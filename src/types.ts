export type PlayerId = 0 | 1
export type Stage = 'question' | 'handoff' | 'answer' | 'review' | 'reveal' | 'success' | 'finished' | 'paused'

export interface PoetryLine {
  id: string
  text: string
  normalized: string
  length: number
  author: string
  title: string
  dynasty: string
  sourceFile: string
  sourceIndex: number
  poemId: string
  familiarity?: 0 | 1 | 2
  work?: PoetryWork
}

export interface PoetryWork {
  id?: string
  provider?: 'seed' | 'souyun'
  author: string
  title: string
  dynasty: string
  paragraphs: string[]
}

export interface CorpusManifest {
  version: string
  seedFile: string
  totalWorks: number
  seedBytes: number
  repository: string
  commit: string
  license: string
  totalLines: number
  counts: Record<string, number>
  files: { file: string; sha256: string; poems: number; accepted: number }[]
}

export interface Settings {
  mode: 'local' | 'solo'
  questionStyle: 'familiar' | 'all'
  difficulty: 'easy' | 'normal' | 'hard'
  names: [string, string]
  firstSetter: PlayerId
  winningScore: 5 | 10 | 20 | 0
  timeLimit: 0 | 30 | 60 | 120
  hints: boolean
  minLength: number
  maxLength: number
}

export interface Player {
  id: PlayerId
  name: string
  score: number
  correctCount: number
  skipCount: number
  streak: number
}

export interface Question {
  id: string
  a: PoetryLine
  b: number
  c: string
  privateReference: string
  referenceLine?: PoetryLine
  createdAt: number
}

export interface PendingReview {
  text: string
  normalized: string
  submittedAt: number
  reason: string
  phase: 'request' | 'handoff' | 'decision'
}

export interface RoundRecord {
  questionId: string
  round: number
  setterId: PlayerId
  responderId: PlayerId
  prompt: string
  answer?: string
  answerLine?: PoetryLine
  outcome: 'correct' | 'reviewed' | 'revealed' | 'skipped' | 'timeout'
  reviewReason?: string
  reviewedBy?: [PlayerId, PlayerId]
  time: number
}

export interface GameSession {
  schemaVersion: 1
  id: string
  stage: Stage
  pausedFrom?: Stage
  settings: Settings
  players: [Player, Player]
  setterId: PlayerId
  round: number
  question?: Question
  carryLine?: PoetryLine
  lastAnswer?: PoetryLine
  revealedAnswer?: PoetryLine
  usedLineIds: string[]
  usedLineTexts?: string[]
  queryWait?: { requestId: string; kind: 'answer' | 'reference'; status: 'pending' | 'failed'; message?: string }
  records: RoundRecord[]
  draft: string
  error: string
  review?: PendingReview
  deadlineAt?: number
  remainingMs?: number
  winnerId?: PlayerId
  createdAt: number
  updatedAt: number
}

