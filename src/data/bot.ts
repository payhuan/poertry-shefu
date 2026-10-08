import { botOptions, countSolutions, randomLine } from './corpus'
import { characters } from '../engine/poetry'
import { pickLine } from '../engine/familiarity'
import type { GameSession, Question, Settings } from '../types'

export function shouldBotSolve(difficulty: Settings['difficulty'], roll: number): boolean {
  const rate = difficulty === 'easy' ? .55 : difficulty === 'hard' ? .9 : .72
  return roll < rate
}

export function targetLengthOrder(min: number, max: number, random = Math.random): number[] {
  const remaining = Array.from({ length: max - min + 1 }, (_, index) => min + index)
  const order: number[] = []
  while (remaining.length) {
    const total = remaining.reduce((sum, length) => sum + (length === 5 || length === 7 ? 20 : 1), 0)
    let choice = random() * total
    const index = remaining.findIndex(length => {
      choice -= length === 5 || length === 7 ? 20 : 1
      return choice < 0
    })
    order.push(remaining.splice(index, 1)[0])
  }
  return order
}

export async function makeBotQuestion(game: GameSession): Promise<{ question: Question; solutionCount: number }> {
  const preferFamiliar = game.settings.questionStyle !== 'all'
  const a = game.carryLine || await randomLine(Math.random() < .5 ? 5 : 7, preferFamiliar, game.usedLineIds)
  const sourceChars = new Set(characters(a.normalized))
  for (const length of targetLengthOrder(game.settings.minLength, game.settings.maxLength)) {
    let options = (await botOptions(a, length, game.usedLineIds, preferFamiliar))
      .filter(line => characters(line.normalized).some(char => !sourceChars.has(char)))
    if (!options.length && preferFamiliar) {
      options = (await botOptions(a, length, game.usedLineIds, false))
        .filter(line => characters(line.normalized).some(char => !sourceChars.has(char)))
    }
    if (!options.length) continue
    const sample = pickLine(options, preferFamiliar)!
    const newChars = characters(sample.normalized).filter(char => !sourceChars.has(char))
    const c = newChars[Math.floor(Math.random() * newChars.length)]
    const solutionCount = await countSolutions(a.normalized, length, c, game.usedLineIds)
    return {
      question: { id: crypto.randomUUID(), a, b: length, c, privateReference: sample.text, createdAt: Date.now() },
      solutionCount,
    }
  }
  throw new Error('系统暂时找不到可出题的诗句，请调整字数范围。')
}
