import { useMemo } from 'react'
import { useStore } from '../store'
import type { Item } from '../types'
import { parseQuickEvent } from './dates'

/**
 * The workspace as one connected thing. Docs, recordings and the calendar used to be four separate lists; this reads
 * every doc once and keeps what ties them together:
 *
 *  - **Links.** A doc links to another doc or recording with an ordinary link whose address is `#doc/<id>` (typed with
 *    `[[` in the editor). Because it's a plain link, it survives Markdown files, backups and phone sync untouched.
 *    From those we know what each doc links to, and what links back to it (with the sentence it's mentioned in).
 *  - **Tasks.** Every checklist line in every doc, in one list, with the date it's due when the line says one
 *    ("essay draft by Friday"). Home, the Tasks page and the assistant all read this, so they always agree.
 *
 * Each doc is read again only when its text changes, so this stays cheap while typing.
 */

export const LINK_PREFIX = '#doc/'
export const linkHref = (id: string) => `${LINK_PREFIX}${id}`
export const linkedId = (href: string | null | undefined) => (href?.startsWith(LINK_PREFIX) ? href.slice(LINK_PREFIX.length) : null)

export interface Task {
  itemId: string
  /** Its place among the doc's checklist lines, so two lines with the same words stay apart. */
  n: number
  text: string
  /** What's left of the line once the date is taken out ("Essay draft"). */
  title: string
  done: boolean
  /** Start of the day (or the exact time) it's due, when the line names one. */
  due?: number
  allDay?: boolean
}

export interface Mention {
  /** The doc the link is in. */
  from: Item
  /** The sentence around it. */
  line: string
}

interface Read { content: string; day: number; tasks: Task[]; links: { to: string; line: string }[] }
const cache = new Map<string, Read>()

const BLOCK = 'p,li,h1,h2,h3,h4,td,th,blockquote'

