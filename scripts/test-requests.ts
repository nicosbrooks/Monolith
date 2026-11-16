// Reading requests typed into the Ask bar or ⌘K. Run: npm run test:requests
// The title must be the thing itself, never the request ("make an event for tomorrow" has no name yet).
import { cleanTitle, readDoc, readEvent, readTask, ruleKind } from '../src/lib/request.ts'

// Sunday, Nov 15 2026, 10:00 AM
const NOW = new Date(2026, 10, 15, 10, 0)
const p2 = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}${d.getHours() || d.getMinutes() ? ` ${p2(d.getHours())}:${p2(d.getMinutes())}` : ''}`

let fail = 0
let total = 0
const check = (label: string, got: unknown, want: unknown) => {
  total++
  if (JSON.stringify(got) !== JSON.stringify(want)) (fail++, console.log(`✗ ${label}\n    want ${JSON.stringify(want)}\n    got  ${JSON.stringify(got)}`))
}

// [request, title, when | null]
const events: [string, string, string | null][] = [
  ['make an event for tomorrow', '', 'Mon 11/16'],
  ['Make an event for tomorrow', '', 'Mon 11/16'],
  ['make an event for tomorrow called dentist', 'Dentist', 'Mon 11/16'],
  ['create an event called Demo day on friday', 'Demo day', 'Fri 11/20'],
  ['can you schedule a meeting with Sam on friday at 3', 'Meeting with Sam', 'Fri 11/20 15:00'],
  ['create an event tomorrow at 5pm for team dinner', 'Team dinner', 'Mon 11/16 17:00'],
  ['put lunch with Ana on my calendar thursday noon', 'Lunch with Ana', 'Thu 11/19 12:00'],
  ['add dentist friday 3pm', 'Dentist', 'Fri 11/20 15:00'],
  ['please add a new event tomorrow at 9am', '', 'Mon 11/16 09:00'],
  ['schedule study session thursday 4pm', 'Study session', 'Thu 11/19 16:00'],
  ['set up a call with the advisor monday 10am', 'Call with the advisor', 'Mon 11/16 10:00'],
  ['block off time for studying thursday afternoon', 'Studying', 'Thu 11/19 14:00'],
  ['make dinner tomorrow at 7pm', 'Make dinner', 'Mon 11/16 19:00'],
  ['book a haircut on saturday at 11', 'Haircut', 'Sat 11/21 11:00'],
  ['I need to call mom tonight', 'Call mom', 'Sun 11/15 20:00'],
  ['lunch with Sam tomorrow at noon', 'Lunch with Sam', 'Mon 11/16 12:00'],
  ['add an event called “Q3 review”', 'Q3 review', null],
]
for (const [text, title, when] of events) {
  const r = readEvent(text, NOW)
  check(`event: ${text}`, [r.title, r.when ? fmt(r.when.start) : null], [title, when])
}

const tasks: [string, string][] = [
  ['add a task to email the professor', 'Email the professor'],
  ['new to-do: finish the lab report', 'Finish the lab report'],
  ['remind me to buy milk', 'Buy milk'],
  ['add pay rent to my list', 'Pay rent'],
  ['buy groceries', 'Buy groceries'],
]
for (const [text, want] of tasks) check(`task: ${text}`, readTask(text), want)

const docs: [string, string][] = [
  ['new doc about the trip', 'The trip'],
  ['create a note called reading list', 'Reading list'],
  ['make a new doc', ''],
  ['start a page for project ideas', 'Project ideas'],
]
for (const [text, want] of docs) check(`doc: ${text}`, readDoc(text), want)

check('title: only little words', cleanTitle('add it to my calendar'), '')

// What the rules decide before EmbeddingGemma is ready.
const kinds: [string, string, string?][] = [
  ['make an event for tomorrow', 'event'],
  ['what’s on tomorrow?', 'ask'],
  ['can you add lunch tomorrow at noon?', 'event'],
  ['can you tell me what’s due this week', 'ask'],
  ['add a task to call the bank', 'task'],
  ['new doc about the trip', 'doc'],
  ['summarize this', 'ask'],
  ['dentist friday 3pm', 'event'],
  ['buy milk', 'task', 'tasks'],
  ['add an event called Demo day', 'event'],
  ['how do I solve this problem', 'ask'],
]
for (const [text, want, section] of kinds) check(`kind: ${text}`, ruleKind(text, { section, now: NOW }).kind, want)

console.log(`${total - fail}/${total} pass`)
if (fail) process.exit(1)
