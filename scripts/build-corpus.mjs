import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Converter } from 'opencc-js/t2cn'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = JSON.parse(await readFile(path.join(root, 'data/source-manifest.json'), 'utf8'))
const corrections = JSON.parse(await readFile(path.join(root, 'data/corpus-corrections.json'), 'utf8'))
const cacheDir = path.join(root, 'data/cache')
const outDir = path.join(root, 'public/corpus')
const databasePath = path.join(outDir, 'poetry.sqlite')
const temporaryPath = `${databasePath}.tmp`
await mkdir(cacheDir, { recursive: true })
await mkdir(outDir, { recursive: true })

const toSimplified = Converter({ from: 't', to: 'cn' })
const hash = value => createHash('sha256').update(value).digest('hex')
const isPinnedBlob = (relativePath, body) => {
  const bytes = Buffer.from(body, 'utf8')
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  return actual === source.blobs[relativePath]
}
const clean = value => [...toSimplified(String(value).normalize('NFKC'))]
  .filter(char => /\p{Script=Han}/u.test(char)).join('')
const isCleanLine = value => /^\p{Script=Han}+$/u.test(value)
const splitLines = paragraph => String(paragraph)
  .split(/[，。！？；、,.!?;：:\n\r]+/u)
  .map(part => part.trim()).filter(Boolean)

async function fetchPinned(relativePath) {
  const cachePath = path.join(cacheDir, relativePath.replaceAll('/', '__'))
  try {
    const cached = await readFile(cachePath, 'utf8')
    if (isPinnedBlob(relativePath, cached)) return cached
  } catch { /* Download on first build. */ }
  const url = `https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/${source.commit}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.text()
      if (!isPinnedBlob(relativePath, body)) throw new Error('Git blob hash mismatch')
      await writeFile(cachePath, body)
      return body
    } catch (error) {
      if (attempt === 4) throw new Error(`Unable to fetch ${relativePath}: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, attempt * 1000))
    }
  }
}

// Downloads run concurrently, while insertion preserves the source order.
let nextFile = 0
let ready = 0
await Promise.all(Array.from({ length: 8 }, async () => {
  while (nextFile < source.files.length) {
    const file = source.files[nextFile++]
    await fetchPinned(file)
    ready += 1
    if (ready % 25 === 0 || ready === source.files.length) console.log(`Source files ready: ${ready}/${source.files.length}`)
  }
}))

