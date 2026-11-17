import { lazy, Suspense, useEffect, useState } from 'react'
import { FileText, Mic } from 'lucide-react'
import { AskBar, focusAsk } from './components/AskBar'
import { useStore } from './store'
import { Rail } from './components/Rail'
import { toggleSidebar } from './lib/shell'
import { DocsLibrary } from './views/DocsLibrary'
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
import { VaultPicker } from './components/VaultPicker'
import { ErrorBoundary } from './components/ErrorBoundary'
import { checkVault, useVault } from './lib/vault'
import { useHistory } from './lib/history'
import { holdKey } from './lib/typeahead'
import { applyLook } from './lib/looks'
import { PaneContext, SIDE_MIN, closeBeside, setSideWidth, sideMax, useSidePane } from './lib/panes'

void checkVault()

// Each screen loads its own code the first time it's needed, so the app starts fast.
const views = {
  doc: () => import('./views/DocView'),
  lecture: () => import('./views/LectureView'),
  calendar: () => import('./views/CalendarView'),
  tasks: () => import('./views/TasksView'),
  trash: () => import('./views/TrashView'),
  vault: () => import('./views/VaultView'),
}
const DocView = lazy(() => views.doc().then((m) => ({ default: m.DocView })))
const LectureView = lazy(() => views.lecture().then((m) => ({ default: m.LectureView })))
const TasksView = lazy(() => views.tasks().then((m) => ({ default: m.TasksView })))
const TrashView = lazy(() => views.trash().then((m) => ({ default: m.TrashView })))
const VaultView = lazy(() => views.vault().then((m) => ({ default: m.VaultView })))
const CalendarView = lazy(() => views.calendar().then((m) => ({ default: m.CalendarView })))
const loadPalette = () => import('./components/CommandPalette')
const CommandPalette = lazy(() => loadPalette().then((m) => ({ default: m.CommandPalette })))
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const LinkDialog = lazy(() => import('./components/LinkDialog').then((m) => ({ default: m.LinkDialog })))
const HistoryDialog = lazy(() => import('./components/HistoryDialog').then((m) => ({ default: m.HistoryDialog })))
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
  const historySeen = useOpened(useHistory((s) => !!s.id))
  const [hydrated, setHydrated] = useState(useStore.persist.hasHydrated())
  const section = useStore((s) => s.section)
  const activeId = useStore((s) => s.activeId)
  const calendarDate = useStore((s) => s.calendarDate)
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId))
  const settings = useStore((s) => s.settings)
  const vault = useVault((s) => s.state)
  const setupOpen = useStore((s) => s.setupOpen)
  const side = useSidePane()
  const sideItem = useStore((s) => (side.id ? s.items.find((i) => i.id === side.id && !i.deletedAt) : undefined))

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
    void import('./lib/history').then((m) => m.startHistory())
    void import('./lib/reminders').then((m) => m.startReminders())
    void import('./lib/completed').then((m) => m.startCompleted())
    // System 1 (EmbeddingGemma): small, always on; quietly downloads once, then indexes when the browser is idle.
    void import('./ai/system1').then((m) => m.startSystem1())
    // Load every screen's code in the background, so switching never shows a placeholder first.
    const idle = window.requestIdleCallback || ((f: () => void) => setTimeout(f, 800))
    idle(() => void Promise.all([...Object.values(views).map((v) => v()), loadPalette()]).catch(() => {}))
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
  useEffect(() => applyLook(settings.look, settings.tint), [settings.look, settings.tint])

  // frosted glass, unless it's switched off or the OS asks for reduced transparency
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-transparency: reduce)')
    const apply = () => (document.documentElement.dataset.glass = settings.glass && !mq.matches ? 'on' : 'off')
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
      else if (mod && e.key === 'j') (e.preventDefault(), focusAsk())
      else if (mod && e.key === '\\') (e.preventDefault(), toggleSidebar())
      else if (mod && e.key === ',') (e.preventDefault(), s.setUI({ settingsOpen: true }))
      else if (mod && e.key.toLowerCase() === 'n') (e.preventDefault(), s.createItem('doc'))
      else if (e.key === 'Escape') s.setUI({ paletteOpen: false, settingsOpen: false, connectOpen: false })
    }
    // Quick access is open but its code is still arriving: keep what's typed for it, not for whatever has focus.
    // Shown but its field not focused yet: focus it now, and the key lands there.
    const hold = (e: KeyboardEvent) => {
      if (!useStore.getState().paletteOpen || e.metaKey || e.ctrlKey || e.altKey || (e.key.length !== 1 && e.key !== 'Backspace')) return
      const field = document.querySelector<HTMLInputElement>('.qa input')
      if (field) return void (document.activeElement !== field && field.focus())
      e.preventDefault()
      e.stopPropagation()
      holdKey(e.key)
    }
    window.addEventListener('keydown', hold, true)
    window.addEventListener('keydown', k)
    return () => {
      window.removeEventListener('keydown', hold, true)
      window.removeEventListener('keydown', k)
    }
  }, [])

  if (vault === 'locked') return <Unlock />
  if (!hydrated) return <div className="boot"><img src="/favicon.svg" alt="" /></div>

  const showActive = active && (section === 'trash' ? !!active.deletedAt : !active.deletedAt)
  let atRoot = true // phones: top-level screen (shows the tab bar) vs an open item
  let main: React.ReactNode
  if (section === 'home') main = <HomeView />
  else if (section === 'tasks') main = <TasksView />
  else if (section === 'vault') main = <VaultView />
  else if (section === 'trash' && !showActive) main = <TrashView />
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
        kind === 'doc' ? <PhoneDocList /> : <ItemList kind={kind} />
      ) : !hasDetail && (kind === 'doc' || kind === 'lecture') ? (
        <DocsLibrary kind={kind} />
      ) : (
        <div className="detail">{detail}</div>
      )
  }

  return (
    <div className={`app ${mobile ? 'mobile' : ''}`}>
      {!mobile && <Rail />}
      <main ref={mainRef} className={`main sec-${section}`} data-active={activeId || undefined}>
        <ErrorBoundary area="this page" resetKey={`${section}:${activeId}`}><Suspense fallback={<ViewFallback />}>{main}</Suspense></ErrorBoundary>
        {/* The Ask bar is on every page, and it's where the assistant lives: there is no separate chat panel. */}
        {!mobile && (
          <div className="home-dock">
            <AskBar />
          </div>
        )}
      </main>
      {/* A doc beside the page. Not when it's the page itself. */}
      {!mobile && sideItem && !(activeId === sideItem.id && !atRoot) && (
        <>
          <SideSplitter width={side.width} />
          <aside className="side-pane" style={{ width: side.width }} aria-label={`Beside: ${sideItem.title || 'Untitled'}`} onKeyDown={(e) => e.key === 'Escape' && !e.defaultPrevented && !(e.target as HTMLElement).closest('.ProseMirror, input, textarea') && closeBeside()}>
            <PaneContext.Provider value="side">
              <ErrorBoundary area="this doc" resetKey={sideItem.id}>
                <Suspense fallback={<ViewFallback />}>
                  {sideItem.kind === 'lecture' ? <LectureView key={sideItem.id} item={sideItem} /> : <DocView key={sideItem.id} item={sideItem} />}
                </Suspense>
              </ErrorBoundary>
            </PaneContext.Provider>
          </aside>
        </>
      )}
      {mobile && atRoot && <TabBar />}
      {mobile && !atRoot && <div className="p-dock detail"><AskBar phone /></div>}
      <Suspense fallback={null}>
        {paletteSeen && <CommandPalette />}
        {settingsSeen && <SettingsModal />}
        {connectSeen && <ConnectDialog />}
        {linkSeen && <LinkDialog />}
        {historySeen && <HistoryDialog />}
      </Suspense>
      {(settings.setupAt === null || setupOpen !== false) && <Setup />}
      <BackupDialog />
      <Overlays />
      <FileViewer />
      <VaultPicker />
      <Toaster />
    </div>
  )
}

