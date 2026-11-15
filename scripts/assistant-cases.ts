import { ACT_GUIDE, pinToAsked, splitActs } from '../src/ai/act'
import { CHAT_RULES, evidenceQuery, packTurn, passages, relevant, sameEvidence, sharedContext, turnEvidence, type Workspace } from '../src/ai/context'
import { instantAnswer } from '../src/ai/instant'
import { fit, promptBudget, tokensOf, type Msg } from '../src/ai/prompt'
import type { CalEvent, Item } from '../src/types'

const now = new Date(2026, 10, 15, 10)
const time = (day: number, hour: number) => +new Date(2026, 10, day, hour)
const doc = (id: string, title: string, content: string): Item => ({
  id, kind: 'doc', title, content, folderId: null, parentId: null, pinned: false, tags: [], createdAt: +now, updatedAt: +now,
})
const event = (id: string, title: string, day: number, start: number, end: number): CalEvent =>
  ({ id, title, start: time(day, start), end: time(day, end), color: 'blue' })

const lecture: Item = {
  ...doc('lecture', 'Chemistry lecture', ''),
  kind: 'lecture',
  lecture: {
    duration: 1400, hasAudio: false, status: 'done',
    transcript: [
      ...Array.from({ length: 9 }, (_, n) => ({
        start: n * 80, end: (n + 1) * 80,
        text: 'The reaction mechanism involves an intermediate and the catalyst lowers the activation energy. '.repeat(5),
      })),
      { start: 762, end: 780, text: 'Office hours moved to Room 204 this term. This replaces the previous room. Bring lab questions.' },
    ],
  },
}
const handbook = doc('handbook', 'Lab Handbook', '<p>Wear splash goggles throughout the experiment. Store the sample at 4°C.</p>')
const notes = doc('notes', 'Lab Notes', '<p>The sample was stored at 8°C on the second run. The first run used 4°C.</p>')
const events = [
  event('lab', 'Biology lab', 16, 9, 12), event('seminar', 'Research seminar', 16, 14, 16),
  ...Array.from({ length: 28 }, (_, n) => event(`event-${n}`, `Background commitment ${n + 1}`, 17 + Math.floor(n / 4), 10 + (n % 4) * 2, 11 + (n % 4) * 2)),
]
const tasks = doc('tasks', 'Course Tasks', `<ul><li data-checked="false">Submit microscopy report</li>${Array.from({ length: 14 }, (_, n) => `<li data-checked="false">Read chapter ${n + 1} and revise the practice set</li>`).join('')}</ul>`)
const workspace: Workspace = { now, items: [handbook, lecture, notes, tasks], events }
const updatedLecture = {
  ...lecture, updatedAt: +now + 1,
  lecture: { ...lecture.lecture!, transcript: [{ start: 780, end: 793, text: 'Office hours now meet in Room 301.' }] },
}
const edited: Workspace = { ...workspace, items: workspace.items.map((item) => item === lecture ? updatedLecture : item) }

type Case = {
  name: string
  question: string
  snippets: string[]
  expected: string
  absent?: string[]
  docs?: string[]
  action?: boolean
  previous?: string
  open?: Item
  workspace?: Workspace
}
export const cases: Case[] = [
  {
    name: 'Buried transcript detail', question: 'Where are office hours in the Chemistry lecture?',
    snippets: ['[12:42]', 'Room 204'], expected: 'Identify Room 204 and ground it in the lecture.',
    absent: ['Biology lab', 'Submit microscopy report'], docs: ['lecture'],
  },
  {
    name: 'Compare two documents', question: 'Compare the sample storage temperatures in Lab Handbook and Lab Notes.',
    snippets: ['4°C', '8°C'], expected: 'Handbook requires 4°C. The second run in the notes used 8°C.',
    docs: ['handbook', 'notes'],
  },
  {
    name: 'Calendar gap', question: 'Could I fit an hour of studying between my calendar events tomorrow?',
    snippets: ['Biology lab', 'Research seminar', 'tomorrow 2026-11-16', 'between timed events: 12 PM–2 PM'], expected: 'Pick a one-hour interval between noon and 2 PM.',
    absent: ['Background commitment', 'Course Tasks'],
  },
  {
    name: 'Planning across calendar and tasks', question: 'What should I focus on tomorrow given my calendar and open tasks?',
    snippets: ['Biology lab', 'Research seminar', 'Submit microscopy report'], expected: 'Use the open tasks and schedule without inventing a deadline.',
    absent: ['Background commitment'],
  },
  {
    name: 'Edited source on follow-up', question: 'Where is that now?', previous: 'Where are office hours in the Chemistry lecture?',
    snippets: ['Room 301'], expected: 'Identify Room 301 as the current room.', absent: ['Room 204'], docs: ['lecture'], workspace: edited,
  },
  {
    name: 'Move an event', question: 'Move Research seminar from Monday to Tuesday at 3 pm.',
    snippets: ['Research seminar', '2026-11-17', '@move'], expected: 'Propose moving Research seminar to 2026-11-17 at 3 PM.',
    action: true,
  },
  {
    name: 'Preserve answer constraints', question: 'In 15 words, tell me the Lab Handbook temperature. Keep the original units.',
    snippets: ['4°C', 'Keep the original units'], expected: 'Answer in at most 15 words and preserve 4°C.', docs: ['handbook'], open: handbook,
  },
]

