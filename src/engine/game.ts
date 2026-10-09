import type { GameSession, PlayerId, PoetryLine, Question, RoundRecord, Settings, Stage } from '../types'
import { lineFits, normalize, validateAnswerFormat, validateQuestionShape } from './poetry'

export type GameAction =
  | { type: 'SET_QUESTION'; question: Question; now: number }
  | { type: 'QUERY_START'; requestId: string; kind: 'answer' | 'reference'; now: number }
  | { type: 'QUERY_FAIL'; requestId: string; message: string; now: number }
  | { type: 'QUERY_COMPLETE'; requestId: string; result: 'found' | 'missing' | 'question' | 'reference'; line?: PoetryLine; question?: Question; now: number }
  | { type: 'RECEIVE'; now: number }
  | { type: 'DRAFT'; text: string; now: number }
  | { type: 'ERROR'; message: string; now: number }
  | { type: 'ANSWER_FOUND'; line: PoetryLine; now: number }
  | { type: 'ANSWER_MISSING'; text: string; now: number }
  | { type: 'REVEAL'; line: PoetryLine; now: number }
  | { type: 'NEXT_AFTER_REVEAL'; now: number }
  | { type: 'REQUEST_REVIEW'; reason: string; now: number }
  | { type: 'REVIEW_RECEIVE'; now: number }
  | { type: 'REVIEW_APPROVE'; reason: string; now: number }
  | { type: 'REVIEW_DECLINE'; reason: string; now: number }
  | { type: 'FAIL'; outcome: 'skipped' | 'timeout'; now: number }
  | { type: 'NEXT'; now: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'END'; now: number }
  | { type: 'INVALID_QUESTION'; now: number }

export function other(id: PlayerId): PlayerId { return id === 0 ? 1 : 0 }

export function createSession(settings: Settings, now = Date.now()): GameSession {
  const names = (settings.mode === 'solo' ? [settings.names[0], '系统'] : settings.names).map(value => value.trim()) as [string, string]
  if (!names[0] || !names[1] || names[0] === names[1] || names.some(value => [...value].length > 12)) {
    throw new Error('两位玩家的昵称须不同，且各为 1–12 个字。')
  }
  return {
    schemaVersion: 1, id: crypto.randomUUID(), stage: 'question', settings: { ...settings, names },
    players: names.map((name, id) => ({ id: id as PlayerId, name, score: 0, correctCount: 0, skipCount: 0, streak: 0 })) as GameSession['players'],
    setterId: settings.firstSetter, round: 1, usedLineIds: [], usedLineTexts: [], records: [], draft: '', error: '',
    createdAt: now, updatedAt: now,
  }
}

function record(session: GameSession, outcome: RoundRecord['outcome'], now: number, line?: PoetryLine, reason?: string): RoundRecord {
  const question = session.question!
  return {
    questionId: question.id, round: session.round, setterId: session.setterId, responderId: other(session.setterId),
    prompt: `${question.a.text} / ${question.b} 字 / 含「${question.c}」`,
    answer: line?.text || session.review?.text || session.draft || undefined,
    answerLine: line, outcome, reviewReason: reason,
    reviewedBy: outcome === 'reviewed' ? [other(session.setterId), session.setterId] : undefined,
    time: now,
  }
}

function score(session: GameSession, line: PoetryLine, outcome: 'correct' | 'reviewed', now: number, reason?: string): GameSession {
  const question = session.question
  if (!question || session.records.some(item => item.questionId === question.id)) return session
  const answerer = other(session.setterId)
  const players = session.players.map(player => player.id === answerer
    ? { ...player, score: player.score + 1, correctCount: player.correctCount + 1, streak: player.streak + 1 }
    : player) as GameSession['players']
  const won = session.settings.winningScore > 0 && players[answerer].score >= session.settings.winningScore
  return {
    ...session, stage: won ? 'finished' : 'success', players, lastAnswer: line,
    usedLineIds: [...new Set([...session.usedLineIds, line.id])],
    usedLineTexts: [...new Set([...usedTexts(session), normalize(line.text)])],
    records: [...session.records, record(session, outcome, now, line, reason)],
    review: undefined, deadlineAt: undefined, remainingMs: undefined, queryWait: undefined,
    winnerId: won ? answerer : undefined, error: '', updatedAt: now,
  }
}

