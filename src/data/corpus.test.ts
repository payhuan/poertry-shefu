import { afterAll, expect, it, vi } from 'vitest'
import { getPoem } from './corpus'
import type { PoetryLine } from '../types'

const fetchMock = vi.fn(async (_url: string) => ({
  ok: true,
  json: async () => ({ result: { author: '作者', title: '作品', dynasty: '唐', paragraphs: ['第一句，第二句。', '第三句。'] } }),
}))
vi.stubGlobal('fetch', fetchMock)
afterAll(() => vi.unstubAllGlobals())

it('loads the complete work for a line from local SQLite', async () => {
  const line = { sourceFile: 'source.json', sourceIndex: 4 } as PoetryLine
  const work = await getPoem(line)
  expect(work.paragraphs).toEqual(['第一句，第二句。', '第三句。'])
  expect((await getPoem(line)).title).toBe('作品')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[1][0]).toContain('api/poetry')
})
