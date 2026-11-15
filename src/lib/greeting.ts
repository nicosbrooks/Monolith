// Home's words change with the day, so opening the app many times a day never reads the same canned line.
// Choices are fixed for a given day and part of day: they don't flicker while you use the app.
// iOS mirrors this in TodayView.swift (Greeting); keep the phrases in step.

const DAY = 86_400_000
type Part = 'night' | 'morning' | 'afternoon' | 'evening'
const partOf = (h: number): Part => (h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening')

const PHRASES: Record<Part, string[]> = {
  night: ['Late night', 'Still going', 'Good evening'],
  morning: ['Good morning', 'Morning', 'Fresh start'],
  afternoon: ['Good afternoon', 'Afternoon', 'Hope the day’s going well'],
  evening: ['Good evening', 'Evening', 'Winding down'],
}

const dayNumber = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / DAY)

/** "Good morning, Nico", "Happy Friday, Nico", "Welcome back, Nico", or the same without a name. */
export function greeting(now: Date, name: string, awayMs = 0) {
  const first = name.trim().split(/\s+/)[0]
  const part = partOf(now.getHours())
  const dow = now.getDay()
  let phrase: string
  if (awayMs > 2 * DAY) phrase = 'Welcome back'
  else {
    const options = [...PHRASES[part]]
    // Fridays and weekends get their own line, mixed in with the rest rather than every time.
    if (dow === 5 && part !== 'night') options.push('Happy Friday')
    if ((dow === 0 || dow === 6) && part !== 'night') options.push(`Happy ${dow === 0 ? 'Sunday' : 'Saturday'}`)
    phrase = options[(dayNumber(now) * 7 + ['night', 'morning', 'afternoon', 'evening'].indexOf(part)) % options.length]
  }
  return first ? `${phrase}, ${first}` : phrase
}

/**
 * The assistant card's title. "Start from here" on the first day, when it's an invitation;
 * after that it says what the starting points are about.
 */
export function startersTitle(o: { now: Date; setupAt: number | null; soon: boolean; onlyDocs: boolean }) {
  if (o.setupAt && o.now.getTime() - o.setupAt < DAY) return 'Start from here'
  if (o.soon) return 'Coming up'
  if (o.onlyDocs) return 'Pick up where you left off'
  const part = partOf(o.now.getHours())
  return part === 'morning' ? 'For this morning' : part === 'afternoon' ? 'For this afternoon' : 'For tonight'
}

/** How long since Home was last opened in this browser (0 the first time). A per-browser nicety only. */
export function awayFor(now: Date) {
  const KEY = 'monolith:lastHome'
  try {
    const last = Number(localStorage.getItem(KEY)) || 0
    localStorage.setItem(KEY, String(now.getTime()))
    return last ? now.getTime() - last : 0
  } catch {
    return 0
  }
}
