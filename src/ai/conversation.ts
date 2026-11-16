import { create } from 'zustand'
import { useStore } from '../store'
import { allEvents, ownEvents } from '../lib/events'
import { chat, enqueue, ensureAI, isReady, type Msg } from './llm'
import { ACT_GUIDE, describe, fresh, perform, pinToAsked, splitActs, verbs, visible, wantsAction, type Act } from './act'
import { CHAT_RULES, evidenceQuery, packTurn, sameEvidence, turnEvidence, wantsDeviceContext, type Evidence, type Workspace } from './context'
import { instantAnswer } from './instant'
import { deviceContext, refreshDevice } from '../lib/integrations'
import { passageScores } from './system1'
import { toast } from '../components/Toast'
import type { CalEvent } from '../types'

/**
 * The one conversation with the assistant. It lives in the Ask bar at the bottom of every page (there is no separate
 * chat panel): a question opens a thread above the bar, follow-ups continue it, and anything the assistant offers to
 * do shows as a card you confirm with one tap. Everything can be undone.
 */

export type Source = { id: string | null; title: string }
/** What the app knows about each answer: where it came from, what it offers to do, what it's doing now. */
export type Meta = { sources: Source[]; acts: Act[]; status?: string; failed?: boolean; /** The app's own short reply, not the model's. */ local?: boolean }

/** A detail the Ask bar asked for: the name of an event it has a date for, or the date of one it has a name for. */
export type Pending = { need: 'title'; start: number; end: number; allDay: boolean; location?: string; due?: boolean; repeat?: CalEvent['repeat'] } | { need: 'when'; title: string }

interface Convo {
  msgs: Msg[]
  meta: Record<number, Meta>
  /** Cards already done, by `answerIndex:cardIndex`. */
  done: Record<string, boolean>
  streaming: boolean
  /** The thread is showing above the Ask bar. */
  open: boolean
  /** Questions are about the open doc or recording (the "About …" chip turns it off). */
  useCtx: boolean
  pending: Pending | null
}

export const useConvo = create<Convo>(() => ({ msgs: [], meta: {}, done: {}, streaming: false, open: false, useCtx: true, pending: null }))

let abort: AbortController | null = null
// Keep the prompt prefix when its evidence is still current, so the runtime can reuse its cache.
const sent = new Map<number, { content: string; kept: Evidence[]; workspace: Workspace }>()

/** The doc or recording on screen, if questions should be about it. */
function openItem() {
  const st = useStore.getState()
  if (st.section !== 'docs' && st.section !== 'lectures') return null
  return st.items.find((i) => i.id === st.activeId && !i.deletedAt) ?? null
}

export const openThread = (open = true) => useConvo.setState({ open })
export const stop = () => abort?.abort()

/** Start over: a new conversation. */
export function reset() {
  abort?.abort()
  sent.clear()
  useConvo.setState({ msgs: [], meta: {}, done: {}, streaming: false, pending: null })
}

/** Add a question and the app's own answer to the thread, without the model (an event added, a detail asked for). */
export function say(question: string, answer: string, meta: Partial<Meta> = {}, doneCards = false) {
  const { msgs } = useConvo.getState()
  const at = msgs.length + 1
  const done = doneCards ? Object.fromEntries((meta.acts ?? []).map((_, k) => [`${at}:${k}`, true])) : {}
  useConvo.setState((s) => ({
    msgs: [...msgs, { role: 'user', content: question }, { role: 'assistant', content: answer }],
    meta: { ...s.meta, [at]: { sources: [], acts: [], local: true, ...meta } },
    done: { ...s.done, ...done },
    open: true,
  }))
}

/** Do what a card offers, mark it done, and show a toast that can undo it. */
export function doCard(at: number, k: number) {
  const act = useConvo.getState().meta[at]?.acts[k]
  if (!act) return
  const undo = perform(act)
  const key = `${at}:${k}`
  useConvo.setState((s) => ({ done: { ...s.done, [key]: true } }))
  toast(`${verbs(act)[1]} “${act.title.length > 32 ? act.title.slice(0, 31) + '…' : act.title}”`, {
    ms: 8000,
    action: { label: 'Undo', run: () => (undo(), useConvo.setState((s) => ({ done: { ...s.done, [key]: false } }))) },
  })
}

