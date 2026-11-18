import { useMemo } from 'react'
import { useStore } from '../store'
import type { Item } from '../types'

/**
 * The workspace as one connected thing. Docs, recordings and the calendar used to be four separate lists; this reads
 * every doc once and keeps what ties them together:
 *
 *  - **Links.** A doc links to another doc or recording with an ordinary link whose address is `#doc/<id>` (typed with
 *    `[[` in the editor). Because it's a plain link, it survives Markdown files, backups and phone sync untouched.
 *    From those we know what each doc links to, and what links back to it (with the sentence it's mentioned in).

 * Tasks are not read from docs any more: they're records of their own (lib/tasks.ts).
 *
 * Each doc is read again only when its text changes, so this stays cheap while typing.
 */

export const LINK_PREFIX = '#doc/'
export const linkHref = (id: string) => `${LINK_PREFIX}${id}`
export const linkedId = (href: string | null | undefined) => (href?.startsWith(LINK_PREFIX) ? href.slice(LINK_PREFIX.length) : null)

export interface Mention {
  /** The doc the link is in. */
  from: Item
  /** The sentence around it. */
  line: string
}

interface Read { content: string; day: number; links: { to: string; line: string }[]; plain?: string }
const cache = new Map<string, Read>()

const BLOCK = 'p,li,h1,h2,h3,h4,td,th,blockquote'

function read(item: Item, now: Date): Read {
  const day = new Date(now).setHours(0, 0, 0, 0)
  const hit = cache.get(item.id)
  // A relative date ("by Friday") means something else tomorrow, so a day change reads the doc again.
  if (hit && hit.content === item.content && hit.day === day) return hit
  const out: Read = { content: item.content, day, links: [] }
  if (item.content.includes(LINK_PREFIX)) {
    // A <template> parses without loading anything (pictures in a plain <div> would start downloading).
    const tpl = document.createElement('template')
    tpl.innerHTML = item.content
    tpl.content.querySelectorAll(`a[href^="${LINK_PREFIX}"]`).forEach((a) => {
      const to = linkedId(a.getAttribute('href'))
      if (!to || to === item.id) return
      const line = (a.closest(BLOCK)?.textContent || a.textContent || '').replace(/\s+/g, ' ').trim()
      out.links.push({ to, line: line.length > 180 ? `${line.slice(0, 177)}…` : line })
    })
  }
  cache.set(item.id, out)
  return out
}

export interface Workspace {
  /** What each doc links to. */
  links: Map<string, string[]>
  /** What links to each doc. */
  mentions: Map<string, Mention[]>
}

export function readWorkspace(items: Item[], now = new Date()): Workspace {
  const live = items.filter((i) => !i.deletedAt)
  const ids = new Set(live.map((i) => i.id))
  const links = new Map<string, string[]>()
  const mentions = new Map<string, Mention[]>()
  for (const item of [...live].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const r = read(item, now)
    const seen = new Set<string>()
    for (const l of r.links) {
      if (!ids.has(l.to) || seen.has(l.to)) continue
      seen.add(l.to)
      mentions.set(l.to, [...(mentions.get(l.to) ?? []), { from: item, line: l.line }])
    }
    if (seen.size) links.set(item.id, [...seen])
  }
  return { links, mentions }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A title as a whole phrase, in any letter case. */
const phrase = (title: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(title.trim())}(?![\\p{L}\\p{N}])`, 'iu')

/**
 * Docs that say this doc's name in plain words without linking to it. Offered under Connections as "Mentioned in",
 * each with a Link button. Only for titles long enough to mean something (four letters or more).
 */
export function unlinkedMentions(item: Item, items: Item[], ws: Workspace): Mention[] {
  const title = item.title.trim()
  if (title.length < 4) return []
  const re = phrase(title)
  const low = title.toLowerCase()
  const linked = new Set((ws.mentions.get(item.id) ?? []).map((m) => m.from.id))
  const out: Mention[] = []
  for (const other of items) {
    if (other.id === item.id || other.deletedAt || other.file?.dir || linked.has(other.id)) continue
    const r = cache.get(other.id)
    if (!r || r.content !== other.content) continue // not read yet: it will be on the next pass
    if (r.plain === undefined) {
      const tpl = document.createElement('template')
      tpl.innerHTML = other.content.replace(/<\/(p|h\d|li|div|blockquote|pre|tr|td|th)>/g, '</$1>\n')
      r.plain = tpl.content.textContent || ''
    }
    if (!r.plain.toLowerCase().includes(low)) continue
    const line = r.plain.split('\n').find((l) => re.test(l))
    if (line) out.push({ from: other, line: line.trim().length > 180 ? `${line.trim().slice(0, 177)}…` : line.trim() })
    if (out.length === 5) break
  }
  return out
}

/** Turn the first plain mention of `target`'s title in a doc into a link to it. Returns the doc's text from before, for Undo. */
export function linkMention(fromId: string, target: Item): string | null {
  const st = useStore.getState()
  const from = st.items.find((i) => i.id === fromId)
  if (!from) return null
  const re = phrase(target.title)
  const tpl = document.createElement('template')
  tpl.innerHTML = from.content
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest('a,code,pre')) continue
    const m = node.data.match(re)
    if (!m || m.index === undefined) continue
    const rest = node.splitText(m.index)
    rest.splitText(m[0].length)
    const a = document.createElement('a')
    a.setAttribute('href', linkHref(target.id))
    a.textContent = rest.data
    rest.replaceWith(a)
    st.updateItem(from.id, { content: tpl.innerHTML })
    return from.content
  }
  return null
}

/** The workspace, re-read when docs change. */
export function useWorkspace(): Workspace {
  const items = useStore((s) => s.items)
  return useMemo(() => readWorkspace(items), [items])
}
