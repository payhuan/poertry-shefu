import type { CorpusManifest, PoetryLine, PoetryWork } from '../types'
import { characters, hasSharedCharacter, normalize } from '../engine/poetry'
import { cachedWork, cachedWorks, rememberWork } from './work-cache'
import { fetchWork, LookupError, searchPoems, SearchBudget, workLines } from './souyun'
import { pickLine } from '../engine/familiarity'

const BASE = `${import.meta.env.BASE_URL}corpus/`
type SeedWork = PoetryWork & { id: string; sourceFile: string; sourceIndex: number }
type Seed = { schemaVersion: number; lines: PoetryLine[]; works: SeedWork[] }
let manifestPromise: Promise<CorpusManifest> | undefined
let seedPromise: Promise<{ lines: PoetryLine[]; works: Map<string, SeedWork> }> | undefined

export function getManifest(): Promise<CorpusManifest> {
  manifestPromise ??= fetch(`${BASE}seed-manifest.json`).then(async response => {
    if (!response.ok) throw new Error('轻量题池清单加载失败，请刷新重试。')
    return response.json() as Promise<CorpusManifest>
  }).catch(error => { manifestPromise = undefined; throw error })
  return manifestPromise
}

async function seed() {
  seedPromise ??= getManifest().then(async manifest => {
    const response = await fetch(`${BASE}${manifest.seedFile}`)
    if (!response.ok) throw new Error('轻量题池加载失败，请刷新重试。')
    const data = await response.json() as Seed
    if (data.schemaVersion !== 1 || !Array.isArray(data.lines) || !Array.isArray(data.works)) throw new Error('轻量题池格式异常。')
    const works = new Map(data.works.map(work => [work.id, work]))
    const lines = data.lines.map(line => {
      const work = works.get(line.poemId)
      if (!work) throw new Error('轻量题池缺少对应作品。')
      return { ...line, author: work.author, title: work.title, dynasty: work.dynasty,
        sourceFile: work.sourceFile, sourceIndex: work.sourceIndex, work }
    })
    return { lines, works }
  }).catch(error => { seedPromise = undefined; throw error })
  return seedPromise
}

async function availableLines(): Promise<PoetryLine[]> {
  const [data, works] = await Promise.all([seed(), cachedWorks()])
  return unique([...data.lines, ...works.flatMap(workLines)])
}

function unique(lines: PoetryLine[]): PoetryLine[] {
  return [...new Map(lines.map(line => [line.normalized, line])).values()]
}

function unused(line: PoetryLine, used: string[]): boolean {
  return !used.includes(line.id) && !used.includes(line.normalized) && !used.includes(`text:${line.normalized}`)
}

export type LineLookup = { status: 'found'; line: PoetryLine } | { status: 'not-found' } | { status: 'incomplete'; message: string }

export async function lookupLine(raw: string, sharedBudget?: SearchBudget): Promise<LineLookup> {
  const normalized = normalize(raw)
  const local = (await availableLines()).find(line => line.normalized === normalized)
  if (local) { if (local.work?.provider === 'souyun') await rememberWork(local.work); return { status: 'found', line: local } }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'incomplete', message: '当前离线，此句不在内置或缓存作品中。请联网后重试。' }
  const budget = sharedBudget || new SearchBudget()
  try {
    const result = await searchPoems(normalized, budget, 3, work => workLines(work).some(line => line.normalized === normalized))
    const found = result.works.flatMap(workLines).find(line => line.normalized === normalized)
    if (found) return { status: 'found', line: found }
    return result.complete ? { status: 'not-found' } : { status: 'incomplete', message: result.message || '本次检索未完成，请重试。' }
  } finally { if (!sharedBudget) budget.close() }
}

export async function findLine(raw: string, budget?: SearchBudget): Promise<PoetryLine | undefined> {
  const result = await lookupLine(raw, budget)
  if (result.status === 'incomplete') throw new LookupError(result.message, 'incomplete')
  return result.status === 'found' ? result.line : undefined
}

