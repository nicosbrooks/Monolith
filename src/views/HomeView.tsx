import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { addDays, format, formatDistanceToNowStrict, isSameDay, startOfDay } from 'date-fns'
import { ChevronLeft, ChevronRight, FileText, GripVertical, LayoutGrid, MapPin, AudioWaveform, Search, StickyNote } from 'lucide-react'
import { MoreIcon } from '../components/icons'
import { openDoc } from '../lib/panes'
import { NewMenu } from '../components/NewMenu'
import { useMobile, useScrolled } from '../lib/useMobile'
import { PhoneTitle } from '../components/Phone'
import { useStore } from '../store'
import { itemEmoji } from '../lib/util'
import { TaskRow } from './TasksView'
import { useOpenTasks } from '../lib/tasks'
import { Card } from './DocsLibrary'
import { useEvents } from '../lib/events'
import { COLORS } from '../lib/colors'
import type { CalEvent } from '../types'
import { openMenu } from '../components/Overlays'
import { docMenu } from '../components/Sidebar'
import { awayFor, greeting } from '../lib/greeting'

const KindIcon = { note: StickyNote, doc: FileText, lecture: AudioWaveform }

/** Phones show five, then "See all". On a computer each card scrolls inside itself, so it can hold much more. */
const PHONE_SHOWN = 5
const DESK_SHOWN = 40

