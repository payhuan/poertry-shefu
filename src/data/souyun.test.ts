import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const poem = { Id: 30425, Author: '杜甫', Dynasty: '唐', Title: { Content: '江畔独步寻花七绝句' }, Clauses: [{ Content: '留连戏蝶时时舞，' }] }
const page = { ShiData: [poem], Count: 1, PageSize: 20, PageNo: 0 }
beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Souyun public API boundaries', () => {
  it('accepts real id-query pagination and null no-match responses', async () => {
    const { parsePage, workLines } = await import('./souyun')
    expect(parsePage(null, 0).works).toEqual([])
    const parsed = parsePage({ ...page, Count: 0, PageSize: 0 }, 0)
    expect(workLines(parsed.works[0])[0].normalized).toBe('留连戏蝶时时舞')
    expect(() => parsePage({ ...page, PageNo: 9 }, 0)).toThrow('格式异常')
  })
  it('does not interpret rate limits, HTTP errors or non-JSON responses as empty matches', async () => {
    const { SearchBudget, searchPoems } = await import('./souyun')
    for (const response of [{ ok: false, status: 429 }, { ok: false, status: 503 }, { ok: true, json: async () => { throw Error('HTML') } }]) {
      vi.stubGlobal('fetch', vi.fn(async () => response))
      const budget = new SearchBudget()
      expect((await searchPoems('留连戏蝶时时舞', budget)).complete).toBe(false)
      budget.close()
    }
  })
  it('merges concurrent identical requests and caps global concurrency at two', async () => {
    let active = 0, peak = 0
    const fetchMock = vi.fn(async () => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return { ok: true, json: async () => page }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { SearchBudget, searchPoems } = await import('./souyun')
    const budgets = [new SearchBudget(), new SearchBudget(), new SearchBudget()]
    await Promise.all(budgets.map(budget => searchPoems('同一请求', budget)))
    budgets.forEach(budget => budget.close())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(peak).toBe(2)
  })
  it('returns an incomplete result after the operation deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Error('aborted')))
    })))
    const { SearchBudget, searchPoems } = await import('./souyun')
    const budget = new SearchBudget(), result = searchPoems('慢查询', budget)
    await vi.advanceTimersByTimeAsync(15001)
    expect((await result).complete).toBe(false)
    expect((await result).message).toContain('超时')
    budget.close()
  })
  it('stores at most 500 successful works and refreshes recently used entries without IndexedDB', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw Error('disabled') } })
    const { rememberWork, cachedWork, cachedWorks } = await import('./work-cache')
    for (let index = 0; index < 500; index++) await rememberWork({ id: `souyun:${index}`, provider: 'souyun', author: '作者', title: '作品', dynasty: '唐', paragraphs: ['诗句'] })
    await cachedWork('souyun:0')
    await rememberWork({ id: 'souyun:500', provider: 'souyun', author: '作者', title: '作品', dynasty: '唐', paragraphs: ['诗句'] })
    expect(await cachedWork('souyun:0')).toBeDefined()
    expect(await cachedWork('souyun:1')).toBeUndefined()
    expect(await cachedWorks()).toHaveLength(500)
  })
})
