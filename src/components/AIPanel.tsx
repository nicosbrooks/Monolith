import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, BookOpen, CalendarClock, CalendarPlus, CalendarX, Check, CheckSquare, Clock, FileInput, List, Loader2, Lightbulb, ListPlus, Square, X, Wand2, HelpCircle, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { useAI, background, chat, enqueue, isReady, ensureAI, SYSTEM, type Msg } from '../ai/llm'
import { useRuleSuggestions } from '../ai/suggestions'
import { getActiveEditor } from '../ai/actions'
import { ACT_GUIDE, describe, fresh, perform, pinToAsked, quickAct, splitActs, verbs, visible, wantsAction, type Act } from '../ai/act'
import { CHAT_RULES, evidenceQuery, packTurn, sameEvidence, turnEvidence, wantsDeviceContext, type Evidence, type Workspace } from '../ai/context'
import { instantAnswer } from '../ai/instant'
import { deviceContext, refreshDevice } from '../lib/integrations'
import { toast } from './Toast'
import { Listen } from './Listen'
import { htmlToText, mdToHtml } from '../lib/util'
import { passageScores } from '../ai/system1'
import type { Suggestion } from '../types'

const ICONS = { calendar: CalendarPlus, check: CheckSquare, sparkles: Lightbulb, clock: Clock, book: BookOpen, list: List }

export function AIPanel() {
  const ai = useAI()
  const st = useStore.getState()
  const settings = useStore((s) => s.settings)
  const activeId = useStore((s) => s.activeId)
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId && !i.deletedAt))
  const rules = useRuleSuggestions()
  // Opening the assistant is the cue to get the in-browser model ready (downloaded once, then cached).
  useEffect(() => {
    void ensureAI()
  }, [])
  const asking = useStore((s) => s.askDraft)
  const [tab, setTab] = useState<'foryou' | 'chat'>(asking ? 'chat' : 'foryou')
  useEffect(() => { if (asking) setTab('chat') }, [asking])
  const [insights, setInsights] = useState<{ id: string; items: string[]; loading: boolean } | null>(null)
  const ready = isReady()

  // Proactive AI insights: after you pause on a page, the local model looks for gaps & next steps
  const text = active ? htmlToText(active.content) + ' ' + (active.lecture?.transcript.map((s) => s.text).join(' ') || '') : ''
  useEffect(() => {
    if (!settings.proactive || !ready || !active || text.trim().length < 120) return
    if (insights?.id === active.id + text.length) return
    const t = setTimeout(async () => {
      const key = active.id + text.length
      setInsights({ id: key, items: [], loading: true })
      try {
        const out = await background((signal) =>
          chat(
            [
              { role: 'system', content: SYSTEM },
              {
                role: 'user',
                content: `Here is a page the user is working on (title: "${active.title}"). Give exactly 3 short, specific, proactive suggestions to help them — e.g. a missing concept to add, a question to check understanding, a concrete next step, or an error to fix. Each under 22 words. Output as 3 lines starting with "- ".\n\n---\n${text.slice(0, 5000)}`,
              },
            ],
            undefined,
            { temperature: 0.5, maxTokens: 220, signal },
          ),
        )
        const lines = out.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.length > 8).slice(0, 3)
        setInsights({ id: key, items: lines, loading: false })
      } catch {
        setInsights(null)
      }
    }, 6000)
    return () => clearTimeout(t)
  }, [activeId, text.length, ready, settings.proactive]) // eslint-disable-line

  return (
    <aside className="ai-panel">
      <header className="ai-head">
        <div className="ai-title">
          <span className="orb" data-busy={ai.busy || undefined} />
          <b>Assistant</b>
        </div>
        <div className="seg sm">
          <button className={tab === 'foryou' ? 'on' : ''} onClick={() => setTab('foryou')}>For you</button>
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat</button>
        </div>
        <button className="icon-btn" onClick={() => st.setUI({ aiOpen: false })} title="Close (⌘J)"><X size={16} /></button>
      </header>

      {!ready && <GettingReady />}

      {tab === 'foryou' ? (
        <div className="ai-scroll">
          {active && ready && <QuickActions />}

          {settings.proactive && active && ready && (insights?.loading || insights?.items.length) ? (
            <section>
              <div className="ai-label">
                <Lightbulb size={12} /> Insights on “{active.title || 'Untitled'}”
                <button className="icon-btn sm" title="Refresh" onClick={() => setInsights(null)}><RefreshCw size={12} /></button>
              </div>
              {insights?.loading ? (
                <div className="shimmer-list"><i /><i /><i /></div>
              ) : (
                insights!.items.map((s, i) => (
                  <motion.div key={i} className="insight" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                    <span>{s}</span>
                    <button className="icon-btn sm" title="Add to page" onClick={() => getActiveEditor()?.chain().focus('end').insertContent(`<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${s}</p></li></ul>`).run()}>
                      <FileInput size={13} />
                    </button>
                  </motion.div>
                ))
              )}
            </section>
          ) : null}

          <section>
            <div className="ai-label">Suggestions</div>
            <AnimatePresence initial={false}>
              {rules.map((s) => <SuggestionCard key={s.id} s={s} />)}
            </AnimatePresence>
            {!rules.length && <p className="muted small pad">You’re all caught up. Suggestions appear as you write, schedule and record.</p>}
          </section>
        </div>
      ) : (
        <Chat />
      )}
    </aside>
  )
}

