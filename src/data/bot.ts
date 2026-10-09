import { candidateLines, randomLine } from './corpus'
import { characters } from '../engine/poetry'
import { pickLine } from '../engine/familiarity'
import type { GameSession, Question, Settings } from '../types'
import { SearchBudget } from './souyun'
import { usedTexts } from '../engine/game'

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

export async function makeBotQuestion(game: GameSession): Promise<{ question: Question }> {
  const budget = new SearchBudget()
  try {
    const preferFamiliar = game.settings.questionStyle !== 'all'
    const used = usedTexts(game)
    const a = game.carryLine || await randomLine(Math.random() < .5 ? 5 : 7, preferFamiliar, used, budget)
    const sourceChars = new Set(characters(a.normalized))
    const candidates = await candidateLines(a, game.settings.minLength, game.settings.maxLength, used, !preferFamiliar, budget)
    for (const length of targetLengthOrder(game.settings.minLength, game.settings.maxLength)) {
      const options = candidates.filter(line => line.length === length)
        .filter(line => characters(line.normalized).some(char => !sourceChars.has(char)))
      if (!options.length) continue
      const sample = pickLine(options, preferFamiliar)!
      const newChars = characters(sample.normalized).filter(char => !sourceChars.has(char))
      const c = newChars[Math.floor(Math.random() * newChars.length)]
      return {
        question: { id: crypto.randomUUID(), a, b: length, c, privateReference: sample.text, referenceLine: sample, createdAt: Date.now(),
          selectionNotice: !preferFamiliar && sample.work?.provider === 'seed' ? '在线扩展未取得可用候选，本题回退到内置常见诗词。' : undefined },
      }
    }
    throw new Error('本次检索未找到可用题目，请重试或结束本局后调整字数范围。')
  } finally { budget.close() }
}
