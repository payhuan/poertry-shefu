import { expect, it } from 'vitest'
import { dynastyOrder } from './chronology'

it('orders familiar dynasties, explicit aliases and transition labels', () => {
  const labels = ['先秦', '汉', '晋', '隋', '唐', '五代', '宋', '元', '明', '清', '近现代']
  for (let i = 1; i < labels.length; i++) expect(dynastyOrder(labels[i - 1])).toBeLessThan(dynastyOrder(labels[i]))
  expect(dynastyOrder('唐代')).toBe(dynastyOrder('唐'))
  expect(dynastyOrder('南唐')).toBe(dynastyOrder('五代'))
  expect(dynastyOrder('北魏')).toBeGreaterThan(dynastyOrder('三国'))
  expect(dynastyOrder('宋末元初')).toBe(dynastyOrder('宋'))
})

it('leaves unknown dates behind known dates without inventing a chronology', () => {
  expect(dynastyOrder('不详')).toBe(Infinity)
  expect(dynastyOrder('')).toBe(Infinity)
  expect(dynastyOrder('待核')).toBe(Infinity)
})