function SuggestionCard({ s }: { s: Suggestion }) {
  const I = ICONS[s.icon]
  return (
    <motion.div layout className="sugg" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0 }}>
      <span className={`sugg-ico i-${s.icon}`}><I size={15} /></span>
      <div className="col">
        <b>{s.title}</b>
        {s.detail && <small>{s.detail}</small>}
        <div className="row">
          {s.action && <button className="btn sm primary" onClick={s.action.run}>{s.action.label}</button>}
          <button className="btn sm ghost" onClick={() => useStore.getState().dismiss(s.id)}>Dismiss</button>
        </div>
      </div>
    </motion.div>
  )
}

/** Shown only until the assistant can answer. No model names, no choices: it picks and starts itself. */
function GettingReady() {
  const ai = useAI()
  if (ai.status === 'unsupported' || ai.status === 'error')
    return (
      <div className="setup">
        <b>The assistant couldn’t start</b>
        <p>{ai.error || 'Something went wrong while loading it.'}</p>
        <button className="link small" onClick={() => void ensureAI()}>Try again</button>
      </div>
    )
  return (
    <div className="setup">
      <b>Getting the assistant ready…</b>
      <div className="bar"><i style={{ width: `${Math.max(ai.progress, 0.04) * 100}%` }} /></div>
      <small className="muted">The first time takes a minute. After that it starts instantly, even offline.</small>
    </div>
  )
}

