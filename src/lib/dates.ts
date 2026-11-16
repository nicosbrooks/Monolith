import { addDays, addMinutes, nextDay, set, startOfDay, type Day } from 'date-fns'
import type { Repeat } from '../types'

// Quick add: turn "math 19a homework due tomorrow 9pm" into an event titled "Math 19a homework", tomorrow at 9 PM,
// marked as a deadline. Used by the Ask bar, the command palette, the assistant (quick adds and pinning the model's
// dates) and suggestions found in docs. iOS mirrors this in QuickAdd (Intelligence.swift); keep the two in step.
//
// How it works: each kind of phrase (date, time, range, length, place) is found, read, and cut out of the text,
// along with the little words that tie it to the sentence ("on", "at", "by", "from", "due"). What's left is the title.
// Bare numbers are never taken as times unless something says so ("at 3", "3pm", "3:30", "from 3 to 5"), so
// "Math 19a", "CS 61B" and "Room 4" stay in the title.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export interface ParsedEvent {
  title: string
  start: Date
  end: Date
  allDay: boolean
  matched: string
  /** A deadline ("due", "by Friday"), not something that takes up time. */
  due: boolean
  explicitDuration: boolean
  /** "at Chipotle", "@ Room 204". */
  location?: string
  /** The sentence this was found in, when it came from free text. */
  line?: string
  /** "every week", "weekdays", "daily"… */
  repeat?: Repeat
}

