import type { Item } from '../types'
import { htmlToText } from './util'

// A doc's plain text is asked for constantly: search as you type, the assistant choosing what to read, word counts,
// suggestions. Working it out means parsing the doc's HTML, which is slow to repeat across thousands of docs on every
// keystroke. A doc object is never changed in place (an edit makes a new one), so its text is worked out once and
// remembered until the doc changes; the memory is freed with the doc.

const plain = new WeakMap<Item, string>()
const lower = new WeakMap<Item, string>()

/** The doc's words, without markup. */
export function textOf(item: Item): string {
  let t = plain.get(item)
  if (t === undefined) plain.set(item, (t = htmlToText(item.content)))
  return t
}

/** Everything searchable in a doc or recording (its words, then its transcript), as written. */
export function fullText(item: Item): string {
  const said = item.lecture?.transcript.length ? ' ' + item.lecture.transcript.map((s) => s.text).join(' ') : ''
  return textOf(item) + said
}

/** The same in lower case, for matching. */
export function searchText(item: Item): string {
  let t = lower.get(item)
  if (t === undefined) lower.set(item, (t = fullText(item).toLowerCase()))
  return t
}

export const wordCount = (item: Item) => {
  const t = textOf(item).trim()
  return t ? t.split(/\s+/).length : 0
}
