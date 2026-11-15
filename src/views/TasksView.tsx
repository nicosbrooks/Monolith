import { ListChecks } from 'lucide-react'
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

/** One task: a checkbox, the task (opens its doc), and when it's due. */
export function TaskRow({ task, docTitle, group }: { task: Task; docTitle: string; group?: TaskGroup }) {
  const due = dueLabel(task)
  return (
    <div className="hm-row hm-task">
      <input type="checkbox" checked={false} aria-label={`Mark done: ${task.text}`} onChange={() => completeTask(task)} />
      <button className="hm-row-main" onClick={() => useStore.getState().open(task.itemId)} title="Open the doc">
        <span>{task.title}</span>
        <small>{docTitle}</small>
      </button>
      {due && <time className={`hm-due ${(group ?? taskGroup(task)) === 'overdue' ? 'late' : ''}`}>{due}</time>}
    </div>
  )
}

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

  return (
    <div className={`home page-scroll ${mobile ? 'p-screen' : ''}`} onScroll={mobile ? onScroll : undefined}>
      {mobile && <PhoneTitle title="Tasks" scrolled={scrolled} />}
      <div className="hm">
        <header className="hm-head">
          <h1>Tasks</h1>
          {ws.tasks.length > 0 && <p>{ws.tasks.length === 1 ? 'One thing to do' : `${ws.tasks.length} things to do`}, from {new Set(ws.tasks.map((t) => t.itemId)).size === 1 ? 'one doc' : `${new Set(ws.tasks.map((t) => t.itemId)).size} docs`}</p>}
        </header>
        {groups.map(({ g, tasks }) => (
          <section key={g} className="hm-sec" aria-labelledby={`tk-${g}`}>
            <div className="hm-label"><h2 id={`tk-${g}`}>{GROUP_LABEL[g]}</h2></div>
            <div className="hm-card hm-list">
              {tasks.map((t) => <TaskRow key={`${t.itemId}:${t.n}`} task={t} docTitle={titles.get(t.itemId) ?? 'Untitled'} group={g} />)}
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