function read(item: Item, now: Date): Read {
  const day = new Date(now).setHours(0, 0, 0, 0)
  const hit = cache.get(item.id)
  // A relative date ("by Friday") means something else tomorrow, so a day change reads the doc again.
  if (hit && hit.content === item.content && hit.day === day) return hit
  const out: Read = { content: item.content, day, tasks: [], links: [] }
  if (item.content.includes('data-checked') || item.content.includes(LINK_PREFIX)) {
    // A <template> parses without loading anything (pictures in a plain <div> would start downloading).
    const tpl = document.createElement('template')
    tpl.innerHTML = item.content
    tpl.content.querySelectorAll('li[data-checked]').forEach((li, n) => {
      // Its own words only: a nested checklist's lines are tasks of their own.
      const own = li.cloneNode(true) as Element
      own.querySelectorAll('ul,ol').forEach((x) => x.remove())
      const text = (own.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text) return
      const task: Task = { itemId: item.id, n, text, title: text, done: li.getAttribute('data-checked') === 'true' }
      const when = task.done ? null : parseQuickEvent(text, now)
      if (when) {
        task.due = when.start.getTime()
        task.allDay = when.allDay
        if (when.title) task.title = when.title
      }
      out.tasks.push(task)
    })
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
  /** Open tasks: overdue and dated first (soonest first), then the rest in the order their docs were last edited. */
  tasks: Task[]
  /** What each doc links to. */
  links: Map<string, string[]>
  /** What links to each doc. */
  mentions: Map<string, Mention[]>
}

export function readWorkspace(items: Item[], now = new Date()): Workspace {
  const live = items.filter((i) => !i.deletedAt)
  const ids = new Set(live.map((i) => i.id))
  const tasks: Task[] = []
  const links = new Map<string, string[]>()
  const mentions = new Map<string, Mention[]>()
  for (const item of [...live].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const r = read(item, now)
    for (const t of r.tasks) if (!t.done) tasks.push(t)
    const seen = new Set<string>()
    for (const l of r.links) {
      if (!ids.has(l.to) || seen.has(l.to)) continue
      seen.add(l.to)
      mentions.set(l.to, [...(mentions.get(l.to) ?? []), { from: item, line: l.line }])
    }
    if (seen.size) links.set(item.id, [...seen])
  }
  // Stable: dated ones by date, the rest keep doc order.
  const dated = tasks.filter((t) => t.due !== undefined).sort((a, b) => a.due! - b.due!)
  return { tasks: [...dated, ...tasks.filter((t) => t.due === undefined)], links, mentions }
}

/** The workspace, re-read when docs change. */
export function useWorkspace(): Workspace {
  const items = useStore((s) => s.items)
  return useMemo(() => readWorkspace(items), [items])
}

/** Check or uncheck one checklist line in a doc. Returns the doc's text from before, for Undo. */
export function setTaskDone(task: Pick<Task, 'itemId' | 'n'>, done: boolean): string | null {
  const st = useStore.getState()
  const item = st.items.find((i) => i.id === task.itemId)
  if (!item) return null
  const tpl = document.createElement('template')
  tpl.innerHTML = item.content
  const li = tpl.content.querySelectorAll('li[data-checked]')[task.n]
  if (!li) return null
  li.setAttribute('data-checked', String(done))
  // Tiptap also writes the state on the checkbox itself.
  const box = li.querySelector(':scope > label > input[type="checkbox"]')
  if (box) (done ? box.setAttribute('checked', 'checked') : box.removeAttribute('checked'))
  st.updateItem(item.id, { content: tpl.innerHTML })
  return item.content
}

/** Take a checklist line out of its doc (Undo for a task just added). */
export function removeTask(task: Pick<Task, 'itemId' | 'n'>) {
  const st = useStore.getState()
  const item = st.items.find((i) => i.id === task.itemId)
  if (!item) return
  const tpl = document.createElement('template')
  tpl.innerHTML = item.content
  const li = tpl.content.querySelectorAll('li[data-checked]')[task.n]
  if (!li) return
  const list = li.parentElement
  li.remove()
  if (list && !list.children.length) list.remove()
  st.updateItem(item.id, { content: tpl.innerHTML })
}

export type TaskGroup = 'overdue' | 'today' | 'week' | 'later' | 'someday'
export const GROUP_LABEL: Record<TaskGroup, string> = { overdue: 'Overdue', today: 'Today', week: 'Next 7 days', later: 'Later', someday: 'No date' }

export function taskGroup(t: Task, now = new Date()): TaskGroup {
  if (t.due === undefined) return 'someday'
  const day = new Date(now).setHours(0, 0, 0, 0)
  // A timed task is overdue once the time passes; an all-day one when the day is over.
  if (t.allDay ? t.due < day : t.due < now.getTime()) return 'overdue'
  if (t.due < day + 864e5) return 'today'
  if (t.due < day + 8 * 864e5) return 'week'
  return 'later'
}

/** "Today", "Tomorrow", "Fri", "Nov 28", with the time when the line gave one. */
export function dueLabel(t: Pick<Task, 'due' | 'allDay'>, now = new Date()): string {
  if (t.due === undefined) return ''
  const day = new Date(now).setHours(0, 0, 0, 0)
  const d = new Date(t.due)
  const days = Math.round((new Date(t.due).setHours(0, 0, 0, 0) - day) / 864e5)
  const date =
    days === 0 ? 'Today'
    : days === 1 ? 'Tomorrow'
    : days === -1 ? 'Yesterday'
    : days > 1 && days < 7 ? d.toLocaleDateString('en-US', { weekday: 'short' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return t.allDay ? date : `${date} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * Where a task typed outside any doc goes: a doc called "Tasks", made the first time it's needed. It's an ordinary
 * doc, so the list can be reordered, annotated and synced like anything else.
 */
export function addTask(text: string): Task | null {
  const line = text.trim()
  if (!line) return null
  const st = useStore.getState()
  const esc = line.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const li = `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>${esc}</p></div></li>`
  const inbox = st.items.find((i) => i.kind === 'doc' && !i.deletedAt && !i.sourceId && i.title.trim().toLowerCase() === 'tasks')
  if (!inbox) {
    const before = { section: st.section, activeId: st.activeId }
    const made = st.createItem('doc', { title: 'Tasks', content: `<ul data-type="taskList">${li}</ul>`, folderId: null })
    useStore.setState(before) // adding a task doesn't take you away from where you are
    return { itemId: made.id, n: 0, text: line, title: line, done: false }
  }
  // Onto the doc's first checklist if it has one, so the list stays one list.
  const tpl = document.createElement('template')
  tpl.innerHTML = inbox.content
  const list = tpl.content.querySelector('ul[data-type="taskList"]')
  if (list) list.insertAdjacentHTML('afterbegin', li)
  else tpl.innerHTML = `<ul data-type="taskList">${li}</ul>${inbox.content}`
  st.updateItem(inbox.id, { content: tpl.innerHTML })
  const n = [...tpl.content.querySelectorAll('li[data-checked]')].findIndex((x) => (x.textContent || '').trim() === line)
  return { itemId: inbox.id, n: Math.max(0, n), text: line, title: line, done: false }
}
