import { expect, it } from 'vitest'
import { normalize, validateAnswerFormat } from './poetry'
import { convertScript } from './script'
import type { Question } from '../types'

it('switches visible Chinese text in both directions', () => {
  expect(convertScript('春风又绿江南岸', 'traditional')).toBe('春風又綠江南岸')
  expect(convertScript('春風又綠江南岸', 'simplified')).toBe('春风又绿江南岸')
})

it('accepts either script for the same answer', () => {
  const question = { a: { normalized: normalize('山高水長') }, b: 4, c: '風' } as Question
  expect(validateAnswerFormat(question, '春風水長')).toBeNull()
  expect(validateAnswerFormat(question, '春风水长')).toBeNull()
})
