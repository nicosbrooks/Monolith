import { intent, system1Ready } from './system1'
import { chat, enqueue, isReady } from './llm'
import { cleanTitle, readDoc, readEvent, readTask, ruleKind, type EventRequest, type RequestKind } from '../lib/request'

/**
 * Understanding a request typed into the Ask bar or ⌘K, in two steps:
 *
 *  1. **What it is.** EmbeddingGemma (System 1, always loaded, a few milliseconds) compares the request to labelled
 *     examples: an event, a task, a new doc, a question, or something to find. Until it has downloaded, the rules in
 *     lib/request.ts decide. A plain question is always a question.
 *  2. **The details.** lib/request.ts takes out the date and time and drops the request's own words ("make an event
 *     for…"), so the title is the thing itself. When that still leaves something that reads like a request, the
 *     general model (if it's loaded) is asked for just the name. With no name at all, the Ask bar asks for one.
 */

export interface Understood {
  kind: RequestKind
  /** Who decided: EmbeddingGemma ('meaning') or the fallback rules. */
  by: 'meaning' | 'rules'
  event?: EventRequest
  task?: string
  doc?: string
}

/** How sure EmbeddingGemma has to be (the gap between its best and next guess) to overrule a best-guess rule. */
const MARGIN = 0.012

export async function understand(text: string, opts: { section?: string; now?: Date; ms?: number } = {}): Promise<Understood> {
  const now = opts.now ?? new Date()
  const rules = ruleKind(text, { section: opts.section, now })
  let kind = rules.kind
  let by: Understood['by'] = 'rules'
  // A question stays a question; everything else is EmbeddingGemma's call when it's ready.
  if (!(rules.sure && rules.kind === 'ask')) {
    const read = system1Ready() ? await intent(text, opts.ms ?? 250) : undefined
    if (read && (read.confidence >= MARGIN || !rules.sure)) ((kind = read.kind), (by = 'meaning'))
  }
  const ev = readEvent(text, now)
  // Where you are tips the balance: a dated line on Tasks is a task with a due date; a task-like line on the calendar
  // that names a date is an event.
  if (opts.section === 'tasks' && kind === 'event') kind = 'task'
  if (opts.section === 'calendar' && kind === 'task' && ev.when) kind = 'event'
  // EmbeddingGemma said "event", but there's neither a date nor any word for one: let the assistant take it.
  if (kind === 'event' && !ev.when && !/\b(?:event|meeting|appointment|calendar)\b/i.test(text)) kind = 'ask'

  if (kind === 'event') return { kind, by, event: { ...ev, title: await refineTitle(text, ev.title) } }
  if (kind === 'task') return { kind, by, task: readTask(text) }
  if (kind === 'doc') return { kind, by, doc: readDoc(text) }
  return { kind, by }
}

/** A title the rules couldn't fully clean: still starts like a request, or is long enough to be one. */
const messy = (t: string) => /^(?:make|create|add|schedule|can|could|would|please|i |i'd|let's|put|plan|set)\b/i.test(t) || t.split(/\s+/).length > 7

/** Ask the general model for just the event's name, when the rules leave something messy and it's already loaded. */
async function refineTitle(request: string, guess: string): Promise<string> {
  if (!guess || !messy(guess) || !isReady()) return guess
  const ask = enqueue(() =>
    chat(
      [
        { role: 'system', content: 'You extract calendar event names. Reply with only the name, at most 6 words, as someone would write it on their calendar. No date, no time, no quotes. If the request gives no name, reply NONE.' },
        { role: 'user', content: request },
      ],
      undefined,
      { temperature: 0, maxTokens: 24 },
    ),
  )
  const answer = await Promise.race([ask.catch(() => ''), new Promise<string>((r) => setTimeout(() => r(''), 6000))])
  const name = answer.split('\n')[0].replace(/^["“'‘]|["”'’.]$/g, '').trim()
  if (!name) return guess
  if (/^none$/i.test(name)) return ''
  return cleanTitle(name) || guess
}
