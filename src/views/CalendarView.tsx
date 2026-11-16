import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek, differenceInMinutes, addMinutes,
} from 'date-fns'
import { ChevronLeft, ChevronRight, MapPin, Plus, Trash2, X, StickyNote, Mic, Layers, Eye, EyeOff, Loader2, Link2, CircleAlert, AudioWaveform, Repeat as RepeatIcon } from 'lucide-react'
import { importFile, refreshStale, subscribe, unsubscribe, updateSub, useCalendars, useSubEvents } from '../lib/calendars'
import { openMenu } from '../components/Overlays'
import { toast } from '../components/Toast'
import { useMobile } from '../lib/useMobile'
import { animate, motion, AnimatePresence, useMotionValue, useReducedMotion } from 'motion/react'
import { listenForSwipes, swipeEdge, type SwipeDirection } from '../lib/swipe'
import { useStore } from '../store'
import type { CalEvent } from '../types'
import { COLORS } from '../lib/colors'
import { REPEATS, expandEvents, occurrenceId, occurrenceOf } from '../lib/repeat'
import { useWorkspace, type Task } from '../lib/graph'
import { completeTask } from './TasksView'

const HOUR = 52 // px per hour
const SNAP = 15
type CalendarPosition = { start: number | null; cursor: number; mode: 'week' | 'month' }

export function CalendarView({ initialDate }: { initialDate: number | null }) {
  const own = useStore((s) => s.events)
  const subEvents = useSubEvents()
  const [showCals, setShowCals] = useState(false)
  const [dir, setDir] = useState(0)
  useEffect(() => {
    refreshStale()
    const i = setInterval(refreshStale, 5 * 60_000)
    return () => clearInterval(i)
  }, [])
  const [position] = useState<CalendarPosition | undefined>(() => history.state?.calendarPosition?.start === initialDate ? history.state.calendarPosition : undefined)
  const [mode, setMode] = useState<CalendarPosition['mode']>(position?.mode ?? 'week')
  const [cursor, setCursor] = useState(() => new Date(position?.cursor ?? initialDate ?? Date.now()))
  const [editing, setEditing] = useState<string | null>(null)
  // Repeating events are laid out for the months around what's on screen.
  const month = startOfMonth(cursor).getTime()
  const events = useMemo(() => [...expandEvents(own, month - 45 * 864e5, month + 80 * 864e5), ...subEvents], [own, subEvents, month])
  // Tasks with a date sit on their day, above the events.
  const ws = useWorkspace()
  const tasks = useMemo(() => ws.tasks.filter((t) => t.due !== undefined), [ws])
  const body = useRef<HTMLDivElement>(null)
  const offset = useMotionValue(0)
  const settle = useRef<ReturnType<typeof animate> | null>(null)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    if (history.state?.monolith?.route.section !== 'calendar') return
    history.replaceState({ ...history.state, calendarPosition: { start: initialDate, cursor: cursor.getTime(), mode } satisfies CalendarPosition }, '')
  }, [cursor, mode, initialDate])

  // Phones show 3 days at a time instead of a full week.
  const narrow = useMobile()
  const step = (d: SwipeDirection) => (setDir(d), setCursor((c) => (mode === 'week' ? (narrow ? addDays(c, d * 3) : addWeeks(c, d)) : addMonths(c, d))))
  const gesture = useRef({ step, editing, showCals, reducedMotion })
  useEffect(() => { gesture.current = { step, editing, showCals, reducedMotion } })
  useEffect(() => {
    if (!body.current) return
    const stop = listenForSwipes(body.current, (_event, edge) => {
      if (edge !== null || gesture.current.editing || gesture.current.showCals) return
      return {
        step: (d) => gesture.current.step(d),
        preview: (x) => {
          if (gesture.current.reducedMotion) return
          settle.current?.stop()
          if (x === 0) settle.current = animate(offset, 0, { duration: 0.2, ease: 'easeOut' })
          else offset.set(x)
        },
      }
    })
    return () => { stop(); settle.current?.stop() }
  }, [offset])
  const edit = (id: string) => setEditing(id)
  const today = () => (setDir(0), setCursor(new Date()))
  const changeMode = (next: CalendarPosition['mode']) => (setDir(0), setMode(next))

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || editing || showCals || (e.target as HTMLElement).closest('input,textarea,[contenteditable],.overlay')) return
      if (e.key === 't') today()
      if (e.key === 'w') changeMode('week')
      if (e.key === 'm') changeMode('month')
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })



  return (
    <div className="calendar">
      <header className="cal-head">
        <h2>
          {format(cursor, 'MMMM')} <span className="muted">{format(cursor, 'yyyy')}</span>
        </h2>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label={mode === 'month' ? 'Previous month' : narrow ? 'Previous three days' : 'Previous week'}><ChevronLeft size={18} /></button>
          <button className="btn sm" onClick={today}>Today</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label={mode === 'month' ? 'Next month' : narrow ? 'Next three days' : 'Next week'}><ChevronRight size={18} /></button>
        </div>
        <span className="grow" />
        <div className="cal-pick">
          <button className="btn sm" onClick={() => setShowCals(!showCals)} aria-expanded={showCals}><Layers size={14} /> Calendars</button>
          <AnimatePresence>{showCals && <CalendarsPanel onClose={() => setShowCals(false)} />}</AnimatePresence>
        </div>
        <div className="seg">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => changeMode('week')}>Week</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => changeMode('month')}>Month</button>
        </div>
      </header>
      <div ref={body} className="cal-body">
        <motion.div className="cal-track" style={{ x: offset }}>
          <AnimatePresence initial={false} custom={dir}>
            <motion.div key={`${mode}-${cursor.toDateString()}`} className="cal-slide" custom={dir} variants={{ enter: (d: number) => ({ x: reducedMotion ? 0 : d * 86, opacity: reducedMotion ? 1 : 0 }), center: { x: 0, opacity: 1 }, leave: (d: number) => ({ x: reducedMotion ? 0 : -d * 72, opacity: 0 }) }} initial="enter" animate="center" exit="leave" transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.2, 0.7, 0.3, 1] }}>
              {mode === 'week' ? <Week cursor={cursor} events={events} tasks={tasks} onEdit={edit} span={narrow ? 3 : 7} /> : <Month cursor={cursor} events={events} tasks={tasks} onEdit={edit} onPickDay={(d) => (setDir(0), setCursor(d), setMode('week'))} />}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
      <AnimatePresence>
        {editing && (subEvents.some((e) => e.id === editing) ? <SubEventSheet ev={subEvents.find((e) => e.id === editing)!} onClose={() => setEditing(null)} /> : <EventEditor id={editing} onRetarget={setEditing} onClose={() => setEditing(null)} />)}
      </AnimatePresence>
    </div>
  )
}

