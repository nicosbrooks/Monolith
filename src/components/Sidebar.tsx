import { useMemo, useState } from 'react'
import {
  LayoutGrid, CalendarDays, FileText, Mic, Trash2, Plus, Folder, Settings, ChevronRight, PanelLeft, FolderPlus, 
  AudioWaveform, RefreshCw, Search, ListChecks, GitCommitHorizontal, CircleAlert, Pencil, Star, StarOff, FilePlus2, Unplug, Inbox,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import type { Item, Section } from '../types'
import { commit, createFile, disconnect, isDirty, pendingChanges, pull, reconnect, useSync } from '../storage/sync'
import { SourceIcon } from './StorageSettings'
import { confirmDialog, openMenu, type MenuItem } from './Overlays'
import { toast } from './Toast'
import { APP_NAME } from '../brand'
import { itemEmoji } from '../lib/util'
import { startRecording } from '../lib/recordNext'
import { rowMenu } from '../views/ItemList'
import { useWorkspace } from '../lib/graph'

/** The mark: an upright slab, 4 wide to 9 tall. Also the selection marker and the assistant's waiting sign (soft.css). */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="3" width="8" height="18" rx="2" fill="currentColor" />
    </svg>
  )
}

/** Which sidebar groups are folded, remembered in this browser. */
const FOLD_KEY = 'monolith-side-folded'
function useFolded() {
  const [folded, setFolded] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}')
    } catch {
      return {}
    }
  })
  const toggle = (id: string) =>
    setFolded((f) => {
      const next = { ...f, [id]: !f[id] }
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify(next))
      } catch {
        /* private window: folding just isn't remembered */
      }
      return next
    })
  return [folded, toggle] as const
}

