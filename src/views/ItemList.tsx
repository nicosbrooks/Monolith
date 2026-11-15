import { useMemo, useState } from 'react'
import { isToday, isYesterday, differenceInDays, format } from 'date-fns'
import { LayoutGrid, List, Pin, PinOff, Search, SquarePen, Mic, Hash, X, Trash2, RotateCcw, FolderInput, Inbox, Ellipsis, FolderPlus, Settings, ChevronLeft } from 'lucide-react'
import { motion } from 'motion/react'
import { useStore } from '../store'
import type { Item, ItemKind } from '../types'
import { formatDuration, preview } from '../lib/util'
import { confirmDialog, openMenu, type MenuItem } from '../components/Overlays'
import { toast } from '../components/Toast'
import { useLongPress, useMobile, useScrolled } from '../lib/useMobile'
import { recordWhenOpened } from '../lib/recordNext'
import { PhoneTitle } from '../components/Phone'

function group(t: number) {
  if (isToday(t)) return 'Today'
  if (isYesterday(t)) return 'Yesterday'
  const d = differenceInDays(Date.now(), t)
  if (d < 7) return 'Previous 7 Days'
  if (d < 30) return 'Previous 30 Days'
  return format(t, 'MMMM yyyy')
}

export function ItemList({ kind, trash }: { kind?: ItemKind; trash?: boolean }) {
  const items = useStore((s) => s.items)
  const activeId = useStore((s) => s.activeId)
  const folderId = useStore((s) => s.folderId)
  const folders = useStore((s) => s.folders)
  const tag = useStore((s) => s.tagFilter)
  const [q, setQ] = useState('')
  const [grid, setGrid] = useState(false)
  const st = useStore.getState()
  const newItem = () => {
    const made = st.createItem(kind!, kind === 'lecture' ? { title: `Recording · ${format(new Date(), 'MMM d')}` } : {})
    if (kind === 'lecture') recordWhenOpened(made.id)
  }
  const newFolder = () => {
    const name = prompt('New folder')?.trim()
    if (name) st.createFolder(name)
  }

  const list = useMemo(() => {
    const ql = q.toLowerCase()
    return items
      .filter((i) => (trash ? !!i.deletedAt : !i.deletedAt && i.kind === kind))
      .filter((i) => trash || !folderId || kind !== 'note' || i.folderId === folderId)
      .filter((i) => !tag || i.tags.includes(tag))
      .filter((i) => !ql || i.title.toLowerCase().includes(ql) || i.content.toLowerCase().includes(ql))
      .sort((a, b) => (trash ? b.deletedAt! - a.deletedAt! : b.updatedAt - a.updatedAt))
  }, [items, kind, trash, folderId, tag, q])

  const pinned = list.filter((i) => i.pinned && !trash)
  const rest = list.filter((i) => !i.pinned || trash)
  const groups = new Map<string, Item[]>()
  rest.forEach((i) => {
    const g = trash ? 'Deleted items are removed after you empty them' : group(i.updatedAt)
    groups.set(g, [...(groups.get(g) || []), i])
  })

  const mobile = useMobile()
  const [scrolled, onScroll] = useScrolled()
  const title = trash ? 'Recently Deleted' : tag ? `#${tag}` : kind === 'note' ? (folders.find((f) => f.id === folderId)?.name ?? 'All Notes') : 'Recordings'

  const body = (
    <>
        {pinned.length > 0 && (
        <>
          <div className="list-group">Pinned</div>
          <div className="cards">{pinned.map((i) => <Row key={i.id} item={i} on={i.id === activeId} grid={grid} />)}</div>
        </>
      )}
      {[...groups.entries()].map(([g, its]) => (
        <div key={g}>
          <div className="list-group">{g}</div>
          <div className="cards">{its.map((i) => <Row key={i.id} item={i} on={i.id === activeId} grid={grid} />)}</div>
        </div>
      ))}
      {!list.length && (q ? (
        <div className="empty-list blank"><b>No matches for “{q}”</b></div>
      ) : trash ? (
        <div className="empty-list blank">
          <span className="blank-ico"><Trash2 size={22} strokeWidth={1.7} /></span>
          <b>Nothing deleted</b>
          <p>Docs and recordings you delete wait here, so you can get them back.</p>
        </div>
      ) : (
        <div className="empty-list blank">
          <span className="blank-ico"><Mic size={22} strokeWidth={1.7} /></span>
          <b>No recordings yet</b>
          <p>Record a class or meeting. You get a transcript, and notes written for you.</p>
          <button className="btn primary" onClick={newItem}><Mic size={15} /> Start recording</button>
        </div>
      ))}
    </>
  )

  if (mobile) {
    const tags = [...new Set(items.filter((i) => !i.deletedAt && i.kind === kind).flatMap((i) => i.tags))].slice(0, 12)
    const more = (e: React.MouseEvent) =>
      openMenu(e, [
        ...(kind === 'note' ? [{ label: grid ? 'View as list' : 'View as gallery', icon: grid ? List : LayoutGrid, run: () => setGrid(!grid) }, { label: 'New folder', icon: FolderPlus, run: newFolder }] : []),
        { label: 'Recently Deleted', icon: Trash2, run: () => st.go('trash') },
        'sep',
        { label: 'Settings', icon: Settings, run: () => st.setUI({ settingsOpen: true }) },
      ])
    return (
      <div className={`p-screen list-pane ${grid ? 'grid' : ''}`} onScroll={onScroll}>
        <PhoneTitle
          title={title}
          scrolled={scrolled}
          lead={trash ? <button className="icon-btn back" onClick={() => st.go('docs')} aria-label="Back"><ChevronLeft size={22} /></button> : undefined}
          actions={!trash && <button className="icon-btn" onClick={more} aria-label="More"><Ellipsis size={20} /></button>}
        />
        {(list.length > 8 || q) && <label className="search p-search">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={trash ? 'Search' : `Search ${kind}s`} />
          {q && <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Clear"><X size={14} /></button>}
        </label>}
        {kind === 'note' && !trash && (folders.length > 0 || tags.length > 0) && (
          <div className="p-chips">
            <button className={!folderId && !tag ? 'on' : ''} onClick={() => (st.setTag(null), useStore.setState({ folderId: null }))}>All</button>
            {folders.map((f) => <button key={f.id} className={folderId === f.id ? 'on' : ''} onClick={() => st.setFolder(f.id)}>{f.name}</button>)}
            {tags.map((t) => <button key={t} className={tag === t ? 'on' : ''} onClick={() => st.setTag(tag === t ? null : t)}>#{t}</button>)}
          </div>
        )}
        <div className="list-scroll">{body}</div>
      </div>
    )
  }

  return (
    <div className={`list-pane ${grid ? 'grid' : ''}`}>
      <header className="list-head">
        <div className="row">
          <h2>{title}</h2>
          {tag && <button className="icon-btn sm" onClick={() => st.setTag(null)}><X size={14} /></button>}
          <span className="grow" />
          {!trash && (
            <button
              className="icon-btn"
              aria-label="More"
              title="More"
              onClick={(e) =>
                openMenu(e, [
                  ...(kind === 'note' ? [{ label: grid ? 'View as list' : 'View as gallery', icon: grid ? List : LayoutGrid, run: () => setGrid(!grid) }, { label: 'New folder', icon: FolderPlus, run: newFolder }] : []),
                  { label: 'Recently Deleted', icon: Trash2, run: () => st.go('trash') },
                ])
              }
            >
              <Ellipsis size={16} />
            </button>
          )}
          {!trash && list.length > 0 && (
            <button className="icon-btn" onClick={newItem} title={kind === 'lecture' ? 'Start recording' : 'New'} aria-label={kind === 'lecture' ? 'Start recording' : 'New'}>
              {kind === 'lecture' ? <Mic size={16} /> : <SquarePen size={16} />}
            </button>
          )}
        </div>
        {(list.length > 8 || q) && (
          <label className="search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
          </label>
        )}
      </header>
      <div className="list-scroll">
{body}
      </div>
    </div>
  )
}

function rowMenu(item: Item): MenuItem[] {
  const st = useStore.getState()
  const what = item.kind === 'lecture' ? 'lecture' : item.kind
  if (item.deletedAt)
    return [
      { label: 'Recover', icon: RotateCcw, run: () => st.restoreItem(item.id) },
      { label: 'Delete forever', icon: Trash2, danger: true, run: async () => (await confirmDialog({ title: `Delete this ${what} forever?`, body: 'This can’t be undone.', confirm: 'Delete forever', danger: true })) && st.purgeItem(item.id) },
    ]
  const folders: MenuItem[] = item.kind === 'note'
    ? ['sep', { heading: 'Move to' }, { label: 'All Notes', icon: Inbox, checked: !item.folderId, run: () => st.updateItem(item.id, { folderId: null }) }, ...st.folders.map((f): MenuItem => ({ label: f.name, icon: FolderInput, checked: item.folderId === f.id, run: () => st.updateItem(item.id, { folderId: f.id }) }))]
    : []
  return [
    { label: item.pinned ? 'Unpin' : 'Pin to top', icon: item.pinned ? PinOff : Pin, run: () => st.updateItem(item.id, { pinned: !item.pinned }) },
    ...folders,
    'sep',
    { label: 'Delete', icon: Trash2, danger: true, run: () => (st.trashItem(item.id), toast(`${what[0].toUpperCase() + what.slice(1)} moved to Recently Deleted`, { action: { label: 'Undo', run: () => st.restoreItem(item.id) } })) },
  ]
}

function Row({ item, on, grid }: { item: Item; on: boolean; grid: boolean }) {
  const hold = useLongPress((e) => openMenu(e, rowMenu(item)))
  const img = grid ? item.content.match(/<img[^>]+src="([^"]+)"/)?.[1] : undefined
  return (
    <motion.button layout="position" className={`row-item ${on ? 'on' : ''}`} onClick={() => useStore.setState({ activeId: item.id })} onContextMenu={(e) => openMenu(e, rowMenu(item))} {...hold}>
      {grid && (
        <div className="thumb">
          {img ? <img src={img} alt="" /> : <div className="thumb-text" dangerouslySetInnerHTML={{ __html: item.content.replace(/<img[^>]*>/g, '').slice(0, 1200) }} />}
        </div>
      )}
      <div className="row-title">
        {item.pinned && <Pin size={11} className="pin" />}
        {item.title || (item.kind === 'lecture' ? 'Untitled lecture' : 'New Note')}
      </div>
      <div className="row-sub">
        <span className="date">{isToday(item.updatedAt) ? format(item.updatedAt, 'h:mm a') : format(item.updatedAt, 'M/d/yy')}</span>
        <span className="pv">
          {item.kind === 'lecture'
            ? `${formatDuration(item.lecture?.duration || 0)} · ${item.lecture?.transcript.length ? 'Transcribed' : item.lecture?.hasAudio ? 'Audio saved' : 'Not recorded'}`
            : preview(item.content, item.title) || 'No additional text'}
        </span>
      </div>
      {!grid && item.tags.length > 0 && (
        <div className="row-tags">{item.tags.slice(0, 3).map((t) => <span key={t}><Hash size={9} />{t}</span>)}</div>
      )}
    </motion.button>
  )
}
