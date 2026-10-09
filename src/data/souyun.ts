import { normalize } from '../engine/poetry'
import type { PoetryLine, PoetryWork } from '../types'
import { rememberWork } from './work-cache'

export const SOUYUN_API = 'https://api.sou-yun.cn/open/Poem'
export class LookupError extends Error {
  constructor(message: string, public readonly kind: 'network' | 'incomplete' = 'network') { super(message); this.name = 'LookupError' }
}

export function splitClauses(paragraphs: string[]): string[] {
  return paragraphs.flatMap(text => text.split(/[，。！？；、,.!?;：:\n\r]+/u)).map(text => text.trim())
    .filter(text => /^\p{Script=Han}+$/u.test(text))
}

export function workLines(work: PoetryWork): PoetryLine[] {
  return splitClauses(work.paragraphs).map((text, index) => {
    const normalized = normalize(text)
    return { id: `text:${normalized}`, text, normalized, length: [...normalized].length, author: work.author,
      title: work.title, dynasty: work.dynasty, sourceFile: work.provider === 'souyun' ? 'souyun' : 'seed',
      sourceIndex: index, poemId: work.id || '', work }
  }).filter(line => line.length >= 2 && line.length <= 15)
}

type Page = { works: PoetryWork[]; count: number; pageNo: number; pageSize: number }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : ''

export function parsePage(value: unknown, requestedPage: number): Page {
  // The public endpoint returns JSON null for an empty search.
  if (value === null) return { works: [], count: 0, pageNo: requestedPage, pageSize: 20 }
  if (!object(value) || !Array.isArray(value.ShiData) || !Number.isInteger(value.Count) || Number(value.Count) < 0 ||
      !Number.isInteger(value.PageSize) || Number(value.PageSize) < 0 || (Number(value.PageSize) === 0 && Number(value.Count) > 0) || value.PageNo !== requestedPage) {
    throw new LookupError('搜韵返回的数据格式异常，请稍后重试。')
  }
  const works: PoetryWork[] = []
  for (const item of value.ShiData) {
    if (!object(item) || !Array.isArray(item.Clauses) || !object(item.Title) || !Number.isInteger(item.Id) ||
        typeof item.Dynasty !== 'string' || !text(item.Author) || !text(item.Title.Content)) {
      throw new LookupError('搜韵返回的作品资料不完整，请稍后重试。')
    }
    if (item.Dynasty !== '唐' && item.Dynasty !== '宋') continue
    const paragraphs = item.Clauses.map(clause => {
      if (!object(clause) || typeof clause.Content !== 'string') throw new LookupError('搜韵返回的诗句资料不完整。')
      return text(clause.Content)
    })
    if (!paragraphs.length || paragraphs.some(paragraph => !paragraph)) throw new LookupError('搜韵返回的作品正文为空。')
    works.push({ id: `souyun:${item.Id}`, provider: 'souyun', author: text(item.Author), title: text(item.Title.Content), dynasty: item.Dynasty, paragraphs })
  }
  return { works, count: Number(value.Count), pageSize: Math.max(1, Number(value.PageSize)), pageNo: requestedPage }
}

export class SearchBudget {
  readonly controller = new AbortController()
  remaining = 6
  private timer = setTimeout(() => this.controller.abort(), 15000)
  close() { clearTimeout(this.timer) }
}

let active = 0
const waiting: (() => void)[] = []
const pending = new Map<string, Promise<unknown>>()

function acquire(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new LookupError('搜韵查询超时，请重试。'))
  if (active < 2) { active++; return Promise.resolve() }
  return new Promise((resolve, reject) => {
    const ready = () => { signal.removeEventListener('abort', abort); resolve() }
    const abort = () => {
      const index = waiting.indexOf(ready)
      if (index >= 0) waiting.splice(index, 1)
      reject(new LookupError('搜韵查询超时，请重试。'))
    }
    waiting.push(ready)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function withinBudget<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new LookupError('搜韵查询超时，请重试。'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function request(url: string, budget: SearchBudget): Promise<unknown> {
  if (!budget.remaining || budget.controller.signal.aborted) throw new LookupError('本次检索未完成，请重试。', 'incomplete')
  budget.remaining--
  try {
    if (budget.controller.signal.aborted) throw new LookupError('搜韵查询超时，请重试。')
    let promise = pending.get(url)
    if (!promise) {
      promise = (async () => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        let acquired = false
        try {
          await acquire(controller.signal); acquired = true
          const response = await fetch(url, { signal: controller.signal })
          if (!response.ok) throw new LookupError(response.status === 429 ? '搜韵查询过于频繁，请稍后重试。' : `搜韵查询暂不可用（${response.status}），请重试。`)
          return await response.json() as unknown
        } finally {
          clearTimeout(timer)
          if (acquired) { const next = waiting.shift(); if (next) next(); else active-- }
        }
      })()
      pending.set(url, promise)
      void promise.finally(() => pending.delete(url)).catch(() => {})
    }
    return await withinBudget(promise, budget.controller.signal)
  } catch (error) {
    if (error instanceof LookupError) throw error
    throw new LookupError(budget.controller.signal.aborted ? '搜韵查询超时，请重试。' : '无法连接搜韵，请检查网络后重试。')
  }
}

export type SearchResult = { works: PoetryWork[]; complete: boolean; message?: string }

export async function searchPoems(key: string, budget: SearchBudget, maxPages = 3, stopWhen?: (work: PoetryWork) => boolean): Promise<SearchResult> {
  const results = await Promise.allSettled([7, 8].map(async dynasty => {
    const works: PoetryWork[] = []
    for (let pageNo = 0; pageNo < maxPages; pageNo++) {
      const params = new URLSearchParams({ key, scope: '3', dynasty: String(dynasty), jsonType: 'true', pageNo: String(pageNo) })
      try {
        const page = parsePage(await request(`${SOUYUN_API}?${params}`, budget), pageNo)
        for (const work of page.works) { works.push(work); await rememberWork(work) }
        if ((pageNo + 1) * page.pageSize >= page.count) return { works, complete: true }
        if (stopWhen && page.works.some(stopWhen)) return { works, complete: false }
      } catch (error) { return { works, complete: false, message: (error as Error).message } }
    }
    return { works, complete: false, message: '检索结果较多，本次未查完，请重试或换一句。' }
  }))
  const works: PoetryWork[] = []
  let complete = true, message: string | undefined
  for (const result of results) {
    if (result.status === 'fulfilled') { works.push(...result.value.works); complete &&= result.value.complete; message ||= result.value.message }
    else { complete = false; message ||= '搜韵查询失败，请重试。' }
  }
  return { works: [...new Map(works.map(work => [work.id, work])).values()], complete, message }
}

export async function fetchWork(id: string): Promise<PoetryWork> {
  if (!/^souyun:\d+$/.test(id)) throw new LookupError('作品编号无效。')
  const budget = new SearchBudget()
  try {
    const params = new URLSearchParams({ key: id.slice(7), jsonType: 'true' })
    const page = parsePage(await request(`${SOUYUN_API}?${params}`, budget), 0)
    const work = page.works.find(work => work.id === id)
    if (!work) throw new LookupError('未找到对应的唐宋作品。')
    await rememberWork(work)
    return work
  } finally { budget.close() }
}