export function HomeView() {
  const items = useStore((s) => s.items)
  const events = useEvents()
  const st = useStore.getState()
  const mobile = useMobile()
  const [scrolled, onScroll] = useScrolled()
  const name = useStore((s) => s.settings.name)
  const [away] = useState(() => awayFor(new Date()))

  const now = new Date()
  const today = startOfDay(now)
  const live = items.filter((i) => !i.deletedAt)
  const recent = live.filter((i) => !i.file?.dir).sort((a, b) => b.updatedAt - a.updatedAt)
  const todos = useOpenTasks()
  // Is anything left today? With nothing left, Calendar steps aside until there is.
  const leftToday = events.some((e) => (e.allDay ? e.start < addDays(today, 1).getTime() && e.end > now.getTime() : isSameDay(e.start, today) && e.end > now.getTime()))
  const SHOWN = mobile ? PHONE_SHOWN : DESK_SHOWN
  const tasks = todos.slice(0, SHOWN)
  const [dayOffset, setDayOffset] = useState(0)
  const openDay = () => useStore.getState().openCalendarDate(addDays(today, dayOffset))
  const [board, setBoard] = useBoard()

  const docRow = (r: (typeof recent)[number], showTime = true) => {
    const Icon = KindIcon[r.kind]
    return (
      <button key={r.id} className="hm-row" onClick={(e) => openDoc(r.id, e)} onContextMenu={r.kind === 'lecture' ? undefined : (e) => openMenu(e, docMenu(r))}>
        <span className="hm-ico">{itemEmoji(r) || <Icon size={17} strokeWidth={1.8} />}</span>
        <span className="hm-row-title">{r.title || 'Untitled'}</span>
        {showTime && <small>{now.getTime() - r.updatedAt < 60_000 ? 'Just now' : formatDistanceToNowStrict(r.updatedAt, { addSuffix: true })}</small>}
      </button>
    )
  }

  // Each panel: its name, the link to its full page, and what it holds.
  const panels: Record<PanelId, Panel> = {
    calendar: {
      label: 'Calendar',
      action: { label: 'Open', run: openDay },
      body: <Day events={events} today={today} offset={dayOffset} setOffset={setDayOffset} shown={SHOWN} openDay={openDay} />,
    },
    recent: {
      label: 'Recent',
      action: recent.length > SHOWN ? { label: 'See all', run: () => st.go('docs') } : undefined,
      body: (
        <div className="hm-list">
          {recent.slice(0, SHOWN).map((r) => docRow(r))}
          {!recent.length && <p className="hm-empty">Docs and recordings you’ve worked on show up here.</p>}
        </div>
      ),
    },
    tasks: {
      label: 'Tasks',
      action: todos.length ? { label: todos.length > SHOWN ? `See all ${todos.length}` : 'Open', run: () => st.go('tasks') } : undefined,
      body: (
        <div className="hm-list">
          {/* The panel scrolls on a computer, so it holds them all; a phone shows the first few. */}
          {(mobile ? tasks : todos).map((t) => <TaskRow key={t.id} task={t} />)}
          {!todos.length && <p className="hm-empty">Nothing to do. Type a task in the bar below.</p>}
        </div>
      ),
    },
  }

  const panelsMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { heading: 'Show on Home' },
      ...PANEL_IDS.filter((id) => id !== 'recent').map((id) => ({
        label: panels[id].label,
        checked: board.some((t) => t.id === id),
        run: () => setBoard(board.some((t) => t.id === id) ? board.filter((t) => t.id !== id) : [...board, { id, w: 2, h: 1 }]),
      })),
      'sep',
      { label: 'Reset the layout', run: () => setBoard(DEFAULT_BOARD) },
    ])

  return (
    <div className={`home page-scroll ${mobile ? 'p-screen' : ''}`} onScroll={mobile ? onScroll : undefined}>
      {mobile && <PhoneTitle title="" scrolled={scrolled} />}
      <div className="hm">
        <header className="hm-head">
          <h1>{greeting(now, name, away)}</h1>
          <time dateTime={format(now, 'yyyy-MM-dd')}>{format(now, 'EEEE, MMMM d')}</time>
          {!mobile && (
            <div className="hm-quick">
              <NewMenu />
              <button onClick={() => st.setUI({ paletteOpen: true })}><Search size={15} aria-hidden="true" /> Search <kbd>⌘K</kbd></button>
              <button onClick={panelsMenu} aria-label="Choose panels" title="Choose panels"><LayoutGrid size={15} aria-hidden="true" /> Panels</button>
            </div>
          )}
        </header>

        {mobile ? (
          // Phones: one column in a fixed order, each list showing five.
          <div className="hm-board">
            {(leftToday ? (['calendar', 'tasks', 'recent'] as const) : (['tasks', 'recent'] as const)).map((id) => (
              <section key={id} className={`hm-sec hm-${id === 'calendar' ? 'cal' : id}`} aria-labelledby={`hm-${id}`}>
                <div className="hm-label">
                  <h2 id={`hm-${id}`}>{panels[id].label}</h2>
                  {panels[id].action && <button onClick={panels[id].action!.run}>{panels[id].action!.label}<ChevronRight size={14} aria-hidden="true" /></button>}
                </div>
                <div className={`hm-card ${id === 'calendar' ? 'hm-cal-card' : ''}`}>{panels[id].body}</div>
              </section>
            ))}
          </div>
        ) : (
          <>
            {/* Recent leads the page: the docs you were just in, as cards, one row that fits the window. */}
            {recent.length > 0 && (
              <section className="hm-recent-row" aria-labelledby="hm-recent-h">
                <div className="hm-label">
                  <h2 id="hm-recent-h">Recent</h2>
                  <button onClick={() => st.go('docs')}>See all<ChevronRight size={14} aria-hidden="true" /></button>
                </div>
                <div className="lib-grid hm-recent-cards">
                  {recent.slice(0, 8).map((r) => <Card key={r.id} item={r} />)}
                </div>
              </section>
            )}
            <Board tiles={board.filter((t) => t.id !== 'calendar' || leftToday)} allTiles={board} setTiles={setBoard} panels={panels} />
          </>
        )}
      </div>
    </div>
  )
}

type PanelId = 'calendar' | 'tasks' | 'recent'
const PANEL_IDS: PanelId[] = ['calendar', 'tasks', 'recent']
interface Panel {
  label: string
  action?: { label: string; run: () => void }
  body: React.ReactNode
}
/** A panel's place on Home: its width in columns (of four) and height in rows. Order is the array's order. */
interface Tile {
  id: PanelId
  w: number
  h: number
}
const COLS = 4
const MAX_H = 3
/** A panel is as tall as what it holds, up to this many pixels per row of height it's given; then it scrolls. */
const ROW = 260
// Tasks and (when something is left today) the day, side by side at the top; the rest of the page is left open, with
// Recent as a quiet row above the Ask bar. The assistant has no panel: its starting points show in the Ask bar.
const DEFAULT_BOARD: Tile[] = [
  { id: 'tasks', w: 2, h: 1 },
  { id: 'calendar', w: 2, h: 1 },
]
const BOARD_KEY = 'monolith-home-board-3'

