import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { createSession, other, transition } from '../engine/game'
import { makeBotQuestion } from './bot'
import type { Settings } from '../types'

const settings: Settings = { mode: 'solo', questionStyle: 'familiar', difficulty: 'normal', names: ['甲', '系统'], firstSetter: 1, winningScore: 5, timeLimit: 0, hints: true, minLength: 2, maxLength: 15 }
const seed = JSON.parse(readFileSync(new URL('../../public/corpus/seed.json', import.meta.url), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('../../public/corpus/seed-manifest.json', import.meta.url), 'utf8'))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('plays nine complete rounds with actual seed data, unique answers and a five-point victory', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('api.sou-yun.cn')) throw Error('This game should not require a network query')
    return { ok: true, json: async () => url.endsWith('seed-manifest.json') ? manifest : seed }
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { onLine: false })
  vi.spyOn(Math, 'random').mockReturnValue(.25)
  let game = createSession(settings, 0)
  for (let round = 1; round <= 9; round++) {
    const carry = game.carryLine?.normalized
    const { question } = await makeBotQuestion(game)
    expect(question.referenceLine?.work?.paragraphs.length).toBeGreaterThan(0)
    expect(question.a.normalized.includes(question.c)).toBe(false)
    if (carry) expect(question.a.normalized).toBe(carry)
    game = transition(game, { type: 'SET_QUESTION', question, now: round * 10 })
    expect(game.stage).toBe('handoff')
    game = transition(game, { type: 'RECEIVE', now: round * 10 + 1 })
    const responder = other(game.setterId)
    const oldScore = game.players[responder].score
    game = transition(game, { type: 'ANSWER_FOUND', line: question.referenceLine!, now: round * 10 + 2 })
    expect(game.players[responder].score).toBe(oldScore + 1)
    if (round < 9) game = transition(game, { type: 'NEXT', now: round * 10 + 3 })
  }
  expect(game.stage).toBe('finished')
  expect(game.winnerId).toBe(0)
  expect(game.players.map(player => player.score)).toEqual([5, 4])
  expect(new Set(game.usedLineTexts).size).toBe(9)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('rejects invalid setting ranges before starting a round', () => {
  for (const range of [[3.5, 7], [2, 16], [8, 7]]) expect(() => createSession({ ...settings, minLength: range[0], maxLength: range[1] })).toThrow('整数')
})
