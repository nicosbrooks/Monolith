import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, BookOpen, CalendarPlus, Check, CheckSquare, Clock, FileInput, List, Loader2, Sparkles, Square, X, Wand2, HelpCircle, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { useAI, chat, enqueue, isReady, ensureAI, SYSTEM, type Msg } from '../ai/llm'
import { useRuleSuggestions } from '../ai/suggestions'
import { getActiveEditor } from '../ai/actions'
import { ACT_GUIDE, describe, fresh, itemText, mentioned, perform, quickAct, splitActs, wantsAction, type Act } from '../ai/act'
import { Listen } from './Listen'
import { extractOpenTodos, htmlToText, mdToHtml } from '../lib/util'
import type { Suggestion } from '../types'

const ICONS = { calendar: CalendarPlus, check: CheckSquare, sparkles: Sparkles, clock: Clock, book: BookOpen, list: List }

export function AIPanel() {
  const ai = useAI()
  const st = useStore.getState()
  const settings = useStore((s) => s.settings)
  const activeId = useStore((s) => s.activeId)
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId && !i.deletedAt))
  const rules = useRuleSuggestions()
  // Opening the assistant is the cue to get an engine ready: the Mac's, Ollama, or (once) the in-browser one.
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
        const out = await enqueue(() =>
          chat(
            [
              { role: 'system', content: SYSTEM },
              {
                role: 'user',
                content: `Here is a page the user is working on (title: "${active.title}"). Give exactly 3 short, specific, proactive suggestions to help them — e.g. a missing concept to add, a question to check understanding, a concrete next step, or an error to fix. Each under 22 words. Output as 3 lines starting with "- ".\n\n---\n${text.slice(0, 5000)}`,
              },
            ],
            undefined,
            { temperature: 0.5, maxTokens: 220 },
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
                <Sparkles size={12} /> Insights on “{active.title || 'Untitled'}”
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

function Chat() {
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId && !i.deletedAt))
  const events = useStore((s) => s.events)
  const items = useStore((s) => s.items)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [useCtx, setUseCtx] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const abort = useRef<AbortController | null>(null)
  // The system prompt for this conversation and exactly what each user turn sent. Sending the same prefix every turn
  // lets the local model reuse what it has already read (its KV cache) and only read the new message.
  const convo = useRef<{ key: string; sys: string; sent: Record<number, string> } | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const ready = isReady()
  useEffect(() => { scroll.current?.scrollTo({ top: 1e9, behavior: 'smooth' }) }, [msgs])
  // A question asked from Ask or search arrives here.
  const draft = useStore((s) => s.askDraft)
  useEffect(() => {
    if (!draft || useStore.getState().askDraft !== draft) return
    useStore.setState({ askDraft: null })
    if (ready || quickAct(draft)) void send(draft)
    else setQ(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  /** Everything the assistant should know, built once per conversation. */
  const buildSystem = () => {
    const now = Date.now()
    const upcoming = events
      .filter((e) => e.end > now && e.start < now + 7 * 864e5)
      .sort((a, b) => a.start - b.start)
      .slice(0, 10)
      .map((e) => `- ${new Date(e.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: e.allDay ? undefined : 'numeric', minute: e.allDay ? undefined : '2-digit' })}: ${e.title}`)
    const live = items.filter((i) => !i.deletedAt)
    const todos = live.flatMap((i) => extractOpenTodos(i.content, i.id).map((t) => `- ${t.text} (${i.title || 'Untitled'})`)).slice(0, 10)
    const recent = [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map((i) => `- ${i.title || 'Untitled'} (${i.kind === 'lecture' ? 'recording' : i.kind})`)
    const page = useCtx && active ? `\n\nThe user has this page open — "${active.title}":\n${(htmlToText(active.content) + ' ' + (active.lecture?.transcript.map((s) => s.text).join(' ') || '')).slice(0, 6000)}` : ''
    return `${SYSTEM}\nAnswer in plain text. Only add events, notes or docs when a message includes the format for them.\nToday: ${new Date().toDateString()}.\nUpcoming calendar (next 7 days):\n${upcoming.join('\n') || '(none)'}\nOpen tasks:\n${todos.join('\n') || '(none)'}\nRecently edited:\n${recent.join('\n') || '(none)'}${page}`
  }

  const send = async (text = q) => {
    if (!text.trim() || abort.current) return
    setQ('')
    const next: Msg[] = [...msgs, { role: 'user', content: text }]
    // A plain "add … thu 4pm" is understood on the spot, no model needed.
    const quick = quickAct(text)
    if (quick && quick.kind === 'event') {
      setMsgs([...next, { role: 'assistant', content: `Adding **${quick.title}**.\n@event ${JSON.stringify({ title: quick.title, ...(quick.allDay ? { date: new Date(quick.start).toISOString().slice(0, 10) } : { start: toLocalISO(quick.start), end: toLocalISO(quick.end) }) })}` }])
      return
    }
    setMsgs([...next, { role: 'assistant', content: '' }])
    setStreaming(true)
    const controller = new AbortController()
    abort.current = controller
    try {
      const key = `${useCtx && active ? active.id : ''}|${new Date().toDateString()}`
      if (convo.current?.key !== key || !msgs.length) convo.current = { key, sys: buildSystem(), sent: {} }
      const c = convo.current
      // Per-turn extras ride on the user message, so the shared prefix never changes.
      const named = mentioned(text, items).filter((i) => i.id !== active?.id)
      c.sent[msgs.length] = `${text}${named.map((i) => `\n\n(I mean ${itemText(i)})`).join('')}${wantsAction(text) ? `\n\n${ACT_GUIDE}` : ''}`
      const history = next
        .map((m, i): Msg => (m.role === 'user' ? { role: 'user', content: c.sent[i] ?? m.content } : { role: 'assistant', content: splitActs(m.content).text || '(Suggested some items.)' }))
        .slice(-12)
      await enqueue(() =>
        chat([{ role: 'system', content: c.sys }, ...history], (t) => setMsgs([...next, { role: 'assistant', content: t }]), { signal: controller.signal, maxTokens: 600 }),
      )
    } catch (e) {
      if (!controller.signal.aborted) {
        const detail = typeof e === 'string' ? e : e instanceof Error ? e.message : 'The assistant couldn’t answer. Try again.'
        setMsgs([...next, { role: 'assistant', content: `⚠️ ${detail}` }])
      }
    } finally {
      abort.current = null
      setStreaming(false)
    }
  }

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scroll}>
        {!msgs.length && (
          <div className="chat-empty">
            <p className="muted small">Ask about this page, your week, or anything else.</p>
            {['What should I focus on this week?', 'Add study session tomorrow 4pm', 'Summarize this page into a note', 'Plan my week around my deadlines'].map((s) => (
              <button key={s} className="starter" disabled={!ready} onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'assistant' ? (
              <>
                {m.content ? <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(splitActs(m.content).text) }} /> : <div className="typing"><i /><i /><i /></div>}
                {!(streaming && i === msgs.length - 1) &&
                  splitActs(m.content).acts.map((a, k) => {
                    const key = `${i}:${k}`
                    // Hide what's already on the calendar, unless it was added from this card.
                    if (!done[key] && !fresh([a], events).length) return null
                    return <ActCard key={key} act={a} done={!!done[key]} onDo={() => (perform(a), setDone((d) => ({ ...d, [key]: true })))} />
                  })}
                {m.content && !(streaming && i === msgs.length - 1) && (
                  <div className="msg-actions">
                    <Listen id={`chat:${i}:${m.content.length}`} text={() => splitActs(m.content).text} className="mini" label="Listen" />
                    {getActiveEditor() && (
                      <button className="mini" onClick={() => getActiveEditor()?.chain().focus('end').insertContent(mdToHtml(splitActs(m.content).text)).run()}>
                        <FileInput size={11} /> Insert
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              m.content
            )}
          </div>
        ))}
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
            disabled={!ready}
            placeholder={ready ? 'Ask anything…' : 'Getting ready…'}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          />
          {streaming ? (
            <button className="send" onClick={() => abort.current?.abort()}><Square size={12} fill="currentColor" /></button>
          ) : (
            <button className="send" disabled={!q.trim() || !ready} onClick={() => send()}><ArrowUp size={15} /></button>
          )}
        </div>
      </div>
    </div>
  )
}

const toLocalISO = (t: number) => {
  const d = new Date(t)
  return new Date(t - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** Something the assistant offers to do. One tap does it. */
function ActCard({ act, done, onDo }: { act: Act; done: boolean; onDo: () => void }) {
  const I = act.kind === 'event' ? CalendarPlus : act.kind === 'note' ? FileInput : BookOpen
  return (
    <div className={`act-card ${done ? 'done' : ''}`}>
      <span className="act-ico"><I size={15} /></span>
      <span className="col">
        <b>{act.title}</b>
        <small>{describe(act)}</small>
      </span>
      {done ? (
        <span className="act-done"><Check size={14} /> {act.kind === 'event' ? 'Added' : 'Created'}</span>
      ) : (
        <button className="btn sm primary" onClick={onDo}>{act.kind === 'event' ? 'Add' : 'Create'}</button>
      )}
    </div>
  )
}
