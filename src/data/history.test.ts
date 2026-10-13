import { afterEach, expect, it, vi } from 'vitest'
import { clearStoredGameRecords } from './history'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('deletes legacy game records without reading or writing games or clearing poetry preferences', async () => {
  const values = new Map([
    ['poetry-shefu-current-v1', 'old game'], ['poetry-shefu-history-v1', 'old history'],
    ['poetry-shefu-script', 'traditional'],
  ])
  const storage = { removeItem: vi.fn((key: string) => values.delete(key)), getItem: vi.fn(), setItem: vi.fn() }
  vi.stubGlobal('localStorage', storage)
  const request: { onsuccess?: () => void } = {}
  const database = { deleteDatabase: vi.fn(() => { queueMicrotask(() => request.onsuccess?.()); return request }), open: vi.fn() }
  vi.stubGlobal('indexedDB', database)
  expect(await clearStoredGameRecords()).toBe(true)
  expect([...values.keys()]).toEqual(['poetry-shefu-script'])
  expect(database.deleteDatabase).toHaveBeenCalledWith('poetry-shefu-history')
  expect(database.open).not.toHaveBeenCalled()
  expect(storage.getItem).not.toHaveBeenCalled()
  expect(storage.setItem).not.toHaveBeenCalled()
})

it('works without IndexedDB and does not create a new history database', async () => {
  vi.stubGlobal('localStorage', { removeItem: vi.fn() })
  vi.stubGlobal('indexedDB', undefined)
  expect(await clearStoredGameRecords()).toBe(true)
})

it('reports blocked cleanup so the page can instruct the player to close other tabs', async () => {
  vi.stubGlobal('localStorage', { removeItem: vi.fn() })
  const request: { onblocked?: () => void } = {}
  vi.stubGlobal('indexedDB', { deleteDatabase: () => { queueMicrotask(() => request.onblocked?.()); return request } })
  expect(await clearStoredGameRecords()).toBe(false)
})

it('reports inaccessible storage and bounds an unresponsive database cleanup', async () => {
  vi.stubGlobal('localStorage', { removeItem: () => { throw Error('Storage unavailable') } })
  vi.stubGlobal('indexedDB', undefined)
  expect(await clearStoredGameRecords()).toBe(false)
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', { removeItem: vi.fn() })
  vi.stubGlobal('indexedDB', { deleteDatabase: () => ({}) })
  const result = clearStoredGameRecords()
  await vi.advanceTimersByTimeAsync(1500)
  expect(await result).toBe(false)
})
