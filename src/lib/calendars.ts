import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import { addMonths } from 'date-fns'
import type { CalEvent } from '../types'
import { uid } from './util'

/**
 * Calendars you subscribe to: a Google, Apple or Outlook calendar's link, or an .ics file. They show next to your
 * own events in their own color, read-only, and refresh on their own. Nothing to set up beyond pasting the link.
 */
export interface Subscription {
  id: string
  name: string
  /** The calendar's link. Empty for a calendar opened from a file, which doesn't refresh. */
  url: string
  color: string
  hidden?: boolean
  fetchedAt?: number
  error?: string
}

interface State {
  subs: Subscription[]
  /** Occurrences, by subscription id, from two months back to a year ahead. */
  events: Record<string, CalEvent[]>
  busy: Record<string, boolean>
}

const PALETTE = ['violet', 'teal', 'amber', 'green', 'rose', 'slate', 'blue']
const REFRESH = 15 * 60_000

export const useCalendars = create<State>()(
  persist(() => ({ subs: [], events: {}, busy: {} }) as State, {
    name: 'socratic-calendars',
    version: 1,
    storage: createJSONStorage(() => ({
      getItem: async (k: string) => (await get(k)) ?? null,
      setItem: (k: string, v: string) => set(k, v),
      removeItem: (k: string) => del(k),
    })),
    partialize: (s) => ({ subs: s.subs, events: s.events }) as State,
  }),
)

/**
 * Where the calendar file can be fetched: the relay, this site's own server, then the host itself.
 * The link goes in the request body, never the URL, because private calendar links are secrets.
 */
