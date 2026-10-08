import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createBrotliDecompress } from 'node:zlib'
import type { Plugin } from 'vite'

type QueryValue = string | number
type Payload = Record<string, unknown>
type Row = Record<string, string | number>

const root = process.cwd()
const corpusDir = path.join(root, 'public/corpus')
const cacheDir = path.join(tmpdir(), `poetry-shefu-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`)
const lineColumns = 'id, text, normalized, length, author, title, dynasty, source_file, source_index, poem_id, familiarity'
const lineTable = 'lines JOIN works USING(work_key)'
let database: DatabaseSync | undefined
let databasePath = ''
let readyPromise: Promise<void> | undefined

async function ensureDatabase(): Promise<void> {
  readyPromise ??= (async () => {
    const manifest = JSON.parse(await readFile(path.join(corpusDir, 'manifest.json'), 'utf8')) as { version: string; databaseParts: string[] }
    if (!Array.isArray(manifest.databaseParts) || !manifest.databaseParts.length) throw new Error('题库分片清单无效。')
    const target = path.join(cacheDir, `poetry-${manifest.version}.sqlite`)
    try {
      if ((await stat(target)).size > 0) { databasePath = target; return }
    } catch { /* The database is unpacked on first use. */ }
    await mkdir(cacheDir, { recursive: true })
    const temporary = `${target}.tmp`
    await rm(temporary, { force: true })
    try {
      async function* archive() {
        for (const part of manifest.databaseParts) {
          if (!/^poetry\.sqlite\.br\.part\d{2}$/.test(part)) throw new Error('题库分片名称无效。')
          for await (const chunk of createReadStream(path.join(corpusDir, part))) yield chunk
        }
      }
      await pipeline(Readable.from(archive()), createBrotliDecompress(), createWriteStream(temporary))
      await rename(temporary, target)
      databasePath = target
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  })().catch(error => { readyPromise = undefined; throw error })
  return readyPromise
}

function db(): DatabaseSync {
  database ??= new DatabaseSync(databasePath, { readOnly: true })
  return database
}

function one(sql: string, params: QueryValue[]): Row | undefined {
  return db().prepare(sql).get(...params) as Row | undefined
}

function all(sql: string, params: QueryValue[]): Row[] {
  return db().prepare(sql).all(...params) as Row[]
}

function line(row: Row) {
  return {
    id: row.id, text: row.text, normalized: row.normalized, length: row.length,
    author: row.author, title: row.title, dynasty: row.dynasty,
    sourceFile: row.source_file, sourceIndex: row.source_index,
    poemId: row.poem_id, familiarity: row.familiarity || undefined,
  }
}

function usedIds(payload: Payload): string[] {
  return Array.isArray(payload.usedIds) ? payload.usedIds.filter((value): value is string => typeof value === 'string').slice(0, 1000) : []
}

function excluded(ids: string[]): string {
  return ids.length ? ` AND id NOT IN (${ids.map(() => '?').join(', ')})` : ''
}

function shared(value: string) {
  const chars = [...new Set([...value])]
  if (!chars.length) throw new Error('上一句不能为空。')
  return { clause: `(${chars.map(() => 'instr(normalized, ?) > 0').join(' OR ')})`, chars }
}

function query(payload: Payload): unknown {
  switch (payload.action) {
    case 'line': {
      const found = one(`SELECT ${lineColumns} FROM ${lineTable} WHERE normalized = ? LIMIT 1`, [String(payload.normalized)])
      return found ? line(found) : null
    }
    case 'poem': {
      const work = one('SELECT author, title, dynasty, paragraphs_json FROM works WHERE source_file = ? AND source_index = ?',
        [String(payload.sourceFile), Number(payload.sourceIndex)])
      if (!work) throw new Error('未找到这句诗对应的全诗。')
      return { author: work.author, title: work.title, dynasty: work.dynasty,
        paragraphs: JSON.parse(String(work.paragraphs_json)) }
    }
    case 'solutions':
    case 'count': {
      const ids = usedIds(payload)
      const { clause, chars } = shared(String(payload.a))
      const where = `length = ? AND instr(normalized, ?) > 0 AND ${clause}${excluded(ids)}`
      const params = [Number(payload.b), String(payload.c), ...chars, ...ids]
      if (payload.action === 'count') return one(`SELECT count(*) AS total FROM lines WHERE ${where}`, params)?.total || 0
      const order = payload.preferFamiliar ? 'familiarity DESC, lines.rowid' : 'lines.rowid'
      const limit = Math.min(100, Math.max(1, Number(payload.limit) || 8))
      return all(`SELECT ${lineColumns} FROM ${lineTable} WHERE ${where} ORDER BY ${order} LIMIT ?`, [...params, limit]).map(line)
    }
    case 'random': {
      const ids = usedIds(payload)
      const base = `length = ?${excluded(ids)}`
      const params: QueryValue[] = [Number(payload.length), ...ids]
      let tier = ''
      if (payload.preferFamiliar) {
        for (const level of [2, 1]) {
          if (Number(one(`SELECT count(*) AS total FROM lines WHERE ${base} AND familiarity = ?`, [...params, level])?.total)) {
            tier = ' AND familiarity = ?'
            params.push(level)
            break
          }
        }
      }
      const total = Number(one(`SELECT count(*) AS total FROM lines WHERE ${base}${tier}`, params)?.total)
      if (!total) throw new Error('题库中没有可用诗句。')
      const offset = Math.floor(Math.random() * total)
      return line(one(`SELECT ${lineColumns} FROM ${lineTable} WHERE ${base}${tier} LIMIT 1 OFFSET ?`, [...params, offset])!)
    }
    case 'botOptions': {
      const ids = usedIds(payload)
      const { clause, chars } = shared(String(payload.a))
      const base = `length = ? AND id <> ? AND ${clause}${excluded(ids)}`
      const params: QueryValue[] = [Number(payload.length), String(payload.aId), ...chars, ...ids]
      const tier = payload.preferFamiliar ? ' AND familiarity > 0' : ''
      const total = Number(one(`SELECT count(*) AS total FROM lines WHERE ${base}${tier}`, params)?.total)
      if (!total) return []
      const offset = Math.floor(Math.random() * total)
      const sql = `SELECT ${lineColumns} FROM ${lineTable} WHERE ${base}${tier} LIMIT 300 OFFSET ?`
      const sample = all(sql, [...params, offset])
      if (sample.length < 300 && offset) sample.push(...all(sql, [...params, 0]).slice(0, 300 - sample.length))
      return sample.map(line)
    }
    default:
      throw new Error('未知的题库操作。')
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > 64 * 1024) throw new Error('请求过大。')
      chunks.push(bytes)
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Payload
    await ensureDatabase()
    const result = query(payload)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ result }))
  } catch (error) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: (error as Error).message }))
  } finally {
    database?.close()
    database = undefined
  }
}

export function poetryApi(): Plugin {
  return {
    name: 'local-poetry-sqlite',
    configureServer(server) { server.middlewares.use('/api/poetry', (req, res) => { void handle(req, res) }) },
    configurePreviewServer(server) { server.middlewares.use('/api/poetry', (req, res) => { void handle(req, res) }) },
  }
}
