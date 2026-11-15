import { addDays, format, startOfDay } from 'date-fns'
import type { CalEvent } from '../types'

const DURATION = String.raw`(a|an|one|\d+(?:\.\d+)?)(?:\s+free)?\s*(hours?|minutes?|mins?)(?:\s+(?:and\s+)?(\d+)\s+(?:minutes?|mins?))?`

export function requestedMinutes(question: string) {
  if (!/\b(fit|free|find|available|time slot)\b/i.test(question)) return 0
  if (/\bhalf an hour\b/i.test(question)) return 30
  const duration = question.match(new RegExp(String.raw`\b${DURATION}\b`, 'i'))
  if (!duration) return 0
  const count = /^\d/.test(duration[1]) ? Number(duration[1]) : 1
  return /^h/i.test(duration[2]) ? count * 60 + Number(duration[3] ?? 0) : count
}

const time = (value: number) => format(value, 'h:mm a').replace(':00', '')
type Gap = { start: number; end: number }

/** Use every timed event, including overlaps and subscribed calendars. */
function timedGaps(events: CalEvent[], from: number, to: number, minutes: number, between: boolean, after = from) {
  const intervals = events.filter((e) => !e.allDay && e.start < to && e.end > from).sort((a, b) => a.start - b.start)
  const gaps: Gap[] = []
  const add = (start: number, end: number) => {
    start = Math.max(start, after)
    if (end - start >= minutes * 60000) gaps.push({ start, end })
  }
  let busyUntil = from
  for (const [i, event] of intervals.entries()) {
    if (!between || i > 0) add(busyUntil, event.start)
    busyUntil = Math.max(busyUntil, event.end)
  }
  if (!between) add(busyUntil, to)
  return gaps
}

export function gapLine(events: CalEvent[], from: number, to: number, minutes: number, between: boolean, after?: number) {
  const gaps = timedGaps(events, from, to, minutes, between, after)
  const label = `Calendar gaps of at least ${minutes} minutes ${between ? 'between timed events' : 'around timed events'}`
  if (!gaps.length) return `${label}: none.`
  const labels = gaps.slice(0, 4).map(({ start, end }) => `${time(start)}–${end === to ? 'midnight' : time(end)}`)
  return `${label}: ${labels.join(', ')}${gaps.length > 4 ? ' (more available)' : ''}.`
}

// Only answer directly when the request spells out the length, day and "between events" constraint.
// Extra scheduling preferences still go to the model along with the calculated evidence.
const betweenRequest = new RegExp(
  String.raw`^(?:can i fit|could i fit|find(?: me)?)\s+(?:half an hour|${DURATION})(?: of [a-z]+)? between (?:(?:my|the) )?(?:calendar )?events (today|tomorrow|tonight)$`,
  'i',
)

export function betweenEventsAnswer(question: string, events: CalEvent[], now: Date) {
  const match = question.match(betweenRequest)
  const minutes = match ? requestedMinutes(question) : 0
  if (!match || !minutes) return null
  const when = match.at(-1)!.toLowerCase()
  const day = startOfDay(when === 'tomorrow' ? addDays(now, 1) : now)
  const floor = when === 'tonight' ? new Date(day).setHours(17) : +day
  const gaps = timedGaps(events, floor, +addDays(day, 1), minutes, true, +now)
  if (!gaps.length) return `There’s no ${minutes}-minute gap between timed events ${when}.`
  const { start } = gaps[0]
  return `**${time(start)}–${time(start + minutes * 60000)}** fits between your timed events ${when}.`
}
