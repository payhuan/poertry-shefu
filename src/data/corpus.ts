import type { CorpusManifest, PoetryLine } from '../types'
import { lineFits, normalize } from '../engine/poetry'

const memory = new Map<number, PoetryLine[]>()
let manifestPromise: Promise<CorpusManifest> | undefined
const BASE = `${import.meta.env.BASE_URL}corpus/`

function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null)
  return new Promise(resolve => {
    const request = indexedDB.open('poetry-shefu-corpus', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('shards')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function cachedShard(key: string): Promise<PoetryLine[] | null> {
  const db = await openDatabase()
  if (!db) return null
  return new Promise(resolve => {
    const request = db.transaction('shards', 'readonly').objectStore('shards').get(key)
    request.onsuccess = () => { db.close(); resolve((request.result as PoetryLine[]) || null) }
    request.onerror = () => { db.close(); resolve(null) }
  })
}

async function saveShard(key: string, lines: PoetryLine[]): Promise<void> {
  const db = await openDatabase()
  if (!db) return
  return new Promise(resolve => {
    const transaction = db.transaction('shards', 'readwrite')
    transaction.objectStore('shards').put(lines, key)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); resolve() }
  })
}

export function getManifest(): Promise<CorpusManifest> {
  manifestPromise ??= fetch(`${BASE}manifest.json`).then(async response => {
    if (!response.ok) throw new Error('诗词题库清单加载失败。')
    return response.json() as Promise<CorpusManifest>
  }).catch(error => { manifestPromise = undefined; throw error })
  return manifestPromise
}

export async function getLines(length: number): Promise<PoetryLine[]> {
  if (memory.has(length)) return memory.get(length)!
  const manifest = await getManifest()
  if (!manifest.counts[String(length)]) return []
  const key = `${manifest.version}:${length}`
  let lines = await cachedShard(key)
  if (!lines) {
    const response = await fetch(`${BASE}lines-${length}.json`)
    if (!response.ok) throw new Error(`${length} 字诗句加载失败。`)
    lines = await response.json() as PoetryLine[]
    void saveShard(key, lines)
  }
  memory.set(length, lines)
  return lines
}

export async function findLine(raw: string): Promise<PoetryLine | undefined> {
  const normalized = normalize(raw)
  const lines = await getLines([...normalized].length)
  return lines.find(line => line.normalized === normalized)
}

export async function findSolutions(a: string, b: number, c: string, usedIds: string[], limit = 8): Promise<PoetryLine[]> {
  const lines = await getLines(b)
  const used = new Set(usedIds)
  const matches: PoetryLine[] = []
  for (const line of lines) {
    if (!used.has(line.id) && lineFits(a, b, c, line)) {
      matches.push(line)
      if (matches.length >= limit) break
    }
  }
  return matches
}

export async function randomLine(length: 5 | 7 = 5): Promise<PoetryLine> {
  const lines = await getLines(length)
  if (!lines.length) throw new Error('题库中没有可用诗句。')
  return lines[Math.floor(Math.random() * lines.length)]
}

