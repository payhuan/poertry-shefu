import { getLines, randomLine } from './corpus'
import { characters, hasSharedCharacter } from '../engine/poetry'
import type { GameSession, PoetryLine, Question, Settings } from '../types'

export function shouldBotSolve(difficulty: Settings['difficulty'], roll: number): boolean {
  const rate = difficulty === 'easy' ? .55 : difficulty === 'hard' ? .9 : .72
  return roll < rate
}

export async function makeBotQuestion(game: GameSession): Promise<{ question: Question; solutionCount: number }> {
  const a = game.carryLine || await randomLine(Math.random() < .5 ? 5 : 7)
  const used = new Set(game.usedLineIds)
  const sourceChars = new Set(characters(a.normalized))
  for (const length of [5, 7, 4, 3, 6, 2, 8, 9, 10, 11, 12, 15]) {
    if (length < game.settings.minLength || length > game.settings.maxLength) continue
    const all = await getLines(length)
    const options: PoetryLine[] = []
    for (const line of all) {
      if (line.id !== a.id && !used.has(line.id) && hasSharedCharacter(a.normalized, line.normalized)) options.push(line)
    }
    if (!options.length) continue
    const sample = options[Math.floor(Math.random() * options.length)]
    const common = characters(sample.normalized).filter(char => sourceChars.has(char))
    const c = common[Math.floor(Math.random() * common.length)]
    const solutionCount = options.filter(line => line.normalized.includes(c)).length
    return {
      question: { id: crypto.randomUUID(), a, b: length, c, privateReference: sample.text, createdAt: Date.now() },
      solutionCount,
    }
  }
  throw new Error('系统暂时找不到可出题的诗句，请调整字数范围。')
}
