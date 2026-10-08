import { describe, expect, it } from 'vitest'
import { createSession, restoreSession, transition } from './game'
import { normalize, validateAnswerFormat, validateQuestionShape } from './poetry'
import { shouldBotSolve, targetLengthOrder } from '../data/bot'
import type { GameSession, PoetryLine, Question, Settings } from '../types'

const settings: Settings = {
  mode: 'local', questionStyle: 'familiar', difficulty: 'normal', names: ['甲', '乙'], firstSetter: 0,
  winningScore: 5, timeLimit: 30, hints: false, minLength: 2, maxLength: 15,
}
const line = (text: string, id = text): PoetryLine => ({
  id, text, normalized: normalize(text), length: [...normalize(text)].length,
  author: '作者', title: '作品', dynasty: '宋', sourceFile: 'test.json', sourceIndex: 0, poemId: id,
})
const a = line('遍插茱萸少一人', 'a')
const answer = line('少年不识愁滋味', 'answer')
const question = (id = 'q1'): Question => ({ id, a, b: 7, c: '愁', privateReference: '其他参考句', createdAt: 1 })

function answering(): GameSession {
  let game = createSession(settings, 0)
  game = transition(game, { type: 'SET_QUESTION', question: question(), solutionCount: 3, now: 1 })
  return transition(game, { type: 'RECEIVE', now: 2 })
}

