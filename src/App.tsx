import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { findLine, findSolutions, getManifest, getPoem, randomLine } from './data/corpus'
import { makeBotQuestion, shouldBotSolve } from './data/bot'
import { exportSessionText, listFinished, readSnapshot, saveFinished, saveSnapshot } from './data/history'
import { createSession, other, restoreSession, transition } from './engine/game'
import { hasSharedCharacter, normalize, validateAnswerFormat, validateQuestionShape } from './engine/poetry'
import { convertScript, readScript, saveScript } from './engine/script'
import type { CorpusManifest, GameSession, PlayerId, PoetryLine, PoetryWork, Question, Settings } from './types'
import type { Script } from './engine/script'

type Dialog = 'rules' | 'history' | 'reveal' | 'end' | null
const defaults: Settings = { mode: 'local', questionStyle: 'familiar', difficulty: 'normal', names: ['甲', '乙'], firstSetter: 0, winningScore: 5, timeLimit: 0, hints: false, minLength: 2, maxLength: 15 }
const rulesPoster = `${import.meta.env.BASE_URL}rules-intro.png`
const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}`

function Modal({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><section className={`modal${wide ? ' rules-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="关闭">×</button></div>{children}</section></div>
}
function Source({ line, onOpen, script }: { line: PoetryLine; onOpen: (line: PoetryLine) => void; script: Script }) {
  if (line.sourceFile === 'manual-review') return <span className="source-note">双方复核通过 · 来源待考</span>
  return <button type="button" className="source-note source-link" onClick={() => onOpen(line)} aria-label={`查看${convertScript(line.author, script)}《${convertScript(line.title, script)}》全诗`}>出处：{line.dynasty} · {convertScript(line.author, script)}《{convertScript(line.title, script)}》 <span>查看全诗 ↗</span></button>
}
function Scoreboard({ game, now }: { game: GameSession; now: number }) {
  const left = game.players[0], right = game.players[1]
  return <div className="scoreboard"><div className="player-score"><span className="player-mark">甲</span><div><small>{left.name}</small><strong>{pad(left.score)}</strong></div></div><div className="score-center"><small>第 {pad(game.round)} 回</small><span>◆</span><b>{game.deadlineAt ? clock(Math.max(0, game.deadlineAt - now)) : '以诗会友'}</b></div><div className="player-score right"><div><small>{right.name}</small><strong>{pad(right.score)}</strong></div><span className="player-mark">乙</span></div></div>
}

function hintCopy(level: number, lines: PoetryLine[], script: Script): string {
  const sample = lines[0]
  if (!sample) return '暂无线索，请稍后再试。'
  const first = `当前题库找到至少 ${lines.length} 条可用诗句。其中一条来自${sample.dynasty}代，作者是${convertScript(sample.author, script)}。`
  return level === 1 ? first : `${first}这条诗句的题名是《${convertScript(sample.title, script)}》。`
}