/**
 * The sidebar. Its shape never depends on where you are: the same rows in the same places on every page, so nothing
 * moves when you open something. Places at the top, then your docs, folders and recordings as groups you can fold,
 * then Recently Deleted and Settings at the bottom.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  // Only what the sidebar itself shows; the doc trees subscribe to items on their own.
  const view = useStore(useShallow((x) => ({ section: x.section, folders: x.folders, sources: x.sources })))
  const s = { ...useStore.getState(), ...view }
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [folded, toggle] = useFolded()
  const deleteFolder = async (id: string, name: string) => {
    const n = useStore.getState().items.filter((i) => i.folderId === id && !i.deletedAt).length
    if (await confirmDialog({ title: `Delete “${name}”?`, body: n ? `Its ${n} doc${n > 1 ? 's' : ''} stay in Docs. Nothing is deleted.` : undefined, confirm: 'Delete folder' })) s.deleteFolder(id)
  }

  const nav = (id: Section, label: string, Icon: typeof LayoutGrid, n?: number) => (
    <button className={`nav ${s.section === id ? 'on' : ''}`} onClick={() => (s.go(id), onNavigate?.())}>
      <Icon size={17} strokeWidth={1.8} />
      <span>{label}</span>
      <em>{n || ''}</em>
    </button>
  )

  /** A group's heading: folds it, and has the one way to add to it. */
  const group = (id: string, label: React.ReactNode, add?: { title: string; run: () => void; icon?: typeof Plus }, menu?: (e: React.MouseEvent) => void) => (
    <div className="side-group" onContextMenu={menu}>
      <button className="side-group-head" onClick={() => toggle(id)} aria-expanded={!folded[id]}>
        <ChevronRight size={12} className={`side-chev ${folded[id] ? '' : 'open'}`} />
        <span>{label}</span>
      </button>
      {add && (
        <button className="icon-btn sm side-group-add" title={add.title} aria-label={add.title} onClick={add.run}>
          {add.icon ? <add.icon size={13} /> : <Plus size={14} />}
        </button>
      )}
    </div>
  )

  return (
    <aside className="sidebar">
      <div className="side-top">
        <div className="brand">
          <Logo />
          <span>{APP_NAME}</span>
        </div>
        <div className="side-icons">
          <button className="icon-btn" title="Collapse sidebar (⌘\)" aria-label="Collapse sidebar" onClick={() => s.setUI({ sidebarCollapsed: true })}><PanelLeft size={17} /></button>
        </div>
      </div>
      <button className="side-search" onClick={() => (s.setUI({ paletteOpen: true }), onNavigate?.())}>
        <Search size={15} strokeWidth={1.9} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="side-scroll">
        {nav('home', 'Home', LayoutGrid)}
        <TasksNav nav={nav} />
        {nav('calendar', 'Calendar', CalendarDays)}

        {group('docs', 'Docs', { title: 'New doc (⌘N)', run: () => (useStore.setState({ folderId: null }), s.createItem('doc'), onNavigate?.()) })}
        {!folded.docs && <div className="side-tree"><DocTree onNavigate={onNavigate} /></div>}

        {(s.folders.length > 0 || newFolder !== null) && group('folders', 'Folders', { title: 'New folder', icon: FolderPlus, run: () => setNewFolder('') })}
        <div className="side-tree">
        {!folded.folders && s.folders.map((f) =>
          renaming?.id === f.id ? (
            <input
              key={f.id}
              className="folder-input"
              autoFocus
              value={renaming.name}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
              onBlur={() => (renaming.name.trim() && s.renameFolder(f.id, renaming.name.trim()), setRenaming(null))}
              onKeyDown={(e) => (e.key === 'Enter' ? (e.target as HTMLInputElement).blur() : e.key === 'Escape' && setRenaming(null))}
            />
          ) : (
            <div key={f.id}>
              <div
                className="nav sub folder"
                onClick={() => toggle(`f:${f.id}`)}
                onDoubleClick={() => setRenaming({ id: f.id, name: f.name })}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: 'New doc here', icon: FilePlus2, run: () => s.createItem('doc', { folderId: f.id }) },
                    { label: 'Rename', icon: Pencil, run: () => setRenaming({ id: f.id, name: f.name }) },
                    'sep',
                    { label: 'Delete folder', icon: Trash2, danger: true, run: () => deleteFolder(f.id, f.name) },
                  ])
                }
              >
                <span className="emoji"><span className="ico"><Folder size={15} strokeWidth={1.8} /></span></span>
                <button type="button" className="tree-title" aria-expanded={!folded[`f:${f.id}`]}>{f.name}</button>
                <button className="icon-btn sm hover-only" title="New doc here" aria-label={`New doc in ${f.name}`} onClick={(e) => (e.stopPropagation(), s.createItem('doc', { folderId: f.id }), onNavigate?.())}><Plus size={12} /></button>
              </div>
              {!folded[`f:${f.id}`] && <div className="side-tree nested"><DocTree folderId={f.id} onNavigate={onNavigate} /></div>}
            </div>
          ),
        )}
        {newFolder !== null && (
          <input
            className="folder-input"
            autoFocus
            placeholder="Folder name"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onBlur={() => (newFolder.trim() && s.createFolder(newFolder.trim()), setNewFolder(null))}
            onKeyDown={(e) => (e.key === 'Enter' ? (e.target as HTMLInputElement).blur() : e.key === 'Escape' && setNewFolder(null))}
          />
        )}
        </div>

        {group('recordings', 'Recordings', { title: 'Start recording', icon: Mic, run: () => (startRecording(), onNavigate?.()) })}
        {!folded.recordings && <div className="side-tree"><RecordingList /></div>}

        {s.sources.map((src) => <SourceTree key={src.id} id={src.id} />)}
      </nav>
      <div className="side-foot">
        <TrashNav nav={nav} />
        <button className="nav" onClick={() => (s.setUI({ settingsOpen: true }), onNavigate?.())}>
          <Settings size={17} strokeWidth={1.8} />
          <span>Settings</span>
          <em><kbd>⌘,</kbd></em>
        </button>
      </div>
    </aside>
  )
}

/** Tasks, with how many are open. Its own component so only this row re-reads docs as they change. */
function TasksNav({ nav }: { nav: (id: Section, label: string, Icon: typeof LayoutGrid, n?: number) => React.ReactNode }) {
  const n = useWorkspace().tasks.length
  return <>{nav('tasks', 'Tasks', ListChecks, n)}</>
}