function QuickActions() {
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId))!
  const [out, setOut] = useState<{ label: string; text: string; done: boolean } | null>(null)
  const run = async (label: string, prompt: string) => {
    const ctx = htmlToText(active.content) + '\n' + (active.lecture?.transcript.map((s) => s.text).join(' ') || '')
    setOut({ label, text: '', done: false })
    const full = await enqueue(() => chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: `${prompt}\n\n---\nTitle: ${active.title}\n${ctx.slice(0, 7000)}` }], (t) => setOut({ label, text: t, done: false })))
    setOut({ label, text: full, done: true })
  }
  const acts = [
    { l: 'Summarize', i: Wand2, p: 'Summarize this page in 3–5 bullets.' },
    { l: 'Find tasks', i: CheckSquare, p: 'List every action item or deadline as a Markdown checklist ("- [ ] ...").' },
    { l: 'Quiz me', i: HelpCircle, p: 'Write 4 quiz questions (mix of short answer and multiple choice) to test understanding of this page. Put answers at the end under "Answers".' },
    { l: 'Explain', i: BookOpen, p: 'Explain the hardest idea on this page simply, with an analogy.' },
  ]
  return (
    <section>
      <div className="ai-label">This page</div>
      <div className="quick-grid">
        {acts.map((a) => (
          <button key={a.l} onClick={() => run(a.l, a.p)} disabled={!!out && !out.done}>
            <a.i size={14} /> {a.l}
          </button>
        ))}
      </div>
      {out && (
        <div className="answer">
          <div className="ai-label">
            {out.label} {!out.done && <Loader2 size={12} className="spin" />}
            <span className="grow" />
            <button className="icon-btn sm" onClick={() => setOut(null)}><X size={12} /></button>
          </div>
          <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(out.text) }} />
          {out.done && (
            <button className="btn sm" onClick={() => getActiveEditor()?.chain().focus('end').insertContent(`<h3>${out.label}</h3>` + mdToHtml(out.text)).run()}>
              <FileInput size={13} /> Insert into page
            </button>
          )}
        </div>
      )}
    </section>
  )
}

type Source = { id: string | null; title: string }
/** What the app knows about each answer: where it came from, what it offers to do, what it's doing now. */
type Meta = { sources: Source[]; acts: Act[]; status?: string; failed?: boolean }

