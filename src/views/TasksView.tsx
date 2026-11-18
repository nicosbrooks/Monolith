import { useState } from 'react'
import { ChevronRight, FileText, ListChecks, AudioWaveform, StickyNote } from 'lucide-react'
import { itemEmoji } from '../lib/util'
import type { Item } from '../types'
import { openDoc } from '../lib/panes'
import { useMobile, useScrolled } from '../lib/useMobile'
import { PhoneTitle } from '../components/Phone'
import { useStore } from '../store'
import { GROUP_LABEL, dueLabel, setTaskDone, taskGroup, useWorkspace, type Task, type TaskGroup } from '../lib/graph'
import { toast } from '../components/Toast'

const ORDER: TaskGroup[] = ['overdue', 'today', 'week', 'later', 'someday']

/** Mark a task done, with Undo. Shared by Home and Tasks so both behave the same. */
export function completeTask(t: Pick<Task, 'itemId' | 'n'>) {
  const before = setTaskDone(t, true)
  if (before === null) return
  toast('Task done', { ms: 6000, action: { label: 'Undo', run: () => useStore.getState().updateItem(t.itemId, { content: before }) } })
}

/** One task: a checkbox, the task (opens its doc), and when it's due. `docTitle` names the doc it's in; pass '' when the row above is from the same doc, so a list of
 *  tasks from one doc doesn't repeat its name on every line. */
export function TaskRow({ task, docTitle, group }: { task: Task; docTitle: string; group?: TaskGroup }) {
  const due = dueLabel(task)
  return (
    <div className="hm-row hm-task">
      <input type="checkbox" checked={false} aria-label={`Mark done: ${task.text}`} onChange={() => completeTask(task)} />
      <button className="hm-row-main" onClick={(e) => openDoc(task.itemId, e)} title="Open the doc">
        <span>{task.title}</span>
        {docTitle && <small>{docTitle}</small>}
      </button>
      {due && <time className={`hm-due ${(group ?? taskGroup(task)) === 'overdue' ? 'late' : ''}`}>{due}</time>}
    </div>
  )
}

const KindIcon = { note: StickyNote, doc: FileText, lecture: AudioWaveform }
const FOLDS_KEY = 'monolith-task-folds'

/** Which docs' task groups are folded, remembered in this browser. Shared by Home and Tasks. */
function useFolds(): [Set<string>, (id: string) => void] {
  const [folds, set] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(FOLDS_KEY) || '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const toggle = (id: string) => {
    const next = new Set(folds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set(next)
    try {
      localStorage.setItem(FOLDS_KEY, JSON.stringify([...next]))
    } catch {
      /* private window */
    }
  }
  return [folds, toggle]
}

/** Tasks bundled by the doc they're written in. Docs with the soonest due task come first; then the rest, most
 *  recently edited first. Within a doc, tasks keep their order (soonest first). */
export function groupByDoc(tasks: Task[], items: Item[]) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const groups = new Map<string, Task[]>()
  for (const t of tasks) groups.set(t.itemId, [...(groups.get(t.itemId) ?? []), t])
  return [...groups.entries()]
    .map(([id, ts]) => ({ item: byId.get(id), id, tasks: ts, due: Math.min(...ts.map((t) => t.due ?? Infinity)) }))
    .sort((a, b) => a.due - b.due || (b.item?.updatedAt ?? 0) - (a.item?.updatedAt ?? 0))
}

/**
 * Each doc's tasks under its name. The name opens the doc; the chevron folds its tasks away (remembered), so a doc
 * with forty checkboxes doesn't bury the others. `cards` puts each doc in its own card (the Tasks page); without it
 * the groups sit in one list (Home's panel).
 */
