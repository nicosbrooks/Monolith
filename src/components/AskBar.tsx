import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUp, ArrowUpRight, CalendarPlus, ListPlus, FileText, FilePlus2, MessageCircle, AudioWaveform, StickyNote, Square, X, RefreshCw,
  FileInput, Paperclip, Check, Copy, BookOpen, CalendarClock, CalendarX, CheckSquare, SquarePen, CornerDownLeft,
} from 'lucide-react'
import { useStore } from '../store'
import { whenLabel, type ParsedEvent } from '../lib/dates'
import { itemEmoji, mdToHtml } from '../lib/util'
import { searchText } from '../lib/text'
import { toast } from './Toast'
import { Listen } from './Listen'
import { addTask, removeTask } from '../lib/graph'
import { readEvent, ruleKind, readTask, readDoc, isQuestion, cleanTitle, taskPreview } from '../lib/request'
import { useConvo, ask, openThread, reset, retry, say, stop, doCard, attachFiles, detachFile, type Pending } from '../ai/conversation'
import { ACCEPT, sizeLabel } from '../ai/attach'
import { describe, perform, verbs, visible, type Act } from '../ai/act'
import { getActiveEditor } from '../ai/actions'
import { MODELS, ONNX_MODELS, useAI } from '../ai/llm'
import { useRemote } from '../ai/remote'
import type { Item } from '../types'
import type { Understood } from '../ai/understand'

/** Focus the Ask bar from anywhere (⌘J, Home's starting points), optionally with text in it. */
export function focusAsk(text?: string) {
  window.dispatchEvent(new CustomEvent('monolith:ask', { detail: { text } }))
}

type Read = Pick<Understood, 'kind' | 'by' | 'event' | 'task' | 'doc'> & { text: string }

/** The quick read, while EmbeddingGemma's is on its way: the rules alone, so the preview never waits. */
function quickRead(text: string, section: string): Read {
  const kind = ruleKind(text, { section }).kind
  const event = kind === 'event' ? readEvent(text) : undefined
  return { text, kind, by: 'rules', event, task: kind === 'task' ? readTask(text) : undefined, doc: kind === 'doc' ? readDoc(text) : undefined }
}

const eventAct = (title: string, w: ParsedEvent): Act => ({
  kind: 'event', title, start: w.start.getTime(), end: w.end.getTime(), allDay: w.allDay, location: w.location, due: w.due, repeat: w.repeat,
})

type Option = { key: string; icon: typeof MessageCircle; label: React.ReactNode; hint?: string; run: () => void; emoji?: string }

/**
 * The bar at the bottom of every page, and the only place the assistant lives. It knows where you are and what you
 * mean: EmbeddingGemma reads each request (src/ai/understand.ts) as an event, a task, a new doc, something to find, or
 * a question. Changes happen at once with Undo; questions open a conversation above the bar.
 */
