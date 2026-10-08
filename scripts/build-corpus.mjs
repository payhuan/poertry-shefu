import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Converter } from 'opencc-js/t2cn'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = JSON.parse(await readFile(path.join(root, 'data/source-manifest.json'), 'utf8'))
const corrections = JSON.parse(await readFile(path.join(root, 'data/corpus-corrections.json'), 'utf8'))
const cacheDir = path.join(root, 'data/cache')
const outDir = path.join(root, 'public/corpus')
await mkdir(cacheDir, { recursive: true })
await mkdir(outDir, { recursive: true })

const toSimplified = Converter({ from: 't', to: 'cn' })
const hash = value => createHash('sha256').update(value).digest('hex')
const clean = value => [...toSimplified(String(value).normalize('NFKC'))]
  .filter(char => /\p{Script=Han}/u.test(char)).join('')
const isCleanLine = value => /^\p{Script=Han}+$/u.test(value)
const splitLines = paragraph => String(paragraph)
  .split(/[，。！？；、,.!?;：:\n\r]+/u)
  .map(part => part.trim()).filter(Boolean)

async function fetchPinned(relativePath) {
  const url = `https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/${source.commit}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
  const cachePath = path.join(cacheDir, relativePath.replaceAll('/', '__'))
  try { return await readFile(cachePath, 'utf8') } catch { /* Download on first build. */ }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to fetch ${relativePath}: HTTP ${response.status}`)
  const body = await response.text()
  await writeFile(cachePath, body)
  return body
}

const lines = new Map()
const fileStats = []
let segments = 0
let rejected = 0
let duplicates = 0
let correctionsApplied = 0

for (const [fileIndex, file] of source.files.entries()) {
  const body = await fetchPinned(file)
  const records = JSON.parse(body)
  if (!Array.isArray(records)) throw new Error(`${file}: expected an array`)
  let accepted = 0
  const works = {}
  for (const [recordIndex, poem] of records.entries()) {
    const author = String(poem.author || '佚名').trim()
    const title = String(poem.title || poem.rhythmic || '无题').trim()
    if (!Array.isArray(poem.paragraphs)) continue
    const paragraphs = poem.paragraphs.map(value => String(value).trim()).filter(Boolean)
    for (const correction of corrections) {
      if (correction.file !== file || correction.index !== recordIndex) continue
      const paragraphIndex = paragraphs.findIndex(value => value.includes(correction.from))
      if (paragraphIndex >= 0) {
        paragraphs[paragraphIndex] = paragraphs[paragraphIndex].replace(correction.from, correction.to)
      } else if (!paragraphs.some(value => value.includes(correction.to))) {
        throw new Error(`Correction source not found: ${file}#${recordIndex}`)
      }
      correctionsApplied += 1
    }
    const dynasty = file.includes('poet.tang') || file.endsWith('唐诗三百首.json') ? '唐' : '宋'
    const tags = Array.isArray(poem.tags) ? poem.tags.map(String) : []
    const familiarity = tags.some(tag => /小学古诗|初中古诗|高中古诗|[一二三四五六七八九]年级|高[一二三]年级/u.test(tag))
      ? 2 : file.endsWith('三百首.json') || tags.some(tag => tag.includes('诗三百首') || tag.includes('词三百首')) ? 1 : 0
    for (const paragraph of paragraphs) {
      for (const text of splitLines(paragraph)) {
        segments += 1
        const normalized = clean(text)
        const length = [...normalized].length
        // Reject damaged text instead of silently deleting missing glyphs or notes.
        if (length < 2 || length > 15 || !isCleanLine(text.replace(/[\s　]/gu, '')) || /[□\[\]（）()]/u.test(text)) {
          rejected += 1
          continue
        }
        const id = hash(normalized).slice(0, 20)
        if (lines.has(id)) {
          const previous = lines.get(id)
          if (familiarity > (previous.familiarity ?? 0)) previous.familiarity = familiarity
          duplicates += 1
          continue
        }
        const line = {
          id, text, normalized, length, author, title, dynasty,
          sourceFile: file, sourceIndex: recordIndex,
          poemId: String(poem.id || `${file}#${recordIndex}`),
        }
        if (familiarity) line.familiarity = familiarity
        lines.set(id, line)
        works[recordIndex] ??= {
          author, title, dynasty,
          paragraphs,
        }
        accepted += 1
      }
    }
  }
  await writeFile(path.join(outDir, `poems-${fileIndex}.json`), JSON.stringify(works))
  fileStats.push({ file, sha256: hash(body), poems: records.length, accepted })
  console.log(`${file}: ${records.length} poems, ${accepted} new lines`)
}

const counts = {}
const familiarityCounts = { 0: 0, 1: 0, 2: 0 }
for (const line of lines.values()) familiarityCounts[line.familiarity ?? 0] += 1
for (let length = 2; length <= 15; length += 1) {
  const shard = [...lines.values()].filter(line => line.length === length).sort((a, b) => a.id.localeCompare(b.id))
  counts[length] = shard.length
  await writeFile(path.join(outDir, `lines-${length}.json`), JSON.stringify(shard))
}
const manifest = {
  version: hash(JSON.stringify({ source, fileStats, corrections })).slice(0, 16),
  repository: source.repository,
  commit: source.commit,
  license: source.license,
  totalLines: lines.size,
  counts,
  files: fileStats,
}
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(path.join(root, 'data/quality-report.json'), JSON.stringify({
  sourceCommit: source.commit, sourceFiles: fileStats,
  segments, accepted: lines.size, rejected, duplicateNormalizedLines: duplicates, correctionsApplied,
  countsByLength: counts, familiarityCounts,
}, null, 2) + '\n')
await writeFile(path.join(outDir, 'LICENSE.txt'), await fetchPinned('LICENSE'))
console.log(`Built ${lines.size} unique lines; rejected ${rejected}, merged ${duplicates} duplicates`)
