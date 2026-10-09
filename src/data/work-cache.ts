import type { PoetryWork } from '../types'

type Entry = { id: string; work: PoetryWork; touched: number }
const memory = new Map<string, Entry>()
let database: Promise<IDBDatabase | null> | undefined
let loaded: Promise<void> | undefined

function open(): Promise<IDBDatabase | null> {
  database ??= new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(null); return }
    try {
      const request = indexedDB.open('poetry-shefu-poems', 1)
      let settled = false
      const finish = (value: IDBDatabase | null) => { if (!settled) { settled = true; resolve(value) } else value?.close() }
      const timer = setTimeout(() => finish(null), 1000)
      request.onupgradeneeded = () => request.result.createObjectStore('works', { keyPath: 'id' })
      request.onsuccess = () => { clearTimeout(timer); finish(request.result) }
      request.onerror = request.onblocked = () => { clearTimeout(timer); finish(null) }
    } catch { resolve(null) }
  })
  return database
}

async function load(): Promise<void> {
  loaded ??= (async () => {
    const db = await open()
    if (!db) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1000)
      try {
        const request = db.transaction('works').objectStore('works').getAll()
        request.onsuccess = () => {
          clearTimeout(timer)
          const entries = (request.result as Entry[]).filter(entry => entry.work?.provider === 'souyun' && Array.isArray(entry.work.paragraphs))
          for (const entry of entries.sort((a, b) => a.touched - b.touched).slice(-500)) memory.set(entry.id, entry)
          resolve()
        }
        request.onerror = () => { clearTimeout(timer); resolve() }
      } catch { clearTimeout(timer); resolve() }
    })
  })()
  return loaded
}

function persist(entry: Entry, removed: string[]): void {
  void open().then(db => {
    if (!db) return
    try {
      const tx = db.transaction('works', 'readwrite')
      const store = tx.objectStore('works')
      store.put(entry)
      removed.forEach(id => store.delete(id))
      tx.onerror = () => { /* Memory remains available when storage is full. */ }
    } catch { /* Memory remains available when storage is disabled. */ }
  })
}

export async function rememberWork(work: PoetryWork): Promise<void> {
  if (!work.id || work.provider !== 'souyun') return
  await load()
  const entry = { id: work.id, work, touched: Date.now() }
  memory.delete(entry.id)
  memory.set(entry.id, entry)
  const removed: string[] = []
  while (memory.size > 500) {
    const oldest = memory.keys().next().value!
    memory.delete(oldest); removed.push(oldest)
  }
  persist(entry, removed)
}

export async function cachedWorks(): Promise<PoetryWork[]> {
  await load()
  return [...memory.values()].map(entry => entry.work)
}

export async function cachedWork(id: string): Promise<PoetryWork | undefined> {
  await load()
  const entry = memory.get(id)
  if (!entry) return undefined
  await rememberWork(entry.work)
  return entry.work
}
