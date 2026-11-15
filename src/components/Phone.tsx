import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { format } from 'date-fns'
import { CalendarDays, ChevronRight, FileText, Folder, Mic, PanelLeft, Plus, Search, MessageCircle, Sun, ArrowUp, HardDriveUpload, GitCommitHorizontal, RefreshCw } from 'lucide-react'
import { create } from 'zustand'
import { useStore } from '../store'
import { AskBar } from './AskBar'
import type { Item } from '../types'
import { useLongPress, useScrolled } from '../lib/useMobile'
import { openMenu } from './Overlays'
import { CommitBox, docMenu, docOrder, Sidebar } from './Sidebar'
import { SourceIcon } from './StorageSettings'
import { createFile, pendingChanges, pull, reconnect, useSync } from '../storage/sync'
import { itemEmoji } from '../lib/util'

// ─── Large-title header ─────────────────────────────────────────────────────

/** iOS-style header: a big title that shrinks into a glass bar once you scroll. Pass `scrolled` from useScrolled. */
export function PhoneTitle({ title, sub, actions, scrolled, lead }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; scrolled: boolean; lead?: React.ReactNode }) {
  return (
    <>
      <header className={`p-bar ${scrolled ? 'scrolled' : ''}`}>
        <span className="p-bar-lead">{lead ?? <SidebarButton />}</span>
        <span className="p-bar-title">{title}</span>
        <span className="p-bar-actions">{actions}</span>
      </header>
      <div className="p-large">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
    </>
  )
}

// ─── Phone navigation: the same sidebar as everywhere else, plus the Ask pill ─────────

/** Whether the sidebar is slid in on a phone. */
export const usePhoneNav = create<{ open: boolean }>(() => ({ open: false }))

function SidebarButton() {
  return (
    <button className="icon-btn" onClick={() => usePhoneNav.setState({ open: true })} aria-label="Show sidebar">
      <PanelLeft size={20} strokeWidth={1.8} />
    </button>
  )
}

