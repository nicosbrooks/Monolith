import { useStore, type Completion } from '../store'
import { readWorkspace, removeTask, setTaskDone, type Task } from './graph'

/**
 * Completed checklist lines, for Recently Deleted. A checked line stays in its doc (it's still part of what was
 * written), so nothing is lost; this only remembers *when* each was checked, wherever it happened (the editor, Home,
 * Tasks, ⌘K, the assistant), so Recently Deleted can list them newest first and put any of them back.
 */

const KEEP = 30 * 864e5
const MAX = 300
const key = (c: Pick<Completion, 'itemId' | 'text'>) => `${c.itemId}\u0000${c.text}`

/** The checked lines in each doc, by their words. */
function doneIn(items: ReturnType<typeof useStore.getState>['items']) {
  const out = new Map<string, Set<string>>()
  for (const t of readWorkspace(items).done) {
    const set = out.get(t.itemId) ?? new Set<string>()
    set.add(t.text)
    out.set(t.itemId, set)
  }
  return out
}

let started = false
/** Start watching for lines being checked and unchecked. */
export function startCompleted() {
  if (started) return
  started = true
  let before = doneIn(useStore.getState().items)
  let timer = 0
  useStore.subscribe((s, prev) => {
    if (s.items === prev.items) return
    // After typing settles: reading every doc on each keystroke would be wasted work.
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      const now = doneIn(useStore.getState().items)
      const at = Date.now()
      const added: Completion[] = []
      const gone = new Set<string>()
      for (const [itemId, lines] of now) for (const text of lines) if (!before.get(itemId)?.has(text)) added.push({ itemId, text, at })
      for (const [itemId, lines] of before) for (const text of lines) if (!now.get(itemId)?.has(text)) gone.add(key({ itemId, text }))
      before = now
      if (!added.length && !gone.size) return
      const fresh = new Set(added.map(key))
      useStore.setState((st) => ({
        completed: [...added, ...(st.completed ?? []).filter((c) => !gone.has(key(c)) && !fresh.has(key(c)) && at - c.at < KEEP)].slice(0, MAX),
      }))
    }, 500)
  })
}

export interface CompletedTask extends Task {
  /** When it was checked off, if this browser saw it happen. */
  at?: number
}

/** Checked lines still checked in their docs, the ones checked most recently first. */
export function completedTasks(items = useStore.getState().items, log = useStore.getState().completed ?? []): CompletedTask[] {
  const when = new Map(log.map((c) => [key(c), c.at]))
  const live = new Set(items.filter((i) => !i.deletedAt).map((i) => i.id))
  return readWorkspace(items)
    .done.filter((t) => live.has(t.itemId))
    .map((t) => ({ ...t, at: when.get(key(t)) }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/** Uncheck it, so it's an open task again. Returns the doc's text from before, for Undo. */
export const restoreTask = (t: Pick<Task, 'itemId' | 'n'>) => setTaskDone(t, false)

/** Take the line out of its doc altogether. */
export function deleteTask(t: Pick<Task, 'itemId' | 'n'>) {
  const before = useStore.getState().items.find((i) => i.id === t.itemId)?.content ?? null
  removeTask(t)
  return before
}
