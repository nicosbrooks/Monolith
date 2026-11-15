import { format } from 'date-fns'
import { useStore } from '../store'
import type { Item } from '../types'
import { htmlToText, mdToHtml } from '../lib/util'
import { parseQuickEvent } from '../lib/dates'

/**
 * The assistant can do things, not just answer: add an event, write a note or a doc. It proposes them as
 * `@event {…}` / `@note {…}` / `@doc {…}` lines; the app shows each as a card you confirm with one tap.
 */
export type Act =
  | { kind: 'event'; title: string; start: number; end: number; allDay: boolean }
  | { kind: 'note' | 'doc'; title: string; md: string }

// Placeholders, not sample values: small models copy examples word for word.
export const ACT_GUIDE = `The user asked you to do something in the app. Say in one short sentence what you're adding, then end with one line per item, in this form (fill in every <…>):
@event {"title":"<what>","start":"<YYYY-MM-DDTHH:MM>","end":"<YYYY-MM-DDTHH:MM>"}
@event {"title":"<what>","date":"<YYYY-MM-DD>"}
@note {"title":"<title>","md":"<markdown body>"}
@doc {"title":"<title>","md":"<markdown body>"}
Use local times. Only add what the user asked for.`

/** Only a request to do something gets the action format; questions get plain answers. */
export const wantsAction = (text: string) =>
  /\b(add|schedule|book|put|create|make|write|draft|save|remind|plan out|set up|block (off|out)|new (note|doc|event))\b/i.test(text)

/** Drop events already on the calendar (same title, same day), so nothing is offered twice. */
export function fresh(acts: Act[], events: { title: string; start: number }[]) {
  const day = (t: number) => new Date(t).toDateString()
  return acts.filter((a) => a.kind !== 'event' || !events.some((e) => e.title.trim().toLowerCase() === a.title.trim().toLowerCase() && day(e.start) === day(a.start)))
}

const LINE = /^@(event|note|doc)\s+(\{.*\})\s*$/

/** Separate action lines from the visible answer. Partial lines while streaming are hidden too. */
export function splitActs(text: string): { text: string; acts: Act[] } {
  const acts: Act[] = []
  const keep: string[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('@event') && !t.startsWith('@note') && !t.startsWith('@doc')) {
      keep.push(line)
      continue
    }
    const m = t.match(LINE)
    if (!m) continue
    try {
      if (m[2].includes('<')) continue
      const j = JSON.parse(m[2])
      if (m[1] === 'event') {
        const allDay = !!j.date && !j.start
        const start = new Date(allDay ? `${j.date}T00:00` : j.start).getTime()
        if (isNaN(start)) continue
        let end = allDay ? start + 864e5 : new Date(j.end || '').getTime()
        if (isNaN(end) || end <= start) end = start + 3600e3
        acts.push({ kind: 'event', title: String(j.title || 'New event').slice(0, 120), start, end, allDay })
      } else {
        acts.push({ kind: m[1] as 'note' | 'doc', title: String(j.title || 'Untitled').slice(0, 120), md: String(j.md || '') })
      }
    } catch {
      /* not valid JSON: leave it out */
    }
  }
  return { text: keep.join('\n').trim(), acts }
}

/** "add calc review thu 4pm" needs no model: it's an event, right away. */
export function quickAct(text: string): Act | null {
  if (!/^\s*(add|schedule|book|put|create|new|remind me)\b/i.test(text)) return null
  const p = parseQuickEvent(text.replace(/^\s*(add|schedule|book|put|create( an?)?( event)?|new( event)?|remind me( to| about)?)\s+/i, ''))
  if (!p) return null
  return { kind: 'event', title: p.title.replace(/\s+(to|on) (my )?calendar$/i, '') || 'New event', start: p.start.getTime(), end: p.end.getTime(), allDay: p.allDay }
}

/** Notes, docs or recordings the question names ("summarize the biology lecture") are given to the model in full. */
export function mentioned(text: string, items: Item[]): Item[] {
  const q = text.toLowerCase()
  return items
    .filter((i) => !i.deletedAt && i.title.trim().length > 2 && q.includes(i.title.toLowerCase().replace(/^recording · /, '').trim()))
    .slice(0, 2)
}

export function itemText(i: Item) {
  const transcript = i.lecture?.transcript.map((s) => s.text).join(' ') || ''
  return `"${i.title}" (${i.kind === 'lecture' ? 'recording' : i.kind}):\n${htmlToText(i.content)}${transcript ? `\nTranscript: ${transcript}` : ''}`.slice(0, 6000)
}

export function describe(a: Act) {
  if (a.kind === 'event') return a.allDay ? format(a.start, 'EEE, MMM d') : `${format(a.start, 'EEE, MMM d · h:mm a')} – ${format(a.end, 'h:mm a')}`
  return 'New doc'
}

/** Do it, and return what to open. */
export function perform(a: Act) {
  const st = useStore.getState()
  if (a.kind === 'event') {
    st.addEvent({ title: a.title, start: a.start, end: a.end, allDay: a.allDay, color: /due|exam|quiz|test|deadline/i.test(a.title) ? 'rose' : 'blue' })
    return
  }
  const body = mdToHtml(a.md)
  const it = st.createItem(a.kind, { title: a.title, content: body })
  st.open(it.id)
}