export function casePrompts(test: Case, strategy: 'broad' | 'focused', window: number, reserve: number) {
  const data = test.workspace ?? workspace
  const query = evidenceQuery(test.question, test.previous)
  const history: Msg[] = test.previous ? [
    { role: 'user', content: test.previous },
    { role: 'assistant', content: 'Office hours were in Room 204 when we last checked the lecture.' },
  ] : []
  const guide = test.action ? ACT_GUIDE : undefined
  if (strategy === 'broad') {
    // Use today's retrieval in both variants to isolate the effect of packing the workspace snapshot.
    const docs = relevant(query, { items: data.items, open: test.open })
    return {
      kept: [],
      messages: [
        { role: 'system', content: sharedContext(data) }, ...history,
        { role: 'user', content: `${passages(docs)}\n\nQuestion: ${test.question}${guide ? `\n\n${guide}` : ''}` },
      ] satisfies Msg[],
    }
  }
  const evidence = turnEvidence(query, { ...data, open: test.open, action: test.action })
  const packed = packTurn(test.question, evidence, { window, reserve, guide, open: test.open })
  return {
    kept: packed.kept,
    messages: [
      { role: 'system', content: CHAT_RULES },
      ...history,
      { role: 'user', content: packed.content },
    ] satisfies Msg[],
  }
}

export function auditPrompts(window = 4096) {
  const rows = cases.map((test) => {
    const reserve = test.action ? 800 : 500
    const { kept, messages } = casePrompts(test, 'focused', window, reserve)
    const focused = fit(messages, window, reserve)
    const broad = fit(casePrompts(test, 'broad', window, reserve).messages, window, reserve)
    const current = focused.at(-1)!.content
    const fails = [
      ...test.snippets.filter((snippet) => !current.includes(snippet)).map((s) => `Missing: ${s}`),
      ...(test.absent ?? []).filter((snippet) => current.includes(snippet)).map((s) => `Unexpected: ${s}`),
      ...(test.docs ?? []).filter((id) => !kept.some(({ item }) => item?.id === id)).map((id) => `Missing source: ${id}`),
    ]
    const tokens = (parts: Msg[]) => parts.reduce((n, part) => n + tokensOf(part.content), 0)
    if (tokens(focused) > promptBudget(window, reserve)) fails.push('Input exceeds estimated budget.')
    return { case: test.name, broadTokens: tokens(broad), focusedTokens: tokens(focused), fails }
  })
  const prior = turnEvidence(cases[0].question, workspace)
  if (!sameEvidence(prior, workspace, workspace) || sameEvidence(prior, workspace, edited)) {
    rows[4].fails.push('Prior evidence was not invalidated after source edit.')
  }
  const gap = instantAnswer(cases[2].question, workspace)
  if (gap?.source !== 'calendar' || gap.text !== '**12 PM–1 PM** fits between your timed events tomorrow.') {
    rows[2].fails.push('Direct availability did not return the noon slot.')
  }
  // The live model proposed a one-hour end for a two-hour event. The confirmed card must keep its length.
  const generated = '@move {"event":"Research seminar","start":"2026-11-17T15:00","end":"2026-11-17T16:00"}'
  const acts = splitActs(generated, workspace).acts
  const [move] = pinToAsked(acts, cases[5].question, now)
  if (move?.kind !== 'move' || move.eventId !== 'seminar' || move.start !== time(17, 15) || move.end !== time(17, 17)) {
    rows[5].fails.push('Moving the seminar did not preserve its two-hour duration.')
  }
  const [shorter] = pinToAsked(acts, 'Move Research seminar to Tuesday at 3 pm for 45 minutes.', now)
  if (shorter?.kind !== 'move' || shorter.end - shorter.start !== 45 * 60000) {
    rows[5].fails.push('The requested 45-minute duration was not honored.')
  }
  return rows
}