/** Recently Deleted, with how many things are waiting there. */
function TrashNav({ nav }: { nav: (id: Section, label: string, Icon: typeof LayoutGrid, n?: number) => React.ReactNode }) {
  const n = useStore((s) => s.items.reduce((k, i) => k + (i.deletedAt ? 1 : 0), 0))
  return <>{nav('trash', 'Recently Deleted', Trash2, n)}</>
}

/** How many rows a level shows before "Show more": a list of thousands is slow to draw and no use to read. */
const ROWS = 100

/** Docs grouped by parent, each group in order, worked out once for the whole tree. */
function byParent(docs: Item[]) {
  const map = new Map<string | null, Item[]>()
  for (const d of docs) {
    const list = map.get(d.parentId)
    if (list) list.push(d)
    else map.set(d.parentId, [d])
  }
  for (const list of map.values()) list.sort(docOrder)
  return map
}

function Tree({ docs, depth = 0, parent = null, groups, onNavigate }: { docs: Item[]; depth?: number; parent?: string | null; groups?: Map<string | null, Item[]>; onNavigate?: () => void }) {
  const activeId = useStore((s) => s.activeId)
  const section = useStore((s) => s.section)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [shown, setShown] = useState(ROWS)
  const map = useMemo(() => groups ?? byParent(docs), [groups, docs])
  const level = map.get(parent) ?? []
  // The open doc is always in view, even when it sits past the cut.
  const at = level.findIndex((d) => d.id === activeId)
  const rows = level.length <= shown ? level : at >= shown ? [...level.slice(0, shown), level[at]] : level.slice(0, shown)
  return (
    <>
      {rows
        .map((d) => {
          const kids = map.has(d.id)
          const holdsActive = () => {
            const byId = (id: string | null) => (id ? docs.find((x) => x.id === id) : undefined)
            for (let p = byId(activeId); p; p = byId(p.parentId)) if (p.parentId === d.id) return true
            return false
          }
          const open = closed[d.id] === undefined ? !d.file?.dir || holdsActive() : !closed[d.id]
          const toggle = () => setClosed((c) => ({ ...c, [d.id]: open }))
          return (
            <div key={d.id}>
              <div
                className={`nav sub doc ${section === 'docs' && activeId === d.id ? 'on' : ''}`}
                style={{ paddingLeft: 17 + depth * 12 }}
                onClick={() => (useStore.getState().open(d.id), onNavigate?.())}
                onContextMenu={(e) => openMenu(e, docMenu(d))}
              >
                {/* Items line up with the section rows; a doc with sub-docs swaps its icon for the arrow on hover. */}
                <span
                  className={`emoji ${kids ? 'has-kids' : ''} ${open ? 'open' : ''}`}
                  role={kids ? 'button' : undefined}
                  aria-label={kids ? (open ? 'Collapse' : 'Expand') : undefined}
                  aria-expanded={kids ? open : undefined}
                  onClick={kids ? (e) => (e.stopPropagation(), toggle()) : undefined}
                >
                  <span className="ico">{d.file?.dir ? <Folder size={15} strokeWidth={1.8} /> : itemEmoji(d) || <FileText size={15} />}</span>
                  {kids && <ChevronRight size={13} className="chev" />}
                </span>
                <button type="button" className="tree-title" title={d.title || undefined} onClick={(e) => { e.stopPropagation(); useStore.getState().open(d.id); onNavigate?.() }}>{d.title || 'Untitled'}</button>
                {d.file?.conflict ? <i className="file-dot conflict" title="Changed in two places" /> : isDirty(d) ? <i className="file-dot" title="Unsaved changes" /> : null}
                {(!d.sourceId || d.file?.dir) && (
                  <button
                    className="icon-btn sm hover-only"
                    title={d.sourceId ? 'New file here' : 'Add sub-doc'}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (d.sourceId) createFile(d.sourceId, d.id)
                      else useStore.getState().createItem('doc', { parentId: d.id })
                      setClosed((c) => ({ ...c, [d.id]: false }))
                    }}
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
              {kids && open && <Tree docs={docs} depth={depth + 1} parent={d.id} groups={map} onNavigate={onNavigate} />}
            </div>
          )
        })}
      {level.length > shown && (
        <button className="nav sub more-rows" style={{ paddingLeft: 17 + depth * 12 }} onClick={() => setShown((n) => n + ROWS)}>
          Show {Math.min(ROWS, level.length - shown)} more of {level.length}
        </button>
      )}
    </>
  )
}