/** Ask the last question again. */
export function retry() {
  const { msgs } = useConvo.getState()
  const last = msgs.length - 2
  if (last < 0 || msgs[last].role !== 'user') return
  void ask(msgs[last].content, msgs.slice(0, last))
}

/** Ask the assistant. The thread opens and the answer streams into it. */
export async function ask(text: string, base = useConvo.getState().msgs) {
  if (!text.trim() || abort) return
  const st = useStore.getState()
  const at = base.length + 1 // index of the answer
  const next: Msg[] = [...base, { role: 'user', content: text }]
  // A retried answer starts with fresh cards.
  useConvo.setState((s) => ({ open: true, pending: null, done: Object.fromEntries(Object.entries(s.done).filter(([k]) => !k.startsWith(`${at}:`))) }))
  const put = (content: string, m: Meta) => useConvo.setState((s) => ({ msgs: [...next, { role: 'assistant', content }], meta: { ...s.meta, [at]: m } }))

  // Exact answers from the app's own data need no model ("what's on tomorrow").
  const instant = !wantsAction(text) && instantAnswer(text, { events: allEvents(), items: st.items })
  if (instant) return put(instant.text, { sources: [{ id: null, title: instant.source === 'calendar' ? 'Your calendar' : 'Your open tasks' }], acts: [] })

  const controller = new AbortController()
  abort = controller
  useConvo.setState({ streaming: true })
  put('', { sources: [], acts: [], status: 'Thinking…' }) // the question shows the moment it's sent
  const active = useConvo.getState().useCtx ? openItem() : null
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
    const workspace: Workspace = { items: current.items, events: ownEvents(current.events), now: new Date(), device: deviceContext() }
    const open = active ? current.items.find((item) => item.id === active.id && !item.deletedAt) : null
    // System 1 ranks passages by meaning when it's ready (a few milliseconds); otherwise words alone decide.
    const semantic = await passageScores(query).catch(() => undefined)
    const evidence = turnEvidence(query, { ...workspace, open, action: act, semantic })
    const start = Math.max(0, base.length - 10)
    for (const i of sent.keys()) if (i < start || i >= base.length) sent.delete(i)
    const meta = useConvo.getState().meta
    const history = base.slice(start).map((m, offset): Msg => {
      const index = start + offset
      if (m.role === 'user') {
        const prior = sent.get(index)
        const content = prior && sameEvidence(prior.kept, prior.workspace, workspace) ? prior.content.replace(`${ACT_GUIDE}\n\n`, '') : m.content
        return { role: 'user', content }
      }
      const cards = meta[index]?.acts
      const content = visible(m.content) || (cards?.length ? `Offered: ${cards.map((a) => `${verbs(a)[0]} “${a.title}” (${describe(a)})`).join('; ')}` : '(No answer.)')
      return { role: 'assistant', content }
    })
    let sources: Source[] = []
    let packed: ReturnType<typeof packTurn> | undefined
    const full = await enqueue(() =>
      chat(
        (window, reserve) => {
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
        },
        (t) => useConvo.setState({ msgs: [...next, { role: 'assistant', content: t }] }),
        { signal: controller.signal, temperature: 0.3, maxTokens: act ? 800 : 500, turnKey: (m) => m.content.replace(`${ACT_GUIDE}\n\n`, '') },
      ),
    )
    if (packed && !controller.signal.aborted) sent.set(base.length, { ...packed, workspace })
    const now = useStore.getState()
    const acts = act ? fresh(pinToAsked(splitActs(full, { events: ownEvents(now.events), items: now.items, openId: active?.id ?? null }).acts, text), ownEvents(now.events)) : []
    if (!visible(full) && !acts.length) put(act ? 'I couldn’t work out that change. Try saying it another way, with the day and time.' : 'No answer came back. Try asking another way.', { sources, acts: [], failed: true })
    else put(full, { sources, acts })
  } catch (e) {
    if (!controller.signal.aborted) {
      const detail = typeof e === 'string' ? e : e instanceof Error ? e.message : 'The assistant couldn’t answer. Try again.'
      put(detail, { sources: [], acts: [], failed: true })
    } else useConvo.setState((s) => ({ meta: { ...s.meta, [at]: { ...s.meta[at], status: undefined } } }))
  } finally {
    abort = null
    useConvo.setState({ streaming: false })
  }
}
