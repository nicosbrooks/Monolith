import { format, set } from 'date-fns'
import { occurrenceOf, repeatLabel } from '../lib/repeat'
import { useStore } from '../store'
import type { CalEvent, Item } from '../types'
import { htmlToText, mdToHtml } from '../lib/util'
import { eventColor, parseQuickEvent } from '../lib/dates'
import { addTask, findOpenTask, removeTask, setTaskDone } from '../lib/tasks'

/**
 * The assistant can do things, not just answer. It proposes them as `@event {…}`-style lines; the app shows each
 * as a card you confirm with one tap, and every one can be undone.
 */
export type Act =
  | { kind: 'event'; title: string; start: number; end: number; allDay: boolean; location?: string; due?: boolean; repeat?: CalEvent['repeat'] }
  | { kind: 'move'; eventId: string; title: string; start: number; end: number; allDay: boolean; was: { start: number; end: number; allDay?: boolean } }
  | { kind: 'cancel'; eventId: string; title: string; start: number }
  | { kind: 'task'; title: string; docId: string | null; docTitle: string }
  | { kind: 'done'; title: string; taskId: string }
  | { kind: 'note' | 'doc'; title: string; md: string }

// Placeholders, not sample values: small models copy examples word for word.
export const ACT_GUIDE = `The user asked you to do something in the app. Reply with only one line per change, nothing before or after, using these forms (fill in every <…>, times are local):
@event {"title":"<what>","start":"<YYYY-MM-DDTHH:MM>","end":"<YYYY-MM-DDTHH:MM>"}
@event {"title":"<what>","date":"<YYYY-MM-DD>"}
@move {"event":"<title exactly as on the calendar>","start":"<YYYY-MM-DDTHH:MM>"}
@cancel {"event":"<title exactly as on the calendar>"}
@task {"text":"<the task>"}
@done {"task":"<task text exactly as under Open tasks>"}
@doc {"title":"<title>","md":"<markdown body>"}
Take dates from the Dates list. For @move, include an end only if the user asks to change the duration. Only do what the user asked for.`

/**
 * Only a request to do something gets the action format; questions get plain answers. The verb has to be the request
 * itself ("move my 3pm to 4", "can you add…"), not just a word in a question ("how do I complete the lab?").
 */
