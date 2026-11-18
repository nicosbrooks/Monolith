import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FileText, ListChecks, Trash2, X } from 'lucide-react'
import { itemEmoji } from '../lib/util'
import { openDoc } from '../lib/panes'
import { useMobile, useScrolled } from '../lib/useMobile'
import { PhoneTitle } from '../components/Phone'
import { useStore } from '../store'
import { GROUP_LABEL, completeTask, deleteTask, doneTasks, dueLabel, editTask, openTasks, setTaskDone, taskGroup, updateTask, useTaskEdit, type Task, type TaskGroup } from '../lib/tasks'

const ORDER: TaskGroup[] = ['overdue', 'today', 'week', 'later', 'someday']

/** The doc a task belongs with, as a small link on its row. Opens beside the page. */
function DocChip({ id }: { id: string }) {
  const item = useStore((s) => s.items.find((i) => i.id === id && !i.deletedAt))
  if (!item) return null
  return (
    <button className="tk-doc-chip" onClick={(e) => (e.stopPropagation(), openDoc(id, e))} title={`Open ${item.title || 'Untitled'}`}>
      <span aria-hidden="true">{itemEmoji(item) || <FileText size={12} strokeWidth={1.8} />}</span>
      <span>{item.title || 'Untitled'}</span>
    </button>
  )
}

/**
 * One task: a checkbox, its name and when it's due, and the doc it belongs with if it has one. Clicking the name
 * opens it for editing (on the Tasks page, in place; elsewhere it takes you there).
 */
export function TaskRow({ task, group }: { task: Task; group?: TaskGroup }) {
  const due = dueLabel(task)
  const editing = useTaskEdit((s) => s.id === task.id)
  const onTasks = useStore((s) => s.section === 'tasks')
  const open = () => {
    if (!onTasks) useStore.getState().go('tasks')
    editTask(editing && onTasks ? null : task.id)
  }
  return (
    <>
      <div className={`hm-row hm-task ${task.done ? 'done' : ''} ${editing && onTasks ? 'editing' : ''}`}>
        <input type="checkbox" checked={task.done} aria-label={`${task.done ? 'Not done' : 'Mark done'}: ${task.title}`} onChange={() => (task.done ? setTaskDone(task.id, false) : completeTask(task))} />
        {editing && onTasks ? (
          <TitleField task={task} />
        ) : (
          <button className="hm-row-main" onClick={open} aria-expanded={onTasks ? editing : undefined} title="Edit task">
            <span>{task.title || 'Untitled task'}</span>
          </button>
        )}
        {task.docId && <DocChip id={task.docId} />}
        {due && !task.done && <time className={`hm-due ${(group ?? taskGroup(task)) === 'overdue' ? 'late' : ''}`}>{due}</time>}
      </div>
      {editing && onTasks && <TaskEditor task={task} />}
    </>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const timeInput = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

/** While a task is open, its name on the row is a text field. Enter or Esc closes it. */
function TitleField({ task }: { task: Task }) {
  const [title, setTitle] = useState(task.title)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <input
      ref={ref}
      className="tk-edit-title"
      value={title}
      aria-label="Task"
      placeholder="Task"
      onChange={(e) => (setTitle(e.target.value), updateTask(task.id, { title: e.target.value }))}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.preventDefault(), editTask(null))}
    />
  )
}

