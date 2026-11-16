import { addDays, addMonths, addYears } from 'date-fns'
import type { CalEvent, Repeat } from '../types'

/**
 * Repeating events. One stored event (the series) stands for every time it happens: "every week", "weekdays",
 * "every month"… What the calendar, Home and the assistant see are its occurrences, made here on demand for the
 * dates they're looking at. An occurrence's id is `<series id>@<its start>`, so the store can tell which one was
 * touched: deleting it skips that date, dragging it turns that one date into an event of its own.
 */

export const REPEATS: { id: Repeat['every']; label: string }[] = [
  { id: 'day', label: 'Every day' },
  { id: 'weekday', label: 'Weekdays' },
  { id: 'week', label: 'Every week' },
  { id: '2weeks', label: 'Every 2 weeks' },
  { id: 'month', label: 'Every month' },
  { id: 'year', label: 'Every year' },
]
export const repeatLabel = (r?: Repeat) => (r ? REPEATS.find((x) => x.id === r.every)?.label ?? '' : '')

/** `<series id>@<start>` → its parts, or null for an ordinary event id. */
export function occurrenceOf(id: string): { seriesId: string; start: number } | null {
  const at = id.lastIndexOf('@')
  if (at < 1) return null
  const start = Number(id.slice(at + 1))
  return Number.isFinite(start) ? { seriesId: id.slice(0, at), start } : null
}
export const occurrenceId = (seriesId: string, start: number) => `${seriesId}@${start}`

/** The nth time a series happens (0 is the first), in local time so 9 AM stays 9 AM across clock changes. */
function nth(first: Date, every: Repeat['every'], n: number): Date {
  switch (every) {
    case 'day': return addDays(first, n)
    case 'week': return addDays(first, n * 7)
    case '2weeks': return addDays(first, n * 14)
    case 'month': return addMonths(first, n)
    case 'year': return addYears(first, n)
    case 'weekday': {
      // Count Monday to Friday only, starting from the first day (moved to Monday if it falls on a weekend).
      const d = new Date(first)
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
      const offset = d.getDay() - 1 + n
      return addDays(d, Math.floor(offset / 5) * 7 + (offset % 5) - (d.getDay() - 1))
    }
  }
}

const MAX = 1500

/** Every event between two times: ordinary events as they are, each series as its occurrences. */
export function expandEvents(events: CalEvent[], from: number, to: number): CalEvent[] {
  const out: CalEvent[] = []
  for (const e of events) {
    if (!e.repeat) {
      out.push(e)
      continue
    }
    const first = new Date(e.start)
    const len = e.end - e.start
    const until = e.repeat.until ?? Infinity
    const skip = new Set(e.skip)
    // Jump close to the window instead of walking from the first date.
    const per = { day: 1, weekday: 1.4, week: 7, '2weeks': 14, month: 31, year: 366 }[e.repeat.every]
    let n = Math.max(0, Math.floor((from - len - e.start) / 864e5 / per) - 1)
    for (let made = 0; made < MAX; n++) {
      const start = nth(first, e.repeat.every, n).getTime()
      if (start >= to || start > until) break
      if (start + len <= from || skip.has(start)) continue
      made++
      out.push({ ...e, id: occurrenceId(e.id, start), seriesId: e.id, start, end: start + len })
    }
  }
  return out
}

/** A year either side of now covers everything outside the calendar grid (Home, the assistant, search). */
export const expandAround = (events: CalEvent[], now = Date.now()) => expandEvents(events, now - 62 * 864e5, now + 370 * 864e5)
