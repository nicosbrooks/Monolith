export type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

/** Rough token count, on the safe side: about 3.2 characters a token (English is nearer 4). */
export const tokensOf = (t: string) => Math.ceil(t.length / 3.2) + 4
export const promptBudget = (window: number, reserve: number) => window - reserve - 48

/**
 * Fit a chat inside the model's window, leaving room for the answer. The system message and the newest question always
 * stay; older turns go oldest first (a pair at a time, so the chat still starts with a question); if the newest
 * question alone is too long, its middle is cut, keeping the opening paragraph and the end.
 */
export function fit(messages: Msg[], window: number, reserve: number): Msg[] {
  const budget = promptBudget(window, reserve)
  const sys = messages[0]?.role === 'system' ? messages[0] : null
  const rest = sys ? messages.slice(1) : messages
  if (!rest.length) return messages
  const last = rest[rest.length - 1]
  const used = (sys ? tokensOf(sys.content) : 0) + tokensOf(last.content)
  if (used > budget) {
    const room = Math.floor(Math.max(200, (budget - (sys ? tokensOf(sys.content) : 0)) * 3.2))
    // Keep the opening paragraph (instructions come first in some prompts) and the end (the question comes last in
    // chat); the middle, usually pasted material, is what gives way.
    const para = last.content.indexOf('\n\n')
    const head = para > 0 ? Math.min(para, Math.floor(room * 0.4)) : 0
    return [...(sys ? [sys] : []), { ...last, content: last.content.slice(0, head) + '\n…\n' + last.content.slice(-(room - head - 3)) }]
  }
  let total = used
  let from = rest.length - 1
  while (from > 0 && total + tokensOf(rest[from - 1].content) <= budget) total += tokensOf(rest[--from].content)
  while (from < rest.length - 1 && rest[from].role !== 'user') from++
  return [...(sys ? [sys] : []), ...rest.slice(from)]
}

