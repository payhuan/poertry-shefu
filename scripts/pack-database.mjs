import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { constants, createBrotliCompress } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const corpusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/corpus')
const sqlitePath = path.join(corpusDir, 'poetry.sqlite')
const archivePath = `${sqlitePath}.br`
const temporaryPath = `${archivePath}.tmp`
const manifestPath = path.join(corpusDir, 'manifest.json')
const partSize = 32 * 1024 * 1024

try {
  await stat(sqlitePath)
  await rm(temporaryPath, { force: true })
  await pipeline(
    createReadStream(sqlitePath),
    createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 7 } }),
    createWriteStream(temporaryPath),
  )
  await rm(archivePath, { force: true })
  await rename(temporaryPath, archivePath)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  await stat(archivePath)
}
const digest = createHash('sha256')
for await (const chunk of createReadStream(archivePath)) digest.update(chunk)
for (const name of await readdir(corpusDir)) {
  if (/^poetry\.sqlite\.br\.part\d{2}$/.test(name)) await rm(path.join(corpusDir, name))
}
const parts = []
const archiveSize = (await stat(archivePath)).size
for (let start = 0; start < archiveSize; start += partSize) {
  const name = `poetry.sqlite.br.part${String(parts.length).padStart(2, '0')}`
  await pipeline(
    createReadStream(archivePath, { start, end: Math.min(start + partSize, archiveSize) - 1 }),
    createWriteStream(path.join(corpusDir, name)),
  )
  parts.push(name)
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.version = digest.digest('hex').slice(0, 16)
manifest.databaseParts = parts
delete manifest.database
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
await rm(archivePath)
await rm(sqlitePath, { force: true })
