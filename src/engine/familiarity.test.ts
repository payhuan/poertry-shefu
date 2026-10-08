import { expect, it } from 'vitest'
import { pickLine } from './familiarity'
import type { PoetryLine } from '../types'

const lines = [
  { id: 'rare', familiarity: 0 },
  { id: 'anthology', familiarity: 1 },
  { id: 'textbook', familiarity: 2 },
] as PoetryLine[]

function rolls(...values: number[]): () => number {
  let index = 0
  return () => values[index++]
}

it('selects school lines first, then anthology lines, then the full corpus', () => {
  expect(pickLine(lines, true, rolls(.8))?.id).toBe('textbook')
  expect(pickLine(lines.slice(0, 2), true, rolls(.8))?.id).toBe('anthology')
  expect(pickLine(lines.slice(0, 1), true, rolls(.8))?.id).toBe('rare')
})

it('uses the whole corpus when the familiar preference is off', () => {
  expect(pickLine(lines, false, () => 0)?.id).toBe('rare')
  expect(pickLine(lines, false, () => .99)?.id).toBe('textbook')
  expect(pickLine([], true)).toBeUndefined()
})