// ——— pieces ———
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`
const ORD = String.raw`(?:st|nd|rd|th)`
const MER = String.raw`(a\.?m\.?|p\.?m\.?)`
/** "at", "on", "by", "from" in front of a date or time belong to it, not to the title. */
const LEAD = String.raw`(?:(?:on|at|by|from|starting(?: on| at)?|before|until|till|for|this|next|coming)\s+|@\s*)*`
// Full names (and plurals: "mondays"), or the short forms. A short form never takes an "s" ("thus" isn't Thursday), and
// "sun" counts only before a date, a comma or full stop, or at the end ("watch the sun rise" isn't Sunday).
const WEEKDAY = String.raw`((?:sun|mon|tues|wednes|thurs|fri|satur)day|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun(?=[.,]|\s+\d|\s*$))(?:(?<=day)s)?(?![a-z])`

const PART: Record<string, number> = { morning: 9, afternoon: 14, evening: 18, night: 20, tonight: 20 }

interface Clock { h: number; m: number; mer?: 'am' | 'pm' }

const mer = (s?: string): 'am' | 'pm' | undefined => (s ? (s[0].toLowerCase() === 'a' ? 'am' : 'pm') : undefined)

/** Turn a clock reading into 24-hour time, using what's known about the part of day when there's no am/pm. */
function hour24(c: Clock, part: number | null): number {
  let h = c.h
  if (c.mer === 'pm' && h < 12) h += 12
  else if (c.mer === 'am' && h === 12) h = 0
  else if (!c.mer && h <= 12) {
    if (part !== null) {
      if (part >= 12 && h < 12) h += 12 // "tonight at 9", "this afternoon at 3"
    } else if (h < 7) h += 12 // "at 3" is 3 PM; "at 9" is 9 AM
  }
  return h
}

/** Sunday of next week. */
export const nextWeek = (now: Date) => addDays(startOfDay(now), 7 - now.getDay())

/** "weekly", "every tuesday", "every day"… in quick-add text. Returns the repeat and the text without those words. */
export function parseRepeat(text: string): { repeat?: Repeat; text: string } {
  // "daily", "weekly"… on their own count only where they can't be part of a name: at the end, or before a date or
  // time ("gym daily 7am"). "Weekly review" and "daily standup" are names, and stay names.
  const AFTER = String.raw`(?=\s*$|\s+(?:at|on|from|until|\d|today|tonight|tomorrow|mon|tue|wed|thu|fri|sat|sun))`
  const rules: [RegExp, Repeat['every']][] = [
    [/\b(every|each) (week ?day|school day)s?\b|\bweekdays\b/i, 'weekday'],
    [new RegExp(String.raw`\b(every|each) (other|second) week\b|\bevery (2|two) weeks\b|\b(biweekly|fortnightly)${AFTER}`, 'i'), '2weeks'],
    [new RegExp(String.raw`\b(every|each) day\b|\bdaily${AFTER}`, 'i'), 'day'],
    [new RegExp(String.raw`\b(every|each) week\b|\bweekly${AFTER}`, 'i'), 'week'],
    [new RegExp(String.raw`\b(every|each) month\b|\bmonthly${AFTER}`, 'i'), 'month'],
    [new RegExp(String.raw`\b(every|each) year\b|\b(yearly|annually)${AFTER}`, 'i'), 'year'],
  ]
  for (const [re, every] of rules) {
    if (re.test(text)) return { repeat: { every }, text: text.replace(re, ' ').replace(/\s+/g, ' ').trim() }
  }
  // "every tuesday", "mondays": weekly on that day; the day stays in the text for the date parser.
  const day = text.match(/\b(?:every|each) ((?:mon|tues|wednes|thurs|fri|satur|sun)day|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i) ?? text.match(/\b((?:mon|tues|wednes|thurs|fri|satur|sun)day)s\b/i)
  if (day) return { repeat: { every: 'week' }, text: text.replace(day[0], ` ${day[1]} `).replace(/\s+/g, ' ').trim() }
  return { text }
}

/** Parse a date, time and title from quick-add text. Null when there's no date or time in it. */
export function parseQuickEvent(input: string, now = new Date()): ParsedEvent | null {
  const r = parseRepeat(input)
  if (!r.repeat) return parseOnce(input, now)
  // Something that repeats with no day given starts today ("standup weekdays 9am", "journal daily").
  const p = parseOnce(r.text, now) ?? parseOnce(`${r.text} today`, now)
  return p && { ...p, repeat: r.repeat }
}

function parseOnce(input: string, now: Date): ParsedEvent | null {
  let text = ` ${input.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ')} `
  const matched: string[] = []
  let due = false
  /** Find, record and cut out a phrase. */
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = text.match(re)
    if (!m || m.index === undefined) return null
    matched.push(m[0].trim())
    text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`
    return m
  }
  const markDue = (m: RegExpMatchArray | null) => {
    if (m && /\b(by|before|due)\b/i.test(m[0])) due = true
  }

  // "due", "is due", "are due on", "due date": a deadline. The word itself leaves the title.
  if (/\bdue\b/i.test(text)) {
    due = true
    text = text.replace(/\s(?:is|are)\s+due\b/gi, ' ').replace(/\bdue(?:\s+(?:date|on|at|by))?\b/gi, ' ')
  }

  // ——— length ———
  let minutes: number | null = null
  const num = (s: string) => (/^(an?|one)$/i.test(s) ? 1 : s.toLowerCase() === 'two' ? 2 : s.toLowerCase() === 'three' ? 3 : parseFloat(s))
  let d = take(/\s(?:for\s+)?(an?|one)\s+hour\s+and\s+a\s+half\b/i)
  if (d) minutes = 90
  if (minutes === null && (d = take(/\s(?:for\s+)?half\s+an?\s+hour\b/i))) minutes = 30
  if (minutes === null && (d = take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*(\d{1,2})\s*m(?:ins?|inutes?)?\b/i))) minutes = +d[1] * 60 + +d[2]
  if (minutes === null && (d = take(/\s(?:for\s+)?(\d+(?:\.\d+)?|an?|one|two|three)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/i)))
    minutes = num(d[1]) * (d[2].toLowerCase().startsWith('h') ? 60 : 1)

  // ——— day ———
  let day: Date | null = null
  let part: number | null = null
  const today = startOfDay(now)
  const year = (y?: string) => (y ? (+y < 100 ? 2000 + +y : +y) : null)
  const onDate = (y: number | null, mo: number, dd: number) => {
    let x = new Date(y ?? now.getFullYear(), mo, dd)
    // Without a year, a date more than a month gone means next year's.
    if (y === null && x < addDays(today, -30)) x = new Date(now.getFullYear() + 1, mo, dd)
    return x.getMonth() === mo ? startOfDay(x) : null
  }
  let m: RegExpMatchArray | null
  if ((m = take(new RegExp(String.raw`\s${LEAD}(\d{4})-(\d{1,2})-(\d{1,2})\b`, 'i')))) (markDue(m), (day = onDate(+m[1], +m[2] - 1, +m[3])))
  else if ((m = take(new RegExp(String.raw`\s${LEAD}(?:the\s+)?(\d{1,2})${ORD}?\s+(?:of\s+)?${MONTH}(?:,?\s+(\d{4}))?\b`, 'i'))))
    (markDue(m), (day = onDate(year(m[3]), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1])))
  else if ((m = take(new RegExp(String.raw`\s${LEAD}${MONTH}\s+(\d{1,2})${ORD}?(?:,?\s+(\d{4}))?\b`, 'i'))))
    (markDue(m), (day = onDate(year(m[3]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2])))
  else if ((m = take(new RegExp(String.raw`\s${LEAD}(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b`, 'i')))) {
    markDue(m)
    // Month first, unless the first number can't be a month.
    const [a, b] = [+m[1], +m[2]]
    day = a > 12 ? onDate(year(m[3]), b - 1, a) : onDate(year(m[3]), a - 1, b)
  } else if ((m = take(new RegExp(String.raw`\s${LEAD}the\s+(\d{1,2})${ORD}\b|\s(?:on|by)\s+(\d{1,2})${ORD}\b`, 'i')))) {
    markDue(m)
    const dd = +(m[1] ?? m[2])
    // This month's, else next month's; a day the month doesn't have ("the 31st" in November) moves on, never rolls over.
    const fit = (mo: number) => {
      const x = new Date(now.getFullYear(), mo, dd)
      return x.getMonth() === ((mo % 12) + 12) % 12 ? x : null
    }
    let x = fit(now.getMonth())
    if (!x || x < today) x = fit(now.getMonth() + 1) ?? fit(now.getMonth() + 2)
    if (x) day = startOfDay(x)
  } else if ((m = take(/\s(?:by\s+|on\s+)?(?:the\s+)?day\s+after\s+(?:tomorrow|tmrw|tmr)\b|\sovermorrow\b/i))) (markDue(m), (day = addDays(today, 2)))
  else if ((m = take(/\s(?:by\s+|on\s+|for\s+)?(?:tomorrow|tomorow|tommorow|tommorrow|tmrw|tmr|tmw)(?:\s+(morning|afternoon|evening|night))?\b/i))) {
    markDue(m)
    day = addDays(today, 1)
    if (m[1]) part = PART[m[1].toLowerCase()]
  } else if ((m = take(/\s(?:by\s+)?(?:today|tonight|this\s+(morning|afternoon|evening))\b/i))) {
    markDue(m)
    day = today
    part = /tonight/i.test(m[0]) ? PART.tonight : m[1] ? PART[m[1].toLowerCase()] : null
  } else if ((m = take(/\s(?:by\s+)?in\s+(\d+|an?|one|two|three|a\s+couple(?:\s+of)?)\s+(days?|weeks?)\b/i))) {
    markDue(m)
    const n = /couple/i.test(m[1]) ? 2 : num(m[1])
    day = addDays(today, n * (/week/i.test(m[2]) ? 7 : 1))
  } else if ((m = take(/\s(?:by\s+)?(next|this)\s+weekend\b|\s(?:by\s+|on\s+)?(?:the\s+)?weekend\b/i))) {
    markDue(m)
    day = now.getDay() === 6 ? today : startOfDay(nextDay(now, 6))
    if (m[1]?.toLowerCase() === 'next') day = addDays(day, 7)
  } else if ((m = take(new RegExp(String.raw`\s${LEAD}${WEEKDAY}\s+(?:of\s+)?next\s+week\b`, 'i')))) {
    // "friday next week": that weekday in next week. Weeks run Sunday to Saturday, so on Sunday it's not tomorrow's week.
    markDue(m)
    const idx = WEEKDAYS.findIndex((w) => w.startsWith(m![1].toLowerCase().slice(0, 3)))
    day = addDays(nextWeek(now), idx)
  } else if ((m = take(/\s(?:by\s+)?next\s+week\b/i))) (markDue(m), (day = addDays(nextWeek(now), 1)))
  else {
    // The first weekday that isn't "SAT" (the exam): "SAT prep saturday".
    const all = [...text.matchAll(new RegExp(String.raw`\s${LEAD}${WEEKDAY}\b(?:\s+(morning|afternoon|evening|night))?`, 'gi'))]
    const w = all.find((x) => !/\bSAT\b/.test(x[0]))
    if (w && w.index !== undefined) {
      m = w
      matched.push(w[0].trim())
      text = `${text.slice(0, w.index)} ${text.slice(w.index + w[0].length)}`
      markDue(m)
      const idx = WEEKDAYS.findIndex((x) => x.startsWith(m![1].toLowerCase().slice(0, 3)))
      day = startOfDay(nextDay(now, idx as Day))
      if (/\bthis\b/i.test(m[0]) && idx === now.getDay()) day = today
      if (m[2]) part = PART[m[2].toLowerCase()]
    }
  }
  // "in the morning", "at night". A bare "night" stays: it's often part of the name ("movie night").
  if (part === null && (m = take(/\s(?:in\s+the|this|at|that)\s+(morning|afternoon|evening|night)\b/i))) part = PART[m[1].toLowerCase()]
  // A date already says which day, so a weekday beside it is only a label: "Mon 11/16", "tomorrow (Monday)".
  if (day) text = text.replace(new RegExp(String.raw`\s\(?(?:on\s+)?${WEEKDAY}\)?,?(?=\s)`, 'gi'), (w) => (/\bSAT\b/.test(w) ? w : ' '))
  // Without am/pm, some plans are clearly evening ones: "dinner at 7:30" is 7:30 PM.
  const hint = part ?? (/\b(dinner|supper|drinks|party|movie|concert|show|date night|game night|bar|club)\b/i.test(text) ? PART.evening : null)

  // ——— time ———
  let start: Clock | null = null
  let end: Clock | null = null
  const T = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*${MER}?`
  // A range: "3-5pm", "10am to 12", "from 3 to 4:30", "between 2 and 4pm", "9:30-11".
  const RANGE = new RegExp(String.raw`\s${LEAD}(?:between\s+)?${T}\s*(?:-|to|till|until|and)\s*${T}(?=[\s,.!?])`, 'i')
  const r = text.match(RANGE)
  // Only a time range if something says so ("pages 3-5" isn't one, even "tonight": "read chapters 3-5 tonight").
  const counted = r?.index !== undefined && !r[3] && !r[6] && !r[2] && !r[5] && /\b(?:pages?|pp?|chapters?|ch|sections?|problems?|questions?|exercises?|qs?|slides?|lectures?|units?|modules?|lessons?|weeks?|days?|steps?|items?|parts?|nos?|numbers?|#)\.?\s*$/i.test(text.slice(0, r.index + 1))
  if (r && !counted && (r[3] || r[6] || r[2] || r[5] || part !== null || /\b(from|between|at)\b/i.test(r[0])) && +r[1] <= 24 && +r[4] <= 24) {
    const range = take(RANGE)!
    markDue(range)
    start = { h: +range[1], m: +(range[2] ?? 0), mer: mer(range[3]) }
    end = { h: +range[4], m: +(range[5] ?? 0), mer: mer(range[6]) }
    // "3-5pm": the start shares the end's am/pm, unless that would put it after the end ("11-1pm").
    if (!start.mer && end.mer) start.mer = end.mer === 'pm' && start.h > end.h && start.h !== 12 ? 'am' : end.mer
    if (!end.mer && start.mer) end.mer = start.mer === 'am' && end.h < start.h ? 'pm' : start.mer
  }
  if (!start && (m = take(/\s(?:(?:at|by|before|from|starting(?:\s+at)?)\s+)*(noon|midday|midnight|end of (?:the )?day|eod)\b/i))) {
    markDue(m)
    const w = m[1].toLowerCase()
    start = w === 'midnight' ? { h: 12, m: 0, mer: 'am' } : /noon|midday/.test(w) ? { h: 12, m: 0, mer: 'pm' } : { h: 5, m: 0, mer: 'pm' }
    if (w === 'midnight' && day) day = addDays(day, 1) // "due Friday at midnight" is the end of Friday
  }
  if (!start && (m = take(new RegExp(String.raw`\s${LEAD}(\d{1,2})(?:[:.](\d{2}))?\s*${MER}(?=[\s,.!?]|$)`, 'i')))) {
    markDue(m)
    start = { h: +m[1], m: +(m[2] ?? 0), mer: mer(m[3]) }
  }
  if (!start && (m = take(new RegExp(String.raw`\s${LEAD}(\d{1,2}):(\d{2})\b`, 'i')))) (markDue(m), (start = { h: +m[1], m: +m[2] }))
  // A bare number only counts after "at"/"by"/"@" ("at 3", "by 5"), or with "o'clock".
  if (!start && (m = take(/\s(?:(?:at|by|before|@)\s*)(\d{1,2})(?:\s*o'?clock)?(?=[\s,.!?]|$)|\s(\d{1,2})\s*o'?clock\b/i))) {
    markDue(m)
    start = { h: +(m[1] ?? m[2]), m: 0 }
  }
  // "at 9a" / "9p": single-letter am/pm only after "at", so "19a" or "CS 9a" stay course names.
  if (!start && (m = take(/\s(?:at|by|@)\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap])(?=[\s,.!?]|$)/i))) (markDue(m), (start = { h: +m[1], m: +(m[2] ?? 0), mer: mer(m[3]) }))

  const valid = (c: Clock | null) => !c || (c.h <= 24 && c.m < 60 && (!c.mer || (c.h >= 1 && c.h <= 12)))
  if (!valid(start) || !valid(end)) return null
  if (!day && !start) return null

  // ——— where ———
  let location: string | undefined
  // "@ Room 204", "at Chipotle" (a capital or a number says it's a place), "at the library". It runs up to a
  // comma or a word that starts a new part ("to study", "with Sam", "about the essay").
  const PLACE_END = String.raw`(?=\s+(?:to|for|with|about|re)\s|\s*[,;]|\s*$)`
  const where =
    text.match(new RegExp(String.raw`\s(?:@\s*|[Aa]t\s+(?=[A-Z0-9]))([^,;@]+?)${PLACE_END}`)) ??
    text.match(new RegExp(String.raw`\sat\s+((?:the\s+)?(?:room|hall|library|lib|cafe|café|coffee shop|office|gym|lab|building|bldg|center|centre|studio|park|school|campus|cafeteria|dining hall)\b[^,;@]*?)${PLACE_END}`, 'i')) ??
    // "in Room 101", "in the auditorium": only rooms and halls, so "in class" or "in person" stay in the title.
    text.match(new RegExp(String.raw`\sin\s+((?:the\s+)?(?:room|rm|hall|building|bldg|lab|library|auditorium|lecture hall|gym)\b[^,;@]*?)${PLACE_END}`, 'i'))
  if (where && where.index !== undefined && /[a-z]/i.test(where[1])) {
    location = where[1].trim().replace(/[.!?]+$/, '')
    text = `${text.slice(0, where.index)} ${text.slice(where.index + where[0].length)}`
  }

  // ——— title ———
  const EDGE = /^(?:on|at|by|from|to|until|till|for|this|next|the|in|is|are|was|be|will|starting|and|@|[-–—,:;.()]+)$/i
  const words = text.replace(/\s+([,.!?;:])/g, '$1').trim().split(/\s+/).filter(Boolean)
  while (words.length && EDGE.test(words[words.length - 1].replace(/[,.!?;:]+$/, ''))) words.pop()
  while (words.length && EDGE.test(words[0])) words.shift()
  let title = words.join(' ').replace(/[,;:\s]+$/, '').replace(/\s{2,}/g, ' ')
  if (!title) title = due ? 'Deadline' : 'New event'
  else title = title[0].toUpperCase() + title.slice(1)

  // ——— when ———
  let s: Date
  let e: Date
  const hasTime = !!start || part !== null
  if (start) {
    const h = hour24(start, hint)
    const base = day ?? today
    s = set(base, { hours: h === 24 ? 0 : h, minutes: start.m, seconds: 0, milliseconds: 0 })
    if (h === 24) s = addDays(s, 1)
    // A time with no day that's already gone today means tomorrow.
    if (!day && s < now) s = addDays(s, 1)
    if (end) {
      e = set(s, { hours: hour24(end, hint) % 24, minutes: end.m })
      if (e <= s) e = addDays(e, 1)
    } else e = addMinutes(s, minutes ?? (due ? 30 : 60))
  } else if (part !== null) {
    s = set(day ?? today, { hours: part, minutes: 0, seconds: 0, milliseconds: 0 })
    if (!day && s < now) s = addDays(s, 1)
    e = addMinutes(s, minutes ?? 60)
  } else {
    s = day!
    e = addDays(s, 1)
  }
  return { title, start: s, end: e, allDay: !hasTime, matched: matched.join(' '), due, explicitDuration: hasTime && (end !== null || minutes !== null), location }
}

/** Find lines in free text that look like they describe a dated commitment. */
export function findDatedCommitments(text: string, now = new Date()): ParsedEvent[] {
  const out: ParsedEvent[] = []
  const KEY = /\b(due|exam|quiz|test|midterm|final|deadline|meeting|meet|call|submit|presentation|interview|appointment|office hours|lab|review session)\b/i
  const DATE = new RegExp(String.raw`\b(today|tonight|tomorrow|tmrw|${WEEKDAY}|${MONTH}\s+\d|\d{1,2}/\d{1,2}|\d{1,2}${ORD}\b|next week|in \d+ days?)`, 'i')
  for (const line of text.split(/\n|(?<=[.!?])\s+/)) {
    // narrow to the clause that holds the keyword (drop quotes, asides, etc.)
    const l =
      line
        .split(/[;“”"()—–]|:(?!\d)|,\s+(?=and\b|but\b|so\b|which\b)/)
        .map((c) => c.trim())
        .find((c) => KEY.test(c)) ?? ''
    if (l.length < 6 || l.length > 120 || !KEY.test(l)) continue
    if (!DATE.test(l)) continue
    const p = parseQuickEvent(l.replace(/^[-*•\d.)\s]+/, ''), now)
    if (p && p.start.getTime() > now.getTime() - 864e5) out.push({ ...p, line: line.replace(/^[-*•\s]+/, '').trim() })
  }
  return out
}

export const weekdayName = (d: number) => WEEKDAYS[d]

/** What a parsed event's preview says under its title: "Due Mon, Nov 16 · 9:00 PM · Chipotle". */
export function whenLabel(p: Pick<ParsedEvent, 'start' | 'allDay' | 'due' | 'location' | 'repeat'>) {
  const d = p.start
  const day = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}, ${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`
  const time = p.allDay ? '' : ` · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  const again = p.repeat ? ` · ${{ day: 'Every day', weekday: 'Weekdays', week: 'Every week', '2weeks': 'Every 2 weeks', month: 'Every month', year: 'Every year' }[p.repeat.every]}` : ''
  return `${p.due ? 'Due ' : ''}${day}${time}${again}${p.location ? ` · ${p.location}` : ''}`
}

/** The calendar colour for a new event: deadlines and exams stand out. */
export const eventColor = (p: { title: string; due?: boolean }) => (p.due || /\b(exam|quiz|test|midterm|final|deadline)\b/i.test(p.title) ? 'rose' : 'blue')
