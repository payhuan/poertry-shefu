import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AnswerExample, QuestionCard } from './App'
import type { PoetryLine, Question } from './types'

const line: PoetryLine = { id: 'example', text: '举头望明月', normalized: '举头望明月', length: 5, poemId: 'seed:example', author: '李白', title: '静夜思', dynasty: '唐', sourceFile: 'seed.json', sourceIndex: 0 }
const question: Question = { id: 'question', a: line, b: 5, c: '乡', privateReference: '不应公开的私有参考答案', createdAt: 0 }

it('renders the revealed question with its full constraints and clickable source', () => {
  const html = renderToStaticMarkup(<QuestionCard question={question} onOpen={() => {}} script="simplified" revealed/>)
  for (const text of ['上一句 · a', '举头望明月', '目标字数', '指定汉字', '乡', '查看李白《静夜思》全诗', 'reveal-prompt']) expect(html).toContain(text)
  expect(html).toContain('<strong>5<small>字</small></strong>')
  expect(html).not.toContain(question.privateReference)
})

it('renders an answer example with the same full-poem source control and script conversion', () => {
  const html = renderToStaticMarkup(<AnswerExample line={line} onOpen={() => {}} script="traditional"/>)
  expect(html).toContain('可用答案示例：舉頭望明月')
  expect(html).toContain('查看李白《靜夜思》全诗')
  expect(html).toContain('查看全诗 ↗')
  expect(html).toContain('type="button"')
})