export function TasksByDoc({ tasks, cards }: { tasks: Task[]; cards?: boolean }) {
  const items = useStore((s) => s.items)
  const [folds, toggle] = useFolds()
  return (
    <>
      {groupByDoc(tasks, items).map(({ id, item, tasks: ts }) => {
        const Icon = KindIcon[item?.kind ?? 'doc']
        const folded = folds.has(id)
        const late = ts.filter((t) => taskGroup(t) === 'overdue').length
        const body = (
          <>
            <div className={`tk-doc ${folded ? 'folded' : ''}`}>
              <button className="tk-fold" onClick={() => toggle(id)} aria-expanded={!folded} aria-label={`${folded ? 'Show' : 'Hide'} tasks in ${item?.title || 'Untitled'}`}>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
              <button className="tk-doc-name" onClick={(e) => openDoc(id, e)} title="Open the doc">
                <span className="tk-doc-ico">{(item && itemEmoji(item)) || <Icon size={14} strokeWidth={1.8} />}</span>
                <span className="tk-doc-title">{item?.title || 'Untitled'}</span>
              </button>
              <span className="tk-doc-count">{late ? <b>{late} late · </b> : null}{ts.length}</span>
            </div>
            {!folded && ts.map((t) => <TaskRow key={`${t.itemId}:${t.n}`} task={t} docTitle="" />)}
          </>
        )
        return cards ? (
          <section key={id} className="hm-card hm-list tk-group">{body}</section>
        ) : (
          <div key={id} className="tk-group">{body}</div>
        )
      })}
    </>
  )
}

const VIEW_KEY = 'monolith-tasks-view'

/**
 * Every open checklist line from every doc, in one place, grouped by when it's due. Tasks aren't a separate kind of
 * thing: each lives in the doc it was written in, and checking it here checks it there.
 */
export function TasksView() {
  const ws = useWorkspace()
  const items = useStore((s) => s.items)
  const mobile = useMobile()
  const [scrolled, onScroll] = useScrolled()
  const titles = new Map(items.map((i) => [i.id, i.title || 'Untitled']))
  const now = new Date()
  const groups = ORDER.map((g) => ({ g, tasks: ws.tasks.filter((t) => taskGroup(t, now) === g) })).filter((x) => x.tasks.length)
  // By doc (the default) or by date; remembered in this browser.
  const [view, setViewState] = useState<'doc' | 'date'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'date' ? 'date' : 'doc'
    } catch {
      return 'doc'
    }
  })
  const setView = (v: 'doc' | 'date') => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private window */
    }
  }

  return (
    <div className={`home page-scroll ${mobile ? 'p-screen' : ''}`} onScroll={mobile ? onScroll : undefined}>
      {mobile && <PhoneTitle title="Tasks" scrolled={scrolled} />}
      <div className="hm">
        <header className="hm-head">
          {!mobile && <h1>Tasks</h1>}
          {ws.tasks.length > 0 && <p>{ws.tasks.length === 1 ? 'One thing to do' : `${ws.tasks.length} things to do`}, from {new Set(ws.tasks.map((t) => t.itemId)).size === 1 ? 'one doc' : `${new Set(ws.tasks.map((t) => t.itemId)).size} docs`}</p>}
          {ws.tasks.length > 0 && (
            <div className="hm-quick">
              <div className="seg" role="group" aria-label="Group tasks">
                <button className={view === 'doc' ? 'on' : ''} aria-pressed={view === 'doc'} onClick={() => setView('doc')}>By doc</button>
                <button className={view === 'date' ? 'on' : ''} aria-pressed={view === 'date'} onClick={() => setView('date')}>By date</button>
              </div>
            </div>
          )}
        </header>
        {view === 'doc' && ws.tasks.length > 0 && <div className="tk-docs"><TasksByDoc tasks={ws.tasks} cards /></div>}
        {view === 'date' && groups.map(({ g, tasks }) => (
          <section key={g} className="hm-sec" aria-labelledby={`tk-${g}`}>
            <div className="hm-label"><h2 id={`tk-${g}`}>{GROUP_LABEL[g]}</h2></div>
            <div className="hm-card hm-list">
              {tasks.map((t, i) => <TaskRow key={`${t.itemId}:${t.n}`} task={t} docTitle={i > 0 && tasks[i - 1].itemId === t.itemId ? '' : titles.get(t.itemId) ?? 'Untitled'} group={g} />)}
            </div>
          </section>
        ))}
        {!groups.length && (
          <div className="blank tk-blank">
            <span className="blank-ico"><ListChecks size={22} strokeWidth={1.7} /></span>
            <b>Nothing to do</b>
            <p>Checklist lines from all your docs gather here, with their dates. Type one below to start a list.</p>
          </div>
        )}
      </div>
    </div>
  )
}