function fail(session: GameSession, outcome: 'skipped' | 'timeout', now: number): GameSession {
  if (session.stage !== 'answer' && session.stage !== 'review') return session
  if (!session.question || session.records.some(item => item.questionId === session.question!.id)) return session
  const answerer = other(session.setterId)
  const players = session.players.map(player => player.id === answerer
    ? { ...player, skipCount: player.skipCount + 1, streak: 0 }
    : player) as GameSession['players']
  return {
    ...session, stage: 'question', players, round: session.round + 1,
    records: [...session.records, record(session, outcome, now)],
    question: undefined, carryLine: undefined, lastAnswer: undefined,
    draft: '', error: '', review: undefined, deadlineAt: undefined, remainingMs: undefined, queryWait: undefined, updatedAt: now,
  }
}

export function usedTexts(session: GameSession): string[] {
  return session.usedLineTexts || session.records.filter(record => record.outcome === 'correct' || record.outcome === 'reviewed')
    .map(record => normalize(record.answerLine?.text || record.answer || '')).filter(Boolean)
}

export function transition(session: GameSession, action: GameAction): GameSession {
  const now = action.now
  if (session.queryWait?.status === 'pending' && !['QUERY_COMPLETE', 'QUERY_FAIL', 'PAUSE', 'END'].includes(action.type)) return session
  switch (action.type) {
    case 'QUERY_START': {
      if (session.stage === 'finished' || session.queryWait?.status === 'pending') return session
      const stage = session.stage === 'paused' ? session.pausedFrom || 'question' : session.stage
      if (stage !== 'answer' && stage !== 'question' && action.kind !== 'reference') return session
      if (stage === 'answer' && session.deadlineAt && now >= session.deadlineAt) return fail(session, 'timeout', now)
      return { ...session, stage, pausedFrom: undefined, queryWait: { requestId: action.requestId, kind: action.kind, status: 'pending' },
        remainingMs: session.deadlineAt ? Math.max(0, session.deadlineAt - now) : session.remainingMs,
        deadlineAt: undefined, error: '', updatedAt: now }
    }
    case 'QUERY_FAIL':
      if (session.queryWait?.requestId !== action.requestId || session.queryWait.status !== 'pending') return session
      return { ...session, pausedFrom: session.stage, stage: 'paused', queryWait: { ...session.queryWait, status: 'failed', message: action.message }, error: action.message, updatedAt: now }
    case 'QUERY_COMPLETE': {
      if (session.queryWait?.requestId !== action.requestId || session.queryWait.status !== 'pending' || session.stage === 'paused') return session
      const ready = { ...session, queryWait: undefined, remainingMs: session.stage === 'answer' ? undefined : session.remainingMs,
        deadlineAt: session.stage === 'answer' && session.remainingMs !== undefined ? now + session.remainingMs : undefined, updatedAt: now }
      if (action.result === 'question' && action.question) return transition(ready, { type: 'SET_QUESTION', question: action.question, now })
      if (action.result === 'reference' && action.line?.work && session.question && lineFits(session.question.a.normalized, session.question.b, session.question.c, action.line)) {
        return { ...ready, question: { ...session.question, referenceLine: action.line } }
      }
      if (action.result === 'found' && action.line) return transition(ready, { type: 'ANSWER_FOUND', line: action.line, now })
      if (action.result === 'missing') return session.settings.mode === 'local'
        ? transition(ready, { type: 'ANSWER_MISSING', text: session.draft, now })
        : { ...ready, error: '本次搜韵检索未找到此句，这不表示诗句不存在。可修改答案或揭晓参考答案。' }
      return { ...ready, error: '查询结果无法用于当前题目，请重试。' }
    }
    case 'SET_QUESTION': {
      if (session.stage !== 'question') return session
      const q = action.question
      const error = validateQuestionShape(q.a.text, q.b, q.c, session.settings.minLength, session.settings.maxLength)
      if (error || !q.referenceLine?.work || !lineFits(q.a.normalized, q.b, q.c, q.referenceLine) ||
          usedTexts(session).includes(q.referenceLine.normalized) || (session.carryLine && normalize(session.carryLine.text) !== normalize(q.a.text))) {
        return { ...session, error: error || '题目尚无可用答案，请调整字数或指定字。', updatedAt: now }
      }
      return { ...session, question: q, stage: 'handoff', draft: '', error: '', updatedAt: now }
    }
    case 'RECEIVE':
      if (session.stage !== 'handoff') return session
      return { ...session, stage: 'answer', deadlineAt: session.settings.timeLimit ? now + session.settings.timeLimit * 1000 : undefined, error: '', updatedAt: now }
    case 'DRAFT':
      return session.stage === 'answer' ? { ...session, draft: action.text, error: '', updatedAt: now } : session
    case 'ERROR':
      return session.stage === 'answer' || session.stage === 'question' || session.stage === 'paused' ? { ...session, error: action.message, updatedAt: now } : session
    case 'ANSWER_FOUND':
      if (session.queryWait) return session
      if (session.deadlineAt && now >= session.deadlineAt) return fail(session, 'timeout', now)
      if (session.stage !== 'answer' || !session.question || validateAnswerFormat(session.question, action.line.text)) return session
      if (!lineFits(session.question.a.normalized, session.question.b, session.question.c, action.line)) return session
      if (usedTexts(session).includes(normalize(action.line.text))) return { ...session, error: '这句诗本局已用于得分，请换一句。', updatedAt: now }
      return score(session, action.line, 'correct', now)
    case 'ANSWER_MISSING':
      if (session.stage !== 'answer' || !session.question) return session
      if (validateAnswerFormat(session.question, action.text)) return session
      return {
        ...session, stage: 'review', review: { text: action.text, normalized: normalize(action.text), submittedAt: now, reason: '', phase: 'request' },
        remainingMs: session.deadlineAt ? Math.max(0, session.deadlineAt - now) : undefined,
        deadlineAt: undefined, error: '', updatedAt: now,
      }
    case 'REVEAL': {
      if (session.queryWait) return session
      if (session.deadlineAt && now >= session.deadlineAt) return fail(session, 'timeout', now)
      if (session.stage !== 'answer' || !session.question || !lineFits(session.question.a.normalized, session.question.b, session.question.c, action.line)) return session
      if (session.records.some(item => item.questionId === session.question!.id)) return session
      const answerer = other(session.setterId)
      const players = session.players.map(player => player.id === answerer
        ? { ...player, skipCount: player.skipCount + 1, streak: 0 }
        : player) as GameSession['players']
      return {
        ...session, stage: 'reveal', players, revealedAnswer: action.line,
        records: [...session.records, record(session, 'revealed', now, action.line)],
        deadlineAt: undefined, remainingMs: undefined, error: '', updatedAt: now,
      }
    }
    case 'NEXT_AFTER_REVEAL':
      if (session.stage !== 'reveal') return session
      return {
        ...session, stage: 'question', round: session.round + 1, question: undefined,
        carryLine: undefined, revealedAnswer: undefined, draft: '', error: '', updatedAt: now,
      }
    case 'REQUEST_REVIEW':
      if (session.stage !== 'review' || session.review?.phase !== 'request' || !action.reason.trim()) return session
      return { ...session, review: { ...session.review, reason: action.reason.trim(), phase: 'handoff' }, updatedAt: now }
    case 'REVIEW_RECEIVE':
      if (session.stage !== 'review' || session.review?.phase !== 'handoff') return session
      return { ...session, review: { ...session.review, phase: 'decision' }, updatedAt: now }
    case 'REVIEW_APPROVE': {
      if (session.stage !== 'review' || session.review?.phase !== 'decision' || !session.question || !action.reason.trim()) return session
      const text = session.review.text
      const line: PoetryLine = {
        id: `manual:${session.review.normalized}`, text, normalized: session.review.normalized,
        length: [...session.review.normalized].length, author: '双方复核', title: '人工裁定', dynasty: '待核',
        sourceFile: 'manual-review', sourceIndex: -1, poemId: session.question.id,
      }
      if (usedTexts(session).includes(line.normalized)) return { ...session, error: '这句诗已经使用过。', updatedAt: now }
      return score(session, line, 'reviewed', now, `${session.review.reason}；出题者认可：${action.reason.trim()}`)
    }
    case 'REVIEW_DECLINE':
      if (session.stage !== 'review' || (session.review?.phase !== 'decision' && session.review?.phase !== 'request') || !action.reason.trim()) return session
      return {
        ...session, stage: 'answer', review: undefined,
        deadlineAt: session.remainingMs === undefined ? undefined : now + session.remainingMs,
        remainingMs: undefined, error: `未通过复核：${action.reason.trim()}。可修改答案或揭晓本题。`, updatedAt: now,
      }
    case 'FAIL': return fail(session, action.outcome, now)
    case 'NEXT':
      if (session.stage !== 'success' || !session.lastAnswer) return session
      return {
        ...session, stage: 'question', setterId: other(session.setterId), round: session.round + 1,
        carryLine: session.lastAnswer, question: undefined, lastAnswer: undefined,
        draft: '', error: '', updatedAt: now,
      }
    case 'PAUSE':
      if (session.stage === 'finished' || session.stage === 'paused') return session
      return {
        ...session, pausedFrom: session.stage, stage: 'paused',
        remainingMs: session.stage === 'answer' && session.deadlineAt ? Math.max(0, session.deadlineAt - now) : session.remainingMs,
        deadlineAt: undefined, queryWait: session.queryWait ? { ...session.queryWait, status: 'failed', message: '查询已暂停，请重试。' } : undefined, updatedAt: now,
      }
    case 'RESUME': {
      if (session.stage !== 'paused') return session
      const stage: Stage = session.pausedFrom || 'question'
      return {
        ...session, stage, pausedFrom: undefined, queryWait: undefined, error: '',
        deadlineAt: stage === 'answer' && session.remainingMs !== undefined ? now + session.remainingMs : undefined,
        remainingMs: stage === 'answer' ? undefined : session.remainingMs,
        updatedAt: now,
      }
    }
    case 'END':
      return session.stage === 'finished' ? session : { ...session, stage: 'finished', deadlineAt: undefined, queryWait: undefined, updatedAt: now }
    case 'INVALID_QUESTION': {
      if (!session.question) return session
      const invalidRecord = session.records.find(item => item.questionId === session.question!.id)
      const wasScored = invalidRecord?.outcome === 'correct' || invalidRecord?.outcome === 'reviewed'
      const players = session.players.map(player => wasScored && player.id === invalidRecord?.responderId
        ? { ...player, score: Math.max(0, player.score - 1), correctCount: Math.max(0, player.correctCount - 1), streak: 0 }
        : player) as GameSession['players']
      return {
        ...session, stage: 'question', pausedFrom: undefined, question: undefined, review: undefined,
        players, records: session.records.filter(item => item.questionId !== invalidRecord?.questionId),
        usedLineIds: invalidRecord?.answerLine ? session.usedLineIds.filter(id => id !== invalidRecord.answerLine!.id) : session.usedLineIds,
        usedLineTexts: usedTexts(session).filter(text => text !== normalize(invalidRecord?.answerLine?.text || '')),
        queryWait: undefined,
        winnerId: undefined, lastAnswer: undefined, revealedAnswer: undefined, draft: '', deadlineAt: undefined, remainingMs: undefined,
        error: '上一题的指定字出现在上一句中，题目已退回，请重新出题。', updatedAt: now,
      }
    }
  }
}

