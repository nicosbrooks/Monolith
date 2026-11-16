import { parseQuickEvent, type ParsedEvent } from './dates.ts'

/**
 * What someone typed into the Ask bar or ⌘K, read into the details of a change. src/ai/understand.ts decides *what*
 * they want (EmbeddingGemma, with these rules as the fallback); this file pulls out the parts: the title, the date
 * and time. "Make an event for tomorrow" is an event tomorrow with no name yet, never an event called "Make an event".
 *
 * Plain functions, no app state, so `npm run test:dates` checks them in Node.
 */

export type RequestKind = 'event' | 'task' | 'doc' | 'ask' | 'find'

/** "please", "can you", "I'd like you to"… in front of the request itself. */
const POLITE = /^\s*(?:(?:please|pls|ok(?:ay)?|hey|hi|so|now|also|and|then|just|quickly)[,\s]+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|i(?:['’]d| would)? (?:like|want|need) (?:you )?to\s+|let['’]?s\s+|go ahead and\s+|help me\s+)?(?:please\s+)?/i

/** Verbs that only say "make this", and are never part of the name. */
const VERB = /^(?:add|create|schedule|book|put|set ?up|log|pencil in|new|remind me(?: to| about)?|don['’]?t (?:let me )?forget (?:to|about)|i need to|i have to|i must)\s+/i
/** "make" and "plan" are only the request when what follows says what is being made ("make an event", not "make dinner"). */
const SOFT_VERB = /^(?:make|plan|block(?: off| out)?|start|open|write)\s+(?=(?:me |us )?(?:an? |the |another |one )?(?:new |blank |empty |calendar )?(?:event|entry|item|thing|meeting|appointment|reminder|task|to-?do|doc|note|page|document|time|block|slot)\b)/i
/** Words for "an event" that carry no name: "an event", "a new calendar entry", "some time". */
const GENERIC = /^(?:(?:me|us)\s+)?(?:(?:an?|the|one|another|some)\s+)?(?:new\s+|blank\s+|empty\s+)?(?:calendar\s+)?(?:events?|entry|entries|item|thing|something|reminder|block|slot|time(?=\s+(?:for|to)\b)|tasks?|to-?dos?|docs?|notes?|pages?|documents?)\b\s*:?\s*/i
/** "… on my calendar", "… to my list". */
const WHERE = /\s+(?:to|on|in|into|onto)\s+(?:my|the|our)\s+(?:calendar|schedule|agenda|planner|list|to-?do list|tasks?(?: list)?|docs?)\b/gi
/** "called Demo day", "named “Q3 review”". */
const NAMED = /\b(?:called|named|titled|labell?ed)\s+["“'‘]?(.+?)["”'’]?\s*$/i

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,.:;–-]+|[\s,.;:!?–-]+$/g, '').trim()

/** The request without "please" and "can you". */
export const stripPolite = (text: string) => text.replace(POLITE, '').trim()

/**
 * The name in what's left of a request once its date is taken out: "Make an event called dentist" → "Dentist",
 * "Schedule a meeting with Sam" → "Meeting with Sam", "Make an event" → "" (no name given).
 */
export function cleanTitle(raw: string): string {
  let t = ` ${tidy(stripPolite(raw))} `.replace(WHERE, ' ').trim()
  const named = t.match(NAMED)
  if (named) return cap(tidy(named[1]))
  t = t.replace(VERB, '').replace(SOFT_VERB, '')
  if (GENERIC.test(t)) t = t.replace(GENERIC, '').replace(/^(?:for|about|to|on|with(?= \w+ \w+)|:|-)\s+/i, '')
  else t = t.replace(/^(?:an?|the)\s+/i, '')
  t = tidy(t)
  // Only little words left: no name was given.
  if (!t || /^(?:(?:for|on|at|to|my|the|a|an|me|it|this|that|one|calendar|event|new|please)\s*)+$/i.test(t)) return ''
  return cap(t)
}

export interface EventRequest {
  /** Empty when the request didn't name it ("make an event for tomorrow"). */
  title: string
  /** The date and time, or null when none was given ("add an event called Demo day"). */
  when: ParsedEvent | null
}

/** An event's details from a request. */
export function readEvent(text: string, now = new Date()): EventRequest {
  const s = stripPolite(text)
  const when = parseQuickEvent(s, now)
  return { title: cleanTitle(when ? when.title : s), when }
}

/** A task's words from a request: "add a task to email the professor" → "Email the professor". */
export function readTask(text: string): string {
  const s = tidy(stripPolite(text).replace(WHERE, ' '))
  const named = s.match(NAMED)
  if (named) return cap(tidy(named[1]))
  let t = s.replace(VERB, '').replace(SOFT_VERB, '')
  if (GENERIC.test(t)) t = t.replace(GENERIC, '').replace(/^(?:to|for|about|:|-)\s+/i, '')
  return cap(tidy(t))
}

/** A task line as Tasks will list it: its name without the date words, and when it's due. */
export function taskPreview(line: string, now = new Date()): { name: string; due: ParsedEvent | null } {
  const when = parseQuickEvent(line, now)
  const due = when && !when.repeat ? when : null
  return { name: (due && due.title) || line, due }
}

/** A new doc's title from a request: "new doc about the trip" → "The trip". Empty when none was given. */
export function readDoc(text: string): string {
  const s = tidy(stripPolite(text))
  const named = s.match(NAMED)
  if (named) return cap(tidy(named[1]))
  let t = s.replace(VERB, '').replace(SOFT_VERB, '')
  if (!GENERIC.test(t)) return ''
  t = t.replace(GENERIC, '').replace(/^(?:about|on|for|:|-)\s+/i, '')
  return cap(tidy(t))
}

/** A request for information, not a change. Commands that start like questions ("can you add…") aren't. */
const QUESTION = /^(?:what|when|where|who|why|how|do|does|did|is|are|am|should|which|any|show|list|find|tell|summari[sz]e|explain|compare|describe)\b/i
export const isQuestion = (text: string) => {
  const s = stripPolite(text)
  if (/^(?:can|could|would|will) you\b/i.test(text.trim()) && !QUESTION.test(s)) return false
  return QUESTION.test(s) || (/\?\s*$/.test(text) && !VERB.test(s) && !SOFT_VERB.test(s))
}

const TASK_WORDS = /\b(?:task|to-?do|my (?:to-?do )?list)\b|^(?:remind me to|don['’]?t (?:let me )?forget)\b/i
const DOC_WORDS = /^(?:(?:new|create|make|start|open)\s+(?:an?\s+|the\s+)?(?:new\s+|blank\s+|empty\s+)?(?:doc|note|page|document))\b/i
const EVENT_WORDS = /\b(?:event|calendar|meeting|appointment|schedule|book)\b/i

/**
 * The rules, for when EmbeddingGemma hasn't downloaded yet (and as a check on it). `sure` means the words leave no
 * doubt ("add a task…", "new doc…", a question); otherwise it's a best guess.
 */
export function ruleKind(text: string, opts: { section?: string; now?: Date } = {}): { kind: RequestKind; sure: boolean } {
  const s = stripPolite(text)
  if (isQuestion(text)) return { kind: 'ask', sure: true }
  if (DOC_WORDS.test(s)) return { kind: 'doc', sure: true }
  if (TASK_WORDS.test(s)) return { kind: 'task', sure: true }
  const when = parseQuickEvent(s, opts.now)
  if (when && (VERB.test(s) || SOFT_VERB.test(s) || EVENT_WORDS.test(s))) return { kind: 'event', sure: true }
  if (!when && (VERB.test(s) || SOFT_VERB.test(s)) && /\b(?:event|meeting|appointment)\b/i.test(s)) return { kind: 'event', sure: true }
  if (opts.section === 'tasks') return { kind: 'task', sure: false }
  if (when && s.split(/\s+/).length <= 10) return { kind: 'event', sure: false }
  if (opts.section === 'calendar' && when) return { kind: 'event', sure: false }
  return { kind: 'ask', sure: false }
}
