import type { GameSession, PlayerId, PoetryLine, Question, RoundRecord, Settings, Stage } from '../types'
import { lineFits, normalize, validateAnswerFormat, validateQuestionShape } from './poetry'

export type GameAction =
  | { type: 'SET_QUESTION'; question: Question; solutionCount: number; now: number }
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
    setterId: settings.firstSetter, round: 1, usedLineIds: [], records: [], draft: '', error: '',
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
    records: [...session.records, record(session, outcome, now, line, reason)],
    review: undefined, deadlineAt: undefined, remainingMs: undefined,
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
    draft: '', error: '', review: undefined, deadlineAt: undefined, remainingMs: undefined, updatedAt: now,
  }
}

export function transition(session: GameSession, action: GameAction): GameSession {
  const now = action.now
  switch (action.type) {
    case 'SET_QUESTION': {
      if (session.stage !== 'question') return session
      const q = action.question
      const error = validateQuestionShape(q.a.text, q.b, q.c, session.settings.minLength, session.settings.maxLength)
      if (error || action.solutionCount < 1 || (session.carryLine && session.carryLine.id !== q.a.id)) {
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
      return session.stage === 'answer' || session.stage === 'question' ? { ...session, error: action.message, updatedAt: now } : session
    case 'ANSWER_FOUND':
      if (session.stage !== 'answer' || !session.question || validateAnswerFormat(session.question, action.line.text)) return session
      if (!lineFits(session.question.a.normalized, session.question.b, session.question.c, action.line)) return session
      if (session.usedLineIds.includes(action.line.id)) return { ...session, error: '这句诗本局已用于得分，请换一句。', updatedAt: now }
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
      if (session.usedLineIds.includes(line.id)) return { ...session, error: '这句诗已经使用过。', updatedAt: now }
      return score(session, line, 'reviewed', now, `${session.review.reason}；出题者认可：${action.reason.trim()}`)
    }
    case 'REVIEW_DECLINE':
      if (session.stage !== 'review' || (session.review?.phase !== 'decision' && session.review?.phase !== 'request') || !action.reason.trim()) return session
      return {
        ...session, stage: 'answer', review: undefined,
        deadlineAt: session.remainingMs === undefined ? undefined : now + session.remainingMs,
        remainingMs: undefined, error: `未通过复核：${action.reason.trim()}。可修改答案或放弃本题。`, updatedAt: now,
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
        deadlineAt: undefined, updatedAt: now,
      }
    case 'RESUME': {
      if (session.stage !== 'paused') return session
      const stage: Stage = session.pausedFrom || 'question'
      return {
        ...session, stage, pausedFrom: undefined,
        deadlineAt: stage === 'answer' && session.remainingMs !== undefined ? now + session.remainingMs : undefined,
        remainingMs: stage === 'answer' ? undefined : session.remainingMs,
        updatedAt: now,
      }
    }
    case 'END':
      return session.stage === 'finished' ? session : { ...session, stage: 'finished', deadlineAt: undefined, updatedAt: now }
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
    if (parsed.question && normalize(parsed.question.a.text).includes(normalize(parsed.question.c))) {
      return transition(parsed, { type: 'INVALID_QUESTION', now: Date.now() })
    }
    return parsed
  } catch { return null }
}