export function restoreSession(raw: string | null): GameSession | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as GameSession
    if (parsed.schemaVersion !== 1 || !parsed.id || !Array.isArray(parsed.players) || parsed.players.length !== 2 || !parsed.settings) return null
    parsed.settings.questionStyle ??= 'familiar'
    parsed.usedLineTexts = usedTexts(parsed)
    if (parsed.question && normalize(parsed.question.a.text).includes(normalize(parsed.question.c))) {
      return transition(parsed, { type: 'INVALID_QUESTION', now: Date.now() })
    }
    if (parsed.queryWait || (parsed.question && !parsed.question.referenceLine && !['finished', 'success', 'reveal'].includes(parsed.stage))) {
      const now = Date.now()
      if (parsed.stage !== 'paused') {
        parsed.pausedFrom = parsed.stage
        parsed.remainingMs = parsed.deadlineAt ? Math.max(0, parsed.deadlineAt - now) : parsed.remainingMs
        parsed.stage = 'paused'
      }
      parsed.deadlineAt = undefined
      if (parsed.queryWait) parsed.queryWait = { ...parsed.queryWait, status: 'failed', message: '查询被刷新中断，请重试或继续对局。' }
      parsed.error = parsed.question && !parsed.question.referenceLine ? '旧题目需要补齐参考答案，请联网重试。' : '查询已中断，进度和剩余时间已保存。'
    }
    return parsed
  } catch { return null }
}