function Chat() {
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId && !i.deletedAt))
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [meta, setMeta] = useState<Record<number, Meta>>({})
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [useCtx, setUseCtx] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const abort = useRef<AbortController | null>(null)
  // Keep the prompt prefix when its evidence is still current, so the runtime can reuse its cache.
  const sent = useRef(new Map<number, { content: string; kept: Evidence[]; workspace: Workspace }>())
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => { scroll.current?.scrollTo({ top: 1e9, behavior: 'smooth' }) }, [msgs, meta])
  // A question asked from Ask or search arrives here.
  const draft = useStore((s) => s.askDraft)
  useEffect(() => {
    if (!draft || useStore.getState().askDraft !== draft) return
    useStore.setState({ askDraft: null })
    void send(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const send = async (text = q, base = msgs) => {
    if (!text.trim() || abort.current) return
    setQ('')
    const st = useStore.getState()
    const at = base.length + 1 // index of the answer
    const next: Msg[] = [...base, { role: 'user', content: text }]
    // A retried answer starts with fresh cards.
    setDone((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${at}:`))))
    const put = (content: string, m: Meta) => {
      setMsgs([...next, { role: 'assistant', content }])
      setMeta((x) => ({ ...x, [at]: m }))
    }

    // Exact answers from the app's own data need no model: a plain "add … thu 4pm", or "what's on tomorrow".
    const quick = quickAct(text)
    if (quick?.kind === 'event') return put('', { sources: [], acts: [quick] })
    const instant = !wantsAction(text) && instantAnswer(text, { events: st.events, items: st.items })
    if (instant) return put(instant.text, { sources: [{ id: null, title: instant.source === 'calendar' ? 'Your calendar' : 'Your open tasks' }], acts: [] })

    const controller = new AbortController()
    abort.current = controller
    setStreaming(true)
    put('', { sources: [], acts: [], status: 'Thinking…' }) // the question shows the moment it's sent
    try {
      if (!isReady()) {
        put('', { sources: [], acts: [], status: 'Getting the assistant ready…' })
        if (!(await ensureAI())) throw new Error('The assistant couldn’t start. Try again in a moment.')
      }
      const act = wantsAction(text)
      const previous = base.findLast((m) => m.role === 'user')?.content
      const query = evidenceQuery(text, previous)
      if (wantsDeviceContext(query)) await Promise.race([refreshDevice(), new Promise((r) => setTimeout(r, 1500))])
      const current = useStore.getState()
      const workspace: Workspace = { items: current.items, events: current.events, now: new Date(), device: deviceContext() }
      const open = useCtx && active ? current.items.find((item) => item.id === active.id && !item.deletedAt) : null
      // System 1 ranks passages by meaning when it's ready (a few milliseconds); otherwise words alone decide.
      const semantic = await passageScores(query).catch(() => undefined)
      const evidence = turnEvidence(query, { ...workspace, open, action: act, semantic })
      const start = Math.max(0, base.length - 10)
      for (const i of sent.current.keys()) if (i < start || i >= base.length) sent.current.delete(i)
      const history = base.slice(start).map((m, offset): Msg => {
        const index = start + offset
        if (m.role === 'user') {
          const prior = sent.current.get(index)
          const content = prior && sameEvidence(prior.kept, prior.workspace, workspace)
            ? prior.content.replace(`${ACT_GUIDE}\n\n`, '')
            : m.content
          return { role: 'user', content }
        }
        const cards = meta[index]?.acts
        const content = visible(m.content) || (cards?.length ? `Offered: ${cards.map((a) => `${verbs(a)[0]} “${a.title}” (${describe(a)})`).join('; ')}` : '(No answer.)')
        return { role: 'assistant', content }
      })
      let sources: Source[] = []
      let packed: ReturnType<typeof packTurn> | undefined
      const full = await enqueue(() => chat((window, reserve) => {
        packed = packTurn(text, evidence, { window, reserve, guide: act ? ACT_GUIDE : undefined, open })
        const bySource = new Map<string, Source>()
        for (const row of packed.kept) {
          if (row.item) bySource.set(row.item.id, { id: row.item.id, title: row.item.title || 'Untitled' })
          else if (row.kind === 'calendar') bySource.set('calendar', { id: null, title: 'Your calendar' })
          else if (row.kind === 'tasks') bySource.set('tasks', { id: null, title: 'Your open tasks' })
        }
        sources = [...bySource.values()]
        const titles = sources.filter((source) => source.id !== null).slice(0, 2).map((source) => `“${source.title}”`)
        put('', { sources, acts: [], status: titles.length ? `Reading ${titles.join(' and ')}…` : act ? 'Working it out…' : 'Thinking…' })
        return [{ role: 'system', content: CHAT_RULES }, ...history, { role: 'user', content: packed.content }]
      }, (t) => setMsgs([...next, { role: 'assistant', content: t }]), { signal: controller.signal, temperature: 0.3, maxTokens: act ? 800 : 500 }))
      if (packed && !controller.signal.aborted) sent.current.set(base.length, { ...packed, workspace })
      const now = useStore.getState()
      const acts = act ? fresh(pinToAsked(splitActs(full, { events: now.events, items: now.items, openId: useCtx ? active?.id : null }).acts, text), now.events) : []
      if (!visible(full) && !acts.length) put(act ? 'I couldn’t work out that change. Try saying it another way, with the day and time.' : 'No answer came back. Try asking another way.', { sources, acts: [], failed: true })
      else put(full, { sources, acts })
    } catch (e) {
      if (!controller.signal.aborted) {
        const detail = typeof e === 'string' ? e : e instanceof Error ? e.message : 'The assistant couldn’t answer. Try again.'
        put(detail, { sources: [], acts: [], failed: true })
      } else setMeta((x) => ({ ...x, [at]: { ...x[at], status: undefined } }))
    } finally {
      abort.current = null
      setStreaming(false)
    }
  }

  /** Ask the last question again. */
  const retry = () => {
    const last = msgs.length - 2
    if (last < 0 || msgs[last].role !== 'user') return
    void send(msgs[last].content, msgs.slice(0, last))
  }

  const starters = [active ? 'Summarize this page' : 'What should I focus on today?', 'What’s on this week?', 'Add study session tomorrow 4pm', 'What’s left to do?']

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scroll}>
        {!msgs.length && (
          <div className="chat-empty">
            <p className="muted small">Ask about this page, your week, or anything else.</p>
            {starters.map((s) => (
              <button key={s} className="starter" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => {
          const mt = meta[i]
          const live = streaming && i === msgs.length - 1
          const shown = visible(m.content)
          return (
            <div key={i} className={`msg ${m.role}${mt?.failed ? ' failed' : ''}`}>
              {m.role === 'assistant' ? (
                <>
                  {shown ? (
                    <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(shown) }} />
                  ) : live || !mt?.acts.length ? (
                    <div className="ai-status"><span className="slab-wait" aria-hidden="true" />{mt?.status && <span>{mt.status}</span>}</div>
                  ) : null}
                  {!live &&
                    mt?.acts.map((a, k) => {
                      const key = `${i}:${k}`
                      return (
                        <ActCard key={key} act={a} done={!!done[key]} onDo={() => {
                          const undo = perform(a)
                          setDone((d) => ({ ...d, [key]: true }))
                          toast(`${verbs(a)[1]} “${a.title.length > 32 ? a.title.slice(0, 31) + '…' : a.title}”`, { ms: 8000, action: { label: 'Undo', run: () => (undo(), setDone((d) => ({ ...d, [key]: false }))) } })
                        }} />
                      )
                    })}
                  {!live && !!mt?.sources.length && (
                    <div className="msg-sources">
                      <span>From</span>
                      {mt.sources.slice(0, 3).map((x) =>
                        x.id ? <button key={x.id} className="src" onClick={() => useStore.getState().open(x.id!)}>{x.title}</button> : <span key={x.title} className="src">{x.title}</span>,
                      )}
                    </div>
                  )}
                  {(shown || !!mt?.acts.length) && !live && (
                    <div className="msg-actions">
                      {shown && <Listen id={`chat:${i}:${m.content.length}`} text={() => shown} className="mini" label="Listen" />}
                      {shown && getActiveEditor() && !mt?.failed && (
                        <button className="mini" onClick={() => getActiveEditor()?.chain().focus('end').insertContent(mdToHtml(shown)).run()}>
                          <FileInput size={11} /> Insert
                        </button>
                      )}
                      {i === msgs.length - 1 && !streaming && (
                        <button className="mini" onClick={retry}><RefreshCw size={11} /> Retry</button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                m.content
              )}
            </div>
          )
        })}
      </div>
      <div className="composer">
        {active && (
          <button className={`ctx ${useCtx ? 'on' : ''}`} onClick={() => setUseCtx(!useCtx)}>
            {useCtx ? <Check size={11} /> : <Square size={11} />} Using “{(active.title || 'Untitled').slice(0, 28)}”
          </button>
        )}
        <div className="input-row">
          <textarea
            rows={1}
            value={q}
            placeholder="Ask anything…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          />
          {streaming ? (
            <button className="send" onClick={() => abort.current?.abort()} aria-label="Stop"><Square size={12} fill="currentColor" /></button>
          ) : (
            <button className="send" disabled={!q.trim()} onClick={() => send()} aria-label="Send"><ArrowUp size={15} /></button>
          )}
        </div>
      </div>
    </div>
  )
}

const ACT_ICONS = { event: CalendarPlus, move: CalendarClock, cancel: CalendarX, task: ListPlus, done: CheckSquare, note: FileInput, doc: BookOpen }

/** Something the assistant offers to do. One tap does it; the toast that follows can undo it. */
function ActCard({ act, done, onDo }: { act: Act; done: boolean; onDo: () => void }) {
  const I = ACT_ICONS[act.kind]
  const [verb, did] = verbs(act)
  return (
    <div className={`act-card ${done ? 'done' : ''}`}>
      <span className="act-ico"><I size={15} /></span>
      <span className="col">
        <b>{act.title}</b>
        <small>{describe(act)}</small>
      </span>
      {done ? (
        <span className="act-done"><Check size={14} /> {did}</span>
      ) : (
        <button className={`btn sm ${act.kind === 'cancel' ? '' : 'primary'}`} onClick={onDo}>{verb}</button>
      )}
    </div>
  )
}
