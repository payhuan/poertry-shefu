import { createHash } from 'node:crypto'
import { readFile, readdir, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, 'data/cache')
const source = JSON.parse(await readFile(path.join(root, 'data/source-manifest.json'), 'utf8'))

for (const file of [...source.files, 'LICENSE']) {
  const target = path.resolve(cacheDir, file.replaceAll('/', '__'))
  if (path.dirname(target) !== cacheDir) throw new Error(`Unsafe cache path: ${file}`)
  let body
  try { body = await readFile(target) } catch (error) {
    if (error.code === 'ENOENT') continue
    throw error
  }
  const actual = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')
  if (actual !== source.blobs[file]) throw new Error(`Cache file differs from pinned source: ${file}`)
  await rm(target)
}
if ((await readdir(cacheDir)).length === 0) await rmdir(cacheDir)
