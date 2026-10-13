import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AnswerExample, PoemParagraph, QuestionCard } from './App'
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

it('highlights only the complete entry clause across traditional and simplified scripts', () => {
  const html = renderToStaticMarkup(<PoemParagraph paragraph="舉頭望明月，低頭思故鄉。" entryText="低头思故乡"/>)
  expect(html).toContain('舉頭望明月，<mark class="poem-entry-line" aria-label="入口诗句">低頭思故鄉。</mark>')
  expect(html.match(/<mark/g)).toHaveLength(1)
})

it('highlights the original clause for an accepted variant without changing its annotations', () => {
  const original = '乡音难（一作无）改鬓（一作面）毛衰，笑问客从何处来。'
  const html = renderToStaticMarkup(<PoemParagraph paragraph={original} entryText="乡音无改面毛衰"/>)
  expect(html).toContain('<mark class="poem-entry-line" aria-label="入口诗句">乡音难（一作无）改鬓（一作面）毛衰，</mark>笑问客从何处来。')
})

it('preserves the poem without highlighting a substring or a missing entry', () => {
  for (const entryText of ['思故乡', '未收录的入口句', '']) {
    expect(renderToStaticMarkup(<PoemParagraph paragraph="举头望明月，低头思故乡。" entryText={entryText}/>))
      .toBe('<p>举头望明月，低头思故乡。</p>')
  }
})
