import { create } from 'zustand'
import { del, get, set } from 'idb-keyval'
import { useStore } from '../store'
import type { Item } from '../types'
import { openText, sealText } from './vault'

/**
 * Earlier versions of each doc, kept on this device so nothing written is ever really lost: a rewrite that went wrong,
 * a paragraph deleted last week, a sync that replaced the page.
 *
 * A version is the doc as it was before a stretch of editing. One is saved when a doc changes and its newest version is
 * more than ten minutes old, and always before a large change in one step (an import, an assistant rewrite, a pull from
 * a connected folder), however recent the last one. Each doc keeps its 30 newest. They are stored apart from the
 * workspace (so they don't slow saving), encrypted with the passcode when one is set, and deleted with the doc.
 */

export interface Version { at: number; title: string; content: string }

const EVERY = 10 * 60_000
const KEEP = 30
const key = (id: string) => `history:${id}`
const newest = new Map<string, number>() // doc id → when its newest version was saved

export async function versions(id: string): Promise<Version[]> {
  const raw = await get<string>(key(id))
  if (!raw) return []
  try {
    return JSON.parse(await openText(raw)) as Version[]
  } catch {
    return []
  }
}

let queue: Promise<unknown> = Promise.resolve()
function keep(was: Item) {
  // One at a time, so two quick saves of the same doc can't overwrite each other.
  queue = queue
    .then(async () => {
      const list = await versions(was.id)
      if (list[0]?.content === was.content && list[0]?.title === was.title) return
      await set(key(was.id), await sealText(JSON.stringify([{ at: was.updatedAt, title: was.title, content: was.content }, ...list].slice(0, KEEP))))
    })
    .catch((e) => console.error('Saving a version failed', e))
}

/** Is this change big enough to be a replacement rather than typing? */
const big = (a: string, b: string) => Math.abs(a.length - b.length) > Math.max(400, a.length * 0.3)

/** Save the doc as it is now as a version (before restoring an older one over it). */
export function keepNow(item: Item) {
  newest.set(item.id, Date.now())
  keep(item)
  return queue
}

let started = false
export function startHistory() {
  if (started) return
  started = true
  useStore.subscribe((s, prev) => {
    if (s.items === prev.items) return
    // Usually the list is the same length and one doc changed, so compare place by place; otherwise look each up.
    const aligned = s.items.length === prev.items.length
    const before = aligned ? null : new Map(prev.items.map((i) => [i.id, i]))
    for (let n = 0; n < s.items.length; n++) {
      const item = s.items[n]
      const was = aligned && prev.items[n]?.id === item.id ? prev.items[n] : before ? before.get(item.id) : prev.items.find((i) => i.id === item.id)
      if (!was || was === item || was.content === item.content) continue
      if (!was.content.trim()) continue // nothing to go back to
      // A doc made moments ago has nothing worth going back to yet.
      const last = newest.get(item.id) ?? was.createdAt
      if (Date.now() - last < EVERY && !big(was.content, item.content)) continue
      newest.set(item.id, Date.now())
      keep(was)
    }
    // A doc deleted for good takes its versions with it.
    if (s.items.length < prev.items.length) {
      const ids = new Set(s.items.map((i) => i.id))
      for (const i of prev.items) if (!ids.has(i.id)) (newest.delete(i.id), void del(key(i.id)))
    }
  })
}

/** Which doc's versions are showing, if any. */
export const useHistory = create<{ id: string | null }>(() => ({ id: null }))
export const openHistory = (id: string) => useHistory.setState({ id })

/** A stored version made safe to show as it is: no scripts, frames, styles, event handlers or script links. */
export function safeHtml(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll('script,iframe,object,embed,style,link,meta,form,base').forEach((x) => x.remove())
  tpl.content.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value))) el.removeAttribute(a.name)
    }
  })
  // Stored pictures can't load here; say what was there instead.
  tpl.content.querySelectorAll('img').forEach((img) => {
    const note = document.createElement('em')
    note.textContent = img.getAttribute('alt') || 'Picture'
    img.replaceWith(note)
  })
  return tpl.innerHTML
}
