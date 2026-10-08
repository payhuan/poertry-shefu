import { afterAll, expect, it, vi } from 'vitest'
import { getPoem } from './corpus'
import type { PoetryLine } from '../types'

const fetchMock = vi.fn(async (url: string) => ({
  ok: true,
  json: async () => url.endsWith('manifest.json')
    ? { files: [{ file: 'source.json' }] }
    : { 4: { author: '作者', title: '作品', dynasty: '唐', paragraphs: ['第一句，第二句。', '第三句。'] } },
}))
vi.stubGlobal('fetch', fetchMock)
afterAll(() => vi.unstubAllGlobals())

it('loads the complete work for a line from its pinned source shard', async () => {
  const line = { sourceFile: 'source.json', sourceIndex: 4 } as PoetryLine
  const work = await getPoem(line)
  expect(work.paragraphs).toEqual(['第一句，第二句。', '第三句。'])
  expect((await getPoem(line)).title).toBe('作品')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[1][0]).toContain('poems-0.json')
})