/** Docs order: sources keep folders-then-name; your own docs are favourites first, then most recently edited. */
export const docOrder = (a: Item, b: Item) =>
  a.sourceId ? Number(!!b.file?.dir) - Number(!!a.file?.dir) || a.title.localeCompare(b.title) : Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt

export function docMenu(d: Item): MenuItem[] {
  const st = useStore.getState()
  const local = !d.sourceId
  const newHere: MenuItem = d.sourceId
    ? { label: d.file?.dir ? 'New file here' : 'New file next to this', icon: FilePlus2, run: () => createFile(d.sourceId!, d.id) }
    : { label: 'Add sub-doc', icon: FilePlus2, run: () => st.createItem('doc', { parentId: d.id }) }
  if (d.file?.dir) return [newHere]
  return [
    newHere,
    { label: d.pinned ? 'Remove from favorites' : 'Add to favorites', icon: d.pinned ? StarOff : Star, run: () => st.updateItem(d.id, { pinned: !d.pinned }) },
    ...(local && st.folders.length ? [{ heading: 'Move to' }, { label: 'No folder', icon: Inbox, checked: !d.folderId, run: () => st.updateItem(d.id, { folderId: null }) }, ...st.folders.map((f): MenuItem => ({ label: f.name, icon: Folder, checked: d.folderId === f.id, run: () => st.updateItem(d.id, { folderId: f.id }) }))] : []),
    'sep',
    { label: 'Delete', icon: Trash2, danger: true, run: () => (st.trashItem(d.id), toast('Doc moved to Recently Deleted', { action: { label: 'Undo', run: () => st.restoreItem(d.id) } })) },
  ]
}

/**
 * Your own docs as a tree. Each doc shows once: in the folder its top-level doc is in, or under Docs when that has no
 * folder. Sub-docs stay with their parent.
 */
function DocTree({ folderId = null, onNavigate }: { folderId?: string | null; onNavigate?: () => void }) {
  const items = useStore((s) => s.items)
  const docs = useMemo(() => {
    const mine = items.filter((i) => i.kind === 'doc' && !i.deletedAt && !i.sourceId)
    const byId = new Map(mine.map((d) => [d.id, d]))
    const home = (d: Item) => {
      let top = d
      for (let n = 0; top.parentId && byId.has(top.parentId) && n < 50; n++) top = byId.get(top.parentId)!
      return top.folderId ?? null
    }
    // A doc whose parent was deleted sits at the top level.
    return mine.filter((d) => home(d) === folderId).map((d) => (d.parentId && !byId.has(d.parentId) ? { ...d, parentId: null } : d))
  }, [items, folderId])
  if (!docs.length) return folderId ? null : <div className="side-empty">No docs yet</div>
  return <Tree docs={docs} onNavigate={onNavigate} />
}