/** A task opened in place, under its row: when it's due, notes, the doc it goes with, and Delete. Saves as you go. */
function TaskEditor({ task }: { task: Task }) {
  const items = useStore((s) => s.items)
  const docs = useMemo(() => items.filter((i) => !i.deletedAt && !i.file?.dir).sort((a, b) => b.updatedAt - a.updatedAt), [items])
  const setDue = (day: string, time: string) => {
    if (!day) return updateTask(task.id, { due: undefined, allDay: undefined })
    const [y, m, d] = day.split('-').map(Number)
    const [h, min] = time ? time.split(':').map(Number) : [0, 0]
    updateTask(task.id, { due: new Date(y, m - 1, d, h, min).getTime(), allDay: !time })
  }
  const day = task.due !== undefined ? dayInput(task.due) : ''
  const time = task.due !== undefined && !task.allDay ? timeInput(task.due) : ''
  const close = () => editTask(null)
  return (
    <div className="tk-edit" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}>
      <div className="tk-edit-row">
        <label>
          <span>Due</span>
          <input type="date" value={day} onChange={(e) => setDue(e.target.value, time)} />
        </label>
        {day && (
          <label>
            <span>Time</span>
            <input type="time" value={time} onChange={(e) => setDue(day, e.target.value)} />
          </label>
        )}
        {day && <button className="tk-edit-clear" onClick={() => setDue('', '')} title="No due date" aria-label="Clear due date"><X size={13} /></button>}
        <label className="tk-edit-doc">
          <span>Doc</span>
          <select value={task.docId ?? ''} onChange={(e) => updateTask(task.id, { docId: e.target.value || undefined })}>
            <option value="">None</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.title || 'Untitled'}</option>)}
          </select>
        </label>
      </div>
      <textarea className="tk-edit-notes" value={task.notes ?? ''} placeholder="Notes" aria-label="Notes" rows={2} onChange={(e) => updateTask(task.id, { notes: e.target.value || undefined })} />
      <div className="tk-edit-foot">
        <button className="tk-edit-del" onClick={() => deleteTask(task)}><Trash2 size={14} /> Delete</button>
        <button className="btn sm" onClick={close}>Done</button>
      </div>
    </div>
  )
}

const DONE_KEY = 'monolith-tasks-done-open'

/**
 * Tasks: a list of its own. Grouped by when each is due; typed in the Ask bar ("essay draft by Friday"). A task can
 * name a doc it belongs with, but a checklist in a doc stays in that doc. Checked-off tasks fold away at the bottom
 * for 30 days, where they can be unchecked.
 */
export function TasksView() {
  const tasks = useStore((s) => s.tasks)
  const mobile = useMobile()
  const [scrolled, onScroll] = useScrolled()
  const open = useMemo(() => openTasks(tasks), [tasks])
  const done = useMemo(() => doneTasks(tasks), [tasks])
  const now = new Date()
  const groups = ORDER.map((g) => ({ g, tasks: open.filter((t) => taskGroup(t, now) === g) })).filter((x) => x.tasks.length)
  const [showDone, setShowDone] = useState(() => {
    try {
      return localStorage.getItem(DONE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleDone = () => {
    setShowDone(!showDone)
    try {
      localStorage.setItem(DONE_KEY, showDone ? '0' : '1')
    } catch {
      /* private window */
    }
  }
  // Leaving the page closes the one being edited.
  useEffect(() => () => editTask(null), [])
  const late = groups.find((x) => x.g === 'overdue')?.tasks.length ?? 0

  return (
    <div className={`home page-scroll ${mobile ? 'p-screen' : ''}`} onScroll={mobile ? onScroll : undefined}>
      {mobile && <PhoneTitle title="Tasks" scrolled={scrolled} />}
      <div className="hm tk-page">
        <header className="hm-head">
          {!mobile && <h1>Tasks</h1>}
          <p>{open.length ? `${open.length === 1 ? 'One thing' : `${open.length} things`} to do${late ? `, ${late} late` : ''}` : 'Nothing to do'}</p>
        </header>
        {groups.map(({ g, tasks }) => (
          <section key={g} className="hm-sec" aria-labelledby={`tk-${g}`}>
            <div className="hm-label"><h2 id={`tk-${g}`}>{GROUP_LABEL[g]}</h2></div>
            <div className="hm-card hm-list">
              {tasks.map((t) => <TaskRow key={t.id} task={t} group={g} />)}
            </div>
          </section>
        ))}
        {!groups.length && (
          <div className="blank tk-blank">
            <span className="blank-ico"><ListChecks size={22} strokeWidth={1.7} /></span>
            <b>Nothing to do</b>
            <p>Type a task in the bar below. Put a date in it (“essay draft by Friday”) and it’s sorted by when it’s due.</p>
          </div>
        )}
        {done.length > 0 && (
          <section className="hm-sec tk-done" aria-label="Done">
            <button className="tk-done-head" onClick={toggleDone} aria-expanded={showDone}>
              <ChevronRight size={14} aria-hidden="true" />
              Done <small>{done.length}</small>
            </button>
            {showDone && <div className="hm-card hm-list">{done.map((t) => <TaskRow key={t.id} task={t} />)}</div>}
          </section>
        )}
      </div>
    </div>
  )
}
