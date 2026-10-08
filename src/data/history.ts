import type { GameSession } from '../types'

const SNAPSHOT_KEY = 'poetry-shefu-current-v1'
const FALLBACK_KEY = 'poetry-shefu-history-v1'

export function saveSnapshot(session: GameSession | null): void {
  try {
    if (session) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(session))
    else localStorage.removeItem(SNAPSHOT_KEY)
  } catch { /* The game stays usable when storage is unavailable. */ }
}

export function readSnapshot(): string | null {
  try { return localStorage.getItem(SNAPSHOT_KEY) } catch { return null }
}

function openHistory(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null)
  return new Promise(resolve => {
    const request = indexedDB.open('poetry-shefu-history', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

export async function saveFinished(session: GameSession): Promise<void> {
  const db = await openHistory()
  if (db) {
    await new Promise<void>(resolve => {
      const tx = db.transaction('sessions', 'readwrite')
      tx.objectStore('sessions').put(session)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    })
  } else {
    try {
      const items = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]') as GameSession[]
      localStorage.setItem(FALLBACK_KEY, JSON.stringify([session, ...items.filter(item => item.id !== session.id)].slice(0, 20)))
    } catch { /* No persistent history available. */ }
  }
}

export async function listFinished(): Promise<GameSession[]> {
  const db = await openHistory()
  if (db) {
    return new Promise(resolve => {
      const request = db.transaction('sessions', 'readonly').objectStore('sessions').getAll()
      request.onsuccess = () => { db.close(); resolve((request.result as GameSession[]).sort((a, b) => b.updatedAt - a.updatedAt)) }
      request.onerror = () => { db.close(); resolve([]) }
    })
  }
  try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]') as GameSession[] } catch { return [] }
}

export function exportSessionText(session: GameSession): string {
  const lines = [
    '诗词射覆 · 对局记录',
    `${session.players[0].name} ${session.players[0].score} : ${session.players[1].score} ${session.players[1].name}`,
    `开始：${new Date(session.createdAt).toLocaleString('zh-CN')}`,
    `结束：${new Date(session.updatedAt).toLocaleString('zh-CN')}`,
    '',
  ]
  for (const item of session.records) {
    const setter = session.players[item.setterId].name
    const responder = session.players[item.responderId].name
    const result = item.outcome === 'correct' ? '答对' : item.outcome === 'reviewed' ? '双方复核通过' : item.outcome === 'revealed' ? '揭晓参考答案，答题失败' : item.outcome === 'timeout' ? '超时' : '未答出'
    lines.push(`第 ${item.round} 轮｜${setter} 出题 · ${responder} 答题`)
    lines.push(`题目：${item.prompt}`)
    lines.push(`结果：${result}${item.answer ? ` · ${item.answer}` : ''}`)
    if (item.answerLine?.sourceFile !== 'manual-review' && item.answerLine) {
      lines.push(`出处：${item.answerLine.dynasty} · ${item.answerLine.author}《${item.answerLine.title}》`)
    }
    if (item.reviewReason) lines.push(`复核：${item.reviewReason}`)
    lines.push('')
  }
  return lines.join('\n')
}