describe('poetry rules and game flow', () => {
  it('TC01 accepts a valid line and scores once', () => {
    const game = transition(answering(), { type: 'ANSWER_FOUND', line: answer, now: 3 })
    expect(game.stage).toBe('success')
    expect(game.players[1].score).toBe(1)
    expect(game.records[0].outcome).toBe('correct')
  })
  it('TC02 does not require the setter’s private reference answer', () => {
    expect(question().privateReference).not.toBe(answer.text)
    expect(transition(answering(), { type: 'ANSWER_FOUND', line: answer, now: 3 }).players[1].score).toBe(1)
  })
  it('TC03 carries the correct answer into the new setter’s question', () => {
    const won = transition(answering(), { type: 'ANSWER_FOUND', line: answer, now: 3 })
    const next = transition(won, { type: 'NEXT', now: 4 })
    expect(next.setterId).toBe(1)
    expect(next.carryLine?.id).toBe(answer.id)
  })
  it('TC04 retains format-valid unknown lines for review', () => {
    const game = transition(answering(), { type: 'ANSWER_MISSING', text: answer.text, now: 3 })
    expect(game.stage).toBe('review')
    expect(game.players[1].score).toBe(0)
  })
  it('TC05 blocks a question with no available solution', () => {
    const game = transition(createSession(settings, 0), { type: 'SET_QUESTION', question: question(), solutionCount: 0, now: 1 })
    expect(game.stage).toBe('question')
    expect(game.error).toContain('可用答案')
  })
  it('rejects a target character already present in the previous line', () => {
    expect(validateQuestionShape('樽前当日客', 5, '日', 2, 15)).toContain('不能出现在上一句')
    const invalid = { ...question(), c: '少' }
    const game = transition(createSession(settings, 0), { type: 'SET_QUESTION', question: invalid, solutionCount: 2, now: 1 })
    expect(game.stage).toBe('question')
    expect(game.error).toContain('不能出现在上一句')
  })
  it('returns an already saved invalid question to its setter without scoring', () => {
    const game = answering()
    game.question = { ...question(), c: '少' }
    const restored = restoreSession(JSON.stringify(game))!
    expect(restored.stage).toBe('question')
    expect(restored.question).toBeUndefined()
    expect(restored.players[1].score).toBe(0)
  })
  it('removes a score recorded for an old invalid question', () => {
    const won = transition(answering(), { type: 'ANSWER_FOUND', line: answer, now: 3 })
    won.question = { ...question(), c: '少' }
    const repaired = restoreSession(JSON.stringify(won))!
    expect(repaired.stage).toBe('question')
    expect(repaired.players[1].score).toBe(0)
    expect(repaired.records).toHaveLength(0)
    expect(repaired.usedLineIds).not.toContain(answer.id)
  })
  it('TC06 rejects missing target or shared characters without changing players', () => {
    expect(validateAnswerFormat(question(), '少年不识云滋味')).toContain('包含')
    expect(validateAnswerFormat(question(), '大江东去浪淘尽')).toContain('相同')
    expect(answering().setterId).toBe(0)
  })
  it('TC07 skips or times out without points and returns to the original setter', () => {
    for (const outcome of ['skipped', 'timeout'] as const) {
      const game = transition(answering(), { type: 'FAIL', outcome, now: 3 })
      expect(game.players[1].score).toBe(0)
      expect(game.setterId).toBe(0)
      expect(game.stage).toBe('question')
    }
  })
  it('reveals one valid reference answer as a failed round', () => {
    const revealed = transition(answering(), { type: 'REVEAL', line: answer, now: 3 })
    expect(revealed.stage).toBe('reveal')
    expect(revealed.players[1].score).toBe(0)
    expect(revealed.records[0].outcome).toBe('revealed')
    expect(revealed.revealedAnswer?.text).toBe(answer.text)
    const next = transition(revealed, { type: 'NEXT_AFTER_REVEAL', now: 4 })
    expect(next.stage).toBe('question')
    expect(next.setterId).toBe(0)
    expect(next.carryLine).toBeUndefined()
  })
  it('TC08 repeated score events cannot add another point', () => {
    const won = transition(answering(), { type: 'ANSWER_FOUND', line: answer, now: 3 })
    expect(transition(won, { type: 'ANSWER_FOUND', line: answer, now: 4 }).players[1].score).toBe(1)
  })
  it('TC09 finishes at the winning score', () => {
    const game = answering()
    game.players[1].score = 4
    const final = transition(game, { type: 'ANSWER_FOUND', line: answer, now: 3 })
    expect(final.stage).toBe('finished')
    expect(final.winnerId).toBe(1)
  })
  it('TC10 restores a saved result without repeating score', () => {
    const won = transition(answering(), { type: 'ANSWER_FOUND', line: answer, now: 3 })
    const restored = restoreSession(JSON.stringify(won))!
    expect(restored.players[1].score).toBe(1)
    expect(transition(restored, { type: 'ANSWER_FOUND', line: answer, now: 4 }).records).toHaveLength(1)
  })
  it('upgrades an existing save to familiar question preference', () => {
    const old = answering()
    delete (old.settings as Partial<Settings>).questionStyle
    expect(restoreSession(JSON.stringify(old))?.settings.questionStyle).toBe('familiar')
  })
  it('TC11 treats the same canonical line as used across source variants', () => {
    const won = transition(answering(), { type: 'ANSWER_FOUND', line: answer, now: 3 })
    expect(won.usedLineIds).toEqual([answer.id])
    const next = transition(won, { type: 'NEXT', now: 4 })
    expect(next.usedLineIds).toContain(answer.id)
  })
  it('TC12 ignores punctuation but rejects non-Chinese content', () => {
    expect(normalize('少年不识，愁滋味。')).toBe(answer.normalized)
    expect(validateAnswerFormat(question(), '少年不识，愁滋味。')).toBeNull()
    expect(validateAnswerFormat(question(), '少年不识愁滋味abc')).toContain('只可包含汉字')
  })
  it('requires two review steps and a recorded reason before score', () => {
    let game = transition(answering(), { type: 'ANSWER_MISSING', text: answer.text, now: 3 })
    game = transition(game, { type: 'REQUEST_REVIEW', reason: '作品出处', now: 4 })
    game = transition(game, { type: 'REVIEW_RECEIVE', now: 5 })
    expect(transition(game, { type: 'REVIEW_APPROVE', reason: '', now: 6 }).players[1].score).toBe(0)
    game = transition(game, { type: 'REVIEW_APPROVE', reason: '核实原文', now: 6 })
    expect(game.players[1].score).toBe(1)
    expect(game.records[0].reviewedBy).toEqual([1, 0])
  })
  it('pauses and resumes the remaining countdown', () => {
    let game = answering()
    game = transition(game, { type: 'PAUSE', now: 1002 })
    expect(game.remainingMs).toBe(29000)
    game = transition(game, { type: 'RESUME', now: 5000 })
    expect(game.deadlineAt).toBe(34000)
  })
  it('checks bot difficulty boundaries and solo naming', () => {
    expect(shouldBotSolve('easy', .6)).toBe(false)
    expect(shouldBotSolve('hard', .6)).toBe(true)
    expect(createSession({ ...settings, mode: 'solo' }).players[1].name).toBe('系统')
    expect(validateQuestionShape(a.text, 7, '愁', 2, 15)).toBeNull()
  })
  it('varies system target lengths within the configured range', () => {
    expect(targetLengthOrder(2, 15, () => .2)[0]).toBe(5)
    expect(targetLengthOrder(2, 15, () => .65)[0]).toBe(7)
    expect(targetLengthOrder(7, 7, () => .5)).toEqual([7])
    expect(targetLengthOrder(4, 6, () => .5).sort()).toEqual([4, 5, 6])
  })
})