function sources(url: string): [string, RequestInit][] {
  const relay = (import.meta.env.VITE_RELAY_URL as string | undefined)?.replace(/^ws/, 'http').replace(/\/$/, '')
  const post: RequestInit = { method: 'POST', body: url, headers: { 'content-type': 'text/plain' } }
  return [
    ...(relay ? [[`${relay}/ics`, post] as [string, RequestInit]] : []),
    ...(location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? [['/ics', post] as [string, RequestInit]] : []),
    [url.replace(/^webcals?:\/\//i, 'https://'), {}],
  ]
}

async function download(url: string): Promise<string> {
  let reason = 'That calendar couldn’t be reached.'
  for (const [src, init] of sources(url)) {
    const res = await fetch(src, init).catch(() => null)
    if (res?.ok) {
      const text = await res.text()
      if (/^\s*BEGIN:VCALENDAR/i.test(text)) return text
      reason = 'That link isn’t a calendar.'
    } else if (res && res.status >= 400 && res.status < 500 && res.headers.get('content-type')?.startsWith('text/plain')) {
      reason = await res.text()
    }
  }
  throw new Error(reason)
}

/** Every occurrence in the window, with recurring events, exceptions and time zones handled by ical.js. */
async function parse(text: string, sub: Pick<Subscription, 'id' | 'color'>): Promise<{ name?: string; events: CalEvent[] }> {
  const { default: ICAL } = await import('ical.js')
  const root = new ICAL.Component(ICAL.parse(text))
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
  const from = addMonths(new Date(), -2)
  const until = ICAL.Time.fromJSDate(addMonths(new Date(), 12), false)

  // Changed occurrences of a repeating event arrive as separate VEVENTs with a RECURRENCE-ID.
  const masters = new Map<string, InstanceType<typeof ICAL.Event>>()
  const exceptions: InstanceType<typeof ICAL.Event>[] = []
  for (const v of root.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(v)
    if (e.isRecurrenceException()) exceptions.push(e)
    else masters.set(e.uid, e)
  }
  for (const x of exceptions) masters.get(x.uid)?.relateException(x)

  const out: CalEvent[] = []
  const add = (uidKey: string, title: string, s: InstanceType<typeof ICAL.Time>, e: InstanceType<typeof ICAL.Time>, location?: string, notes?: string) => {
    const start = s.toJSDate().getTime()
    let end = e.toJSDate().getTime()
    if (end <= start) end = start + (s.isDate ? 864e5 : 3600e3)
    if (end < from.getTime()) return
    out.push({ id: `${sub.id}:${uidKey}:${start}`, calId: sub.id, title: title || 'Busy', start, end, allDay: s.isDate, color: sub.color, location: location || undefined, notes: notes || undefined })
  }
  for (const ev of masters.values()) {
    if (!ev.startDate) continue
    if (!ev.isRecurring()) {
      add(ev.uid, ev.summary, ev.startDate, ev.endDate || ev.startDate, ev.location, ev.description)
      continue
    }
    const it = ev.iterator()
    for (let n = 0, next = it.next(); next && n < 3000; n++, next = it.next()) {
      if (next.compare(until) > 0) break
      const d = ev.getOccurrenceDetails(next)
      add(ev.uid, d.item.summary, d.startDate, d.endDate, d.item.location, d.item.description)
    }
  }
  const name = root.getFirstPropertyValue('x-wr-calname')
  return { name: typeof name === 'string' ? name : undefined, events: out }
}

async function load(sub: Subscription, text?: string) {
  useCalendars.setState((s) => ({ busy: { ...s.busy, [sub.id]: true } }))
  try {
    const { name, events } = await parse(text ?? (await download(sub.url)), sub)
    useCalendars.setState((s) => ({
      subs: s.subs.map((x) => (x.id === sub.id ? { ...x, name: x.name || name || 'Calendar', fetchedAt: Date.now(), error: undefined } : x)),
      events: { ...s.events, [sub.id]: events },
    }))
  } catch (e) {
    useCalendars.setState((s) => ({ subs: s.subs.map((x) => (x.id === sub.id ? { ...x, error: (e as Error).message || 'Couldn’t read that calendar.' } : x)) }))
    throw e
  } finally {
    useCalendars.setState((s) => ({ busy: { ...s.busy, [sub.id]: false } }))
  }
}

const nextColor = () => PALETTE[useCalendars.getState().subs.length % PALETTE.length]

export async function subscribe(url: string) {
  const sub: Subscription = { id: uid(), name: '', url: url.trim(), color: nextColor() }
  useCalendars.setState((s) => ({ subs: [...s.subs, sub] }))
  try {
    await load(sub)
  } catch (e) {
    useCalendars.setState((s) => ({ subs: s.subs.filter((x) => x.id !== sub.id) }))
    throw e
  }
}

export async function importFile(file: File) {
  const sub: Subscription = { id: uid(), name: file.name.replace(/\.ics$/i, ''), url: '', color: nextColor() }
  useCalendars.setState((s) => ({ subs: [...s.subs, sub] }))
  await load(sub, await file.text())
}

export function unsubscribe(id: string) {
  useCalendars.setState((s) => {
    const events = { ...s.events }
    delete events[id]
    return { subs: s.subs.filter((x) => x.id !== id), events }
  })
}

export function updateSub(id: string, patch: Partial<Subscription>) {
  useCalendars.setState((s) => ({
    subs: s.subs.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    // A new color applies to everything already shown from that calendar.
    events: patch.color ? { ...s.events, [id]: (s.events[id] || []).map((e) => ({ ...e, color: patch.color! })) } : s.events,
  }))
}

/** Refresh linked calendars that are more than 15 minutes old. Called when the calendar opens, and every so often. */
export function refreshStale() {
  for (const s of useCalendars.getState().subs) if (s.url && (!s.fetchedAt || Date.now() - s.fetchedAt > REFRESH)) load(s).catch(() => {})
}

/** Occurrences from calendars that are switched on. */
export function useSubEvents(): CalEvent[] {
  const subs = useCalendars((s) => s.subs)
  const events = useCalendars((s) => s.events)
  return subs.filter((s) => !s.hidden).flatMap((s) => events[s.id] || [])
}
