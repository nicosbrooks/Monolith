// When a follow-up reuses the model's conversation. Run: npm run test:reuse
import { afterAnswer, canReuse, turnKeys, type Turn } from '../src/ai/reuse.ts'

const GUIDE = 'To change the calendar, write @event {...}.\n\n'
const strip = (m: Turn) => m.content.replace(GUIDE, '')
const sys: Turn = { role: 'system', content: 'You are Monolith.' }
const u = (content: string): Turn => ({ role: 'user', content })
const a = (content: string): Turn => ({ role: 'assistant', content })
let failed = 0
const check = (name: string, got: boolean, want: boolean) => {
  if (got !== want) (failed++, console.log(`✗ ${name}\n    want ${want}, got ${got}`))
}

// Turn 1: a plain question, 500 tokens allowed.
const t1 = [sys, u('What is on tomorrow?')]
check('nothing held yet', canReuse(null, turnKeys(t1, strip), 500, 0.3), false)
let held = afterAnswer(turnKeys(t1, strip), 500, 0.3)

// Turn 2: the chat sends the answer back tidied; still the same conversation.
const t2 = [sys, u('What is on tomorrow?'), a('Two things: calc review and lunch.'), u('And Thursday?')]
check('follow-up with a tidied answer', canReuse(held, turnKeys(t2, strip), 500, 0.3), true)
held = afterAnswer(turnKeys(t2, strip), 500, 0.3)

// Turn 3 asks for an action: longer answer allowed than the conversation was made for, so one fresh start…
const t3 = [...t2, a('Nothing on Thursday.'), u(`${GUIDE}Move calc review to Thursday 3pm`)]
check('a longer answer than the conversation allows', canReuse(held, turnKeys(t3, strip), 800, 0.3), false)
held = afterAnswer(turnKeys(t3, strip), 800, 0.3)

// …after which the action turn's instructions and its raw answer don't matter, and shorter answers fit.
const t4 = [...t2, a('Nothing on Thursday.'), u('Move calc review to Thursday 3pm'), a('Offered: Move “Calc review”'), u('Thanks. What is left today?')]
check('after an action turn (instructions stripped, answer rewritten, shorter limit)', canReuse(held, turnKeys(t4, strip), 500, 0.3), true)
held = afterAnswer(turnKeys(t4, strip), 800, 0.3)

// Things that really change the chat start afresh.
check('retry of the last question', canReuse(held, turnKeys(t4, strip), 500, 0.3), false)
check('an earlier question edited', canReuse(held, turnKeys([...t4.slice(0, 1), u('What is on today?'), ...t4.slice(2), a('x'), u('next')], strip), 500, 0.3), false)
check('older turns dropped to fit', canReuse(held, turnKeys([sys, ...t4.slice(3), a('x'), u('next')], strip), 500, 0.3), false)
check('a different system message', canReuse(held, turnKeys([{ role: 'system', content: 'Other' }, ...t4.slice(1), a('x'), u('next')], strip), 500, 0.3), false)
check('a different temperature', canReuse(held, turnKeys([...t4, a('x'), u('next')], strip), 500, 0.6), false)
check('the straightforward next turn', canReuse(held, turnKeys([...t4, a('x'), u('next')], strip), 500, 0.3), true)
// A one-off request (rewrite this paragraph) never continues a chat.
check('an unrelated single request', canReuse(held, turnKeys([sys, u('Rewrite: …')]), 500, 0.3), false)

console.log(failed ? `${failed} failed` : '12/12 pass')
process.exit(failed ? 1 : 0)