await rm(temporaryPath, { force: true })
const db = new DatabaseSync(temporaryPath)
db.exec(`
  PRAGMA page_size = 8192;
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;
  PRAGMA temp_store = MEMORY;
  CREATE TABLE works (
    work_key INTEGER PRIMARY KEY, source_file TEXT NOT NULL, source_index INTEGER NOT NULL,
    author TEXT NOT NULL, title TEXT NOT NULL, dynasty TEXT NOT NULL,
    paragraphs_json TEXT NOT NULL, poem_id TEXT NOT NULL,
    UNIQUE (source_file, source_index)
  );
  CREATE TABLE lines (
    id TEXT PRIMARY KEY, text TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE,
    length INTEGER NOT NULL, work_key INTEGER NOT NULL,
    familiarity INTEGER NOT NULL DEFAULT 0
  );
`)
const insertWork = db.prepare('INSERT INTO works(source_file, source_index, author, title, dynasty, paragraphs_json, poem_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
const insertLine = db.prepare('INSERT OR IGNORE INTO lines VALUES (?, ?, ?, ?, ?, ?)')
const updateFamiliarity = db.prepare('UPDATE lines SET familiarity = max(familiarity, ?) WHERE normalized = ?')

const fileStats = []
let segments = 0
let rejected = 0
let duplicates = 0
let correctionsApplied = 0

try {
  for (const file of source.files) {
    const body = await fetchPinned(file)
    const records = JSON.parse(body)
    if (!Array.isArray(records)) throw new Error(`${file}: expected an array`)
    let accepted = 0
    db.exec('BEGIN')
    try {
      for (const [recordIndex, poem] of records.entries()) {
        if (!Array.isArray(poem.paragraphs)) continue
        const author = String(poem.author || '佚名').trim()
        const title = String(poem.title || poem.rhythmic || '无题').trim()
        const dynasty = file.includes('poet.tang') || file.endsWith('唐诗三百首.json') ? '唐' : '宋'
        const paragraphs = poem.paragraphs.map(value => String(value).trim()).filter(Boolean)
        for (const correction of corrections) {
          if (correction.file !== file || correction.index !== recordIndex) continue
          const paragraphIndex = paragraphs.findIndex(value => value.includes(correction.from))
          if (paragraphIndex >= 0) paragraphs[paragraphIndex] = paragraphs[paragraphIndex].replace(correction.from, correction.to)
          else if (!paragraphs.some(value => value.includes(correction.to))) {
            throw new Error(`Correction source not found: ${file}#${recordIndex}`)
          }
          correctionsApplied += 1
        }
        const workKey = Number(insertWork.run(file, recordIndex, author, title, dynasty,
          JSON.stringify(paragraphs), String(poem.id || `${file}#${recordIndex}`)).lastInsertRowid)
        const tags = Array.isArray(poem.tags) ? poem.tags.map(String) : []
        const familiarity = tags.some(tag => /小学古诗|初中古诗|高中古诗|[一二三四五六七八九]年级|高[一二三]年级/u.test(tag))
          ? 2 : file.endsWith('三百首.json') || tags.some(tag => tag.includes('诗三百首') || tag.includes('词三百首')) ? 1 : 0
        for (const paragraph of paragraphs) {
          for (const text of splitLines(paragraph)) {
            segments += 1
            const normalized = clean(text)
            const length = [...normalized].length
            if (length < 2 || length > 15 || !isCleanLine(text.replace(/[\s　]/gu, '')) || /[□\[\]（）()]/u.test(text)) {
              rejected += 1
              continue
            }
            const id = hash(normalized).slice(0, 20)
            const result = insertLine.run(id, text, normalized, length, workKey, familiarity)
            if (result.changes) accepted += 1
            else {
              duplicates += 1
              if (familiarity) updateFamiliarity.run(familiarity, normalized)
            }
          }
        }
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    fileStats.push({ file, sha256: hash(body), poems: records.length, accepted })
    console.log(`${file}: ${records.length} poems, ${accepted} new lines`)
  }

  db.exec('CREATE INDEX lines_by_length_familiarity ON lines(length, familiarity DESC)')
  db.exec('ANALYZE; VACUUM;')
  const counts = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [String(i + 2), 0]))
  for (const row of db.prepare('SELECT length, count(*) AS count FROM lines GROUP BY length').all()) counts[String(row.length)] = row.count
  const familiarityCounts = { 0: 0, 1: 0, 2: 0 }
  for (const row of db.prepare('SELECT familiarity, count(*) AS count FROM lines GROUP BY familiarity').all()) {
    familiarityCounts[row.familiarity] = row.count
  }
  const totalLines = Object.values(counts).reduce((sum, count) => sum + count, 0)
  db.close()
  await rm(databasePath, { force: true })
  await rename(temporaryPath, databasePath)
  const manifest = {
    version: hash(JSON.stringify({ source, fileStats, corrections })).slice(0, 16),
    repository: source.repository, commit: source.commit, license: source.license,
    totalLines, counts, files: fileStats, database: 'poetry.sqlite',
  }
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(path.join(root, 'data/quality-report.json'), JSON.stringify({
    sourceCommit: source.commit, sourceFiles: fileStats,
    segments, accepted: totalLines, rejected, duplicateNormalizedLines: duplicates, correctionsApplied,
    countsByLength: counts, familiarityCounts,
  }, null, 2) + '\n')
  await writeFile(path.join(outDir, 'LICENSE.txt'), await fetchPinned('LICENSE'))
  for (let length = 2; length <= 15; length += 1) await rm(path.join(outDir, `lines-${length}.json`), { force: true })
  for (let index = 0; index < source.files.length; index += 1) await rm(path.join(outDir, `poems-${index}.json`), { force: true })
  await import('./pack-database.mjs')
  await import('./clean-source-cache.mjs')
  console.log(`Built ${totalLines} unique lines; rejected ${rejected}, merged ${duplicates} duplicates`)
} catch (error) {
  try { db.close() } catch { /* The database may already be closed. */ }
  await rm(temporaryPath, { force: true })
  throw error
}
