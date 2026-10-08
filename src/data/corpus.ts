import type { CorpusManifest, PoetryLine, PoetryWork } from '../types'
import { normalize } from '../engine/poetry'

const BASE = `${import.meta.env.BASE_URL}corpus/`
let manifestPromise: Promise<CorpusManifest> | undefined

export function getManifest(): Promise<CorpusManifest> {
  manifestPromise ??= fetch(`${BASE}manifest.json`).then(async response => {
    if (!response.ok) throw new Error('诗词题库清单加载失败。')
    return response.json() as Promise<CorpusManifest>
  }).catch(error => { manifestPromise = undefined; throw error })
  return manifestPromise
}

async function query<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/poetry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  let data: { result?: T; error?: string }
  try { data = await response.json() as { result?: T; error?: string } }
  catch { throw new Error('本地 SQLite 题库服务不可用。') }
  if (!response.ok) throw new Error(data.error || '题库查询失败。')
  return data.result as T
}

export async function getPoem(line: PoetryLine): Promise<PoetryWork> {
  if (line.sourceFile === 'manual-review') throw new Error('人工复核诗句没有收录的全诗。')
  return query<PoetryWork>({ action: 'poem', sourceFile: line.sourceFile, sourceIndex: line.sourceIndex })
}

export async function findLine(raw: string): Promise<PoetryLine | undefined> {
  return (await query<PoetryLine | null>({ action: 'line', normalized: normalize(raw) })) || undefined
}

export function findSolutions(a: string, b: number, c: string, usedIds: string[], limit = 8, preferFamiliar = false): Promise<PoetryLine[]> {
  return query<PoetryLine[]>({ action: 'solutions', a: normalize(a), b, c: normalize(c), usedIds, limit, preferFamiliar })
}

export function countSolutions(a: string, b: number, c: string, usedIds: string[]): Promise<number> {
  return query<number>({ action: 'count', a: normalize(a), b, c: normalize(c), usedIds })
}

export function randomLine(length: 5 | 7 = 5, preferFamiliar = false, usedIds: string[] = []): Promise<PoetryLine> {
  return query<PoetryLine>({ action: 'random', length, preferFamiliar, usedIds })
}

export function botOptions(a: PoetryLine, length: number, usedIds: string[], preferFamiliar: boolean): Promise<PoetryLine[]> {
  return query<PoetryLine[]>({ action: 'botOptions', a: a.normalized, aId: a.id, length, usedIds, preferFamiliar })
}
