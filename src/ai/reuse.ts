// When a follow-up can carry on in the conversation the model already holds.
//
// LiteRT-LM keeps what a conversation has read, so a follow-up only has to read the new question: the difference
// between answering at once and re-reading the whole chat (thousands of tokens) first. The worker used to compare the
// next request's earlier messages with its own record, character for character. They rarely matched after the first
// exchange, for reasons that have nothing to do with the conversation changing:
//   - the chat shows the model's answer tidied (action lines taken out, thinking stripped, trimmed), and sends that back;
//   - a turn that asked for an action carried extra instructions, which the chat leaves out of the history;
//   - an action turn allows a longer answer than a plain one, and the limit was part of the comparison.
// So each message is compared by a key instead. An answer's key is the same whatever its wording (the model's own
// memory of what it said is the true record); a question's key is its text without per-turn instructions; and a
// conversation made with room for a longer answer serves a shorter one. Anything that really changes the chat (a retry,
// an edit, older turns dropped to fit, different evidence in an old turn) still changes a key and starts afresh.
//
// No imports: shared by the page and the worker, and tested on its own (scripts/test-reuse.ts).

export type Turn = { role: string; content: string }

/** Every answer has this key. */
export const ANSWER = '\u0001answer'

export function turnKeys(messages: Turn[], keyOf: (m: Turn) => string = (m) => m.content): string[] {
  return messages.map((m) => (m.role === 'assistant' ? ANSWER : `${m.role}\u0001${keyOf(m)}`))
}

export interface Held { keys: string[]; maxTokens: number; temperature: number }

/** Can a request with these keys (the last is the new question) continue the conversation that's held? */
export function canReuse(held: Held | null | undefined, keys: string[], maxTokens: number, temperature: number): boolean {
  if (!held || held.temperature !== temperature || maxTokens > held.maxTokens) return false
  if (held.keys.length !== keys.length - 1) return false
  for (let i = 0; i < held.keys.length; i++) if (held.keys[i] !== keys[i]) return false
  return true
}

/** What's held once the answer has been given. */
export const afterAnswer = (keys: string[], maxTokens: number, temperature: number): Held => ({ keys: [...keys, ANSWER], maxTokens, temperature })