export default function App() {
  const [game, setGame] = useState<GameSession | null>(() => restoreSession(readSnapshot()))
  const [page, setPage] = useState<'home' | 'setup' | 'game'>(() => readSnapshot() ? 'game' : 'home')
  const [settings, setSettings] = useState<Settings>(defaults)
  const [manifest, setManifest] = useState<CorpusManifest | null>(null)
  const [loadError, setLoadError] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [history, setHistory] = useState<GameSession[]>([])
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [a, setA] = useState(''), [b, setB] = useState(7), [c, setC] = useState(''), [reference, setReference] = useState('')
  const [questionMessage, setQuestionMessage] = useState('')
  const [preview, setPreview] = useState<PoetryLine[]>([])
  const [hintLevel, setHintLevel] = useState(0), [hintLines, setHintLines] = useState<PoetryLine[]>([])
  const [reviewReason, setReviewReason] = useState(''), [decisionReason, setDecisionReason] = useState('')
  const [soundOn, setSoundOn] = useState(false)
  const [script, setScript] = useState<Script>(readScript)
  const [sourceLine, setSourceLine] = useState<PoetryLine | null>(null)
  const [sourceWork, setSourceWork] = useState<PoetryWork | null>(null)
  const [sourceError, setSourceError] = useState('')
  const displayedWork = useMemo(() => sourceWork && {
    ...sourceWork,
    author: convertScript(sourceWork.author, script),
    paragraphs: sourceWork.paragraphs.map(paragraph => convertScript(paragraph, script)),
  }, [sourceWork, script])

  useEffect(() => { getManifest().then(setManifest).catch(e => setLoadError((e as Error).message)) }, [])
  useEffect(() => { saveSnapshot(game); if (game?.stage === 'finished') void saveFinished(game) }, [game])
  useEffect(() => { const timer = window.setInterval(() => { const time = Date.now(); setNow(time); setGame(old => old?.stage === 'answer' && old.deadlineAt && time >= old.deadlineAt ? transition(old, { type: 'FAIL', outcome: 'timeout', now: time }) : old) }, 250); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (!game || game.settings.mode !== 'solo') return
    let cancelled = false
    const id = game.id, round = game.round, stage = game.stage
    const timer = window.setTimeout(async () => {
      try {
        if (stage === 'question' && game.setterId === 1) {
          const result = await makeBotQuestion(game)
          if (!cancelled) setGame(old => old?.id === id && old.round === round && old.stage === stage ? transition(old, { type: 'SET_QUESTION', ...result, now: Date.now() }) : old)
        } else if (stage === 'handoff' && other(game.setterId) === 1) {
          if (!cancelled) setGame(old => old?.id === id && old.round === round && old.stage === stage ? transition(old, { type: 'RECEIVE', now: Date.now() }) : old)
        } else if (stage === 'answer' && other(game.setterId) === 1 && game.question) {
          const lines = await findSolutions(game.question.a.normalized, game.question.b, game.question.c, game.usedLineIds, 12, game.settings.questionStyle !== 'all')
          if (!cancelled) setGame(old => {
            if (!old || old.id !== id || old.round !== round || old.stage !== stage) return old
            return lines.length && shouldBotSolve(old.settings.difficulty, Math.random())
              ? transition(old, { type: 'ANSWER_FOUND', line: lines[Math.floor(Math.random() * lines.length)], now: Date.now() })
              : transition(old, { type: 'FAIL', outcome: 'skipped', now: Date.now() })
          })
        }
      } catch (error) { if (!cancelled) setLoadError((error as Error).message) }
    }, stage === 'answer' ? 1600 : 900)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [game?.id, game?.round, game?.stage, game?.setterId])
  useEffect(() => { setA(convertScript(game?.carryLine?.text || '', script)); setB(7); setC(''); setReference(''); setPreview([]); setQuestionMessage(''); setHintLevel(0); setHintLines([]) }, [game?.id, game?.round])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [page, game?.stage])
  useEffect(() => {
    if (game?.question && normalize(game.question.a.text).includes(normalize(game.question.c))) {
      send({ type: 'INVALID_QUESTION', now: Date.now() })
    }
  }, [game?.question?.id])
  useEffect(() => {
    if (!sourceLine) return
    let cancelled = false
    setSourceWork(null); setSourceError('')
    void getPoem(sourceLine).then(work => { if (!cancelled) setSourceWork(work) }).catch(error => { if (!cancelled) setSourceError((error as Error).message) })
    return () => { cancelled = true }
  }, [sourceLine])

  const question = game?.question
  const setter = game?.players[game.setterId]
  const answerer = game?.players[other(game.setterId)]
  const answerNorm = normalize(game?.draft || '')
  const checks = question ? [
    { ok: [...answerNorm].length === question.b, label: `${question.b} 个汉字` },
    { ok: hasSharedCharacter(question.a.normalized, answerNorm), label: '与上一句有同字' },
    { ok: answerNorm.includes(normalize(question.c)), label: `包含「${question.c}」` },
  ] : []

  function send(action: Parameters<typeof transition>[1]) { setGame(old => old ? transition(old, action) : null) }
  function openHistory() { void listFinished().then(setHistory); setDialog('history') }
  function chime() { if (!soundOn) return; try { const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain(); osc.frequency.value = 660; gain.gain.setValueAtTime(.045, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .3); osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .3); osc.onended = () => void ctx.close() } catch { /* Optional effect. */ } }
  function changeScript() {
    const next: Script = script === 'simplified' ? 'traditional' : 'simplified'
    setScript(next); saveScript(next)
    setA(old => convertScript(old, next)); setC(old => convertScript(old, next)); setReference(old => convertScript(old, next))
    if (game?.stage === 'answer' && game.draft) send({ type: 'DRAFT', text: convertScript(game.draft, next), now: Date.now() })
  }
  function start(event: FormEvent) { event.preventDefault(); try { setGame(createSession(settings)); setPage('game'); setQuestionMessage('') } catch (e) { setQuestionMessage((e as Error).message) } }
  async function pick() { setBusy(true); try { setA(convertScript((await randomLine(Math.random() < .5 ? 5 : 7, game?.settings.questionStyle !== 'all', game?.usedLineIds)).text, script)); setQuestionMessage(''); setPreview([]) } catch (e) { setQuestionMessage((e as Error).message) } finally { setBusy(false) } }
  async function prepare(commit: boolean) {
    if (!game || inFlight.current) return
    inFlight.current = true; setBusy(true); setQuestionMessage(''); setPreview([])
    try {
      const invalid = validateQuestionShape(a, b, c, game.settings.minLength, game.settings.maxLength)
      if (invalid) throw new Error(invalid)
      const source = game.carryLine || await findLine(a)
      if (!source || normalize(source.text) !== normalize(a)) throw new Error('当前题库未收录上一句，请换一条可查证的原句。')
      const solutions = await findSolutions(source.normalized, b, c, game.usedLineIds, 12, game.settings.questionStyle !== 'all')
      if (!solutions.length) throw new Error('当前题库没有可用答案，请调整字数、指定字或上一句。')
      if (reference.trim()) {
        const trial: Question = { id: 'trial', a: source, b, c, privateReference: '', createdAt: Date.now() }
        const error = validateAnswerFormat(trial, reference)
        if (error) throw new Error(`私有参考答案不合规则：${error}`)
        if (!await findLine(reference)) throw new Error('私有参考答案未被当前题库收录；可留空继续出题。')
      }
      setPreview(solutions); setQuestionMessage(`已找到至少 ${solutions.length} 条可用诗句。`)
      if (commit) { send({ type: 'SET_QUESTION', question: { id: crypto.randomUUID(), a: source, b, c, privateReference: reference.trim(), createdAt: Date.now() }, solutionCount: solutions.length, now: Date.now() }); chime() }
    } catch (e) { setQuestionMessage((e as Error).message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function answer() {
    if (!game || !question || inFlight.current) return
    const error = validateAnswerFormat(question, game.draft)
    if (error) { send({ type: 'ERROR', message: error, now: Date.now() }); return }
    inFlight.current = true; setBusy(true)
    try { const line = await findLine(game.draft); if (line) { send({ type: 'ANSWER_FOUND', line, now: Date.now() }); chime() } else if (game.settings.mode === 'solo') send({ type: 'ERROR', message: '当前题库未收录此句；系统无法独立核实，请换句作答或揭晓参考答案。', now: Date.now() }); else send({ type: 'ANSWER_MISSING', text: game.draft, now: Date.now() }) }
    catch (e) { send({ type: 'ERROR', message: (e as Error).message, now: Date.now() }) }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function hint() { if (!game || !question) return; setBusy(true); try { const lines = hintLines.length ? hintLines : await findSolutions(question.a.normalized, question.b, question.c, game.usedLineIds, 12, game.settings.questionStyle !== 'all'); setHintLines(lines); setHintLevel(old => Math.min(2, old + 1)) } catch (e) { send({ type: 'ERROR', message: (e as Error).message, now: Date.now() }) } finally { setBusy(false) } }
  async function reveal() {
    if (!game || !question || game.stage !== 'answer' || inFlight.current) return
    inFlight.current = true; setBusy(true)
    try {
      const lines = await findSolutions(question.a.normalized, question.b, question.c, game.usedLineIds, 1, game.settings.questionStyle !== 'all')
      if (!lines[0]) throw new Error('参考答案暂时无法加载，请稍后重试。')
      send({ type: 'REVEAL', line: lines[0], now: Date.now() })
      setDialog(null)
    } catch (e) { send({ type: 'ERROR', message: (e as Error).message, now: Date.now() }); setDialog(null) }
    finally { inFlight.current = false; setBusy(false) }
  }
  function download(target: GameSession) { const url = URL.createObjectURL(new Blob([exportSessionText(target)], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `诗词射覆-${new Date(target.createdAt).toISOString().slice(0, 10)}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  function again() { setGame(null); saveSnapshot(null); setPage('setup') }

  return <div className="app-shell"><div className="paper-grain" aria-hidden="true" />
    <header className="topbar"><button className="brand" onClick={() => { if (!game || game.stage === 'finished') setPage('home') }}><span className="brand-seal">覆</span><span>诗词射覆<small>THE POETRY GAME</small></span></button><nav><button onClick={() => setDialog('rules')}>玩法规则</button><button onClick={openHistory}>对局记录</button><button className="script-toggle" onClick={changeScript} aria-label={`切换为${script === 'simplified' ? '繁體' : '简体'}展示和输入`} title="切换诗句字形">{script === 'simplified' ? '繁體' : '简体'}</button><button onClick={() => setSoundOn(!soundOn)}>{soundOn ? '♪ 音效开' : '♪ 音效关'}</button></nav></header>

    {page === 'home' && <main className="home-layout"><section className="home-copy"><div className="eyebrow"><i /> 古韵新局 · 双人对弈 / 单人挑战</div><h1>以诗为引，<br /><em>逐字寻章。</em></h1><p>一句诗，一个字，一场心有灵犀的较量。<br />以古诗词为谜，在字里行间寻找下一句。</p><p className="scope-note">当前题库仅支持唐宋诗词</p><div className="home-buttons"><button className="primary-button" onClick={() => setPage('setup')}>开始对局 <span>↗</span></button>{game && game.stage !== 'finished' && <button className="outline-button" onClick={() => setPage('game')}>继续上局 →</button>}</div><div className="home-foot"><span>01 · 轮流出题</span><span>02 · 诗句应答</span><span>03 · 逐字寻章</span></div></section><section className="hero-art" aria-label="山水装饰"><div className="sun"/><div className="mountain mountain-back"/><div className="mountain mountain-mid"/><div className="mountain mountain-front"/><div className="art-quote">诗以言志<br/>覆以会友</div><div className="art-stamp">诗<br/>覆</div></section><aside className="home-aside">本地双人 · 单人挑战 · 无限诗意</aside></main>}

    {page === 'setup' && <main className="content-wrap setup-layout"><div className="section-intro"><span className="section-kicker">壹 · 对局准备</span><h1>开一场诗会</h1><p>选定玩法与规则。以诗为引，逐字交锋。</p></div><form className="panel setup-panel" onSubmit={start}><div className="form-heading"><span>01</span><h2>对弈双方</h2></div>
      <div className="setting-row"><div><strong>对战模式</strong><small>与诗友同屏，或挑战本地系统</small></div><div className="segmented"><button type="button" className={settings.mode === 'local' ? 'selected' : ''} onClick={() => setSettings(old => ({ ...old, mode: 'local', names: [old.names[0], old.names[1] === '系统' ? '乙' : old.names[1]] }))}>本地双人</button><button type="button" className={settings.mode === 'solo' ? 'selected' : ''} onClick={() => setSettings(old => ({ ...old, mode: 'solo', names: [old.names[0], '系统'] }))}>单人对战</button></div></div>
      <div className="two-fields">{([0, 1] as PlayerId[]).map(id => <label className="field" key={id}><span>{id ? (settings.mode === 'solo' ? '对手 · 系统' : '玩家乙 · 昵称') : '玩家甲 · 昵称'}</span><input maxLength={12} disabled={id === 1 && settings.mode === 'solo'} value={id === 1 && settings.mode === 'solo' ? '系统' : settings.names[id]} onChange={e => setSettings(old => ({ ...old, names: old.names.map((name, n) => n === id ? e.target.value : name) as [string, string] }))}/></label>)}</div>
      {settings.mode === 'solo' && <div className="setting-row"><div><strong>系统难度</strong><small>系统答题的成功率；所有出题仍需可解</small></div><div className="segmented">{([['easy','轻松'],['normal','标准'],['hard','挑战']] as const).map(([value,label]) => <button type="button" key={value} className={settings.difficulty === value ? 'selected' : ''} onClick={() => setSettings(old => ({ ...old, difficulty: value }))}>{label}</button>)}</div></div>}
      <div className="form-heading spaced"><span>02</span><h2>本局规则</h2></div>
      <div className="setting-row"><div><strong>自动选句</strong><small>系统出题与“换一句”的选句偏好；答题仍可用全题库</small></div><div className="segmented"><button type="button" className={settings.questionStyle === 'familiar' ? 'selected' : ''} onClick={() => setSettings(old => ({ ...old, questionStyle: 'familiar' }))}>常见诗词优先</button><button type="button" className={settings.questionStyle === 'all' ? 'selected' : ''} onClick={() => setSettings(old => ({ ...old, questionStyle: 'all' }))}>全题库随机</button></div></div>
      <div className="setting-row"><div><strong>先手出题</strong><small>第一回合由谁开始？</small></div><div className="segmented">{([0, 1] as PlayerId[]).map(id => <button type="button" className={settings.firstSetter === id ? 'selected' : ''} key={id} onClick={() => setSettings(old => ({ ...old, firstSetter: id }))}>{settings.names[id] || (id ? '乙' : '甲')}</button>)}</div></div>
      <div className="setting-row"><div><strong>胜利分数</strong><small>先达到目标分数的一方获胜</small></div><div className="segmented">{([5, 10, 20, 0] as Settings['winningScore'][]).map(value => <button type="button" className={settings.winningScore === value ? 'selected' : ''} key={value} onClick={() => setSettings(old => ({ ...old, winningScore: value }))}>{value || '自由'}</button>)}</div></div>
      <div className="setting-row"><div><strong>答题时限</strong><small>交接完成后开始计时</small></div><div className="segmented">{([0, 30, 60, 120] as Settings['timeLimit'][]).map(value => <button type="button" className={settings.timeLimit === value ? 'selected' : ''} key={value} onClick={() => setSettings(old => ({ ...old, timeLimit: value }))}>{value ? `${value}秒` : '不限'}</button>)}</div></div>
      <div className="setting-row"><div><strong>诗句字数</strong><small>出题时再指定目标字数</small></div><div className="range-fields"><input aria-label="最少字数" type="number" min="2" max="15" value={settings.minLength} onChange={e => setSettings(old => ({ ...old, minLength: Math.max(2, Math.min(Number(e.target.value), old.maxLength)) }))}/><span>至</span><input aria-label="最多字数" type="number" min="2" max="15" value={settings.maxLength} onChange={e => setSettings(old => ({ ...old, maxLength: Math.min(15, Math.max(Number(e.target.value), old.minLength)) }))}/><span>字</span></div></div>
      <div className="setting-row"><div><strong>分级提示</strong><small>查看线索不影响得分</small></div><button type="button" className={`toggle ${settings.hints ? 'on' : ''}`} role="switch" aria-checked={settings.hints} onClick={() => setSettings(old => ({ ...old, hints: !old.hints }))}><i/></button></div>
      {questionMessage && <p className="inline-error">{questionMessage}</p>}<div className="form-actions"><button type="button" className="text-button" onClick={() => setPage('home')}>← 返回首页</button><button className="primary-button" type="submit">开启诗会 <span>↗</span></button></div></form></main>}

    {page === 'game' && game && <main className="content-wrap game-layout"><div className="game-topline"><span>诗词射覆 / {game.settings.mode === 'solo' ? '单人对战' : '本地双人'}</span><div><button onClick={() => setDialog('rules')}>规则</button>{game.stage !== 'finished' && game.stage !== 'paused' && <button onClick={() => send({ type: 'PAUSE', now: Date.now() })}>暂停 / 保存</button>}</div></div><Scoreboard game={game} now={now}/>
      {game.stage === 'question' && game.records.at(-1)?.round === game.round - 1 && ['skipped', 'timeout'].includes(game.records.at(-1)!.outcome) && <div className="status-box error">{game.players[game.records.at(-1)!.responderId].name}{game.records.at(-1)!.outcome === 'timeout' ? '答题超时' : '未答出本题'}，本回合未计分。原出题者重新出题。</div>}
      {game.stage === 'question' && game.settings.mode === 'solo' && game.setterId === 1 && <section className="panel thinking-panel"><span className="seal-large">思</span><div className="panel-eyebrow">系统出题 · QUESTION</div><h2>系统正在翻阅诗卷…</h2><p>每道题都会先检查是否存在可用答案。</p>{loadError && <div className="status-box error">{loadError}</div>}</section>}
      {game.stage === 'question' && !(game.settings.mode === 'solo' && game.setterId === 1) && <section className="panel play-panel"><div className="panel-eyebrow">出题 · QUESTION <span>第 {pad(game.round)} 回</span></div><div className="panel-heading"><div><span className="badge green">{setter?.name} 出题</span><h2>{game.carryLine ? '承句，再设一谜。' : '摘一句诗，藏一个字。'}</h2><p>请出题者独自操作。题目确认后，再交给对方。</p></div><span className="large-index">壹</span></div><div className="question-form">
        <label className="field"><span>上一句诗 · a</span><div className="input-with-action"><input value={a} readOnly={Boolean(game.carryLine)} onChange={e => { setA(e.target.value); setPreview([]) }} placeholder="输入可查证的古诗词原句"/><button onClick={() => void pick()} disabled={busy || Boolean(game.carryLine)}>{game.carryLine ? '承接上句' : '换一句'}</button></div></label>{game.carryLine && <Source line={game.carryLine} onOpen={setSourceLine} script={script}/>}
        <div className="two-fields"><label className="field"><span>目标字数 · b</span><select value={b} onChange={e => { setB(Number(e.target.value)); setPreview([]) }}>{Array.from({ length: game.settings.maxLength - game.settings.minLength + 1 }, (_, i) => i + game.settings.minLength).map(n => <option key={n} value={n}>{n} 字{manifest?.counts[String(n)] === 0 ? ' · 暂无收录' : ''}</option>)}</select></label><label className="field"><span>指定汉字 · c</span><input value={c} onChange={e => { setC(e.target.value); setPreview([]) }} maxLength={2} placeholder="如：月"/></label></div>
        <label className="field"><span>私有参考答案 · d <small>选填，仅出题者可见</small></span><input value={reference} onChange={e => setReference(e.target.value)} placeholder="用于自检，不是唯一标准答案"/></label><div className="tip-box"><span>✦</span><p>指定字不能出现在上一句中。答句需为 {b} 个汉字，包含「{c || '指定字'}」，并与上一句至少有一个共同汉字。</p></div>
        {questionMessage && <div className={`status-box ${preview.length ? 'success' : 'error'}`}>{questionMessage}</div>}{preview.length > 0 && <div className="candidate-note">可用答案示例：{convertScript(preview[0].text, script)} <small>（只在出题阶段显示）</small></div>}{game.error && <div className="status-box error">{game.error}</div>}
        <div className="form-actions"><button className="outline-button" disabled={busy} onClick={() => void prepare(false)}>检查可解性</button><button className="primary-button" disabled={busy} onClick={() => void prepare(true)}>{busy ? '正在查验…' : '确认出题'} <span>↗</span></button></div></div></section>}

      {game.stage === 'handoff' && <section className="panel handoff-panel"><span className="seal-large">交</span><div className="panel-eyebrow">{game.settings.mode === 'solo' ? '揭开题面 · HANDOFF' : '设备交接 · HANDOFF'}</div><h2>{game.settings.mode === 'solo' ? <>请准备应答<br/><em>{answerer?.name}</em></> : <>请把设备交给<br/><em>{answerer?.name}</em></>}</h2><p>题目已封存。{game.settings.mode === 'solo' ? '确认后揭开题面。' : '请答题者本人接收，再揭开题面。'}</p><div className="handoff-divider">◆</div>{!(game.settings.mode === 'solo' && other(game.setterId) === 1) && <button className="primary-button" onClick={() => send({ type: 'RECEIVE', now: Date.now() })}>{game.settings.mode === 'solo' ? '揭开题面' : `我是 ${answerer?.name}，揭开题面`} <span>↗</span></button>}{game.settings.mode === 'solo' && other(game.setterId) === 1 && <p>系统正在接题…</p>}<small>揭开时开始计时 · 私有参考答案不会显示</small></section>}

      {game.stage === 'answer' && game.settings.mode === 'solo' && other(game.setterId) === 1 && <section className="panel thinking-panel"><span className="seal-large">答</span><div className="panel-eyebrow">系统应答 · ANSWER</div><h2>系统正在寻诗…</h2><p>系统也遵守字数、关联字和指定字规则。</p></section>}
      {game.stage === 'answer' && question && !(game.settings.mode === 'solo' && other(game.setterId) === 1) && <section className="panel play-panel answer-panel">
        <div className="panel-eyebrow">应答 · ANSWER <span>第 {pad(game.round)} 回</span></div>
        <div className="panel-heading"><div><span className="badge red">{answerer?.name} 应答</span><h2>字里藏诗，等你来寻。</h2><p>符合三项条件的真实诗句，都有机会成为答案。</p></div><span className="large-index">贰</span></div>
        <div className="prompt-card"><small>上一句 · a</small><blockquote>「{convertScript(question.a.text, script)}」</blockquote><Source line={question.a} onOpen={setSourceLine} script={script}/><div className="prompt-meta"><div><span>目标字数</span><strong>{question.b}<small>字</small></strong></div><div><span>指定汉字</span><strong className="red-char">{convertScript(question.c, script)}</strong></div></div></div>
        <label className="field answer-input"><span>你的诗句 · e</span><textarea rows={3} value={game.draft} onChange={e => send({ type: 'DRAFT', text: e.target.value, now: Date.now() })} placeholder="请输入你想到的古诗词原句…"/></label>
        <div className="checks">{checks.map(item => <span className={item.ok ? 'pass' : ''} key={item.label}><i>{item.ok ? '✓' : '○'}</i>{convertScript(item.label, script)}</span>)}</div>
        {game.error && <div className="status-box error">{game.error}</div>}
        {hintLevel > 0 && <div className="tip-box"><span>✦</span><p>{hintCopy(hintLevel, hintLines, script)}</p></div>}
        <div className="form-actions answer-actions"><div>{game.settings.hints && <button className="text-button" disabled={busy || hintLevel >= 2} onClick={() => void hint()}>✧ {hintLevel ? '再看一条线索' : '查看线索'}</button>}<button className="text-button muted" onClick={() => setDialog('reveal')}>揭晓答案</button></div><button className="primary-button" disabled={busy || !game.draft.trim()} onClick={() => void answer()}>{busy ? '正在查验…' : '提交诗句'} <span>↗</span></button></div>
      </section>}

      {game.stage === 'review' && game.review && <section className="panel review-panel"><div className="panel-eyebrow">诗句复核 · REVIEW</div>{game.review.phase === 'request' && <><span className="badge red">{answerer?.name} · 申请复核</span><h2>当前题库尚未收录此句。</h2><p>这不等于诗句一定不存在。请填写你知道的作品或出处，交给出题者核对。</p><blockquote>「{game.review.text}」</blockquote><label className="field"><span>出处或复核理由</span><textarea rows={3} value={reviewReason} onChange={e => setReviewReason(e.target.value)} placeholder="例如：作品名、作者、可靠来源等"/></label><div className="form-actions"><button className="text-button" onClick={() => send({ type: 'REVIEW_DECLINE', reason: '撤回复核', now: Date.now() })}>返回修改</button><button className="primary-button" disabled={!reviewReason.trim()} onClick={() => send({ type: 'REQUEST_REVIEW', reason: reviewReason, now: Date.now() })}>交给 {setter?.name} 复核 <span>↗</span></button></div></>}{game.review.phase === 'handoff' && <div className="review-handoff"><span className="seal-large">审</span><h2>请把设备交给<br/><em>{setter?.name}</em></h2><p>答题者已提交出处。请出题者独立核对。</p><button className="primary-button" onClick={() => send({ type: 'REVIEW_RECEIVE', now: Date.now() })}>我是 {setter?.name}，查看复核 <span>↗</span></button></div>}{game.review.phase === 'decision' && <><span className="badge green">{setter?.name} · 最终核对</span><h2>双方核实这句诗。</h2><blockquote>「{game.review.text}」</blockquote><div className="tip-box"><span>答</span><p>答题者提供：{game.review.reason}</p></div><p className="review-warning">请确认它是真实的古诗词独立句，且符合题面。只有双方同意才可加分。</p><label className="field"><span>你的核对依据或裁定理由</span><textarea rows={3} value={decisionReason} onChange={e => setDecisionReason(e.target.value)} placeholder="请记录作品、出处或不通过的原因"/></label>{game.error && <div className="status-box error">{game.error}</div>}<div className="form-actions"><button className="outline-button" disabled={!decisionReason.trim()} onClick={() => send({ type: 'REVIEW_DECLINE', reason: decisionReason, now: Date.now() })}>不通过，返回修改</button><button className="primary-button" disabled={!decisionReason.trim()} onClick={() => { send({ type: 'REVIEW_APPROVE', reason: decisionReason, now: Date.now() }); chime() }}>同意并计 1 分 <span>↗</span></button></div></>}</section>}

      {game.stage === 'success' && game.lastAnswer && <section className="panel result-panel"><div className="result-symbol">✓</div><div className="panel-eyebrow">一诗既出 · SUCCESS</div><h2>妙句得分。</h2><p>{answerer?.name} 获得 <strong>+1</strong> 分。下一回合由 {answerer?.name} 出题。</p><div className="answer-reveal"><small>这一句，将成为下一题的起点</small><blockquote>「{convertScript(game.lastAnswer.text, script)}」</blockquote><Source line={game.lastAnswer} onOpen={setSourceLine} script={script}/></div><button className="primary-button" onClick={() => send({ type: 'NEXT', now: Date.now() })}>承句续题 <span>↗</span></button></section>}

      {game.stage === 'reveal' && game.revealedAnswer && <section className="panel result-panel"><div className="result-symbol">示</div><div className="panel-eyebrow">参考答案 · REVEAL</div><h2>此题未得分。</h2><p>揭晓答案视为失败。本题有不止一种可能，以下展示一条可用诗句。</p><div className="answer-reveal"><small>可用参考答案</small><blockquote>「{convertScript(game.revealedAnswer.text, script)}」</blockquote><Source line={game.revealedAnswer} onOpen={setSourceLine} script={script}/></div><button className="primary-button" onClick={() => send({ type: 'NEXT_AFTER_REVEAL', now: Date.now() })}>由 {setter?.name} 重新出题 <span>↗</span></button></section>}

      {game.stage === 'finished' && <section className="panel finish-panel"><div className="panel-eyebrow">诗会落幕 · FINALE</div><div className="result-symbol">终</div><h2>{game.winnerId !== undefined ? `${game.players[game.winnerId].name} 胜出` : '本局已收卷'}</h2><p>诗意未尽，来日再续。</p><div className="final-score"><div><small>{game.players[0].name}</small><strong>{game.players[0].score}</strong></div><span>:</span><div><small>{game.players[1].name}</small><strong>{game.players[1].score}</strong></div></div><div className="round-summary">共 {game.records.length} 回 · {game.records.filter(item => item.outcome === 'correct' || item.outcome === 'reviewed').length} 次妙答 · {game.records.filter(item => item.outcome === 'reviewed').length} 次双方复核</div><div className="form-actions center"><button className="outline-button" onClick={() => download(game)}>↓ 导出对局文本</button><button className="primary-button" onClick={again}>再开一局 <span>↗</span></button></div><button className="text-button" onClick={() => { setGame(null); setPage('home') }}>返回首页</button><div className="history-preview"><h3>诗句长卷</h3>{game.records.slice(-5).reverse().map(item => <div key={item.questionId}><span>第 {item.round} 回</span><p>{item.answer || item.prompt}</p><small>{item.outcome === 'correct' ? '答对' : item.outcome === 'reviewed' ? '复核通过' : item.outcome === 'revealed' ? '揭晓失败' : item.outcome === 'timeout' ? '超时' : '未答出'}</small></div>)}</div></section>}

      {game.stage === 'paused' && <section className="panel paused-panel"><span className="seal-large">歇</span><div className="panel-eyebrow">暂歇 · PAUSED</div><h2>诗会稍歇</h2><p>进度已保存在本机。准备好时，继续这一回合。</p><button className="primary-button" onClick={() => send({ type: 'RESUME', now: Date.now() })}>继续对局 <span>↗</span></button><button className="text-button" onClick={() => setDialog('end')}>结束本局</button></section>}
      <footer className="game-footer">数据源 · <a href="https://github.com/chinese-poetry/chinese-poetry" target="_blank" rel="noreferrer">chinese-poetry</a> · MIT 许可 · 固定版本 {manifest?.commit.slice(0, 8) || '加载中'} {loadError && <span className="inline-error">{loadError}</span>}</footer>
    </main>}

    {sourceLine && <Modal title={`《${convertScript(sourceLine.title, script)}》全诗`} close={() => setSourceLine(null)}><div className="poem-source">{displayedWork ? <><p className="poem-byline">{displayedWork.dynasty} · {displayedWork.author}</p><div className="poem-verses">{displayedWork.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><p className="poem-provenance">来源：chinese-poetry · 固定版本 {manifest?.commit.slice(0, 8) || '加载中'}</p></> : sourceError ? <p className="status-box error">{sourceError}</p> : <p className="poem-loading">正在打开诗卷…</p>}</div></Modal>}

    {dialog === 'rules' && <Modal title="玩法规则" close={() => setDialog(null)} wide><div className="rules-poster"><a href={rulesPoster} target="_blank" rel="noopener noreferrer" aria-label="放大查看玩法规则图片"><img src={rulesPoster} alt="诗词射覆玩法规则图：出题者给出诗句、字数和指定字；答题者接出符合条件的真实诗句，答对得一分"/></a><p>轻触图片可放大查看。当前题库仅支持唐宋诗词；图中的接龙示例用于说明玩法，实际作答以游戏判题为准。</p></div><details className="rules-details"><summary>文字版规则与补充说明</summary><div className="rules"><p>出题者给出诗句 <b>a</b>、字数 <b>b</b> 和指定字 <b>c</b>；答题者寻找新的古诗词独立句 <b>e</b>。</p><ol><li>指定字 <b>c</b> 不能出现在上一句 <b>a</b> 中。</li><li>新句恰好有 <b>b</b> 个汉字，标点与空格不计。</li><li>新句与上一句至少有一个共同汉字。</li><li>新句须包含指定汉字 <b>c</b>，并且是题库收录的唐宋诗词原句。</li></ol><p>出题者的参考答案不是唯一答案。答对得 1 分；揭晓答案或超时视为失败，不计分。题库未收录时，本地双人可由双方复核，期间暂停计时。答对后轮换出题，正确答案成为下一题的上一句。</p><div className="tip-box"><span>例</span><p>「遍插茱萸少一人」 / 7 字 / 指定「愁」 → 「少年不识愁滋味」。两句共有「少」字，而「愁」不在上一句中。</p></div></div></details><button className="primary-button modal-primary" onClick={() => setDialog(null)}>明白了 <span>✓</span></button></Modal>}
    {dialog === 'history' && <Modal title="对局记录" close={() => setDialog(null)}><div className="history-list">{history.length ? history.map(item => <div className="history-item" key={item.id}><div><strong>{item.players[0].name} {item.players[0].score} : {item.players[1].score} {item.players[1].name}</strong><small>{new Date(item.updatedAt).toLocaleString('zh-CN')} · {item.records.length} 回</small></div><button onClick={() => download(item)}>导出 ↗</button></div>) : <div className="empty-state">尚无已结束的对局。下一场诗会，从你开始。</div>}</div></Modal>}
    {dialog === 'reveal' && <Modal title="揭晓参考答案？" close={() => setDialog(null)}><p className="modal-copy">揭晓后本题判失败，不计分。页面将展示一条题库核验过的可用诗句与出处；看完后由原出题者重新出题。</p><div className="form-actions"><button className="outline-button" onClick={() => setDialog(null)}>继续作答</button><button className="danger-button" disabled={busy} onClick={() => void reveal()}>{busy ? '正在查找…' : '揭晓并结束本题'}</button></div></Modal>}
    {dialog === 'end' && <Modal title="结束本局？" close={() => setDialog(null)}><p className="modal-copy">现在收卷并保存比分与记录。未完成的当前题不计分。</p><div className="form-actions"><button className="outline-button" onClick={() => setDialog(null)}>继续对局</button><button className="danger-button" onClick={() => { send({ type: 'END', now: Date.now() }); setDialog(null) }}>结束并结算</button></div></Modal>}
  </div>
}
