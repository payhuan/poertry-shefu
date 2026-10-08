import { Converter } from 'opencc-js/t2cn'
import type { PoetryLine, Question } from '../types'

const simplify = Converter({ from: 't', to: 'cn' })
const prose = (text: string) => text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '')
const validHanInput = (text: string) => /^\p{Script=Han}+$/u.test(prose(text))

export function normalize(text: string): string {
  return [...simplify(text.normalize('NFKC'))]
    .filter(char => /\p{Script=Han}/u.test(char)).join('')
}

export function characters(text: string): string[] {
  return [...normalize(text)]
}

export function hasSharedCharacter(a: string, b: string): boolean {
  const chars = new Set(characters(a))
  return characters(b).some(char => chars.has(char))
}

export function validateAnswerFormat(question: Question, raw: string): string | null {
  if (!validHanInput(raw)) return '诗句只可包含汉字、标点和空格。'
  const normalized = normalize(raw)
  if (!normalized) return '请先输入诗句。'
  if ([...normalized].length !== question.b) return `诗句需为 ${question.b} 个汉字。`
  if (!hasSharedCharacter(question.a.normalized, normalized)) return '诗句中需有一个字与上一句相同。'
  if (!normalized.includes(normalize(question.c))) return `诗句中需包含「${question.c}」。`
  return null
}

export function lineFits(a: string, b: number, c: string, line: PoetryLine): boolean {
  return line.length === b && line.normalized.includes(normalize(c)) && hasSharedCharacter(a, line.normalized)
}

export function validateQuestionShape(a: string, b: number, c: string, min: number, max: number): string | null {
  if (!validHanInput(a)) return '上一句须为汉字诗句，可带标点。'
  if (!Number.isInteger(b) || b < min || b > max) return `字数须在 ${min}–${max} 之间。`
  if ([...c].length !== 1 || !/^\p{Script=Han}$/u.test(c)) return '指定字只能是一个汉字。'
  return null
}