const ACT_VERB = String.raw`(?:add|schedule|book|put|create|make|write|draft|save|remind|plan out|set up|block (?:off|out)|move|reschedule|push|postpone|shift|cancel|delete|remove|clear|mark|check off|tick off|finish|complete)`
const LEAD = String.raw`^\s*(?:(?:please|pls|ok(?:ay)?|hey|now|also|and|then|just)[,\s]+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|i(?:['’]d| would)? (?:like|want|need) (?:you )?to\s+|let['’]?s\s+|go ahead and\s+)?`
const COMMAND = new RegExp(LEAD + ACT_VERB + String.raw`\b`, 'i')
const ANYWHERE = /\b(?:new (?:note|doc|event|task)|remind me|(?:to|on|off|from) my (?:calendar|schedule|list)|as (?:done|complete|finished)|i(?:['’]?m| am)? done with|i (?:finished|completed))\b/i
export const wantsAction = (text: string) => text.split(/[.!?\n]+\s*/).some((s) => COMMAND.test(s)) || ANYWHERE.test(text)

/** Drop events already on the calendar (same title, same day), so nothing is offered twice. */
export function fresh(acts: Act[], events: { title: string; start: number }[]) {
  const day = (t: number) => new Date(t).toDateString()
  return acts.filter((a) => a.kind !== 'event' || !events.some((e) => e.title.trim().toLowerCase() === a.title.trim().toLowerCase() && day(e.start) === day(a.start)))
}

const LINE = /^@(event|move|cancel|task|done|note|doc)\s+(\{.*\})\s*$/
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** The calendar event a model means by a title: exact first, then the closest one coming up. Never a subscribed one. */
function findEvent(title: string, events: CalEvent[]) {
  const t = norm(title)
  if (!t) return null
  const mine = events.filter((e) => !e.calId)
  const pick = (l: CalEvent[]) => l.sort((a, b) => Math.abs(a.start - Date.now()) - Math.abs(b.start - Date.now()))[0] ?? null
  return pick(mine.filter((e) => norm(e.title) === t)) ?? pick(mine.filter((e) => norm(e.title).includes(t) || t.includes(norm(e.title))))
}

const time = (s: string) => new Date(s).getTime()

/** The answer without its action lines (and without a half-written one while streaming). Cheap: no lookups. */
export const visible = (text: string) =>
  text.split('\n').filter((l) => !/^\s*@(event|move|cancel|task|done|note|doc)\b/.test(l)).join('\n').trim()

/** Separate action lines from the visible answer. Partial lines while streaming are hidden too. */
export function splitActs(text: string, ctx: { events: CalEvent[]; items: Item[]; openId?: string | null } = { events: useStore.getState().events, items: useStore.getState().items }): { text: string; acts: Act[] } {
  const acts: Act[] = []
  const keep: string[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!/^@(event|move|cancel|task|done|note|doc)\b/.test(t)) {
      keep.push(line)
      continue
    }
    const m = t.match(LINE)
    if (!m || m[2].includes('<')) continue
    try {
      const j = JSON.parse(m[2])
      const kind = m[1]
      if (kind === 'event' || kind === 'move') {
        const allDay = !!j.date && !j.start
        const start = allDay ? time(`${j.date}T00:00`) : time(j.start)
        if (isNaN(start)) continue
        let end = allDay ? start + 864e5 : time(j.end || '')
        if (isNaN(end) || end <= start) end = start + 3600e3
        if (kind === 'event') {
          acts.push({ kind, title: String(j.title || 'New event').slice(0, 120), start, end, allDay })
          continue
        }
        const e = findEvent(String(j.event || j.title || ''), ctx.events)
        if (!e) continue
        // Moving keeps the length unless a new end is given.
        if (!j.end && !allDay) end = start + (e.end - e.start)
        acts.push({ kind, eventId: e.id, title: e.title, start, end, allDay, was: { start: e.start, end: e.end, allDay: e.allDay } })
      } else if (kind === 'cancel') {
        const e = findEvent(String(j.event || j.title || ''), ctx.events)
        if (e) acts.push({ kind, eventId: e.id, title: e.title, start: e.start })
      } else if (kind === 'task') {
        const raw = String(j.text || j.title || '').trim().slice(0, 200)
        const text = raw.charAt(0).toUpperCase() + raw.slice(1)
        if (!text) continue
        // Asked from inside a doc: the task goes with that doc (it isn't written into it).
        const doc = ctx.openId ? ctx.items.find((i) => i.id === ctx.openId && i.kind === 'doc' && !i.deletedAt) : null
        acts.push({ kind, title: text, docId: doc?.id ?? null, docTitle: doc?.title || '' })
      } else if (kind === 'done') {
        const t = findOpenTask(String(j.task || j.text || ''))
        if (t) acts.push({ kind, title: t.title, taskId: t.id })
      } else {
        acts.push({ kind: kind as 'note' | 'doc', title: String(j.title || 'Untitled').slice(0, 120), md: String(j.md || '') })
      }
    } catch {
      /* not valid JSON: leave it out */
    }
  }
  return { text: keep.join('\n').trim(), acts }
}

const DAY_REF = /\b(today|tonight|tomorrow|tmrw|(?:next\s+|this\s+)?(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{1,2}\/\d{1,2})\b/gi

/**
 * Small models get dates wrong ("Tuesday" → the week after). When the request names one day, the app reads it
 * itself, the way quick add does, and pins the new time to it. The model's time is kept unless the request
 * gives one. "Move X from Monday to Tuesday 3pm" reads the part after the last "to".
 */
export function pinToAsked(acts: Act[], request: string, now = new Date()): Act[] {
  const timed = acts.filter((a) => a.kind === 'event' || a.kind === 'move')
  if (timed.length !== 1) return acts
  const target = / to (?=.*\b(today|tomorrow|tonight|sun|mon|tue|wed|thu|fri|sat|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d))/i.test(request) ? request.slice(request.toLowerCase().lastIndexOf(' to ') + 4) : request
  if ((target.match(DAY_REF) ?? []).length !== 1) return acts
  const p = parseQuickEvent(target, now)
  if (!p) return acts
  const hasTime = !p.allDay
  return acts.map((a) => {
    if (a.kind !== 'event' && a.kind !== 'move') return a
    const len = a.kind === 'move' && !a.was.allDay
      ? p.explicitDuration ? +p.end - +p.start : a.was.end - a.was.start
      : a.end - a.start
    const old = new Date(a.start)
    const start = (hasTime ? p.start : set(p.start, { hours: old.getHours(), minutes: old.getMinutes() })).getTime()
    const allDay = hasTime ? false : a.allDay
    if (start === a.start && len === a.end - a.start && allDay === a.allDay) return a
    return { ...a, start, end: allDay ? start + 864e5 : start + len, allDay }
  })
}

/** "add calc review thu 4pm" needs no model: it's an event, right away. */
export function quickAct(text: string): Act | null {
  if (!/^\s*(add|schedule|book|put|create|new|remind me)\b/i.test(text)) return null
  const p = parseQuickEvent(text.replace(/^\s*(add|schedule|book|put|create( an?)?( event)?|new( event)?|remind me( to| about)?)\s+/i, ''))
  if (!p) return null
  return { kind: 'event', title: p.title.replace(/\s+(to|on) (my )?calendar$/i, '') || 'New event', start: p.start.getTime(), end: p.end.getTime(), allDay: p.allDay, location: p.location, due: p.due, repeat: p.repeat }
}

/** Notes, docs or recordings the question names ("summarize the biology lecture"). */
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

const span = (start: number, end: number, allDay: boolean) => (allDay ? format(start, 'EEE, MMM d') : `${format(start, 'EEE, MMM d · h:mm a')} – ${format(end, 'h:mm a')}`)

/** The card's second line. */
export function describe(a: Act) {
  const past = (t: number) => (t < Date.now() - 3600e3 ? ' · in the past' : '')
  switch (a.kind) {
    case 'event': return (a.due ? 'Due ' : '') + (a.due && !a.allDay ? format(a.start, 'EEE, MMM d · h:mm a') : span(a.start, a.end, a.allDay)) + (a.repeat ? ` · ${repeatLabel(a.repeat)}` : '') + (a.location ? ` · ${a.location}` : '') + past(a.start)
    case 'move': return `${format(a.was.start, 'EEE h:mm a')} → ${span(a.start, a.end, a.allDay)}${past(a.start)}`
    case 'cancel': return `Remove from ${format(a.start, 'EEE, MMM d')}`
    case 'task': return a.docId ? `Add to Tasks · for “${a.docTitle || 'Untitled'}”` : 'Add to Tasks'
    case 'done': return 'Check off in Tasks'
    default: return 'New doc'
  }
}

/** The card's button, and what it says once done. */
export const verbs = (a: Act): [string, string] =>
  ({ event: ['Add', 'Added'], move: ['Move', 'Moved'], cancel: ['Remove', 'Removed'], task: ['Add', 'Added'], done: ['Check off', 'Checked off'], note: ['Create', 'Created'], doc: ['Create', 'Created'] })[a.kind] as [string, string]

/** Do it. Returns how to undo it. */
export function perform(a: Act): () => void {
  const st = useStore.getState()
  switch (a.kind) {
    case 'event': {
      const e = st.addEvent({ title: a.title, start: a.start, end: a.end, allDay: a.allDay, location: a.location, color: eventColor(a), repeat: a.repeat })
      return () => useStore.getState().deleteEvent(e.id)
    }
    // One date of a repeating event is moved or removed on its own; the rest of the series stays.
    case 'move': {
      const before = st.events
      if (occurrenceOf(a.eventId)) st.detachEvent(a.eventId, { start: a.start, end: a.end, allDay: a.allDay })
      else st.updateEvent(a.eventId, { start: a.start, end: a.end, allDay: a.allDay })
      return () => useStore.setState({ events: before })
    }
    case 'cancel': {
      const before = st.events
      st.deleteEvent(a.eventId)
      return () => useStore.setState({ events: before })
    }
    case 'task': {
      const t = addTask(a.title, a.docId ? { docId: a.docId } : {})
      return () => void (t && removeTask(t.id))
    }
    case 'done': {
      setTaskDone(a.taskId, true)
      return () => setTaskDone(a.taskId, false)
    }
    default: {
      const it = st.createItem(a.kind, { title: a.title, content: mdToHtml(a.md) })
      st.open(it.id)
      return () => useStore.getState().trashItem(it.id)
    }
  }
}

