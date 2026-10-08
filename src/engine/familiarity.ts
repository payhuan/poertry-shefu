import type { PoetryLine } from '../types'

export function pickLine(lines: PoetryLine[], preferFamiliar: boolean, random = Math.random): PoetryLine | undefined {
  if (!lines.length) return undefined
  if (!preferFamiliar) return lines[Math.floor(random() * lines.length)]
  const textbook = lines.filter(line => line.familiarity === 2)
  const anthologies = lines.filter(line => (line.familiarity ?? 0) >= 1)
  const pool = textbook.length ? textbook : anthologies.length ? anthologies : lines
  return pool[Math.floor(random() * pool.length)]
}
