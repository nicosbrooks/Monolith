import { format } from 'date-fns'
import type { CalEvent, Item } from '../types'
import { extractOpenTodos, htmlToText } from '../lib/util'
import { APP_NAME } from '../brand'
import { deviceContext } from '../lib/integrations'

// What the assistant is told. Small on-device models are only as accurate as what they're given, and every
// character they read costs time before the first word appears. So:
//   - dates are spelled out (small models can't do date arithmetic; "tomorrow" is a lookup, not a sum),
//   - the shared part (rules, dates, calendar, tasks) is built once per conversation and never changes, so the
//     model's cache of it is reused for every follow-up,
//   - docs aren't pasted whole; each question gets the few passages that match it, from any doc.

const DAY = 864e5

export const CHAT_RULES = `You are ${APP_NAME}, a study and productivity assistant that runs on the user's own device.
Rules:
- Answer from the information below and the conversation. If the answer isn't there, say in one plain, friendly sentence that it isn't in their notes or calendar. Never guess.
- Use dates and times exactly as listed under Dates and Calendar. Never work out a date yourself.
- Answer first, then stop: 1–4 sentences, or a short list. No preamble, and don't repeat the question.
- Short Markdown is fine (lists, **bold**). No tables. No emoji unless asked.`

const time = (t: number) => format(t, 'h:mm a').replace(':00', '')
const day = (t: number) => format(t, 'EEE yyyy-MM-dd')

export function eventLine(e: CalEvent) {
  const when = e.allDay ? `${day(e.start)} all day` : `${day(e.start)} ${time(e.start)}–${time(e.end)}`
  return `- ${when}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`
}

/** The part every message shares: rules, today, the next two weeks, open tasks, recently edited. */
export function sharedContext(o: { items: Item[]; events: CalEvent[]; now?: Date }) {
  const now = o.now ?? new Date()
  const start = new Date(now).setHours(0, 0, 0, 0)
  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = start + i * DAY + 12 * 3600e3 // midday, so a clock change never skips a day
    // "Tuesday" means the next one coming, as in quick add; the week after is spelled out so it can't be mistaken for it.
    const label = i === 0 ? 'today, ' : i === 1 ? 'tomorrow, ' : i >= 7 ? 'the week after, ' : ''
    return `- ${label}${format(d, 'EEEE')}: ${format(d, 'yyyy-MM-dd')}`
  })
  const cal = o.events
    .filter((e) => e.end > start && e.start < start + 14 * DAY)
    .sort((a, b) => a.start - b.start)
    .slice(0, 30)
    .map((e) => eventLine(e) + (e.end < now.getTime() ? ' (over)' : ''))
  const live = o.items.filter((i) => !i.deletedAt && !i.file?.dir)
  const tasks = live.flatMap((i) => extractOpenTodos(i.content, i.id).map((t) => `- ${t.text} (in "${i.title || 'Untitled'}")`)).slice(0, 15)
  const recent = [...live]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)
    .map((i) => `- "${i.title || 'Untitled'}" (${i.kind === 'lecture' ? 'recording' : 'doc'}, edited ${format(i.updatedAt, 'EEE MMM d')})`)
  const device = deviceContext()
  return [
    CHAT_RULES,
    `\nNow: ${format(now, "EEEE, MMMM d, yyyy, h:mm a")} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    `Dates:\n${dates.join('\n')}`,
    device && `On this device:\n${device}`,
    `Calendar (next 14 days):\n${cal.join('\n') || '(nothing scheduled)'}`,
    `Open tasks:\n${tasks.join('\n') || '(none)'}`,
    `Recently edited:\n${recent.join('\n') || '(none)'}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ——— Finding the passages a question is about ———

const STOP = new Set(
  'the and for are but not you your with this that what when where which who how why can could would should about from have has had was were will into than then them they their there here just also only some any all its it’s i’m my me our out does did done get got make made more most much very want need like know tell give find show please summarize summarise explain page note notes doc docs'.split(' '),
)
const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) ?? []
const terms = (s: string) => [...new Set(words(s).filter((w) => !STOP.has(w)))]

