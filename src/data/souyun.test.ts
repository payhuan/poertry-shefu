import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const poem = { Id: 30425, Author: '杜甫', Dynasty: '唐', Title: { Content: '江畔独步寻花七绝句' }, Clauses: [{ Content: '留连戏蝶时时舞，' }] }
const page = { ShiData: [poem], Count: 1, PageSize: 20, PageNo: 0 }
beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Souyun public API boundaries', () => {
  it('reads positioned variant comments without accepting ordinary annotations as verses', async () => {
    const { parsePage, workLines } = await import('./souyun')
    const parsed = parsePage({ ...page, ShiData: [{ ...poem, Clauses: [
      { Content: '谁为不平事。', Comments: [{ Content: '一作有', Type: 'Text', Index: 2 }, { Content: '普通注释', Type: 'Text', Index: 5 }] },
      { Content: '今日把似君，', Comments: [{ Content: '一作示。一作事', Type: 'Text', Index: 4 }] },
      { Content: '春风又绿江南岸。', Comments: [{ Content: '一作东风', Type: 'Text', Index: 2 }, { Content: '一作吹绿', Type: 'Text', Index: 4 }, { Content: '一作错误', Type: 'Text', Index: 99 }] },
    ] }] }, 0)
    const lines = workLines(parsed.works[0]).map(line => line.normalized)
    expect(lines).toContain('谁有不平事')
    expect(lines).toContain('谁为不平事')
    expect(lines).toContain('今日把示君')
    expect(lines).toContain('今日把事君')
    expect(lines).toContain('东风吹绿江南岸')
    expect(lines.some(line => line.includes('普通注释') || line.includes('错误'))).toBe(false)
  })
  it('accepts all combinations of annotated variants and preserves the displayed source', async () => {
    const { parsePage, workLines, splitClauses } = await import('./souyun')
    const original = '乡音难（一作无）改鬓（一作面）毛衰。'
    const parsed = parsePage({ ...page, ShiData: [{ ...poem, Clauses: [{ Content: original }] }] }, 0)
    expect(workLines(parsed.works[0]).map(line => line.normalized)).toEqual([
      '乡音难改鬓毛衰', '乡音难改面毛衰', '乡音无改鬓毛衰', '乡音无改面毛衰',
    ])
    expect(parsed.works[0].paragraphs).toEqual([original])
    expect(splitClauses(['乡音难(一作無、未)改鬓毛衰，笑问客从何处来（注：问来处）。'])).toEqual([
      '乡音难改鬓毛衰', '乡音無改鬓毛衰', '乡音未改鬓毛衰', '笑问客从何处来',
    ])
  })
  it('replaces as many preceding Han characters as each alternative contains', async () => {
    const { splitClauses } = await import('./souyun')
    expect(splitClauses(['春风（一作东风）又绿江南岸。'])).toEqual(['春风又绿江南岸', '东风又绿江南岸'])
    expect(splitClauses(['春风又绿（一作吹绿）江南岸。'])).toEqual(['春风又绿江南岸', '春风吹绿江南岸'])
    expect(splitClauses(['春风又绿江南岸（一作到江南）。'])).toEqual(['春风又绿江南岸', '春风又绿到江南'])
    expect(splitClauses(['春风又绿（一作青、吹绿）江南岸。'])).toEqual(['春风又绿江南岸', '春风又青江南岸', '春风吹绿江南岸'])
    expect(splitClauses(['风（一作东风）。'])).toEqual(['风'])
  })
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const distinct = [new SearchBudget(), new SearchBudget(), new SearchBudget()]
    await Promise.all(distinct.map((budget, index) => searchPoems(`不同请求${index}`, budget)))
    distinct.forEach(budget => budget.close())
    expect(fetchMock).toHaveBeenCalledTimes(4)
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
