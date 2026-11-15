import { lazy, Suspense, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileText, Mic, PanelLeftOpen } from 'lucide-react'
import { AskBar } from './components/AskBar'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { Toaster } from './components/Toast'
import { Overlays } from './components/Overlays'
import { ItemList } from './views/ItemList'
import { HomeView } from './views/HomeView'
import { startAI } from './ai/llm'
import { startSync } from './storage/sync'
import { useMobile } from './lib/useMobile'
import { useNavigationHistory } from './lib/navigation'
import { startLink, useLink } from './link/link'
import { PhoneDocList, TabBar } from './components/Phone'
import { Setup, Unlock } from './components/Setup'
import { BackupDialog } from './components/BackupDialog'
import { startRecording } from './lib/recordNext'
import { FileViewer } from './components/FileViewer'
import { ErrorBoundary } from './components/ErrorBoundary'
import { checkVault, useVault } from './lib/vault'

void checkVault()

// Each screen loads its own code the first time it's needed, so the app starts fast.
const views = {
  doc: () => import('./views/DocView'),
  lecture: () => import('./views/LectureView'),
  calendar: () => import('./views/CalendarView'),
  tasks: () => import('./views/TasksView'),
}
const DocView = lazy(() => views.doc().then((m) => ({ default: m.DocView })))
const LectureView = lazy(() => views.lecture().then((m) => ({ default: m.LectureView })))
const TasksView = lazy(() => views.tasks().then((m) => ({ default: m.TasksView })))
const CalendarView = lazy(() => views.calendar().then((m) => ({ default: m.CalendarView })))
const AIPanel = lazy(() => import('./components/AIPanel').then((m) => ({ default: m.AIPanel })))
const CommandPalette = lazy(() => import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const LinkDialog = lazy(() => import('./components/LinkDialog').then((m) => ({ default: m.LinkDialog })))
const ConnectDialog = lazy(() => import('./components/ConnectDialog').then((m) => ({ default: m.ConnectDialog })))

/** True from the first time `on` is true: lets a dialog's code load on first open and stay mounted after. */
function useOpened(on: boolean) {
  const [seen, setSeen] = useState(on)
  if (on && !seen) setSeen(true)
  return seen
}

const ViewFallback = () => (
  <div className="view-skel" aria-hidden>
    <i style={{ width: '38%' }} /><i /><i style={{ width: '82%' }} /><i style={{ width: '64%' }} />
  </div>
)

export default function App() {
  const mobile = useMobile()
  const paletteSeen = useOpened(useStore((s) => s.paletteOpen))
  const settingsSeen = useOpened(useStore((s) => s.settingsOpen))
  const connectSeen = useOpened(useStore((s) => s.connectOpen))
  const linkSeen = useOpened(useLink((s) => s.open))
  const [hydrated, setHydrated] = useState(useStore.persist.hasHydrated())
  const section = useStore((s) => s.section)
  const activeId = useStore((s) => s.activeId)
  const calendarDate = useStore((s) => s.calendarDate)
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId))
  const aiOpen = useStore((s) => s.aiOpen)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const settings = useStore((s) => s.settings)
  const vault = useVault((s) => s.state)
  const setupOpen = useStore((s) => s.setupOpen)

  useEffect(() => useStore.persist.onFinishHydration(() => setHydrated(true)), [])
  useEffect(() => {
    if (hydrated) (startSync(), startLink())
  }, [hydrated])
  useEffect(() => {
    if (!hydrated) return
    const want = new URLSearchParams(location.search).get('new')
    if (want === 'note' || want === 'doc' || want === 'lecture') {
      useStore.getState().createItem(want === 'lecture' ? 'lecture' : 'doc')
      history.replaceState(history.state, '', '/')
    }
    // Find the best engine this machine already has, quietly.
    void startAI()
    void import('./lib/fileUpkeep').then((m) => m.startFileUpkeep())
    void import('./lib/safekeeping').then((m) => m.startSafekeeping())
    // System 1 (EmbeddingGemma): small, always on; quietly downloads once, then indexes when the browser is idle.
    void import('./ai/system1').then((m) => m.startSystem1())
    // Warm the editor and calendar in the background so the first open is instant.
    const idle = window.requestIdleCallback || ((f: () => void) => setTimeout(f, 800))
    idle(() => void Promise.all([views.doc(), views.calendar()]).catch(() => {}))
  }, [hydrated])
  const mainRef = useNavigationHistory(hydrated)

  // theme + accent
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  // frosted glass, unless the OS asks for reduced transparency
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-transparency: reduce)')
    // Solid surfaces: see-through popups blended into the page behind them.
    const apply = () => (document.documentElement.dataset.glass = 'off')
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.glass])

  // global shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // Setup and the lock screen come first: no shortcut opens anything underneath them.
      if (document.querySelector('.su')) return
      const mod = e.metaKey || e.ctrlKey
      const s = useStore.getState()
      if (mod && e.key === 'k' && !(e.target as HTMLElement).closest('.ProseMirror')) (e.preventDefault(), s.setUI({ paletteOpen: !s.paletteOpen }))
      else if (mod && e.key === 'p') (e.preventDefault(), s.setUI({ paletteOpen: true }))
      else if (mod && e.key === 'j') (e.preventDefault(), s.setUI({ aiOpen: !s.aiOpen }))
      else if (mod && e.key === '\\') (e.preventDefault(), s.setUI({ sidebarCollapsed: !s.sidebarCollapsed }))
      else if (mod && e.key === ',') (e.preventDefault(), s.setUI({ settingsOpen: true }))
      else if (mod && e.key.toLowerCase() === 'n') (e.preventDefault(), s.createItem('doc'))
      else if (e.key === 'Escape') s.setUI({ paletteOpen: false, settingsOpen: false, connectOpen: false })
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  if (vault === 'locked') return <Unlock />
  if (!hydrated) return <div className="boot"><img src="/favicon.svg" alt="" /></div>

  const showActive = active && (section === 'trash' ? !!active.deletedAt : !active.deletedAt)
  let atRoot = true // phones: top-level screen (shows the tab bar) vs an open item
  let main: React.ReactNode
  if (section === 'home') main = <HomeView />
  else if (section === 'tasks') main = <TasksView />
  else if (section === 'calendar') main = <CalendarView key={calendarDate ?? 'today'} initialDate={calendarDate} />
  else {
    const kind = section === 'docs' ? 'doc' : section === 'lectures' ? 'lecture' : undefined
    const detail =
      showActive && (section === 'trash' || active.kind === kind) ? (
        active.kind === 'lecture' ? <LectureView key={active.id} item={active} /> : <DocView key={active.id} item={active} />
      ) : (
        <Empty kind={kind} />
      )
    const hasDetail = showActive && (section === 'trash' || active.kind === kind)
    atRoot = !hasDetail
    main =
      mobile && !hasDetail ? (
        kind === 'doc' ? <PhoneDocList /> : <ItemList kind={kind} trash={section === 'trash'} />
      ) : (
        <>
          {/* Docs and recordings are listed in the sidebar; only Recently Deleted has a list column. */}
          {section === 'trash' && !mobile && <ItemList kind={kind} trash />}
          <div className="detail">{detail}</div>
        </>
      )
  }

  return (
    <div className={`app ${collapsed && !mobile ? 'collapsed' : ''} ${aiOpen ? 'ai-open' : ''} ${mobile ? 'mobile' : ''}`}>
      <AnimatePresence initial={false}>
        {!collapsed && !mobile && (
          <motion.div className="side-wrap" initial={{ width: 0, opacity: 0 }} animate={{ width: 'var(--side-w)', opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ type: 'spring', duration: 0.35, bounce: 0 }}>
            <ErrorBoundary area="the sidebar"><Sidebar /></ErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
      <main ref={mainRef} className={`main sec-${section}`} data-active={activeId || undefined}>
        {collapsed && !mobile && (
          <button className="icon-btn float-open" onClick={() => useStore.getState().setUI({ sidebarCollapsed: false })} title="Show sidebar (⌘\)"><PanelLeftOpen size={16} /></button>
        )}
        <ErrorBoundary area="this page" resetKey={`${section}:${activeId}`}><Suspense fallback={<ViewFallback />}>{main}</Suspense></ErrorBoundary>
        {/* The Ask bar is on every page; while the assistant panel is open, its own composer takes over. */}
        {!mobile && !aiOpen && (
          <div className="home-dock">
            <AskBar />
          </div>
        )}
      </main>
      <AnimatePresence initial={false}>
        {aiOpen && (
          <motion.div className="ai-wrap" initial={{ width: 0, opacity: 0 }} animate={{ width: 'var(--ai-w)', opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ type: 'spring', duration: 0.35, bounce: 0 }}>
            <ErrorBoundary area="the assistant"><Suspense fallback={null}><AIPanel /></Suspense></ErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
      {mobile && atRoot && !aiOpen && <TabBar />}
      {mobile && !atRoot && !aiOpen && <div className="p-dock detail"><AskBar phone /></div>}
      <Suspense fallback={null}>
        {paletteSeen && <CommandPalette />}
        {settingsSeen && <SettingsModal />}
        {connectSeen && <ConnectDialog />}
        {linkSeen && <LinkDialog />}
      </Suspense>
      {(settings.setupAt === null || setupOpen !== false) && <Setup />}
      <BackupDialog />
      <Overlays />
      <FileViewer />
      <Toaster />
    </div>
  )
}

function Empty({ kind }: { kind?: string }) {
  if (!kind) return <div className="empty-detail blank"><b>Nothing selected</b><p>Pick something from the list to see it here.</p></div>
  if (kind === 'lecture') {
    const any = useStore.getState().items.some((i) => i.kind === 'lecture' && !i.deletedAt)
    return (
      <div className="empty-detail blank">
        <span className="blank-ico"><Mic size={22} strokeWidth={1.7} /></span>
        <b>{any ? 'No recording open' : 'No recordings yet'}</b>
        <p>{any ? 'Pick one in the sidebar, or start a new one.' : 'Record a class or meeting. You get a transcript, and notes written for you.'}</p>
        <button className="btn primary" onClick={() => startRecording()}><Mic size={15} /> Start recording</button>
      </div>
    )
  }
  return (
    <div className="empty-detail blank">
      <span className="blank-ico"><FileText size={22} strokeWidth={1.7} /></span>
      <b>No doc open</b>
      <p>Pick one in the sidebar, or start a new one.</p>
      <button className="btn primary" onClick={() => useStore.getState().createItem('doc')}>New doc <kbd>⌘N</kbd></button>
    </div>
  )
}
