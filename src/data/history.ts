import type { GameSession } from '../types'

const SNAPSHOT_KEY = 'poetry-shefu-current-v1'
const FALLBACK_KEY = 'poetry-shefu-history-v1'

export function clearStoredGameRecords(): Promise<boolean> {
  let cleared = true
  for (const key of [SNAPSHOT_KEY, FALLBACK_KEY]) {
    try { localStorage.removeItem(key) } catch { cleared = false }
  }
  if (typeof indexedDB === 'undefined') return Promise.resolve(cleared)
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 1500)
    const finish = (success: boolean) => { clearTimeout(timer); resolve(success && cleared) }
    try {
      const request = indexedDB.deleteDatabase('poetry-shefu-history')
      request.onsuccess = () => finish(true)
      request.onerror = () => finish(false)
      request.onblocked = () => finish(false)
    } catch { finish(false) }
  })
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
