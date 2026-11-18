import { useMemo } from 'react'
import { create } from 'zustand'
import { toast } from '../components/Toast'
import { useStore } from '../store'
import type { Task } from '../types'
import { parseQuickEvent } from './dates'

export type { Task }

/**
 * Tasks are their own records in the store (`tasks`), synced to the phone like events. They are not read out of docs:
 * a checklist in a doc is part of that doc. A task can name a doc it belongs with (`docId`).
 *
 * Typing one reads a date out of the words ("essay draft by Friday" → "Essay draft", due Friday), once, when it's
 * made; after that the date is the task's own and can be changed on its own.
 */

const uid = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 16)

/** Open tasks: dated ones first (soonest first), then the rest, newest first. */
export function openTasks(tasks: Task[]): Task[] {
  const open = tasks.filter((t) => !t.done)
  const dated = open.filter((t) => t.due !== undefined).sort((a, b) => a.due! - b.due!)
  const rest = open.filter((t) => t.due === undefined).sort((a, b) => b.createdAt - a.createdAt)
  return [...dated, ...rest]
}

/** Checked-off tasks, the most recently done first. */
export const doneTasks = (tasks: Task[]) => tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt))

export function useOpenTasks(): Task[] {
  const tasks = useStore((s) => s.tasks)
  return useMemo(() => openTasks(tasks), [tasks])
}

/** A task as it would be made from a typed line: its name without the date words, and when it's due. */
export function readLine(line: string, now = new Date()): Pick<Task, 'title' | 'due' | 'allDay'> {
  const text = line.replace(/\s+/g, ' ').trim()
  const when = parseQuickEvent(text, now)
  if (!when || when.repeat) return { title: text }
  return { title: when.title || text, due: when.start.getTime(), allDay: when.allDay }
}

/** Make a task from a typed line. Returns it, or null for an empty line. */
export function addTask(line: string, extra: Partial<Pick<Task, 'docId' | 'notes'>> = {}): Task | null {
  if (!line.trim()) return null
  const now = Date.now()
  const t: Task = { id: uid(), done: false, createdAt: now, updatedAt: now, ...readLine(line), ...extra }
  useStore.setState((s) => ({ tasks: [t, ...s.tasks] }))
  return t
}

export function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) {
  useStore.setState((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }))
}

/** Remove a task. Returns it, for Undo. */
export function removeTask(id: string): Task | null {
  const t = useStore.getState().tasks.find((x) => x.id === id) ?? null
  if (t) useStore.setState((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) }))
  return t
}

/** Put a removed task back as it was (Undo). */
export const putTask = (t: Task) => useStore.setState((s) => ({ tasks: [t, ...s.tasks.filter((x) => x.id !== t.id)] }))

export const setTaskDone = (id: string, done: boolean) => updateTask(id, { done, doneAt: done ? Date.now() : undefined })

/** Done tasks stay 30 days (Recently Deleted lists them, to bring back), then go. */
const KEEP_DONE = 30 * 864e5
export function pruneDone(now = Date.now()) {
  const s = useStore.getState()
  const keep = s.tasks.filter((t) => !t.done || now - (t.doneAt ?? t.updatedAt) < KEEP_DONE)
  if (keep.length !== s.tasks.length) useStore.setState({ tasks: keep })
}

/** An open task by its words, for the assistant ("I finished the essay draft"). */
export function findOpenTask(words: string, tasks = useStore.getState().tasks): Task | undefined {
  const w = words.trim().toLowerCase()
  if (!w) return undefined
  const open = tasks.filter((t) => !t.done)
  return open.find((t) => t.title.toLowerCase() === w) ?? open.find((t) => t.title.toLowerCase().includes(w) || w.includes(t.title.toLowerCase()))
}

/** The task open for editing on the Tasks page. Home sets it to open one there. */
export const useTaskEdit = create<{ id: string | null }>(() => ({ id: null }))
export const editTask = (id: string | null) => useTaskEdit.setState({ id })

/** Mark a task done, with Undo. Shared by Home, Tasks, Calendar and ⌘K so all behave the same. */
export function completeTask(t: Pick<Task, 'id'>) {
  setTaskDone(t.id, true)
  if (useTaskEdit.getState().id === t.id) editTask(null)
  toast('Task done', { ms: 6000, action: { label: 'Undo', run: () => setTaskDone(t.id, false) } })
}

/** Delete a task, with Undo. */
export function deleteTask(t: Pick<Task, 'id'>) {
  const gone = removeTask(t.id)
  if (!gone) return
  if (useTaskEdit.getState().id === t.id) editTask(null)
  toast('Task deleted', { ms: 6000, action: { label: 'Undo', run: () => putTask(gone) } })
}

export type TaskGroup = 'overdue' | 'today' | 'week' | 'later' | 'someday'
export const GROUP_LABEL: Record<TaskGroup, string> = { overdue: 'Overdue', today: 'Today', week: 'Next 7 days', later: 'Later', someday: 'No date' }

export function taskGroup(t: Pick<Task, 'due' | 'allDay'>, now = new Date()): TaskGroup {
  if (t.due === undefined) return 'someday'
  const day = new Date(now).setHours(0, 0, 0, 0)
  // A timed task is overdue once the time passes; an all-day one when the day is over.
  if (t.allDay ? t.due < day : t.due < now.getTime()) return 'overdue'
  if (t.due < day + 864e5) return 'today'
  if (t.due < day + 8 * 864e5) return 'week'
  return 'later'
}

/** "Today", "Tomorrow", "Fri", "Nov 28", with the time when it has one. */
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
 * The one-time move to tasks of their own: open and done lines from the "Tasks" doc the app used to keep (where tasks
 * typed outside any doc went) become tasks. The lines leave that doc; if nothing else was in it, it goes to Recently
 * Deleted, where it can be restored. Checklists in every other doc stay where they are.
 */
export function fromInboxDoc<I extends { id: string; kind: string; title: string; content: string; deletedAt?: number; sourceId?: string; updatedAt: number }>(items: I[], now = Date.now()): { tasks: Task[]; items: I[] } {
  const inbox = items.find((i) => i.kind === 'doc' && !i.deletedAt && !i.sourceId && i.title.trim().toLowerCase() === 'tasks')
  if (!inbox || !inbox.content.includes('data-checked') || typeof document === 'undefined') return { tasks: [], items }
  const tpl = document.createElement('template')
  tpl.innerHTML = inbox.content
  const tasks: Task[] = []
  tpl.content.querySelectorAll('li[data-checked]').forEach((li, n) => {
    const own = li.cloneNode(true) as Element
    own.querySelectorAll('ul,ol').forEach((x) => x.remove())
    const line = (own.textContent || '').replace(/\s+/g, ' ').trim()
    if (!line) return
    const done = li.getAttribute('data-checked') === 'true'
    // Kept in the doc's order: earlier lines are newer (new tasks went on top).
    const at = inbox.updatedAt - n
    tasks.push({ id: `${inbox.id}-${n}`, done, createdAt: at, updatedAt: at, ...(done ? { title: line, doneAt: at } : readLine(line)) })
  })
  tpl.content.querySelectorAll('li[data-checked]').forEach((li) => li.remove())
  tpl.content.querySelectorAll('ul[data-type="taskList"]').forEach((ul) => !ul.children.length && ul.remove())
  const left = (tpl.content.textContent || '').trim() || tpl.content.querySelector('img,table,[data-type]')
  const next = { ...inbox, content: tpl.innerHTML, updatedAt: now, ...(left ? {} : { deletedAt: now }) }
  return { tasks, items: items.map((i) => (i.id === inbox.id ? next : i)) }
}
