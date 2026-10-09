import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoetryLine } from '../types'

const seed = { schemaVersion: 1, works: [{ id: 'seed:1', author: '辛弃疾', title: '丑奴儿', dynasty: '宋', sourceFile: 'seed.json', sourceIndex: 0, provider: 'seed', paragraphs: ['少年不识愁滋味，爱上层楼。'] }], lines: [{ id: 'old-id', text: '少年不识愁滋味', normalized: '少年不识愁滋味', length: 7, poemId: 'seed:1', familiarity: 2 }] }
const poem = { Id: 30425, Dynasty: '唐', Author: '杜甫', Title: { Content: '江畔独步寻花七绝句' }, Clauses: [{ Content: '留連戲蝶時時舞，' }, { Content: '自在嬌鶯恰恰啼。' }], Comments: [{ Content: '不能将注释当作诗句' }] }
const page = (items: unknown[] = [], count = items.length, pageNo = 0) => ({ ShiData: items, Count: count, PageNo: pageNo, PageSize: 20 })
let online: (url: URL) => unknown
let calls: string[]
beforeEach(() => {
  vi.resetModules(); calls = []
  vi.stubGlobal('navigator', { onLine: true })
  online = () => null
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    const body = url.endsWith('seed-manifest.json') ? { seedFile: 'seed.json' } : url.endsWith('/corpus/seed.json') ? seed : online(new URL(url))
    return { ok: true, json: async () => body }
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('static corpus and online lookup', () => {
  it('uses local lines and complete works without a query service', async () => {
    const { findLine, getPoem } = await import('./corpus')
    const line = (await findLine('少年不識愁滋味'))!
    expect(line.text).toBe('少年不识愁滋味')
    expect((await getPoem(line)).paragraphs).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls.some(url => url.includes('api/poetry'))).toBe(false)
  })
  it('matches a full normalized clause and stores only poem text', async () => {
    online = url => url.searchParams.get('dynasty') === '7' ? page([poem]) : null
    const { lookupLine, getPoem } = await import('./corpus')
    const result = await lookupLine('留连戏蝶时时舞')
    expect(result.status).toBe('found')
    if (result.status !== 'found') throw Error('Expected match')
    expect((await getPoem(result.line)).author).toBe('杜甫')
    expect(JSON.stringify(result.line.work)).not.toContain('不能将注释')
    vi.stubGlobal('navigator', { onLine: false })
    expect((await lookupLine('自在娇莺恰恰啼')).status).toBe('found')
  })
  it('does not accept a substring or a work from another dynasty', async () => {
    online = () => page([{ ...poem, Dynasty: '清' }, poem])
    const { lookupLine } = await import('./corpus')
    expect((await lookupLine('戏蝶时时')).status).toBe('not-found')
  })
  it('distinguishes null empty results from malformed responses and pagination limits', async () => {
    const { lookupLine } = await import('./corpus')
    expect((await lookupLine('这是不存在的句子')).status).toBe('not-found')
    online = () => ({ error: 'broken' })
    expect((await lookupLine('这是另一个句子')).status).toBe('incomplete')
    online = url => page([poem], 999, Number(url.searchParams.get('pageNo')))
    const start = calls.length
    expect((await lookupLine('未出现在诗里的句子')).status).toBe('incomplete')
    expect(calls.length - start).toBe(6)
  })
  it('keeps local answers available offline and explains missing target lengths', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { findLine, findSolutions, candidateLines } = await import('./corpus')
    const { SearchBudget } = await import('./souyun')
    const a = (await findLine('少年不识愁滋味'))!
    expect((await findSolutions('遍插茱萸少一人', 7, '愁', [], 1)).length).toBe(1)
    for (const length of [12, 13, 15]) {
      const budget = new SearchBudget()
      await expect(candidateLines(a, length, length, [], false, budget)).rejects.toThrow('离线')
      budget.close()
    }
    expect((await (await import('./corpus')).lookupLine('未知的诗句')).status).toBe('incomplete')
  })
  it('migrates old poem references by exact source or line text', async () => {
    const { getPoem } = await import('./corpus')
    const old = { poemId: 'old-poem-id', sourceFile: 'seed.json', sourceIndex: 0, text: '少年不识愁滋味' } as PoetryLine
    expect((await getPoem(old)).title).toBe('丑奴儿')
  })
})
