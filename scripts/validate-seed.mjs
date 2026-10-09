import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Converter } from 'opencc-js/t2cn'

const root = new URL('../', import.meta.url)
const body = await readFile(new URL('public/corpus/seed.json', root))
const seed = JSON.parse(body)
const manifest = JSON.parse(await readFile(new URL('public/corpus/seed-manifest.json', root), 'utf8'))
const simplify = Converter({ from: 't', to: 'cn' })
const normalize = text => [...simplify(text.normalize('NFKC'))].filter(char => /\p{Script=Han}/u.test(char)).join('')
const works = new Map(seed.works.map(work => [work.id, work]))
const seen = new Set(), counts = {}
assert.equal(seed.schemaVersion, 1)
assert.equal(seed.lines.length, manifest.totalLines)
assert.equal(works.size, manifest.totalWorks)
assert(body.length <= 5 * 1024 * 1024, 'Seed exceeds 5 MiB')
assert.equal(createHash('sha256').update(body).digest('hex'), manifest.sha256)
assert.equal(body.length, manifest.seedBytes)
for (const work of works.values()) {
  assert(['唐', '宋'].includes(work.dynasty))
  assert(work.author && work.title && work.sourceFile && Number.isInteger(work.sourceIndex))
  assert(Array.isArray(work.paragraphs) && work.paragraphs.length)
}
for (const line of seed.lines) {
  const work = works.get(line.poemId)
  assert(work, `Missing work for ${line.id}`)
  assert.equal(line.normalized, normalize(line.text))
  assert.equal(line.length, [...line.normalized].length)
  assert(line.length >= 2 && line.length <= 15)
  assert([1, 2].includes(line.familiarity))
  assert(!seen.has(line.normalized), `Duplicate line ${line.id}`)
  seen.add(line.normalized)
  const clauses = work.paragraphs.flatMap(p => p.split(/[，。！？；、,.!?;：:\n\r]+/u)).map(normalize)
  assert(clauses.includes(line.normalized), `Line absent from work ${line.id}`)
  counts[line.length] = (counts[line.length] || 0) + 1
}
assert.deepEqual(counts, manifest.counts)
console.log(`${fileURLToPath(new URL('public/corpus/seed.json', root))}: ${seed.lines.length} unique lines, ${works.size} works, ${body.length} bytes; valid`)