/** Bottom of every top-level phone screen: Ask or search, and a new-note button. The sidebar slides in from the left. */
export function TabBar() {
  const [sheet, setSheet] = useState(false)
  const open = usePhoneNav((s) => s.open)
  const section = useStore((s) => s.section)
  const activeId = useStore((s) => s.activeId)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  // Picking anything in the sidebar closes it.
  useEffect(() => usePhoneNav.setState({ open: false }), [section, activeId])
  return (
    <>
      <div className="p-dock">
        <AskBar phone />
        <motion.button className="p-fab" whileTap={{ scale: 0.9 }} onClick={() => setSheet(true)} aria-label="Create">
          <Plus size={22} strokeWidth={2} />
        </motion.button>
      </div>
      <CreateSheet open={sheet} close={() => setSheet(false)} />
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="p-scrim" onClick={() => usePhoneNav.setState({ open: false })} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              className="p-drawer"
              style={{ touchAction: 'pan-y' }}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', duration: 0.36, bounce: 0.05 }}
              onTouchStart={(e) => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
              onTouchEnd={(e) => {
                const start = touchStart.current
                touchStart.current = null
                if (!start) return
                const dx = start.x - e.changedTouches[0].clientX
                const dy = start.y - e.changedTouches[0].clientY
                if (dx > 70 && dx > Math.abs(dy) * 1.5) usePhoneNav.setState({ open: false })
              }}
              onTouchCancel={() => { touchStart.current = null }}
            >
              <Sidebar onNavigate={() => usePhoneNav.setState({ open: false })} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

function CreateSheet({ open, close }: { open: boolean; close: () => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, close])
  const st = useStore.getState()
  const run = (fn: () => void) => () => (close(), fn())
  const capture = () => {
    const t = text.trim()
    if (!t) return
    const [first, ...rest] = t.split('\n')
    st.createItem('doc', { title: first.slice(0, 80), content: `${(first.length > 80 ? [first, ...rest] : rest).map((l) => `<p>${esc(l)}</p>`).join('')}` })
    useStore.setState({ activeId: null }) // stay where you are; it's in Docs
    setText('')
    close()
    import('./Toast').then((m) => m.toast('Saved to Docs', { action: { label: 'Open', run: () => st.go('docs') } }))
  }
  const opts: [string, string, typeof Sun, () => void][] = [
    ['Doc', 'Notes, checklists, long-form writing', FileText, () => st.createItem('doc')],
    ['Record', 'A class, a meeting, a thought', Mic, () => st.createItem('lecture', { title: `Recording · ${format(new Date(), 'MMM d')}` })],
    ['Event', 'Add to your calendar', CalendarDays, () => (st.go('calendar'), setTimeout(() => document.querySelector<HTMLInputElement>('.quick-add input')?.focus(), 250))],
  ]
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="p-scrim" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className="sheet p-sheet"
            role="dialog"
            aria-label="Create"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', duration: 0.38, bounce: 0.08 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => (i.offset.y > 80 || i.velocity.y > 500) && close()}
          >
            <div className="grabber" />
            <form className="capture" onSubmit={(e) => (e.preventDefault(), capture())}>
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot something down…" onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), capture())} />
              <button className="send" type="submit" disabled={!text.trim()} aria-label="Save note"><ArrowUp size={17} /></button>
            </form>
            <div className="p-opts">
              {opts.map(([label, hint, Icon, fn]) => (
                <button key={label} onClick={run(fn)}>
                  <span className="ico"><Icon size={18} strokeWidth={1.8} /></span>
                  <span className="lbl">{label}<small>{hint}</small></span>
                </button>
              ))}
            </div>
            <div className="p-opts row2">
              <button onClick={run(() => st.setUI({ aiOpen: true }))}><MessageCircle size={16} /> Ask assistant</button>
              <button onClick={run(() => st.setUI({ paletteOpen: true }))}><Search size={16} /> Search</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

// ─── Docs list (replaces the slide-out tree on phones) ──────────────────────

export function PhoneDocList() {
  const items = useStore((s) => s.items)
  const sources = useStore((s) => s.sources)
  const folders = useStore((s) => s.folders)
  const folderId = useStore((s) => s.folderId)
  const notes = !!folderId // inside a folder: just its docs, no storage sources
  const [scrolled, onScroll] = useScrolled()
  const docs = items.filter((i) => i.kind === 'doc' && !i.deletedAt)
  const mine = docs.filter((d) => !d.sourceId && (!folderId || d.folderId === folderId))
  return (
    <div className="p-screen" onScroll={onScroll}>
      <PhoneTitle
        title={folders.find((f) => f.id === folderId)?.name || 'Docs'}
        scrolled={scrolled}
        actions={<button className="icon-btn" onClick={() => useStore.getState().setUI({ paletteOpen: true })} aria-label="Search"><Search size={19} /></button>}
      />
      <section className="p-group">
        <h2 className="p-sub">Workspace</h2>
        <div className="p-list">
          <DocRows docs={mine} parent={null} depth={0} />
          {!mine.length && <div className="p-empty">No docs yet. Tap + to write one.</div>}
        </div>
      </section>
      {!notes && sources.map((s) => <SourceGroup key={s.id} id={s.id} docs={docs.filter((d) => d.sourceId === s.id)} />)}
      {!notes && <button className="p-quiet" onClick={() => useStore.getState().setUI({ connectOpen: true })}>
        <HardDriveUpload size={16} /> {sources.length ? 'Connect more storage' : 'Keep docs in Google Drive, GitHub or a folder'}
      </button>}
    </div>
  )
}

function SourceGroup({ id, docs }: { id: string; docs: Item[] }) {
  const src = useStore((s) => s.sources.find((x) => x.id === id))!
  const st = useSync((s) => s.st[id])
  const [commitOpen, setCommitOpen] = useState(false)
  const pending = docs.length ? pendingChanges(id) : []
  const status = st?.status || 'idle'
  return (
    <section className="p-group">
      <h2 className="p-sub">
        <SourceIcon kind={src.kind} size={13} /> <span className="grow">{src.name}</span>
        {status === 'needs-auth' && <button className="text-btn" onClick={() => reconnect(id)}>Reconnect</button>}
        {src.kind === 'github' && pending.length > 0 && (
          <button className="commit-pill" onClick={() => setCommitOpen(!commitOpen)}><GitCommitHorizontal size={13} /> {pending.length}</button>
        )}
        <button className="icon-btn" onClick={() => pull(id)} aria-label="Sync"><RefreshCw size={15} className={status === 'syncing' ? 'spin' : ''} /></button>
        <button className="icon-btn" onClick={() => createFile(id)} aria-label="New file"><Plus size={16} /></button>
      </h2>
      {commitOpen && <CommitBox id={id} pending={pending} onClose={() => setCommitOpen(false)} />}
      <div className="p-list">
        <DocRows docs={docs} parent={null} depth={0} />
        {!docs.length && <div className="p-empty">{status === 'syncing' ? 'Loading files…' : 'No Markdown files yet'}</div>}
      </div>
    </section>
  )
}

function DocRows({ docs, parent, depth }: { docs: Item[]; parent: string | null; depth: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const level = docs
    .filter((d) => d.parentId === parent)
    .sort(docOrder)
  return (
    <>
      {level.map((d) => {
        const kids = docs.some((c) => c.parentId === d.id)
        const on = open[d.id]
        return (
          <div key={d.id}>
            <DocRow d={d} depth={depth} kids={kids} on={!!on} toggle={() => setOpen({ ...open, [d.id]: !on })} />
            {kids && on && <DocRows docs={docs} parent={d.id} depth={depth + 1} />}
          </div>
        )
      })}
    </>
  )
}

function DocRow({ d, depth, kids, on, toggle }: { d: Item; depth: number; kids: boolean; on: boolean; toggle: () => void }) {
  const hold = useLongPress((e) => openMenu(e, docMenu(d)))
  const folder = d.file?.dir
  return (
    <button className="p-row" style={{ paddingLeft: 16 + depth * 18 }} onClick={() => (folder ? toggle() : useStore.getState().open(d.id))} onContextMenu={(e) => openMenu(e, docMenu(d))} {...hold}>
      <span className="emo">{folder ? <Folder size={17} /> : itemEmoji(d) || <FileText size={17} />}</span>
      <span className="name">{d.title || 'Untitled'}</span>
      {kids && (
        <span className={`chev ${on ? 'on' : ''}`} onClick={(e) => (e.stopPropagation(), toggle())} role="button" aria-label={on ? 'Collapse' : 'Expand'}>
          <ChevronRight size={16} />
        </span>
      )}
    </button>
  )
}