/** Recordings, newest first (pinned on top), the latest few until you ask for more. Only re-renders when a recording changes. */
function RecordingList() {
  const recs = useStore(useShallow((s) => s.items.filter((i) => i.kind === 'lecture' && !i.deletedAt)))
  const activeId = useStore((s) => s.activeId)
  const [shown, setShown] = useState(6)
  const sorted = [...recs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
  if (!sorted.length) return <div className="side-empty">No recordings yet</div>
  // The open recording is always in view, even past the cut.
  const at = sorted.findIndex((r) => r.id === activeId)
  const rows = at >= shown ? [...sorted.slice(0, shown), sorted[at]] : sorted.slice(0, shown)
  return (
    <>
      {rows.map((r) => (
        <div key={r.id} className={`nav sub doc ${activeId === r.id ? 'on' : ''}`} style={{ paddingLeft: 17 }} onClick={() => useStore.getState().open(r.id)} onContextMenu={(e) => openMenu(e, rowMenu(r))}>
          <span className="emoji"><span className="ico"><AudioWaveform size={15} /></span></span>
          <button type="button" className="tree-title" title={r.title || undefined} onClick={(e) => { e.stopPropagation(); useStore.getState().open(r.id) }}>{r.title || 'Untitled'}</button>
        </div>
      ))}
      {sorted.length > shown && (
        <button className="nav sub more-rows" style={{ paddingLeft: 17 }} onClick={() => setShown((n) => n + 20)}>
          Show {Math.min(20, sorted.length - shown)} more of {sorted.length}
        </button>
      )}
    </>
  )
}

function SourceTree({ id }: { id: string }) {
  const src = useStore((s) => s.sources.find((x) => x.id === id))!
  const items = useStore((s) => s.items)
  const st = useSync((s) => s.st[id])
  const [commitOpen, setCommitOpen] = useState(false)
  const docs = items.filter((i) => i.sourceId === id && !i.deletedAt)
  const pending = items.some((i) => i.sourceId === id) ? pendingChanges(id) : []
  const status = st?.status || 'idle'
  return (
    <>
      <div
        className="side-label source"
        title={st?.error}
        onContextMenu={(e) =>
          openMenu(e, [
            { label: 'New file', icon: Plus, run: () => createFile(id) },
            { label: 'Sync now', icon: RefreshCw, run: () => pull(id) },
            'sep',
            {
              label: 'Disconnect',
              icon: Unplug,
              danger: true,
              run: async () => {
                const n = pending.length
                if (await confirmDialog({ title: `Disconnect ${src.name}?`, body: n ? `${n} unsaved change${n > 1 ? 's' : ''} will be lost. The files themselves are not touched.` : 'Its docs are removed from the app. The files themselves stay where they are.', confirm: 'Disconnect', danger: !!n })) disconnect(id)
              },
            },
          ])
        }
      >
        <SourceIcon kind={src.kind} size={12} />
        <span className="src-name">{src.name}</span>
        {status === 'needs-auth' ? (
          <button className="text-btn xs" onClick={() => reconnect(id)}>Reconnect</button>
        ) : status === 'error' ? (
          <CircleAlert size={12} className="src-err" />
        ) : null}
        {src.kind === 'github' && pending.length > 0 && (
          <button className="commit-pill" onClick={() => setCommitOpen(!commitOpen)} title="Commit changes"><GitCommitHorizontal size={12} /> {pending.length}</button>
        )}
        <button className="icon-btn sm" title="Sync" onClick={() => pull(id)}><RefreshCw size={12} className={status === 'syncing' ? 'spin' : ''} /></button>
        <button className="icon-btn sm" title="New file" onClick={() => createFile(id)}><Plus size={13} /></button>
      </div>
      {commitOpen && <CommitBox id={id} pending={pending} onClose={() => setCommitOpen(false)} />}
      {docs.length ? <Tree docs={docs} /> : <div className="side-empty">{status === 'syncing' ? 'Loading files…' : 'No Markdown files yet'}</div>}
    </>
  )
}

export function CommitBox({ id, pending, onClose }: { id: string; pending: Item[]; onClose: () => void }) {
  const [msg, setMsg] = useState(pending.length === 1 ? `Update ${pending[0].title || 'Untitled'}` : `Update ${pending.length} notes`)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="commit-box"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const ok = await commit(id, msg.trim() || 'Update notes')
        setBusy(false)
        if (ok) onClose()
      }}
    >
      <ul>
        {pending.map((i) => (
          <li key={i.id}>
            <span className={`chg ${i.deletedAt ? 'd' : i.file?.path ? 'm' : 'a'}`}>{i.deletedAt ? 'D' : i.file?.path ? 'M' : 'A'}</span>
            {i.title || 'Untitled'}
          </li>
        ))}
      </ul>
      <input autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      <button className="btn sm primary" disabled={busy}>{busy ? 'Committing…' : 'Commit to GitHub'}</button>
    </form>
  )
}