export function AskBar({ phone = false }: { phone?: boolean }) {
  const section = useStore((s) => s.section)
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId && !i.deletedAt))
  const items = useStore((s) => s.items)
  const convoOpen = useConvo((s) => s.open)
  const hasThread = useConvo((s) => s.msgs.length > 0)
  const streaming = useConvo((s) => s.streaming)
  const pending = useConvo((s) => s.pending)
  const files = useConvo((s) => s.files)
  const filesMode = files.length > 0
  const [dropping, setDropping] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  // What this page is about decides the wording and the starting points.
  const page = active && (section === 'docs' || section === 'lectures') ? active : undefined
  const ctx = useMemo(() => {
    const t = page ? `“${(page.title || 'Untitled').slice(0, 32)}”` : ''
    if (section === 'calendar') return { hint: 'Add an event or ask about your schedule', chips: ['What’s on this week?', 'What’s left today?', 'Find a free hour tomorrow'] }
    if (section === 'tasks') return { hint: 'Add a task or ask what to do first', chips: ['What should I do first?', 'What’s due this week?'] }
    if (page?.kind === 'lecture') return { hint: `Ask about ${t}`, chips: ['Summarize this recording', 'List the to-dos mentioned', 'Quiz me on this'] }
    if (page) return { hint: `Ask about ${t}`, chips: ['Summarize this', 'Find the to-dos', 'Quiz me on this', 'Explain the hardest idea simply'] }
    if (section === 'home') return { hint: 'Ask, add or find anything', chips: ['What’s on my calendar?', 'What should I focus on today?', 'What did I work on recently?'] }
    return { hint: 'Ask or add anything', chips: ['What did I write about this week?', 'Find my open to-dos'] }
  }, [section, page?.id, page?.title, page?.kind]) // eslint-disable-line

  const text = q.trim()
  // The rules give an instant read; EmbeddingGemma's arrives a moment later and replaces it.
  const [read, setRead] = useState<Read | null>(null)
  const quick = useMemo(() => (text.length > 1 ? quickRead(text, section) : null), [text, section])
  const now = read?.text === text ? read : quick
  useEffect(() => {
    if (text.length < 3 || pending) return
    let live = true
    const timer = setTimeout(async () => {
      const [{ understand }, llm] = await Promise.all([import('../ai/understand'), import('../ai/llm')])
      const u = await understand(text, { section })
      if (!live) return
      setRead({ ...u, text })
      if (u.kind === 'ask') llm.warmUp() // a question is coming: load the general model ahead, if it's downloaded
    }, 160)
    return () => ((live = false), clearTimeout(timer))
  }, [text, section, pending])

  const ql = text.toLowerCase()
  const hits = useMemo(() => {
    if (!focused || ql.length < 2 || pending) return []
    const matches: Item[] = []
    for (const item of items) {
      if (item.deletedAt) continue
      if (!item.title.toLowerCase().includes(ql) && !searchText(item).includes(ql)) continue
      matches.push(item)
      if (matches.length === 4) break
    }
    return matches.sort((a, b) => Number(b.title.toLowerCase().startsWith(ql)) - Number(a.title.toLowerCase().startsWith(ql)))
  }, [focused, items, ql, pending])

  const clear = () => (setQ(''), setRead(null), setSel(0))
  const done = () => (clear(), !useConvo.getState().open && input.current?.blur())

  // ─── Doing what was asked ───
  const addEvent = (question: string, title: string, w: ParsedEvent) => {
    const act = eventAct(title, w)
    const undo = perform(act)
    if (useConvo.getState().open) say(question, '', { acts: [act] }, true)
    toast(`Added “${title}” · ${whenLabel(w)}`, { ms: 8000, action: { label: 'Undo', run: undo } })
  }
  const addTaskNow = (question: string, line: string) => {
    const t = addTask(line)
    if (!t) return
    const { name, due } = taskPreview(line)
    const label = `Added “${name}”${due ? ` · due ${whenLabel(due)}` : ''}`
    if (useConvo.getState().open) say(question, `${label} to Tasks.`)
    toast(label, { ms: 6000, action: { label: 'Undo', run: () => removeTask(t) } })
  }
  const newDoc = (title: string) => useStore.getState().createItem('doc', title ? { title } : {})
  const askNow = (prompt: string) => {
    void ask(prompt)
    input.current?.focus()
  }

  /** A detail the bar asked for: the event's name, or when it is. Anything that isn't an answer starts over. */
  const answer = (p: Pending, reply: string) => {
    if (p.need === 'title') {
      const title = cleanTitle(reply)
      if (!title || isQuestion(reply)) return false
      addEvent(reply, title, { title, start: new Date(p.start), end: new Date(p.end), allDay: p.allDay, location: p.location, due: !!p.due, repeat: p.repeat, matched: '', explicitDuration: false })
    } else {
      const w = readEvent(reply).when
      if (!w) return false
      addEvent(reply, p.title, w)
    }
    useConvo.setState({ pending: null })
    return true
  }

  const run = async (r: Read) => {
    const said = r.text
    // With files attached, everything is a question about them; the assistant offers any change as a card.
    if (files.length) return askNow(said)
    if (r.kind === 'event' && r.event) {
      const { title, when } = r.event
      if (title && when) return addEvent(said, title, when)
      // Never an event named after the request: ask for what's missing.
      if (when) {
        useConvo.setState({ pending: { need: 'title', start: when.start.getTime(), end: when.end.getTime(), allDay: when.allDay, location: when.location, due: when.due, repeat: when.repeat } })
        return say(said, `What should I call it? It’s ${whenLabel(when)}.`)
      }
      if (title) {
        useConvo.setState({ pending: { need: 'when', title } })
        return say(said, `When is “${title}”?`)
      }
      return askNow(said)
    }
    if (r.kind === 'task' && r.task) return addTaskNow(said, r.task)
    if (r.kind === 'doc') return void newDoc(r.doc ?? '')
    if (r.kind === 'find' && hits[0]) return useStore.getState().open(hits[0].id)
    askNow(said)
  }

  const submit = async () => {
    if (!text) return
    const p = useConvo.getState().pending
    if (p && answer(p, text)) return done()
    if (p) useConvo.setState({ pending: null })
    let r = now ?? quickRead(text, section)
    // Enter before EmbeddingGemma's read arrived: wait for it (it takes milliseconds, or gives up quickly).
    if (r.by === 'rules') {
      const { understand } = await import('../ai/understand')
      r = { ...(await understand(text, { section, ms: 300 })), text }
    }
    done()
    await run(r)
  }

  // ─── What Enter will do, then other ways to read it ───
  const options: Option[] = []
  if (!text && !pending) {
    if (hasThread && !convoOpen) options.push({ key: 'thread', icon: MessageCircle, label: 'Back to the conversation', run: () => openThread() })
    for (const c of filesMode ? fileChips(files.map((f) => f.name)) : ctx.chips) options.push({ key: c, icon: ArrowUpRight, label: c, run: () => (clear(), askNow(c)) })
  } else if (text && !pending && now) {
    const ev = now.event
    if (!filesMode && now.kind === 'event' && ev)
      options.push({
        key: 'event', icon: CalendarPlus,
        label: ev.title ? <>Add “{ev.title}”</> : <>New event</>,
        hint: ev.when ? whenLabel(ev.when) + (ev.title ? '' : ' · you’ll name it next') : 'you’ll pick the day next',
        run: () => (done(), void run(now)),
      })
    if (!filesMode && now.kind === 'task') {
      // The line keeps its date words ("… on tuesday"): Tasks reads the due date from them. Show it as it will be listed.
      const { name, due } = taskPreview(now.task || text)
      options.push({ key: 'task', icon: ListPlus, label: <>Add task “{name.slice(0, 60)}”</>, hint: due ? `due ${whenLabel(due)}` : undefined, run: () => (done(), void run(now)) })
    }
    if (!filesMode && now.kind === 'doc') options.push({ key: 'doc', icon: FilePlus2, label: now.doc ? <>New doc “{now.doc}”</> : 'New doc', run: () => (done(), void run(now)) })
    const findFirst = !filesMode && now.kind === 'find' && hits.length > 0
    const hitOpts: Option[] = hits.map((i) => ({
      key: i.id, icon: i.kind === 'lecture' ? AudioWaveform : i.kind === 'doc' ? FileText : StickyNote, emoji: itemEmoji(i) || undefined,
      label: i.title || 'Untitled', hint: i.kind === 'lecture' ? 'Recording' : 'Doc', run: () => (useStore.getState().open(i.id), done()),
    }))
    if (findFirst) options.push(...hitOpts)
    options.push({ key: 'ask', icon: MessageCircle, label: <>Ask{filesMode ? ` about ${files.length === 1 ? files[0].name.slice(0, 24) : `${files.length} files`}` : page ? ` about ${(page.title || 'this').slice(0, 24)}` : ''}: “{text.slice(0, 60)}”</>, run: () => (clear(), askNow(text)) })
    // The other readings, quieter, in case the first guess was wrong.
    if (!filesMode && now.kind !== 'event' && readEvent(text).when) {
      const alt = readEvent(text)
      options.push({ key: 'alt-event', icon: CalendarPlus, label: alt.title ? <>Add “{alt.title}” to the calendar</> : 'Add to the calendar', hint: whenLabel(alt.when!), run: () => (done(), void run({ ...now, kind: 'event', event: alt })) })
    }
    if (!filesMode && (now.kind === 'ask' || now.kind === 'find') && !isQuestion(text)) options.push({ key: 'alt-task', icon: ListPlus, label: <>Add as a task</>, run: () => (done(), void run({ ...now, kind: 'task', task: readTask(text) })) })
    if (!findFirst && !filesMode) options.push(...hitOpts)
  }
  useEffect(() => setSel(0), [text, now?.kind])
  const pick = Math.min(sel, Math.max(0, options.length - 1))

  // "/" or ⌘J focuses the bar from anywhere; Home's starting points arrive here too.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as HTMLElement).closest('input,textarea,[contenteditable]')) return
      e.preventDefault()
      input.current?.focus()
    }
    const want = (e: Event) => {
      const t = (e as CustomEvent<{ text?: string }>).detail?.text
      if (t !== undefined) setQ(t)
      if (useConvo.getState().msgs.length) openThread()
      input.current?.focus()
    }
    window.addEventListener('keydown', k)
    window.addEventListener('monolith:ask', want)
    return () => (window.removeEventListener('keydown', k), window.removeEventListener('monolith:ask', want))
  }, [])

  const popOpen = focused && !convoOpen && options.length > 0
  const placeholder = pending ? (pending.need === 'title' ? 'Name the event' : 'When is it? (e.g. “Friday 3pm”)') : convoOpen && hasThread ? 'Ask a follow-up, or add something' : filesMode ? `Ask about ${files.length === 1 ? `“${files[0].name.slice(0, 28)}”` : `${files.length} files`}` : ctx.hint
  const SendIcon = text && now?.kind === 'event' ? CalendarPlus : text && now?.kind === 'task' ? ListPlus : ArrowUp

  return (
    <div
      className={`ask-bar ${phone ? 'phone' : ''} ${focused ? 'focus' : ''} ${convoOpen ? 'threaded' : ''} ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDropping(false)
        void attachFiles([...e.dataTransfer.files])
        input.current?.focus()
      }}
    >
      <AnimatePresence>
        {convoOpen && <Thread key="thread" page={page} />}
        {popOpen && (
          <motion.div
            key="pop"
            className="ask-pop"
            role="listbox"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <button key={o.key} role="option" aria-selected={i === pick} className={`ask-opt ${i === pick ? 'on' : ''}`} onClick={o.run} onMouseMove={() => i !== pick && setSel(i)}>
                {o.emoji ? <span className="ask-emoji">{o.emoji}</span> : <o.icon size={15} />}
                <span>{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
                <CornerDownLeft size={13} className="ask-enter" aria-hidden="true" />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {filesMode && (
        <div className="ask-files" role="list" aria-label="Attached files">
          {files.map((f) => (
            <span key={f.id} role="listitem" className="ask-file" title={f.note}>
              {f.image ? <img src={f.image} alt="" className="ask-thumb" /> : <FileText size={13} aria-hidden="true" />}
              <b title={f.name}>{f.name}</b>
              <small>{sizeLabel(f.size)}</small>
              <button onClick={() => detachFile(f.id)} aria-label={`Remove ${f.name}`}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="ask-field">
        <MessageCircle size={16} className="ask-ico" />
        <input
          ref={input}
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => (setFocused(true), hasThread && void import('../ai/llm').then((m) => m.warmUp()))}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && popOpen) (e.preventDefault(), setSel((pick + 1) % options.length))
            else if (e.key === 'ArrowUp' && popOpen) (e.preventDefault(), setSel((pick - 1 + options.length) % options.length))
            else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (popOpen && options[pick] && (pick > 0 || !text)) options[pick].run()
              else void submit()
            } else if (e.key === 'Escape') {
              if (text) clear()
              else if (pending) useConvo.setState({ pending: null })
              else if (convoOpen) openThread(false)
              else input.current?.blur()
            }
          }}
          aria-label={placeholder}
          onPaste={(e) => {
            if (!e.clipboardData.files.length) return
            e.preventDefault()
            void attachFiles([...e.clipboardData.files])
          }}
        />
        <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { void attachFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
        <button className="ask-attach" onClick={() => picker.current?.click()} aria-label="Attach files" title="Attach files">
          <Paperclip size={16} />
        </button>
        {streaming ? (
          <button className="ask-send" onClick={stop} aria-label="Stop"><Square size={12} fill="currentColor" /></button>
        ) : (
          <button className={`ask-send ${text ? '' : 'idle'}`} onClick={() => void submit()} disabled={!text} aria-label={now?.kind === 'event' ? 'Add event' : now?.kind === 'task' ? 'Add task' : 'Send'}>
            <SendIcon size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

/** What to offer when files are attached and nothing is typed yet. */
const fileChips = (names: string[]) => [
  names.length === 1 ? `Summarize “${names[0].slice(0, 32)}”` : `Summarize these ${names.length} files`,
  'Pull out the action items',
  'What dates are in here?',
]

const ACT_ICONS = { event: CalendarPlus, move: CalendarClock, cancel: CalendarX, task: ListPlus, done: CheckSquare, note: FileInput, doc: BookOpen }

/** The conversation, above the bar. */
function Thread({ page }: { page?: Item }) {
  const msgs = useConvo((s) => s.msgs)
  const meta = useConvo((s) => s.meta)
  const doneCards = useConvo((s) => s.done)
  const streaming = useConvo((s) => s.streaming)
  const useCtx = useConvo((s) => s.useCtx)
  const ai = useAI()
  const scroll = useRef<HTMLDivElement>(null)
  // Follow the answer as it's written, unless you've scrolled up to read.
  const pinned = useRef(true)
  useEffect(() => {
    const el = scroll.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [msgs, meta])
  const phone = useRemote((s) => (s.lastUsed ? s.remote : null))
  const model = phone ? `${phone.model} on ${phone.device}` : ai.status === 'ready' ? [...MODELS, ...ONNX_MODELS].find((m) => m.id === ai.loadedModel)?.name : ai.status === 'loading' ? `Getting ready · ${Math.round(Math.max(ai.progress, 0.02) * 100)}%` : null

  return (
    <motion.section
      className="convo"
      aria-label="Conversation with the assistant"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.16 }}
      onMouseDown={(e) => (e.target as HTMLElement).closest('button,a,.md') || e.preventDefault()}
    >
      <header className="convo-head">
        {page ? (
          <button className={`convo-ctx ${useCtx ? 'on' : ''}`} onClick={() => useConvo.setState({ useCtx: !useCtx })} title={useCtx ? 'Ask about everything instead' : 'Ask about this page'}>
            {useCtx ? <Check size={12} /> : <Square size={12} />} About “{(page.title || 'Untitled').slice(0, 28)}”
          </button>
        ) : (
          <span className="convo-title">Assistant</span>
        )}
        {model && <small className="convo-model">{model}</small>}
        <span className="grow" />
        <button className="icon-btn sm" onClick={reset} title="New conversation" aria-label="New conversation" disabled={!msgs.length}><SquarePen size={14} /></button>
        <button className="icon-btn sm" onClick={() => openThread(false)} title="Hide (Esc)" aria-label="Hide the conversation"><X size={15} /></button>
      </header>
      <div className="convo-scroll" ref={scroll} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {!msgs.length && <p className="convo-empty">Ask about your docs, your week or anything else. Say “add …” to put something on the calendar.</p>}
        {msgs.map((m, i) => {
          if (m.role === 'user') return <div key={i} className="cv-q">{m.content}</div>
          const mt = meta[i]
          const live = streaming && i === msgs.length - 1
          const shown = visible(m.content)
          return (
            <div key={i} className={`cv-a ${mt?.failed ? 'failed' : ''}`}>
              {shown ? (
                <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(shown) }} />
              ) : live || !mt?.acts.length ? (
                <div className="ai-status"><span className="slab-wait" aria-hidden="true" />{mt?.status && <span>{mt.status}</span>}</div>
              ) : null}
              {!live && mt?.acts.map((a, k) => <ActCard key={k} act={a} done={!!doneCards[`${i}:${k}`]} onDo={() => doCard(i, k)} />)}
              {!live && !!mt?.sources.length && (
                <div className="msg-sources">
                  <span>From</span>
                  {mt.sources.slice(0, 3).map((x) => (x.id ? <button key={x.id} className="src" onClick={() => useStore.getState().open(x.id!)}>{x.title}</button> : <span key={x.title} className="src">{x.title}</span>))}
                </div>
              )}
              {shown && !live && !mt?.local && (
                <div className="msg-actions">
                  <Listen id={`chat:${i}:${m.content.length}`} text={() => shown} className="mini" label="Listen" />
                  <button className="mini" onClick={() => void navigator.clipboard.writeText(shown).then(() => toast('Copied'))}><Copy size={11} /> Copy</button>
                  {page && page.kind === 'doc' && getActiveEditor() && !mt?.failed && (
                    <button className="mini" onClick={() => (getActiveEditor()?.chain().focus('end').insertContent(mdToHtml(shown)).run(), toast(`Added to “${page.title || 'Untitled'}”`))}>
                      <FileInput size={11} /> Add to doc
                    </button>
                  )}
                  {i === msgs.length - 1 && !streaming && <button className="mini" onClick={retry}><RefreshCw size={11} /> Retry</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </motion.section>
  )
}

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
      {done ? <span className="act-done"><Check size={14} /> {did}</span> : <button className={`btn sm ${act.kind === 'cancel' ? '' : 'primary'}`} onClick={onDo}>{verb}</button>}
    </div>
  )
}

