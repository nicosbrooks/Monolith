import { useState } from 'react'
import {
  LayoutGrid, CalendarDays, FileText, Mic, Trash2, Plus, Folder, Settings, ChevronRight, PanelLeft, FolderPlus, 
  RefreshCw, GitCommitHorizontal, CircleAlert, Pencil, Star, StarOff, FilePlus2, Unplug, Inbox,
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

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8.25" y="3" width="7.5" height="18" rx="2" fill="currentColor" />
    </svg>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  // Only what the sidebar itself shows; the note and doc trees subscribe to items on their own.
  const view = useStore(useShallow((x) => ({ section: x.section, folderId: x.folderId, tagFilter: x.tagFilter, folders: x.folders, sources: x.sources })))
  const s = { ...useStore.getState(), ...view }
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const deleteFolder = async (id: string, name: string) => {
    const n = useStore.getState().items.filter((i) => i.folderId === id && !i.deletedAt).length
    if (await confirmDialog({ title: `Delete “${name}”?`, body: n ? `Its ${n} doc${n > 1 ? 's' : ''} stay in Docs. Nothing is deleted.` : undefined, confirm: 'Delete folder' })) s.deleteFolder(id)
  }

  const nav = (id: Section, label: string, Icon: typeof LayoutGrid, n?: number) => (
    <button className={`nav ${s.section === id && !(id === 'docs' && (s.folderId || s.tagFilter)) ? 'on' : ''}`} onClick={() => {
      useStore.setState({ folderId: null })
      s.go(id)
      if (onNavigate && (id === 'docs' || id === 'lectures')) useStore.setState({ activeId: null })
      onNavigate?.()
    }}>
      <Icon size={17} strokeWidth={1.8} />
      <span>{label}</span>
      {n ? <em>{n}</em> : null}
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="side-top">
        <div className="brand">
          <Logo />
          <span>{APP_NAME}</span>
        </div>
        <div className="side-icons">
          <button className="icon-btn" title="Collapse sidebar (⌘\)" onClick={() => s.setUI({ sidebarCollapsed: true })}><PanelLeft size={17} /></button>
          <button className="icon-btn" title="Settings (⌘,)" aria-label="Settings" onClick={() => s.setUI({ settingsOpen: true })}><Settings size={16} strokeWidth={1.8} /></button>
        </div>
      </div>

      <nav className="side-scroll">
        {nav('home', 'Home', LayoutGrid)}
        <div className={`nav-row ${s.section === 'docs' && !s.folderId ? 'here' : ''}`}>
          {nav('docs', 'Docs', FileText)}
          <button className="icon-btn sm nav-add" title="New doc (⌘N)" aria-label="New doc" onClick={() => (s.setFolder(null), s.createItem('doc'))}><Plus size={14} /></button>
        </div>
        {/* The doc tree opens under Docs while you're there, instead of a second list of docs below. */}
        {s.section === 'docs' && !s.folderId && <div className="side-tree"><DocTree /></div>}
        {nav('lectures', 'Recordings', Mic)}
        {nav('calendar', 'Calendar', CalendarDays)}

        {(s.folders.length > 0 || newFolder !== null) && (
          <div className="side-label">
            Folders
            <button className="icon-btn sm hover-only" onClick={() => setNewFolder('')} title="New folder"><FolderPlus size={13} /></button>
          </div>
        )}
        {s.folders.map((f) =>
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
              <button
                className={`nav sub ${s.section === 'docs' && s.folderId === f.id ? 'on' : ''}`}
                onClick={() => { s.setFolder(f.id); onNavigate?.() }}
                onDoubleClick={() => setRenaming({ id: f.id, name: f.name })}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: 'Rename', icon: Pencil, run: () => setRenaming({ id: f.id, name: f.name }) },
                    { label: 'New doc here', icon: FilePlus2, run: () => (s.setFolder(f.id), s.createItem('doc', { folderId: f.id })) },
                    'sep',
                    { label: 'Delete folder', icon: Trash2, danger: true, run: () => deleteFolder(f.id, f.name) },
                  ])
                }
              >
                <Folder size={16} strokeWidth={1.8} />
                <span>{f.name}</span>
              </button>
              {s.section === 'docs' && s.folderId === f.id && <div className="side-tree"><DocTree folderId={f.id} /></div>}
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
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        )}

        {s.sources.map((src) => <SourceTree key={src.id} id={src.id} />)}
        {nav('trash', 'Recently Deleted', Trash2)}
      </nav>
    </aside>
  )
}

function Tree({ docs, depth = 0, parent = null }: { docs: Item[]; depth?: number; parent?: string | null }) {
  const activeId = useStore((s) => s.activeId)
  const section = useStore((s) => s.section)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  return (
    <>
      {docs
        .filter((d) => d.parentId === parent)
        .sort(docOrder)
        .map((d) => {
          const kids = docs.some((c) => c.parentId === d.id)
          const holdsActive = () => {
            for (let p = docs.find((x) => x.id === activeId); p; p = docs.find((x) => x.id === p!.parentId)) if (p.parentId === d.id) return true
            return false
          }
          const open = closed[d.id] === undefined ? !d.file?.dir || holdsActive() : !closed[d.id]
          const toggle = () => setClosed((c) => ({ ...c, [d.id]: open }))
          return (
            <div key={d.id}>
              <div
                className={`nav sub doc ${section === 'docs' && activeId === d.id ? 'on' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => useStore.getState().open(d.id)}
                onContextMenu={(e) => openMenu(e, docMenu(d))}
              >
                <span className={`twisty ${kids ? '' : 'hide'} ${open ? 'open' : ''}`} onClick={(e) => (e.stopPropagation(), toggle())}>
                  <ChevronRight size={12} />
                </span>
                <span className="emoji">{d.file?.dir ? <Folder size={14} strokeWidth={1.8} /> : itemEmoji(d) || <FileText size={14} />}</span>
                <button type="button" className="tree-title" onClick={(e) => { e.stopPropagation(); useStore.getState().open(d.id) }}>{d.title || 'Untitled'}</button>
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
              {kids && open && <Tree docs={docs} depth={depth + 1} parent={d.id} />}
            </div>
          )
        })}
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

/** Your docs as a tree. Inside a folder, every doc in it sits at the top level even if its parent lives elsewhere. */
function DocTree({ folderId }: { folderId?: string }) {
  const items = useStore((s) => s.items)
  let docs = items.filter((i) => i.kind === 'doc' && !i.deletedAt && !i.sourceId && (!folderId || i.folderId === folderId))
  if (folderId) { const ids = new Set(docs.map((d) => d.id)); docs = docs.map((d) => (d.parentId && !ids.has(d.parentId) ? { ...d, parentId: null } : d)) }
  if (!docs.length) return null
  return <Tree docs={docs} />
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
