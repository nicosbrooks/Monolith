// Quick-add parser cases. Run: npm run test:dates  (Node 22.6+ runs TypeScript directly)
// iOS mirrors the parser (apple/iOS/QuickAdd.swift); add a case here when either changes.
import { parseQuickEvent } from '../src/lib/dates.ts'

// Sunday, Nov 15 2026, 10:00 AM
const NOW = new Date(2026, 10, 15, 10, 0)
const p2 = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`

// [input, title, start, end | 'all', flags]  flags: due, @location, ~repeat (day, weekday, week, 2weeks, month, year)
const cases: [string, string, string, string, string?][] = [
  ['math 19a homework due tomorrow 9pm', 'Math 19a homework', 'Mon 11/16 21:00', 'Mon 11/16 21:30', 'due'],
  ['Math 19A homework is due tomorrow at 9 pm', 'Math 19A homework', 'Mon 11/16 21:00', 'Mon 11/16 21:30', 'due'],
  ['essay due friday', 'Essay', 'Fri 11/20 00:00', 'all', 'due'],
  ['CS 61B project due on Nov 30 at 11:59pm', 'CS 61B project', 'Mon 11/30 23:59', 'Tue 12/1 00:29', 'due'],
  ['submit lab report by thursday 5pm', 'Submit lab report', 'Thu 11/19 17:00', 'Thu 11/19 17:30', 'due'],
  ['problem set 4 due friday at midnight', 'Problem set 4', 'Sat 11/21 00:00', 'Sat 11/21 00:30', 'due'],
  ['calc review thu 4pm for 90m', 'Calc review', 'Thu 11/19 16:00', 'Thu 11/19 17:30'],
  ['gym tomorrow 7am', 'Gym', 'Mon 11/16 07:00', 'Mon 11/16 08:00'],
  ['dentist appointment on friday at 3', 'Dentist appointment', 'Fri 11/20 15:00', 'Fri 11/20 16:00'],
  ['meeting with Sam 3-5pm tomorrow', 'Meeting with Sam', 'Mon 11/16 15:00', 'Mon 11/16 17:00'],
  ['study group from 2 to 4 on wednesday', 'Study group', 'Wed 11/18 14:00', 'Wed 11/18 16:00'],
  ['brunch 11-1pm saturday', 'Brunch', 'Sat 11/21 11:00', 'Sat 11/21 13:00'],
  ['lunch with mom at Chipotle tomorrow 1pm', 'Lunch with mom', 'Mon 11/16 13:00', 'Mon 11/16 14:00', '@Chipotle'],
  ['office hours tue 2pm @ Room 204', 'Office hours', 'Tue 11/17 14:00', 'Tue 11/17 15:00', '@Room 204'],
  ['study at the library tomorrow afternoon', 'Study', 'Mon 11/16 14:00', 'Mon 11/16 15:00', '@the library'],
  ['call mom tonight', 'Call mom', 'Sun 11/15 20:00', 'Sun 11/15 21:00'],
  ['call mom at 5 about the trip', 'Call mom about the trip', 'Sun 11/15 17:00', 'Sun 11/15 18:00'],
  ['run tomorrow morning', 'Run', 'Mon 11/16 09:00', 'Mon 11/16 10:00'],
  ['dinner friday evening at 7', 'Dinner', 'Fri 11/20 19:00', 'Fri 11/20 20:00'],
  ['standup 9:30', 'Standup', 'Mon 11/16 09:30', 'Mon 11/16 10:30'],
  ['flight Dec 3rd 6:45am', 'Flight', 'Thu 12/3 06:45', 'Thu 12/3 07:45'],
  ['trip 3 dec', 'Trip', 'Thu 12/3 00:00', 'all'],
  ['party on the 21st at 8pm', 'Party', 'Sat 11/21 20:00', 'Sat 11/21 21:00'],
  ['interview 11/24 10am for 45 minutes', 'Interview', 'Tue 11/24 10:00', 'Tue 11/24 10:45'],
  ['conference 2027-01-12', 'Conference', 'Tue 1/12 00:00', 'all'],
  ['review session in 3 days at noon', 'Review session', 'Wed 11/18 12:00', 'Wed 11/18 13:00'],
  ['haircut day after tomorrow 4:15pm', 'Haircut', 'Tue 11/17 16:15', 'Tue 11/17 17:15'],
  ['hike this weekend', 'Hike', 'Sat 11/21 00:00', 'all'],
  ['retro friday next week 2pm', 'Retro', 'Fri 11/27 14:00', 'Fri 11/27 15:00'],
  ['quiz next tuesday', 'Quiz', 'Tue 11/17 00:00', 'all'],
  ['SAT prep saturday 9am', 'SAT prep', 'Sat 11/21 09:00', 'Sat 11/21 10:00'],
  ['read pages 3-5 tomorrow', 'Read pages 3-5', 'Mon 11/16 00:00', 'all'],
  ['1st draft due wednesday', '1st draft', 'Wed 11/18 00:00', 'all', 'due'],
  ['yoga 6:30-7:30pm tmrw', 'Yoga', 'Mon 11/16 18:30', 'Mon 11/16 19:30'],
  ['team sync 14:00-15:30 thursday', 'Team sync', 'Thu 11/19 14:00', 'Thu 11/19 15:30'],
  ['coffee w/ alex at 10a tues', 'Coffee w/ alex', 'Tue 11/17 10:00', 'Tue 11/17 11:00'],
  ['lab 2 hours tomorrow at 1pm', 'Lab', 'Mon 11/16 13:00', 'Mon 11/16 15:00'],
  ['physics midterm Nov 20, 2026 9am', 'Physics midterm', 'Fri 11/20 09:00', 'Fri 11/20 10:00'],
  ['meet at Sam\'s house to study tomorrow 6pm', 'Meet to study', 'Mon 11/16 18:00', 'Mon 11/16 19:00', "@Sam's house"],
  ['pick up package by 5', 'Pick up package', 'Sun 11/15 17:00', 'Sun 11/15 17:30', 'due'],
  ['Q4 report due eod friday', 'Q4 report', 'Fri 11/20 17:00', 'Fri 11/20 17:30', 'due'],
  ['wedding sat 4pm', 'Wedding', 'Sat 11/21 16:00', 'Sat 11/21 17:00'],
  ['monthly review tomorrow', 'Monthly review', 'Mon 11/16 00:00', 'all'],
  ['bio 1a lecture mon 10-11:30am in Room 2', 'Bio 1a lecture', 'Mon 11/16 10:00', 'Mon 11/16 11:30', '@Room 2'],
  ['1:1 with manager tomorrow 3pm', '1:1 with manager', 'Mon 11/16 15:00', 'Mon 11/16 16:00'],
  ['pay rent on the 1st', 'Pay rent', 'Tue 12/1 00:00', 'all'],
  ['Exam! Friday 8am.', 'Exam!', 'Fri 11/20 08:00', 'Fri 11/20 09:00'],
  ['Due: Friday - essay', 'Essay', 'Fri 11/20 00:00', 'all', 'due'],
  ['standup tomorrow @ 3pm', 'Standup', 'Mon 11/16 15:00', 'Mon 11/16 16:00'],
  ['work from 9am to 5pm tuesday', 'Work', 'Tue 11/17 09:00', 'Tue 11/17 17:00'],
  ['shift 9am - 5pm wed', 'Shift', 'Wed 11/18 09:00', 'Wed 11/18 17:00'],
  ['Exam Mon 11/16 9am', 'Exam', 'Mon 11/16 09:00', 'Mon 11/16 10:00'],
  ['essay due tomorrow (Monday) 11:59 PM', 'Essay', 'Mon 11/16 23:59', 'Tue 11/17 00:29', 'due'],
  ['practice 7-9 tonight', 'Practice', 'Sun 11/15 19:00', 'Sun 11/15 21:00'],
  ['MATH 19A HW DUE TMRW 9PM', 'MATH 19A HW', 'Mon 11/16 21:00', 'Mon 11/16 21:30', 'due'],
  ['chem pset due thursday by 10am', 'Chem pset', 'Thu 11/19 10:00', 'Thu 11/19 10:30', 'due'],
  ['dinner at 7:30 with Jo on saturday', 'Dinner with Jo', 'Sat 11/21 19:30', 'Sat 11/21 20:30'],
  ['Thanksgiving dinner Thursday Nov 26', 'Thanksgiving dinner', 'Thu 11/26 00:00', 'all'],
  ['v2.0 release friday', 'V2.0 release', 'Fri 11/20 00:00', 'all'],
  ['doctor in 2 weeks at 10:15am', 'Doctor', 'Sun 11/29 10:15', 'Sun 11/29 11:15'],
  ['reading 4:30PM today for half an hour', 'Reading', 'Sun 11/15 16:30', 'Sun 11/15 17:00'],
  ['call with recruiter at 5pm', 'Call with recruiter', 'Sun 11/15 17:00', 'Sun 11/15 18:00'],
  ['class 8am', 'Class', 'Mon 11/16 08:00', 'Mon 11/16 09:00'],
  ['meeting Monday, November 23rd at 2:00 pm', 'Meeting', 'Mon 11/23 14:00', 'Mon 11/23 15:00'],
  ['project proposal due by end of day tomorrow', 'Project proposal', 'Mon 11/16 17:00', 'Mon 11/16 17:30', 'due'],
  ['movie night saturday at 8', 'Movie night', 'Sat 11/21 20:00', 'Sat 11/21 21:00'],
  ['The midterm is on Nov 20 at 9am in Room 101.', 'Midterm', 'Fri 11/20 09:00', 'Fri 11/20 10:00', '@Room 101'],
  ['group project meeting in class friday', 'Group project meeting in class', 'Fri 11/20 00:00', 'all'],
  ['problem set 5 due thursday by 11:59pm', 'Problem set 5', 'Thu 11/19 23:59', 'Fri 11/20 00:29', 'due'],
  ['read chapters 3-5 tonight', 'Read chapters 3-5', 'Sun 11/15 20:00', 'Sun 11/15 21:00'],
  ['watch the sun rise tomorrow', 'Watch the sun rise', 'Mon 11/16 00:00', 'all'],
  ['Sun Devils game at 7 tomorrow', 'Sun Devils game', 'Mon 11/16 07:00', 'Mon 11/16 08:00'],
  ['essay due the 31st', 'Essay', 'Thu 12/31 00:00', 'all', 'due'],
  ['brunch Sun 11/22', 'Brunch', 'Sun 11/22 00:00', 'all'],
  ['brunch on sun', 'Brunch', 'Sun 11/22 00:00', 'all'],
  ['tutoring mondays at 4pm', 'Tutoring', 'Mon 11/16 16:00', 'Mon 11/16 17:00', '~week'],
  // Repeating: "every …", "weekdays", and "daily"/"weekly" where they can't be part of a name.
  ['study group every tuesday 3pm', 'Study group', 'Tue 11/17 15:00', 'Tue 11/17 16:00', '~week'],
  ['gym daily 7am', 'Gym', 'Mon 11/16 07:00', 'Mon 11/16 08:00', '~day'],
  ['standup weekdays 9am', 'Standup', 'Mon 11/16 09:00', 'Mon 11/16 10:00', '~weekday'],
  ['lab every other week thursday 2pm', 'Lab', 'Thu 11/19 14:00', 'Thu 11/19 15:00', '~2weeks'],
  ['rent due every month on the 1st', 'Rent', 'Tue 12/1 00:00', 'all', 'due ~month'],
  ['office hours fridays 1-2pm', 'Office hours', 'Fri 11/20 13:00', 'Fri 11/20 14:00', '~week'],
  ['weekly review fri 3pm', 'Weekly review', 'Fri 11/20 15:00', 'Fri 11/20 16:00'],
  ['daily standup 9:30am tomorrow', 'Daily standup', 'Mon 11/16 09:30', 'Mon 11/16 10:30'],
]
const nulls = ['math 19a homework', 'buy milk', 'chapter 3 notes', 'room 4 key', 'read pages 3-5', 'CS 61B notes', 'v2.0 release', 'call mom', 'the exam was moved, thus we meet later', 'bring sunscreen']

let fail = 0
for (const [input, title, start, end, flag] of cases) {
  const p = parseQuickEvent(input, NOW)
  const got = p ? [p.title, fmt(p.start), p.allDay ? 'all' : fmt(p.end), [p.due ? 'due' : '', p.location ? '@' + p.location : '', p.repeat ? '~' + p.repeat.every : ''].filter(Boolean).join(' ')] : null
  const want = [title, start, end, flag ?? '']
  if (!got || got.join(' | ') !== want.join(' | ')) {
    fail++
    console.log(`✗ ${input}\n    want ${want.join(' | ')}\n    got  ${got ? got.join(' | ') : 'null'}`)
  }
}
for (const n of nulls) {
  const p = parseQuickEvent(n, NOW)
  if (p) (fail++, console.log(`✗ ${n} should not be an event, got ${p.title} ${fmt(p.start)}`))
}
console.log(`${cases.length + nulls.length - fail}/${cases.length + nulls.length} pass`)
if (fail) process.exit(1)
