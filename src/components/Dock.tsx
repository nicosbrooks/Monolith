import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AudioWaveform, CalendarDays, FileText, LayoutGrid, ListChecks, PanelLeft, Search, Settings } from 'lucide-react'
import { toggleLibrary, useShell } from '../lib/shell'
import { useStore } from '../store'
import type { Section } from '../types'
import { Sidebar } from './Sidebar'
import { ErrorBoundary } from './ErrorBoundary'

const PLACES: { id: Section; label: string; Icon: typeof FileText }[] = [
  { id: 'home', label: 'Home', Icon: LayoutGrid },
  { id: 'docs', label: 'Docs', Icon: FileText },
  { id: 'tasks', label: 'Tasks', Icon: ListChecks },
  { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { id: 'lectures', label: 'Recordings', Icon: AudioWaveform },
]

/** The places, as round buttons. The one you're in opens up to show its name. */
export function Dock() {
  const section = useStore((s) => s.section)
  const library = useShell((s) => s.library)
  const st = useStore.getState()
  return (
    <nav className="dock" aria-label="Main">
      {PLACES.map(({ id, label, Icon }) => {
        const on = section === id || (id === 'docs' && section === 'trash')
        return (
          <button key={id} className={`dock-btn ${on ? 'on' : ''}`} aria-label={label} aria-current={on ? 'page' : undefined} data-tip={label} onClick={() => (id === 'docs' || id === 'lectures' ? useStore.setState({ section: id, activeId: null, tagFilter: null, calendarDate: null }) : st.go(id))}>
            <Icon size={18} strokeWidth={1.8} />
          </button>
        )
      })}
      <i className="dock-sep" aria-hidden="true" />
      <button className={`dock-btn ${library ? 'on' : ''}`} aria-label="Library" aria-expanded={library} title="Library (⌘\)" onClick={() => toggleLibrary()}>
        <PanelLeft size={18} strokeWidth={1.8} />
      </button>
      <button className="dock-btn" aria-label="Search" data-tip="Search  ⌘K" onClick={() => st.setUI({ paletteOpen: true })}>
        <Search size={18} strokeWidth={1.8} />
      </button>
      <button className="dock-btn" aria-label="Settings" data-tip="Settings  ⌘," onClick={() => st.setUI({ settingsOpen: true })}>
        <Settings size={18} strokeWidth={1.8} />
      </button>
    </nav>
  )
}

/** Slides in from the left over a light scrim; choosing something, or Esc, puts it away. */
export function Library() {
  const open = useShell((s) => s.library)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && toggleLibrary(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="library-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => toggleLibrary(false)} />
          <motion.div
            key="panel"
            className="library"
            role="dialog"
            aria-label="Library"
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
          >
            <ErrorBoundary area="the library"><Sidebar library onNavigate={() => toggleLibrary(false)} /></ErrorBoundary>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