function useBoard(): [Tile[], (t: Tile[]) => void] {
  const [tiles, set] = useState<Tile[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BOARD_KEY) || 'null') as Tile[] | null
      return Array.isArray(saved) ? saved.filter((t) => PANEL_IDS.includes(t.id) && t.id !== 'recent') : DEFAULT_BOARD
    } catch {
      return DEFAULT_BOARD
    }
  })
  const update = useCallback((next: Tile[]) => {
    set(next)
    try {
      localStorage.setItem(BOARD_KEY, JSON.stringify(next))
    } catch {
      /* private window */
    }
  }, [])
  return [tiles, update]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
/** How many of the shown columns a panel spans: all four, or half as many when only two are shown. */
const span = (w: number, cols: number) => (cols === COLS ? w : Math.ceil(w / (COLS / cols)))

/**
 * Home on a computer: panels on a four-column grid that fills the window. Hold a panel's header and drag to move it
 * (the others slide out of the way); drag its corner to resize. Each panel's ⋯ menu does the same from the keyboard.
 * Panels scroll inside themselves.
 */
function Board({ tiles, allTiles, setTiles: saveAll, panels }: { tiles: Tile[]; allTiles: Tile[]; setTiles: (t: Tile[]) => void; panels: Record<PanelId, Panel> }) {
  // Changes are made to the tiles shown; a panel that's stepped aside (Calendar with nothing left today) keeps its
  // place in the order, so it comes back where it was.
  const setTiles = (shown: Tile[]) => {
    const out = [...shown]
    allTiles.forEach((t, i) => {
      if (!tiles.some((x) => x.id === t.id) && !out.some((x) => x.id === t.id)) out.splice(Math.min(i, out.length), 0, t)
    })
    saveAll(out)
  }
  const grid = useRef<HTMLDivElement>(null)
  const [lifted, setLifted] = useState<PanelId | null>(null)
  const [sizing, setSizing] = useState<PanelId | null>(null)
  const before = useRef<Map<string, DOMRect> | null>(null)
  const drag = useRef<{ id: PanelId; grabX: number; grabY: number; x: number; y: number; over: string | null } | null>(null)
  const live = useRef(tiles)
  live.current = tiles
  // Narrow (a doc open beside Home, a small window): two columns, and wide panels fit within them.
  const [cols, setCols] = useState(COLS)
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setCols(e.contentRect.width < 880 ? 2 : COLS))
    ro.observe(el)
    return () => ro.disconnect()
  }, [tiles.length > 0])

  // Lay the panels out in rows, counting any that stepped aside. A panel that stepped aside lends its columns to its
  // neighbour in the same row, so Tasks widens to fill the gap instead of leaving half the row empty.
  const spans = new Map<PanelId, number>()
  {
    let row: { id: PanelId; s: number; away: boolean }[] = []
    let used = 0
    const flush = () => {
      const here = row.filter((r) => !r.away)
      if (here.length) {
        row.forEach((r) => !r.away && spans.set(r.id, r.s))
        row.forEach((r, i) => {
          if (!r.away) return
          const to = [...row.slice(0, i)].reverse().find((x) => !x.away) ?? row.slice(i + 1).find((x) => !x.away)
          if (to) spans.set(to.id, (spans.get(to.id) ?? to.s) + r.s)
        })
      }
      row = []
      used = 0
    }
    for (const t of allTiles) {
      const s = span(t.w, cols)
      if (used + s > cols) flush()
      row.push({ id: t.id, s, away: !tiles.some((x) => x.id === t.id) })
      used += s
    }
    flush()
  }

  const tileEl = (id: string) => grid.current?.querySelector<HTMLElement>(`[data-tile="${id}"]`) ?? null
  /** Remember where every panel is, so after a change each one glides to its new place. */
  const snapshot = () => {
    const m = new Map<string, DOMRect>()
    grid.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((el) => m.set(el.dataset.tile!, el.getBoundingClientRect()))
    before.current = m
  }
  const change = (next: Tile[]) => (snapshot(), setTiles(next))
  const follow = () => {
    const d = drag.current
    const el = d && tileEl(d.id)
    if (!d || !el || !grid.current) return
    el.style.transform = `translate(${d.x - d.grabX - el.offsetLeft}px, ${d.y - d.grabY - el.offsetTop}px)`
  }

  useLayoutEffect(() => {
    const prev = before.current
    before.current = null
    follow()
    if (!prev || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    grid.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((el) => {
      const id = el.dataset.tile!
      const was = prev.get(id)
      if (!was || id === drag.current?.id) return
      const now = el.getBoundingClientRect()
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.3,1)' })
    })
  })

  const point = (e: { clientX: number; clientY: number }) => {
    const r = grid.current!.getBoundingClientRect()
    return { x: e.clientX - r.left + grid.current!.scrollLeft, y: e.clientY - r.top + grid.current!.scrollTop }
  }

  // Hold and drag. A mouse can just drag (a few pixels starts it); touch must hold still first, so scrolling still works.
  const startMove = (e: ReactPointerEvent, id: PanelId) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input')) return
    const el = tileEl(id)
    if (!el) return
    const mouse = e.pointerType === 'mouse'
    const sx = e.clientX
    const sy = e.clientY
    let on = false
    const begin = (ev: { clientX: number; clientY: number }) => {
      on = true
      const r = el.getBoundingClientRect()
      const p = point(ev)
      drag.current = { id, grabX: sx - r.left, grabY: sy - r.top, ...p, over: null }
      setLifted(id)
      navigator.vibrate?.(8)
      follow()
    }
    const timer = window.setTimeout(() => begin({ clientX: sx, clientY: sy }), mouse ? 160 : 320)
    const move = (ev: PointerEvent) => {
      if (!on) {
        const far = Math.hypot(ev.clientX - sx, ev.clientY - sy)
        if (mouse && far > 4) (window.clearTimeout(timer), begin(ev))
        else if (!mouse && far > 8) stop()
        return
      }
      ev.preventDefault()
      const d = drag.current!
      Object.assign(d, point(ev))
      follow()
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-tile]')?.dataset.tile ?? null
      if (over === d.over) return
      d.over = over
      if (!over || over === id) return
      const cur = live.current
      const from = cur.findIndex((t) => t.id === id)
      const to = cur.findIndex((t) => t.id === over)
      const next = [...cur]
      next.splice(to, 0, next.splice(from, 1)[0])
      change(next)
    }
    const stop = () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      if (!on) return
      const d = drag.current
      drag.current = null
      setLifted(null)
      const el2 = d && tileEl(d.id)
      if (el2) {
        const from = el2.style.transform
        el2.style.transform = ''
        if (from && !matchMedia('(prefers-reduced-motion: reduce)').matches) el2.animate([{ transform: from }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.3,1)' })
      }
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  // Drag the corner: the panel snaps to whole columns and rows.
  const startSize = (e: ReactPointerEvent, id: PanelId) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = tileEl(id)!
    const g = grid.current!
    const gap = parseFloat(getComputedStyle(g).columnGap) || 12
    const colW = (g.clientWidth - gap * (cols - 1)) / cols
    const r = el.getBoundingClientRect()
    setSizing(id)
    const move = (ev: PointerEvent) => {
      // Width in the columns shown; when there are two, each counts as two of the four.
      const shown = clamp(Math.round((ev.clientX - r.left + gap) / (colW + gap)), 1, cols)
      const h = clamp(Math.ceil((ev.clientY - r.top - 20) / (ROW + gap)), 1, MAX_H)
      const cur = live.current.find((t) => t.id === id)!
      const w = shown === (spans.get(id) ?? span(cur.w, cols)) ? cur.w : shown * (COLS / cols)
      if (w !== cur.w || h !== cur.h) change(live.current.map((t) => (t.id === id ? { ...t, w, h } : t)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      setSizing(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const tileMenu = (e: React.MouseEvent, t: Tile) => {
    const i = tiles.indexOf(t)
    const set = (patch: Partial<Tile>) => change(tiles.map((x) => (x.id === t.id ? { ...x, ...patch } : x)))
    const moveBy = (n: number) => {
      const next = [...tiles]
      next.splice(clamp(i + n, 0, tiles.length - 1), 0, next.splice(i, 1)[0])
      change(next)
    }
    openMenu(e, [
      ...(i > 0 ? [{ label: 'Move earlier', run: () => moveBy(-1) }] : []),
      ...(i < tiles.length - 1 ? [{ label: 'Move later', run: () => moveBy(1) }] : []),
      { heading: 'Width' },
      ...([[1, 'Quarter'], [2, 'Half'], [3, 'Three quarters'], [4, 'Full']] as const).map(([w, label]) => ({ label, checked: t.w === w, run: () => set({ w }) })),
      { heading: 'Height' },
      ...([[1, 'Short'], [2, 'Tall'], [3, 'Taller']] as const).map(([h, label]) => ({ label, checked: t.h === h, run: () => set({ h }) })),
      'sep',
      { label: 'Hide from Home', run: () => change(tiles.filter((x) => x.id !== t.id)) },
    ])
  }

  if (!tiles.length) {
    return (
      <div className="hm-grid empty">
        <p className="hm-empty">Home is empty. Choose panels to show with the Panels button above.</p>
      </div>
    )
  }
  return (
    <div className={`hm-grid ${lifted ? 'arranging' : ''}`} ref={grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {tiles.map((t) => {
        const p = panels[t.id]
        return (
          <section
            key={t.id}
            data-tile={t.id}
            className={`hm-tile hm-card hm-t-${t.id} ${lifted === t.id ? 'lifted' : ''} ${sizing === t.id ? 'sizing' : ''}`}
            style={{ gridColumn: `span ${spans.get(t.id) ?? span(t.w, cols)}`, maxHeight: ROW * t.h + 12 * (t.h - 1) }}
            aria-labelledby={`hm-t-${t.id}`}
          >
            <header className="hm-tile-head" onPointerDown={(e) => startMove(e, t.id)} title="Hold and drag to move">
              <GripVertical className="hm-grip" size={14} aria-hidden="true" />
              <h2 id={`hm-t-${t.id}`}>{p.label}</h2>
              <span className="grow" />
              {p.action && <button className="hm-tile-link" onClick={p.action.run}>{p.action.label}<ChevronRight size={14} aria-hidden="true" /></button>}
              <button className="hm-tile-more" onClick={(e) => tileMenu(e, t)} aria-label={`${p.label} panel options`} title="Size, order, hide">
                <MoreIcon size={16} />
              </button>
            </header>
            <div className="hm-tile-body">{p.body}</div>
            <div className="hm-resize" onPointerDown={(e) => startSize(e, t.id)} title="Drag to resize" aria-hidden="true" />
          </section>
        )
      })}
    </div>
  )
}

/** One day at a time: today first; ‹ › step through the days, and a row shows that day in Calendar. */
function Day({ events, today, offset, setOffset, shown: SHOWN, openDay }: { events: CalEvent[]; today: Date; offset: number; setOffset: (n: number) => void; shown: number; openDay: () => void }) {
  const active = addDays(today, offset)
  const evs = events
    .filter((e) => (e.allDay ? e.start < addDays(active, 1).getTime() && e.end > active.getTime() : isSameDay(e.start, active)))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
  const name = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : format(active, 'EEEE')
  return (
    <>
      <div className="hm-day">
        <button className="hm-step" onClick={() => setOffset(offset - 1)} aria-label="Previous day" title="Previous day"><ChevronLeft size={16} /></button>
        <span className="hm-day-name" aria-live="polite"><b>{name}</b><small>{format(active, 'MMM d')}</small></span>
        <button className="hm-step" onClick={() => setOffset(offset + 1)} aria-label="Next day" title="Next day"><ChevronRight size={16} /></button>
      </div>
      <div className="hm-list">
        {evs.slice(0, SHOWN).map((e) => (
          <button key={e.id} className="hm-row" onClick={openDay}>
            <u className="hm-bar" aria-hidden="true" style={{ background: COLORS[e.color] || COLORS.blue }} />
            <span className="hm-ev">
              <span className="hm-row-title">{e.title || 'Untitled event'}</span>
              {e.location?.trim() && <small><MapPin size={12} aria-hidden="true" /> {e.location.trim()}</small>}
            </span>
            {e.allDay ? (
              <span className="hm-ev-time">All day</span>
            ) : (
              <span className="hm-ev-time"><b>{format(e.start, 'h:mm a')}</b>{format(e.end, 'h:mm a')}</span>
            )}
          </button>
        ))}
        {!evs.length && <p className="hm-empty">Nothing scheduled.</p>}
        {evs.length > SHOWN && <button className="hm-more" onClick={openDay}>{evs.length - SHOWN} more in Calendar<ChevronRight size={14} aria-hidden="true" /></button>}
      </div>
    </>
  )
}
