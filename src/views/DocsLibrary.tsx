import { useMemo, useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { AudioWaveform, FilePlus2, FileText, FolderPlus, Mic, MoreHorizontal, Pin, Search, Upload, X } from 'lucide-react'
import { useStore } from '../store'
import { openDoc, useSidePane } from '../lib/panes'
import { formatDuration, itemEmoji, preview } from '../lib/util'
import { openMenu } from '../components/Overlays'
import { docMenu } from '../components/Sidebar'
import { rowMenu } from './ItemList'
import { startRecording, uploadRecording } from '../lib/recordNext'
import type { Item } from '../types'

/** Docs or Recordings with nothing open: every one as a card on a wide page, filtered by folder or search. */
export function DocsLibrary({ kind }: { kind: 'doc' | 'lecture' }) {
  const items = useStore((s) => s.items)
  const folders = useStore((s) => s.folders)
  const folderId = useStore((s) => s.folderId)
  const [q, setQ] = useState('')
  const st = useStore.getState()
  const docs = kind === 'doc'

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return items
      .filter((i) => i.kind === kind && !i.deletedAt && !i.file?.dir)
      .filter((i) => !docs || !folderId || i.folderId === folderId)
      .filter((i) => !ql || i.title.toLowerCase().includes(ql) || i.content.toLowerCase().includes(ql))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }, [items, kind, docs, folderId, q])

  const create = () => (docs ? st.createItem('doc', folderId ? { folderId } : undefined) : startRecording())
  // A new folder is named in place, as a chip beside the others: no browser prompt.
  const [naming, setNaming] = useState<string | null>(null)
  const saveFolder = () => {
    const name = naming?.trim()
    if (name) st.createFolder(name)
    setNaming(null)
  }
  const title = docs ? 'Docs' : 'Recordings'
  const total = items.filter((i) => i.kind === kind && !i.deletedAt && !i.file?.dir).length

  return (
    <div className="lib page-scroll">
      <div className="lib-col">
        {/* The same header as Home, Tasks and Recently Deleted: title, one quiet line, actions as pills on the right. */}
        <header className="hm-head">
          <h1>{title}</h1>
          <p>{total ? `${total} ${docs ? (total === 1 ? 'doc' : 'docs') : total === 1 ? 'recording' : 'recordings'}` : docs ? 'Nothing here yet' : 'Nothing recorded yet'}</p>
          <div className="hm-quick">
            {docs ? (
              <button onClick={() => setNaming('')}><FolderPlus size={15} aria-hidden="true" /> New folder</button>
            ) : (
              <button onClick={uploadRecording}><Upload size={15} aria-hidden="true" /> Upload audio</button>
            )}
            <button className={`primary ${docs ? '' : 'rec'}`} onClick={create}>
              {docs ? <FilePlus2 size={15} aria-hidden="true" /> : <i className="rec-mark" aria-hidden="true" />} {docs ? 'New doc' : 'Record'}
            </button>
          </div>
        </header>

        <div className="lib-bar">
          <label className="lib-search">
            <Search size={15} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}`} aria-label={`Search ${title.toLowerCase()}`} />
            {q && <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Clear"><X size={13} /></button>}
          </label>
          {docs && (folders.length > 0 || naming !== null) && (
            <div className="lib-chips" role="group" aria-label="Folders">
              <button className={!folderId ? 'on' : ''} onClick={() => useStore.setState({ folderId: null })}>All</button>
              {folders.map((f) => <button key={f.id} className={folderId === f.id ? 'on' : ''} onClick={() => st.setFolder(f.id)}>{f.name}</button>)}
              {naming !== null && (
                <input
                  autoFocus
                  value={naming}
                  placeholder="Folder name"
                  aria-label="Folder name"
                  onChange={(e) => setNaming(e.target.value)}
                  onBlur={saveFolder}
                  onKeyDown={(e) => (e.key === 'Enter' ? saveFolder() : e.key === 'Escape' && (e.stopPropagation(), setNaming(null)))}
                />
              )}
            </div>
          )}
        </div>

        {list.length ? (
          <div className="lib-grid">
            {list.map((i) => <Card key={i.id} item={i} />)}
          </div>
        ) : (
          <div className="lib-empty">
            <span className="blank-ico">{docs ? <FileText size={22} strokeWidth={1.7} /> : <Mic size={22} strokeWidth={1.7} />}</span>
            <b>{q ? `No matches for “${q}”` : docs ? 'No docs here' : 'No recordings yet'}</b>
            {!q && <p>{docs ? 'Start one, or press ⌘N.' : 'Record a class or meeting. You get a transcript, and notes written for you.'}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

/** A doc or recording as a card: icon, title, its first lines, when it was edited. Docs, Recordings and Home's Recent
 *  row share it. Opens like any doc in a list (beside the page on Home; ⌘-click beside from anywhere). */
export function Card({ item }: { item: Item }) {
  const rec = item.kind === 'lecture'
  const emoji = itemEmoji(item)
  // The doc open beside the page is marked, so you can see which card it came from.
  const beside = useSidePane((s) => s.id === item.id)
  const text = rec
    ? `${formatDuration(item.lecture?.duration || 0)} · ${item.lecture?.transcript.length ? 'Transcribed' : item.lecture?.hasAudio ? 'Audio saved' : 'Not recorded'}`
    : preview(item.content, item.title)
  return (
    <div className="lib-cell">
    <button className={`lib-card ${beside ? 'on' : ''}`} aria-current={beside ? 'true' : undefined} onClick={(e) => openDoc(item.id, e)} onContextMenu={(e) => openMenu(e, rec ? rowMenu(item) : docMenu(item))}>
      <span className="lib-card-top">
        <span className="lib-ico">{emoji || (rec ? <AudioWaveform size={16} strokeWidth={1.8} /> : <FileText size={16} strokeWidth={1.8} />)}</span>
        {item.pinned && <Pin size={12} className="pin" aria-label="Favorite" />}
      </span>
      <b>{item.title || (rec ? 'Untitled recording' : 'Untitled')}</b>
      <span className="lib-card-text">{text || 'No additional text'}</span>
      <small>{Date.now() - item.updatedAt < 60_000 ? 'Just now' : formatDistanceToNowStrict(item.updatedAt, { addSuffix: true })}</small>
    </button>
    <button className="lib-more" aria-label="More" title="More" onClick={(e) => openMenu(e, rec ? rowMenu(item) : docMenu(item))}><MoreHorizontal size={16} /></button>
    </div>
  )
}