interface Chunk { item: Item; text: string; words: Set<string> }
const chunkCache = new Map<string, { at: number; chunks: Chunk[] }>()

/** A doc's text in passages of about 700 characters, split on paragraphs. Cached until the doc changes. */
function chunks(i: Item): Chunk[] {
  const hit = chunkCache.get(i.id)
  if (hit && hit.at === i.updatedAt) return hit.chunks
  const transcript = i.lecture?.transcript.map((s) => s.text).join(' ') || ''
  const text = `${htmlToText(i.content)}\n${transcript}`.trim()
  const out: Chunk[] = []
  let cur = ''
  for (const para of text.split(/\n+/)) {
    if (cur && cur.length + para.length > 700) (out.push(chunk(i, cur)), (cur = ''))
    cur += (cur ? '\n' : '') + (para.length > 1400 ? para.slice(0, 1400) : para)
  }
  if (cur.trim()) out.push(chunk(i, cur))
  chunkCache.set(i.id, { at: i.updatedAt, chunks: out })
  return out
}
const chunk = (item: Item, text: string): Chunk => ({ item, text, words: new Set(words(text)) })

export interface Found { item: Item; text: string }

/**
 * The passages that best match a question, across every doc and recording. The open doc counts a little extra.
 * A short open doc is given whole; a doc the question names by title always gets its best passages.
 */
export function relevant(question: string, o: { items: Item[]; open?: Item | null; skip?: Set<string>; budget?: number }): Found[] {
  const budget = o.budget ?? 3200
  const q = terms(question)
  const live = o.items.filter((i) => !i.deletedAt && !i.file?.dir)
  const all = live.flatMap(chunks)
  const lower = question.toLowerCase()
  const named = new Set(live.filter((i) => i.title.trim().length > 2 && lower.includes(i.title.toLowerCase().replace(/^recording · /, '').trim())).map((i) => i.id))
  const df = new Map<string, number>()
  for (const c of all) for (const w of q) if (c.words.has(w)) df.set(w, (df.get(w) ?? 0) + 1)
  const scored = all
    .map((c) => {
      let s = 0
      for (const w of q) if (c.words.has(w)) s += Math.log(1 + all.length / (df.get(w) ?? 1))
      const titleHits = q.filter((w) => c.item.title.toLowerCase().includes(w)).length
      s += titleHits * 1.5
      if (named.has(c.item.id)) s += 4
      if (o.open && c.item.id === o.open.id) s += 1.2
      return { c, s }
    })
    .filter((x) => x.s > 1.2 || (o.open && x.c.item.id === o.open.id && !q.length))
    .sort((a, b) => b.s - a.s)

  const out: Found[] = []
  let used = 0
  const take = (c: Chunk) => {
    const key = `${c.item.id}:${c.text.slice(0, 40)}`
    if (o.skip?.has(key) || used + c.text.length > budget) return
    o.skip?.add(key)
    out.push({ item: c.item, text: c.text })
    used += c.text.length
  }
  // A short open doc is cheap to read in full, and "this page" questions need all of it.
  if (o.open) {
    const own = chunks(o.open)
    const len = own.reduce((n, c) => n + c.text.length, 0)
    if (len <= 2400) own.forEach(take)
    else own.slice(0, 1).forEach(take) // its opening, so "this page" has something to go on
  }
  // Weak matches cost reading time and pull answers off course: keep what scores close to the best.
  const best = scored[0]?.s ?? 0
  for (const { c, s } of scored) {
    if (out.length >= 6 || s < best * 0.45) break
    take(c)
  }
  return out
}

/** The passages as the model reads them, grouped by doc. */
export function passages(found: Found[]) {
  const by = new Map<string, Found[]>()
  for (const f of found) by.set(f.item.id, [...(by.get(f.item.id) ?? []), f])
  return [...by.values()]
    .map((fs) => `From "${fs[0].item.title || 'Untitled'}" (${fs[0].item.kind === 'lecture' ? 'recording' : 'doc'}):\n${fs.map((f) => f.text).join('\n…\n')}`)
    .join('\n\n')
}
