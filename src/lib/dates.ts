import { addDays, addMinutes, nextDay, set, startOfDay, type Day } from 'date-fns'

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WD_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export interface ParsedEvent {
  title: string
  start: Date
  end: Date
  allDay: boolean
  matched: string
  /** The sentence this was found in, when it came from free text. */
  line?: string
}

const TIME = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
const DUR = /\bfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i
const DAY_WORD = /\b(today|tonight|tomorrow|tmrw|next\s+week|(?:next\s+|this\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?)\b/i
const MONTH_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/

/** Natural-language parser: "Calc lecture tue 3pm for 90m", "Essay due Nov 14", "gym tomorrow 7am" */
export function parseQuickEvent(input: string, now = new Date()): ParsedEvent | null {
  let text = ` ${input} `
  let day: Date | null = null
  const matched: string[] = []

  let m = text.match(MONTH_DATE)
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    day = startOfDay(new Date(now.getFullYear(), month, +m[2]))
    if (day < startOfDay(addDays(now, -30))) day = new Date(day.getFullYear() + 1, month, +m[2])
    matched.push(m[0])
    text = text.replace(m[0], ' ')
  } else if ((m = text.match(SLASH_DATE)) && +m[1] <= 12) {
    const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear()
    day = startOfDay(new Date(y, +m[1] - 1, +m[2]))
    matched.push(m[0])
    text = text.replace(m[0], ' ')
  } else if ((m = text.match(DAY_WORD))) {
    const w = m[1].toLowerCase()
    if (w === 'today' || w === 'tonight') day = startOfDay(now)
    else if (w === 'tomorrow' || w === 'tmrw') day = startOfDay(addDays(now, 1))
    else if (w.startsWith('next week')) day = startOfDay(addDays(now, 7))
    else {
      const idx = WD_SHORT.findIndex((s) => m![2].toLowerCase().startsWith(s))
      day = startOfDay(nextDay(now, idx as Day))
      if (w.startsWith('this') && idx === now.getDay()) day = startOfDay(now)
    }
    matched.push(m[0])
    text = text.replace(m[0], ' ')
  }

  let minutes = 60
  const dm = text.match(DUR)
  if (dm) {
    const n = parseFloat(dm[1])
    minutes = dm[2].toLowerCase().startsWith('h') ? n * 60 : n
    text = text.replace(dm[0], ' ')
  }

  let hasTime = false
  let hour = 9
  let minute = 0
  const tm = text.match(/\b(noon|midnight)\b/i) || text.match(TIME)
  if (tm) {
    if (/noon/i.test(tm[0])) {
      hour = 12
      hasTime = true
    } else if (/midnight/i.test(tm[0])) {
      hour = 0
      hasTime = true
    } else if (tm[3] || tm[2] || /at\s/i.test(tm[0])) {
      hour = +tm[1]
      minute = tm[2] ? +tm[2] : 0
      const ap = tm[3]?.toLowerCase()
      if (ap === 'pm' && hour < 12) hour += 12
      if (ap === 'am' && hour === 12) hour = 0
      if (!ap && hour < 7) hour += 12 // "at 3" → 3pm
      hasTime = hour < 24 && minute < 60
    }
    if (hasTime) {
      matched.push(tm[0])
      text = text.replace(tm[0], ' ')
    }
  }

  if (!day && !hasTime) return null
  if (!day) {
    day = startOfDay(now)
    if (set(day, { hours: hour, minutes: minute }) < now) day = addDays(day, 1)
  }
  const start = set(day, { hours: hasTime ? hour : 0, minutes: hasTime ? minute : 0 })
  const end = hasTime ? addMinutes(start, minutes) : addDays(start, 1)
  const title =
    text
      .replace(/\b(on|at|by|from|this|next)\s*$/i, '')
      .replace(/\s+(on|at|by)\s+/gi, ' ')
      .replace(/\s*,.*$/, '')
      .replace(/\s+/g, ' ')
      .trim() || 'New event'
  return { title: title[0].toUpperCase() + title.slice(1), start, end, allDay: !hasTime, matched: matched.join(' ') }
}

/** Find lines in free text that look like they describe a dated commitment. */
export function findDatedCommitments(text: string, now = new Date()): ParsedEvent[] {
  const out: ParsedEvent[] = []
  const KEY = /\b(due|exam|quiz|test|midterm|final|deadline|meeting|meet|call|submit|presentation|interview|appointment|office hours|lab|review session)\b/i
  for (const line of text.split(/\n|(?<=[.!?])\s+/)) {
    // narrow to the clause that holds the keyword (drop quotes, asides, etc.)
    const l =
      line
        .split(/[;:“”"()—–]|,\s+(?=and\b|but\b|so\b|which\b)/)
        .map((c) => c.trim())
        .find((c) => KEY.test(c)) ?? ''
    if (l.length < 6 || l.length > 120 || !KEY.test(l)) continue
    if (!MONTH_DATE.test(l) && !DAY_WORD.test(l) && !SLASH_DATE.test(l)) continue
    const p = parseQuickEvent(l.replace(/^[-*•\d.)\s]+/, ''), now)
    if (p && p.start.getTime() > now.getTime() - 864e5) out.push({ ...p, line: line.replace(/^[-*•\s]+/, '').trim() })
  }
  return out
}

export const weekdayName = (d: number) => WEEKDAYS[d]
