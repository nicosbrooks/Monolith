import { useEffect, useMemo, useRef } from 'react'
import { AudioWaveform, CalendarDays, FileText, LayoutGrid, ListChecks, PanelLeftClose, PanelLeftOpen, Search, Settings, StickyNote, Trash2 } from 'lucide-react'
import { VaultIcon, type AnyIcon } from './icons'
import { setSidebar, toggleSidebar, useShell } from '../lib/shell'
import { useStore } from '../store'
import { itemEmoji } from '../lib/util'
import type { Item, Section } from '../types'
import { Logo, docMenu } from './Sidebar'
import { openMenu } from './Overlays'

const PLACES: { id: Section; label: string; Icon: AnyIcon }[] = [
  { id: 'home', label: 'Home', Icon: LayoutGrid },
  { id: 'tasks', label: 'Tasks', Icon: ListChecks },
  { id: 'docs', label: 'Docs', Icon: FileText },
  { id: 'lectures', label: 'Recordings', Icon: AudioWaveform },
  { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { id: 'vault', label: 'Vault', Icon: VaultIcon },
]

/** How long the pointer rests on the rail before it opens, and lingers off it before it closes. */
const OPEN_DELAY = 140
const CLOSE_DELAY = 260

/**
 * The desktop sidebar. A slim rail of icons that opens in place when you rest the pointer on it (or tab into it),
 * showing the places by name and your recent docs. ⌘\ keeps it open beside the page.
 */
export function Rail() {
  const { open, pinned } = useShell()
  const wide = open || pinned
  const section = useStore((s) => s.section)
  const activeId = useStore((s) => s.activeId)
  const items = useStore((s) => s.items)
  const timer = useRef<number | undefined>(undefined)

  const recent = useMemo(
    () => (wide ? items.filter((i) => !i.deletedAt && !i.file?.dir).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30) : []),
    [items, wide],
  )

  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // Esc puts an open (not kept-open) sidebar away.
  useEffect(() => {
    if (!open || pinned) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setSidebar(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, pinned])

  const st = useStore.getState()
  // Choosing something closes a sidebar that only opened on hover.
  const done = () => !pinned && setSidebar(false)
  const go = (id: Section) => {
    if (id === 'docs' || id === 'lectures') useStore.setState({ section: id, activeId: null, tagFilter: null, calendarDate: null })
    else st.go(id)
    done()
  }
  const openItem = (id: string) => (st.open(id), done())

  const row = (i: Item) => {
    const Icon = i.kind === 'lecture' ? AudioWaveform : i.kind === 'note' ? StickyNote : FileText
    return (
      <button
        key={i.id}
        className={`rl-row rl-doc ${activeId === i.id ? 'on' : ''}`}
        onClick={() => openItem(i.id)}
        onContextMenu={i.kind === 'lecture' ? undefined : (e) => openMenu(e, docMenu(i))}
        title={i.title || 'Untitled'}
      >
        <span className="rl-ico">{itemEmoji(i) || <Icon size={15} strokeWidth={1.8} />}</span>
        <span className="rl-name">{i.title || 'Untitled'}</span>
      </button>
    )
  }

  return (
    <div className={`rail-slot ${pinned ? 'pinned' : ''}`}>
      <nav
        className={`rail ${wide ? 'wide' : ''}`}
        aria-label="Sidebar"
        // Back on it while it was about to close: it just stays open.
        onPointerEnter={(e) => e.pointerType === 'mouse' && !pinned && (useShell.getState().open ? window.clearTimeout(timer.current) : later(() => setSidebar(true), OPEN_DELAY))}
        // Closed by choosing something while the pointer stayed on it: moving again opens it, no need to leave first.
        // Open, but a close was pending (the pointer left and came back): moving on it keeps it open.
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse' || pinned) return
          if (useShell.getState().open) window.clearTimeout(timer.current)
          else later(() => setSidebar(true), OPEN_DELAY)
        }}
        onPointerLeave={(e) => e.pointerType === 'mouse' && !pinned && later(() => setSidebar(false), CLOSE_DELAY)}
        onFocus={() => !pinned && (window.clearTimeout(timer.current), setSidebar(true))}
        onBlur={(e) => !pinned && !e.currentTarget.contains(e.relatedTarget as Node) && setSidebar(false)}
      >
        <div className="rl-top">
          <span className="rl-brand" aria-hidden="true">
            <Logo size={20} />
            {wide && <span className="rl-name">Monolith</span>}
          </span>
          <button className="rl-pin" onClick={() => toggleSidebar()} aria-label={pinned ? 'Let the sidebar close' : 'Keep the sidebar open'} title={pinned ? 'Let it close  ⌘\\' : 'Keep open  ⌘\\'} tabIndex={wide ? 0 : -1}>
            {pinned ? <PanelLeftClose size={16} strokeWidth={1.8} /> : <PanelLeftOpen size={16} strokeWidth={1.8} />}
          </button>
        </div>

        <button className="rl-row rl-search" onClick={() => (st.setUI({ paletteOpen: true }), done())} aria-label="Search">
          <span className="rl-ico"><Search size={17} strokeWidth={1.8} /></span>
          {wide && <span className="rl-name">Search</span>}
          {wide && <kbd className="rl-kbd">⌘K</kbd>}
        </button>

        <div className="rl-group">
          {PLACES.map(({ id, label, Icon }) => {
            const on = section === id && (!activeId || id === 'calendar' || id === 'tasks' || id === 'home' || id === 'vault')
            return (
              <button key={id} className={`rl-row rl-place ${on ? 'on' : ''}`} aria-label={label} aria-current={on ? 'page' : undefined} onClick={() => go(id)}>
                <span className="rl-ico"><Icon size={17} strokeWidth={1.8} /></span>
                {wide && <span className="rl-name">{label}</span>}
              </button>
            )
          })}
        </div>

        <div className="rl-scroll">
          {wide && (
            <>
          <section className="rl-sec" aria-label="Recent">
            <h3>Recent</h3>
            {recent.map(row)}
            {!recent.length && <p className="rl-empty">Docs and recordings you open show up here.</p>}
          </section>
            </>
          )}
        </div>

        <div className="rl-foot">
          <button className={`rl-row ${section === 'trash' && !activeId ? 'on' : ''}`} onClick={() => go('trash')} aria-label="Recently Deleted">
            <span className="rl-ico"><Trash2 size={17} strokeWidth={1.8} /></span>
            {wide && <span className="rl-name">Recently Deleted</span>}
          </button>
          <button className="rl-row" onClick={() => (st.setUI({ settingsOpen: true }), done())} aria-label="Settings">
            <span className="rl-ico"><Settings size={17} strokeWidth={1.8} /></span>
            {wide && <span className="rl-name">Settings</span>}
            {wide && <kbd className="rl-kbd">⌘,</kbd>}
          </button>
        </div>
      </nav>
    </div>
  )
}
