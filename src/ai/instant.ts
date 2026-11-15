import { format, isSameDay } from 'date-fns'
import type { CalEvent, Item } from '../types'
import { extractOpenTodos } from '../lib/util'
import { betweenEventsAnswer } from './availability'

// Some questions have an exact answer in the app's own data: what's on a day, what's next, what's left to do.
// Those are answered on the spot, word for word from the calendar and docs, with no model involved: instantly,
// before the model has even loaded, and never with a wrong date. Anything less clear-cut goes to the model.

const DAY = 864e5
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export interface Instant { text: string; source: 'calendar' | 'tasks' }

const when = (e: CalEvent) => (e.allDay ? 'All day' : `${format(e.start, 'h:mm a')}–${format(e.end, 'h:mm a')}`.replace(/:00/g, ''))
const line = (e: CalEvent) => `- **${e.title}**, ${when(e)}${e.location ? ` · ${e.location}` : ''}`

/** The day range a schedule question asks about, or null if it isn't one. */
function range(q: string, now: Date): { from: number; to: number; label: string; week?: boolean } | null {
  const start = new Date(now).setHours(0, 0, 0, 0)
  if (/\b(today|tonight)\b/.test(q)) return { from: start, to: start + DAY, label: /tonight/.test(q) ? 'tonight' : 'today' }
  if (/\btomorrow\b/.test(q)) return { from: start + DAY, to: start + 2 * DAY, label: 'tomorrow' }
  if (/\bthis week\b|\bthe week\b|\bmy week\b/.test(q)) return { from: start, to: start + 7 * DAY, label: 'in the next 7 days', week: true }
  if (/\bnext week\b/.test(q)) {
    // Sunday to Saturday, the same week quick add means by "next week".
    const toSun = 7 - now.getDay()
    return { from: start + toSun * DAY, to: start + (toSun + 7) * DAY, label: 'next week', week: true }
  }
  const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b(on )?${d}\\b`).test(q))
  if (wd >= 0) {
    const ahead = (wd - now.getDay() + 7) % 7
    const from = start + ahead * DAY
    return { from, to: from + DAY, label: ahead === 0 ? 'today' : `on ${format(from + 12 * 3600e3, 'EEEE, MMM d')}` }
  }
  return null
}

export function instantAnswer(question: string, o: { events: CalEvent[]; items: Item[]; now?: Date }): Instant | null {
  const now = o.now ?? new Date()
  const q = question.toLowerCase().replace(/[’']/g, "'").replace(/[?.!]+$/, '').trim()
  if (q.length > 70) return null
  const gap = betweenEventsAnswer(q, o.events, now)
  if (gap) return { text: gap, source: 'calendar' }

  // "what's next", "what's my next event", "when is my next class"
  if (/^(what's|what is|whats|when's|when is)( my)? next( event| thing| meeting| class)?( on my calendar)?$/.test(q)) {
    const next = o.events.filter((e) => e.start > now.getTime()).sort((a, b) => a.start - b.start)[0]
    if (!next) return { text: 'Nothing coming up on your calendar.', source: 'calendar' }
    const d = isSameDay(next.start, now) ? 'today' : isSameDay(next.start, now.getTime() + DAY) ? 'tomorrow' : format(next.start, 'EEEE, MMM d')
    return { text: `**${next.title}**, ${d}${next.allDay ? '' : ` at ${format(next.start, 'h:mm a').replace(':00', '')}`}${next.location ? ` · ${next.location}` : ''}.`, source: 'calendar' }
  }

  // "what's on today", "what do I have tomorrow", "my schedule this week", "anything on friday"
  const opener = /^(what's|what is|whats|what do i have|what have i got|anything|is there anything|show( me)?|my|how's|how does|do i have)\b/.test(q)
  const asksAbout = /^(what do i have|what have i got|anything|is there anything|do i have anything)\b/.test(q) || /\b(on|planned|scheduled|happening|going on|calendar|schedule|agenda|look|looking)\b/.test(q)
  const schedule = (opener && asksAbout) || /^(my )?(schedule|agenda|calendar)\b/.test(q)
  if (schedule && !/\b(free|busy|should|plan|move|best|focus|prepare|study|why|how long|add|schedule (a|an|my)\b)/.test(q)) {
    const r = range(q, now)
    if (!r) return null
    const from = r.label === 'tonight' ? Math.max(r.from + 17 * 3600e3, now.getTime()) : r.from
    const list = o.events.filter((e) => e.end > from && e.start < r.to).sort((a, b) => a.start - b.start)
    if (!list.length) return { text: `Nothing on your calendar ${r.label}.`, source: 'calendar' }
    if (!r.week) return { text: `${list.length === 1 ? 'One thing' : `${list.length} things`} ${r.label}:\n${list.map(line).join('\n')}`, source: 'calendar' }
    const days = new Map<string, CalEvent[]>()
    for (const e of list) {
      const k = format(Math.max(e.start, r.from), 'EEEE, MMM d')
      days.set(k, [...(days.get(k) ?? []), e])
    }
    return { text: [...days].map(([d, es]) => `**${d}**\n${es.map(line).join('\n')}`).join('\n\n'), source: 'calendar' }
  }

  // "what are my tasks", "what's left to do", "my to-dos"
  if (/^(what are |show( me)? |list )?(my )?(open |remaining )?(tasks|to-?dos|todo list)$|^what('s| is) (left|on my (to-?do|task) list)( to do)?$|^what do i (still )?(need|have) to do$/.test(q)) {
    const todos = o.items.filter((i) => !i.deletedAt).flatMap((i) => extractOpenTodos(i.content, i.id).map((t) => ({ t: t.text, doc: i.title || 'Untitled' })))
    if (!todos.length) return { text: 'No open tasks. Everything’s checked off.', source: 'tasks' }
    const shown = todos.slice(0, 12)
    return {
      text: `${todos.length === 1 ? 'One open task' : `${todos.length} open tasks`}:\n${shown.map((x) => `- ${x.t} *(${x.doc})*`).join('\n')}${todos.length > shown.length ? `\n\n…and ${todos.length - shown.length} more.` : ''}`,
      source: 'tasks',
    }
  }
  return null
}