export async function getPoem(line: PoetryLine): Promise<PoetryWork> {
  if (line.sourceFile === 'manual-review') throw new Error('人工复核诗句没有收录的全诗。')
  if (line.work) return line.work
  const data = await seed()
  const work = data.works.get(line.poemId) || [...data.works.values()].find(work => work.sourceFile === line.sourceFile && work.sourceIndex === line.sourceIndex)
  if (work) return work
  if (line.poemId.startsWith('souyun:')) return (await cachedWork(line.poemId)) || fetchWork(line.poemId)
  const found = await findLine(line.text)
  if (!found?.work) throw new Error('本次检索未找到这句诗对应的唐宋作品，请稍后重试。')
  return found.work
}

export async function findSolutions(a: string, b: number, c: string, used: string[], limit = 8, preferFamiliar = false, sharedBudget?: SearchBudget): Promise<PoetryLine[]> {
  const fits = (line: PoetryLine) => line.length === b && line.normalized.includes(normalize(c)) && hasSharedCharacter(a, line.normalized) && unused(line, used)
  const local = (await availableLines()).filter(fits)
  if (local.length) return (preferFamiliar ? local.sort((x, y) => (y.familiarity || 0) - (x.familiarity || 0)) : local).slice(0, limit)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new LookupError('当前离线，内置和缓存作品中没有符合条件的答案。请联网重试或结束后调整字数。')
  const budget = sharedBudget || new SearchBudget()
  try {
    const result = await searchPoems(normalize(c), budget, 3, work => workLines(work).some(fits))
    const lines = unique(result.works.flatMap(workLines).filter(fits)).slice(0, limit)
    if (!lines.length && !result.complete) throw new LookupError(result.message || '本次检索未完成，尚不能确认可用答案，请重试。', 'incomplete')
    return lines
  } finally { if (!sharedBudget) budget.close() }
}

export async function candidateLines(a: PoetryLine, min: number, max: number, used: string[], onlineFirst: boolean, budget: SearchBudget): Promise<PoetryLine[]> {
  const chars = new Set(characters(a.normalized))
  const fits = (line: PoetryLine) => line.length >= min && line.length <= max && unused(line, used) &&
    hasSharedCharacter(a.normalized, line.normalized) && characters(line.normalized).some(char => !chars.has(char))
  const local = (await availableLines()).filter(fits)
  if (local.length && !onlineFirst) return local
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (local.length) return local
    throw new LookupError('当前离线，题池中没有符合字数范围的接龙答案。请联网重试或结束后调整字数。')
  }
  let message = '本次检索未找到可用的接龙答案。请重试或结束后调整字数范围。'
  for (const char of chars) {
    if (budget.remaining < 2 || budget.controller.signal.aborted) break
    const result = await searchPoems(char, budget, 1)
    const lines = unique(result.works.flatMap(workLines).filter(fits))
    if (lines.length) return lines
    message = result.message || message
  }
  if (local.length) return local
  throw new LookupError(message, 'incomplete')
}

export async function randomLine(length: 5 | 7 = 5, preferFamiliar = false, used: string[] = [], sharedBudget?: SearchBudget): Promise<PoetryLine> {
  const local = (await availableLines()).filter(line => line.length === length && unused(line, used))
  if (!preferFamiliar && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
    const budget = sharedBudget || new SearchBudget()
    try {
      const keys = ['春', '山', '月', '风', '花', '江', '云', '人']
      const result = await searchPoems(keys[Math.floor(Math.random() * keys.length)], budget, 1)
      const online = result.works.flatMap(workLines).filter(line => line.length === length && unused(line, used))
      if (online.length) return online[Math.floor(Math.random() * online.length)]
    } finally { if (!sharedBudget) budget.close() }
  }
  const selected = pickLine(local, true)
  if (!selected) throw new Error('内置及缓存作品中没有可用诗句，请联网重试或调整设置。')
  return selected
}

export async function countSolutions(a: string, b: number, c: string, used: string[]): Promise<number> {
  return (await findSolutions(a, b, c, used, 100)).length
}

export async function botOptions(a: PoetryLine, length: number, used: string[], preferFamiliar: boolean): Promise<PoetryLine[]> {
  const budget = new SearchBudget()
  try { return await candidateLines(a, length, length, used, !preferFamiliar, budget) } finally { budget.close() }
}