/** The edge between the page and the doc beside it: drag to resize, double-click to reset, arrow keys too. */
function SideSplitter({ width }: { width: number }) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    document.documentElement.classList.add('resizing-col')
    const move = (ev: PointerEvent) => setSideWidth(window.innerWidth - ev.clientX - 10)
    const end = () => (handle.removeEventListener('pointermove', move), document.documentElement.classList.remove('resizing-col'))
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end, { once: true })
    handle.addEventListener('pointercancel', end, { once: true })
  }
  const key = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: 32, ArrowRight: -32 }[e.key]
    if (step) (e.preventDefault(), setSideWidth(width + step))
  }
  return (
    <div
      className="side-split"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the doc beside the page"
      aria-valuenow={width}
      aria-valuemin={SIDE_MIN}
      aria-valuemax={sideMax()}
      title="Drag to resize · double-click to reset"
      tabIndex={0}
      onPointerDown={start}
      onDoubleClick={() => setSideWidth(560)}
      onKeyDown={key}
    />
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
        <p>{any ? 'Pick one from the Library, or start a new one.' : 'Record a class or meeting. You get a transcript, and notes written for you.'}</p>
        <button className="btn primary" onClick={() => startRecording()}><Mic size={15} /> Start recording</button>
      </div>
    )
  }
  return (
    <div className="empty-detail blank">
      <span className="blank-ico"><FileText size={22} strokeWidth={1.7} /></span>
      <b>No doc open</b>
      <p>Pick one from the Library, or start a new one.</p>
      <button className="btn primary" onClick={() => useStore.getState().createItem('doc')}>New doc <kbd>⌘N</kbd></button>
    </div>
  )
}