function Week({ cursor, events, tasks, onEdit, span }: { cursor: Date; events: CalEvent[]; tasks: Task[]; onEdit: (id: string) => void; span: number }) {
  const st = useStore.getState()
  const days = span === 7 ? eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) }) : eachDayOfInterval({ start: startOfDay(cursor), end: addDays(startOfDay(cursor), span - 1) })
  const scroller = useRef<HTMLDivElement>(null)
  const cols = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<null | { id?: string; mode: 'new' | 'move' | 'resize'; day: number; a: number; b: number; offset?: number; moved?: boolean }>(null)
  const [now, setNow] = useState(new Date())
  const dragRef = useRef(drag)
  dragRef.current = drag
  const touch = useRef<{ id: number; x: number; y: number } | null>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: HOUR * 7.5 })
    const i = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(i)
  }, [])

  const minsAt = (e: React.PointerEvent | PointerEvent) => {
    const r = cols.current!.getBoundingClientRect()
    const y = e.clientY - r.top
    return Math.max(0, Math.min(24 * 60, Math.round(((y / HOUR) * 60) / SNAP) * SNAP))
  }
  const dayAt = (e: React.PointerEvent | PointerEvent) => {
    const r = cols.current!.getBoundingClientRect()
    return Math.max(0, Math.min(days.length - 1, Math.floor(((e.clientX - r.left) / r.width) * days.length)))
  }
  const startTouch = (event: React.PointerEvent) => {
    touch.current = event.isPrimary && swipeEdge(event.clientX) === null ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null
  }
  const tapped = (event: React.PointerEvent) => {
    const start = touch.current
    touch.current = null
    return start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10
  }
  const createEvent = (day: number, a: number, b: number) => {
    const base = days[day]
    const ev = st.addEvent({ title: '', start: addMinutes(base, a).getTime(), end: addMinutes(base, b - a < SNAP ? a + 60 : b).getTime(), color: 'blue' })
    setTimeout(() => onEdit(ev.id))
  }

  useEffect(() => {
    if (!drag) return
    const mv = (e: PointerEvent) => {
      const m = minsAt(e)
      setDrag((d) => {
        if (!d) return d
        if (d.mode === 'new') return { ...d, b: m, moved: true }
        if (d.mode === 'resize') return { ...d, b: Math.max(d.a + SNAP, m), moved: true }
        const len = d.b - d.a
        const a = Math.max(0, Math.min(24 * 60 - len, m - (d.offset || 0)))
        return { ...d, a, b: a + len, day: dayAt(e), moved: true }
      })
    }
    const up = () => {
      const d = dragRef.current
      setDrag(null)
      {
        if (!d) return
        const base = startOfDay(days[d.day])
        const [a, b] = d.mode === 'new' ? [Math.min(d.a, d.b), Math.max(d.a, d.b)] : [d.a, d.b]
        if (d.mode === 'new') {
          createEvent(d.day, a, b)
        } else if (d.id && d.moved) {
          const to = { start: addMinutes(base, a).getTime(), end: addMinutes(base, b).getTime() }
          if (occurrenceOf(d.id)) {
            // Dragging one date of a repeating event moves that date only; the editor changes them all.
            const before = useStore.getState().events
            st.detachEvent(d.id, to)
            toast('Moved this one. The others stay.', { ms: 6000, action: { label: 'Undo', run: () => useStore.setState({ events: before }) } })
          } else st.updateEvent(d.id, to)
        } else if (d.id) onEdit(d.id)
      }
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
    const cancel = () => setDrag(null)
    window.addEventListener('pointercancel', cancel)
    return () => (window.removeEventListener('pointermove', mv), window.removeEventListener('pointerup', up), window.removeEventListener('pointercancel', cancel))
  }, [drag?.mode, drag?.id]) // eslint-disable-line

  const allDay = (d: Date) => events.filter((e) => e.allDay && e.start <= addDays(d, 1).getTime() - 1 && e.end > d.getTime())

  // lay out overlapping events side by side
  const layout = (d: Date) => {
    const list = events.filter((e) => !e.allDay && isSameDay(e.start, d) && e.id !== drag?.id).sort((a, b) => a.start - b.start || b.end - a.end)
    const out: { e: CalEvent; col: number; cols: number }[] = []
    let cluster: typeof out = []
    let clusterEnd = 0
    const flush = () => {
      const n = Math.max(...cluster.map((c) => c.col)) + 1
      cluster.forEach((c) => (c.cols = n))
      out.push(...cluster)
      cluster = []
    }
    for (const e of list) {
      if (cluster.length && e.start >= clusterEnd) flush()
      const used = new Set(cluster.filter((c) => c.e.end > e.start).map((c) => c.col))
      let col = 0
      while (used.has(col)) col++
      cluster.push({ e, col, cols: 1 })
      clusterEnd = Math.max(clusterEnd, e.end)
    }
    if (cluster.length) flush()
    return out
  }

  return (
    <div className="week" style={{ '--n': days.length } as React.CSSProperties}>
      <div className="week-days">
        <div className="gutter" />
        {days.map((d) => {
          const today = isToday(d)
          const selected = isSameDay(d, cursor)
          return (
            <div key={d.getTime()} className={`wd${today ? ' today' : ''}${selected ? ' selected' : ''}`} role="heading" aria-level={3} aria-label={`${format(d, 'EEEE, MMMM d')}${selected ? ', selected' : ''}`} aria-current={today ? 'date' : undefined}>
              <small aria-hidden="true">{format(d, 'EEE')}</small>
              <b aria-hidden="true">{format(d, 'd')}</b>
            </div>
          )
        })}
      </div>
      <div className="week-allday">
        <div className="gutter"><small>all-day</small></div>
        {days.map((d) => (
          <div key={d.toISOString()} className="ad">
            {allDay(d).map((e) => (
              <button key={e.id} className="chip" style={{ '--c': COLORS[e.color] } as React.CSSProperties} onClick={() => onEdit(e.id)} onContextMenu={(ce) => colorMenu(ce, e)}>{e.title || 'Untitled'}</button>
            ))}
            {tasks.filter((t) => isSameDay(t.due!, d)).map((t) => <TaskChip key={`${t.itemId}:${t.n}`} task={t} />)}
          </div>
        ))}
      </div>
      <div className="week-scroll" ref={scroller} tabIndex={0} aria-label="Week">
        <div className="week-grid" style={{ height: HOUR * 24 }}>
          <div className="gutter hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR }}>{h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}</span>
            ))}
          </div>
          <div className="cols" ref={cols}>
            {days.map((d, di) => (
              <div
                key={d.toISOString()}
                className={`col ${isToday(d) ? 'today' : ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0 || (e.target as HTMLElement).closest('.ev')) return
                  if (e.pointerType === 'touch') return startTouch(e)
                  const m = minsAt(e)
                  setDrag({ mode: 'new', day: di, a: m, b: m + 60 })
                }}
                onPointerUp={(e) => { if (e.pointerType === 'touch' && tapped(e)) createEvent(di, minsAt(e), minsAt(e) + 60) }}
                onPointerCancel={() => { touch.current = null }}
              >
                {layout(d).map(({ e, col, cols }) => {
                  const top = (differenceInMinutes(e.start, startOfDay(d)) / 60) * HOUR
                  const h = Math.max(18, (differenceInMinutes(e.end, e.start) / 60) * HOUR - 2)
                  return (
                    <div
                      key={e.id}
                      className={`ev ${h < 36 ? 'tiny' : ''}`}
                      style={{ top, height: h, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, '--c': COLORS[e.color] } as React.CSSProperties}
                      onContextMenu={(ce) => colorMenu(ce, e)}
                      onClick={(ce) => { if (e.calId && !(ce.nativeEvent instanceof PointerEvent && ce.nativeEvent.pointerType === 'touch')) onEdit(e.id) }}
                      onPointerDown={(pe) => {
                        pe.stopPropagation()
                        if (pe.pointerType === 'touch') return startTouch(pe)
                        if (e.calId) return
                        const a = differenceInMinutes(e.start, startOfDay(d))
                        const b = differenceInMinutes(e.end, startOfDay(d))
                        const resize = (pe.target as HTMLElement).classList.contains('rz')
                        setDrag({ id: e.id, mode: resize ? 'resize' : 'move', day: di, a, b, offset: minsAt(pe) - a })
                      }}
                      onPointerUp={(pe) => {
                        if (pe.pointerType !== 'touch') return
                        pe.stopPropagation()
                        if (tapped(pe)) onEdit(e.id)
                      }}
                    >
                      <b>{e.title || 'New event'}</b>
                      <small>{e.repeat && <RepeatIcon size={10} aria-label="Repeats" />}{format(e.start, 'h:mm')} – {format(e.end, 'h:mm a')}{e.location ? ` · ${e.location}` : ''}</small>
                      <i className="rz" />
                    </div>
                  )
                })}
                {drag && drag.day === di && (
                  <div
                    className="ev ghost"
                    style={{
                      top: (Math.min(drag.a, drag.b) / 60) * HOUR,
                      height: Math.max(18, (Math.abs(drag.b - drag.a) / 60) * HOUR - 2),
                      '--c': COLORS[events.find((x) => x.id === drag.id)?.color || 'blue'],
                    } as React.CSSProperties}
                  >
                    <b>{events.find((x) => x.id === drag.id)?.title || 'New event'}</b>
                    <small>{format(addMinutes(startOfDay(d), Math.min(drag.a, drag.b)), 'h:mm')} – {format(addMinutes(startOfDay(d), Math.max(drag.a, drag.b)), 'h:mm a')}</small>
                  </div>
                )}
                {isToday(d) && <div className="now-line" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR }} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Month({ cursor, events, tasks, onEdit, onPickDay }: { cursor: Date; events: CalEvent[]; tasks: Task[]; onEdit: (id: string) => void; onPickDay: (d: Date) => void }) {
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor)), end: endOfWeek(endOfMonth(cursor)) })
  const st = useStore.getState()
  return (
    <div className="month">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="mh">{d}</div>)}
      {days.map((d) => {
        const evs = events.filter((e) => (e.allDay ? e.start < addDays(d, 1).getTime() && e.end > d.getTime() : isSameDay(e.start, d))).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
        return (
          <div
            key={d.toISOString()}
            className={`md ${isSameMonth(d, cursor) ? '' : 'out'} ${isToday(d) ? 'today' : ''}`}
            onDoubleClick={() => {
              const ev = st.addEvent({ title: '', start: d.getTime(), end: addDays(d, 1).getTime(), allDay: true, color: 'blue' })
              onEdit(ev.id)
            }}
          >
            <button className="num" onClick={() => onPickDay(d)}>{format(d, 'd')}</button>
            {tasks.filter((t) => isSameDay(t.due!, d)).slice(0, 2).map((t) => <TaskChip key={`${t.itemId}:${t.n}`} task={t} month />)}
            {evs.slice(0, 4).map((e) => (
              <button key={e.id} className={`mev ${e.allDay ? 'all' : ''}`} style={{ '--c': COLORS[e.color] } as React.CSSProperties} onClick={() => onEdit(e.id)} onContextMenu={(ce) => colorMenu(ce, e)}>
                {!e.allDay && <i />}
                <span>{e.title || 'Untitled'}</span>
                {!e.allDay && <small>{format(e.start, 'h:mma').toLowerCase().replace(':00', '')}</small>}
              </button>
            ))}
            {evs.length > 4 && <small className="more">+{evs.length - 4} more</small>}
          </div>
        )
      })}
    </div>
  )
}

/** A task with a date, on its day: the box checks it off, the words open its doc. */
function TaskChip({ task, month }: { task: Task; month?: boolean }) {
  return (
    <span className={`chip task ${month ? 'in-month' : ''}`}>
      <button className="box" aria-label={`Mark done: ${task.title}`} title="Mark done" onClick={(e) => (e.stopPropagation(), completeTask(task))} />
      <button className="txt" title="Open the doc" onClick={(e) => (e.stopPropagation(), useStore.getState().open(task.itemId))}>{task.title}</button>
    </span>
  )
}

function EventEditor({ id, onClose, onRetarget }: { id: string; onClose: () => void; onRetarget: (id: string) => void }) {
  const occ = occurrenceOf(id)
  const stored = useStore((s) => s.events.find((e) => e.id === (occ ? occ.seriesId : id)))
  // One date of a repeating event: the series' details, at this date's time.
  const ev = stored && occ ? { ...stored, start: occ.start, end: occ.start + (stored.end - stored.start) } : stored
  const items = useStore((s) => s.items)
  const st = useStore.getState()
  const linked = useMemo(() => items.find((i) => i.id === ev?.linkedItemId && !i.deletedAt), [items, ev?.linkedItemId])
  if (!ev) return null
  const up = (p: Partial<CalEvent>) => {
    st.updateEvent(id, p)
    // A new time moves the whole series, so this date has a new id.
    if (occ && p.start !== undefined && p.start !== occ.start) onRetarget(occurrenceId(occ.seriesId, p.start))
  }
  const setRepeat = (every: string) => {
    if (every) return up({ repeat: { every: every as NonNullable<CalEvent['repeat']>['every'], until: ev.repeat?.until } })
    // No longer repeating: what's left is the date being looked at.
    st.updateEvent(ev.id, { repeat: undefined, skip: undefined, start: ev.start, end: ev.end })
    onRetarget(ev.id)
  }
  const toLocal = (t: number) => format(t, ev.allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm")
  const close = () => {
    if (!ev.title.trim()) up({ title: 'New event' })
    onClose()
  }
  const del = (which: string, said: string) => {
    const before = st.events
    st.deleteEvent(which)
    onClose()
    toast(said, { ms: 6000, action: { label: 'Undo', run: () => useStore.setState({ events: before }) } })
  }
  const link = (kind: 'doc' | 'lecture') => {
    const it = st.createItem(kind, kind === 'doc' ? { title: ev.title, content: `<p>${format(ev.start, 'EEEE, MMMM d')}</p><p></p>`, eventId: ev.id } : { title: ev.title, eventId: ev.id })
    up({ linkedItemId: it.id })
  }
  return (
    <motion.div className="sheet" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }}>
      <header>
        <span className="dot" style={{ background: COLORS[ev.color] }} />
        <input autoFocus={!ev.title} className="ev-title" value={ev.title} placeholder="Event title" onChange={(e) => up({ title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && close()} />
        <button className="icon-btn" onClick={close}><X size={16} /></button>
      </header>
      <label className="toggle">
        <input type="checkbox" checked={!!ev.allDay} onChange={(e) => up(e.target.checked ? { allDay: true, start: startOfDay(ev.start).getTime(), end: addDays(startOfDay(ev.start), 1).getTime() } : { allDay: false, start: addMinutes(startOfDay(ev.start), 9 * 60).getTime(), end: addMinutes(startOfDay(ev.start), 10 * 60).getTime() })} />
        <span /> All-day
      </label>
      <div className="field">
        <small>Starts</small>
        <input type={ev.allDay ? 'date' : 'datetime-local'} value={toLocal(ev.start)} onChange={(e) => { const s = new Date(e.target.value).getTime(); if (!isNaN(s)) up({ start: s, end: s + (ev.end - ev.start) }) }} />
      </div>
      <div className="field">
        <small>Ends</small>
        <input type={ev.allDay ? 'date' : 'datetime-local'} value={toLocal(ev.allDay ? ev.end - 864e5 : ev.end)} onChange={(e) => { const t = new Date(e.target.value).getTime(); if (!isNaN(t)) up({ end: ev.allDay ? t + 864e5 : t }) }} />
      </div>
      <div className="field">
        <small><RepeatIcon size={11} /> Repeat</small>
        <select aria-label="Repeat" value={ev.repeat?.every ?? ''} onChange={(e) => setRepeat(e.target.value)}>
          <option value="">Never</option>
          {REPEATS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      {ev.repeat && (
        <div className="field">
          <small>Until</small>
          <input type="date" aria-label="Repeat until" value={ev.repeat.until ? format(ev.repeat.until, 'yyyy-MM-dd') : ''} onChange={(e) => { const t = e.target.value ? new Date(`${e.target.value}T23:59:59`).getTime() : undefined; up({ repeat: { every: ev.repeat!.every, until: t && !isNaN(t) ? t : undefined } }) }} />
        </div>
      )}
      {ev.repeat && <p className="small muted ev-hint">Changes here apply to every date. Drag one in the calendar to move just that one.</p>}
      <div className="field">
        <small><MapPin size={11} /> Location</small>
        <input value={ev.location || ''} placeholder="Add location" onChange={(e) => up({ location: e.target.value })} />
      </div>
      <div className="colors">
        {Object.entries(COLORS).map(([k, c]) => <button key={k} className={ev.color === k ? 'on' : ''} style={{ background: c }} onClick={() => up({ color: k })} />)}
      </div>
      <textarea className="ev-notes" placeholder="Notes" value={ev.notes || ''} onChange={(e) => up({ notes: e.target.value })} />
      <div className="linked">
        <small className="muted">Linked</small>
        {linked ? (
          <button className="btn sm" onClick={() => st.open(linked.id)}>{linked.kind === 'lecture' ? <AudioWaveform size={13} /> : <StickyNote size={13} />} {linked.title || 'Untitled'}</button>
        ) : (
          <div className="row">
            <button className="btn sm" onClick={() => link('doc')}><Plus size={13} /> Notes</button>
            <button className="btn sm" onClick={() => link('lecture')}><Mic size={13} /> Recording</button>
          </div>
        )}
      </div>
      <span className="grow" />
      {ev.repeat ? (
        <div className="row ev-del">
          <button className="btn" onClick={() => del(occurrenceId(ev.id, ev.start), 'Removed this one')}>Delete this one</button>
          <button className="btn danger" onClick={() => del(ev.id, 'Removed every date')}><Trash2 size={14} /> Delete all</button>
        </div>
      ) : (
        <button className="btn danger" onClick={() => del(id, 'Event deleted')}><Trash2 size={14} /> Delete event</button>
      )}
    </motion.div>
  )
}

const COLOR_NAMES: Record<string, string> = { blue: 'Blue', violet: 'Violet', teal: 'Teal', green: 'Green', amber: 'Amber', rose: 'Rose', slate: 'Slate' }

/** Right-click any event to recolor it. For a subscribed calendar the color applies to the whole calendar. */
function colorMenu(e: React.MouseEvent, ev: CalEvent) {
  e.stopPropagation()
  const set = (c: string) => (ev.calId ? updateSub(ev.calId, { color: c }) : useStore.getState().updateEvent(ev.id, { color: c }))
  openMenu(e, [
    { heading: ev.calId ? 'Calendar color' : 'Color' },
    ...Object.keys(COLORS).map((k) => ({ label: COLOR_NAMES[k], checked: ev.color === k, run: () => set(k) })),
  ])
}

function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="colors">
      {Object.entries(COLORS).map(([k, c]) => (
        <button key={k} className={value === k ? 'on' : ''} style={{ background: c }} onClick={() => onPick(k)} aria-label={COLOR_NAMES[k]} title={COLOR_NAMES[k]} />
      ))}
    </div>
  )
}

/** Your calendars: show or hide each, pick its color, add one by link or file. */
function CalendarsPanel({ onClose }: { onClose: () => void }) {
  const subs = useCalendars((s) => s.subs)
  const busy = useCalendars((s) => s.busy)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const add = async () => {
    if (!url.trim()) return
    setAdding(true)
    try {
      await subscribe(url)
      setUrl('')
    } catch (e) {
      toast((e as Error).message || 'Couldn’t add that calendar.')
    } finally {
      setAdding(false)
    }
  }
  return (
    <>
      <div className="menu-layer" onMouseDown={onClose} />
      <motion.div className="drop cal-panel" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
        <div className="cal-row">
          <i className="sw" style={{ background: 'var(--text)' }} />
          <span className="grow">Your events</span>
        </div>
        {subs.map((s) => (
          <div key={s.id}>
            <div className={`cal-row ${s.hidden ? 'off' : ''}`}>
              <button className="sw" style={{ background: COLORS[s.color] }} onClick={() => setOpen(open === s.id ? null : s.id)} aria-label="Color" title="Color" />
              <span className="grow" title={s.error}>{s.name || 'Calendar'}</span>
              {busy[s.id] ? <Loader2 size={14} className="spin muted" /> : s.error ? <CircleAlert size={14} className="src-err" /> : null}
              <button className="icon-btn sm" onClick={() => updateSub(s.id, { hidden: !s.hidden })} aria-label={s.hidden ? 'Show' : 'Hide'} title={s.hidden ? 'Show' : 'Hide'}>{s.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              <button className="icon-btn sm" onClick={() => unsubscribe(s.id)} aria-label="Remove" title="Remove"><X size={14} /></button>
            </div>
            {open === s.id && <Swatches value={s.color} onPick={(c) => updateSub(s.id, { color: c })} />}
          </div>
        ))}
        <form className="cal-add" onSubmit={(e) => (e.preventDefault(), add())}>
          <Link2 size={14} className="muted" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a calendar link" />
          {url && <button className="btn sm primary" disabled={adding}>{adding ? <Loader2 size={13} className="spin" /> : 'Add'}</button>}
        </form>
        <button className="text-btn muted" onClick={() => file.current?.click()}>or open an .ics file</button>
        <input ref={file} type="file" accept=".ics,text/calendar" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f).catch(() => toast('Couldn’t read that file.')); e.target.value = '' }} />
        <details className="advanced">
          <summary>Where’s the link?</summary>
          <p className="muted small">Google Calendar: Settings → your calendar → <b>Secret address in iCal format</b>. Apple: share the calendar publicly and copy its link. Outlook: Settings → Shared calendars → <b>Publish</b>, then the ICS link.</p>
        </details>
      </motion.div>
    </>
  )
}

/** An event from a subscribed calendar: read here, changed where it lives. */
function SubEventSheet({ ev, onClose }: { ev: CalEvent; onClose: () => void }) {
  const sub = useCalendars((s) => s.subs.find((x) => x.id === ev.calId))
  return (
    <motion.div className="sheet" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }}>
      <header>
        <span className="dot" style={{ background: COLORS[ev.color] }} />
        <b className="ev-title">{ev.title}</b>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>
      <p className="muted">{ev.allDay ? format(ev.start, 'EEEE, MMMM d') : `${format(ev.start, 'EEEE, MMMM d · h:mm a')} – ${format(ev.end, 'h:mm a')}`}</p>
      {ev.location && <p><MapPin size={12} /> {ev.location}</p>}
      {ev.notes && <p className="ev-notes-ro">{ev.notes}</p>}
      <small className="muted">From {sub?.name || 'a linked calendar'}</small>
      {sub && <Swatches value={sub.color} onPick={(c) => updateSub(sub.id, { color: c })} />}
    </motion.div>
  )
}
