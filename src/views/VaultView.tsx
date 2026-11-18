import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { FileSpreadsheet, FileText, Music, Film, Search, Upload, X } from 'lucide-react'
import { MoreIcon, VaultIcon } from '../components/icons'
import { useStore } from '../store'
import { FILE_ARRIVED, VAULT_CHANGED, deleteFile, fileUrl, formatSize, listFiles, refOf, refsIn, renameFile, uploadToVault, type VaultFile } from '../lib/files'
import { confirmDialog, openMenu } from '../components/Overlays'
import { kindOf, openViewer } from '../components/FileViewer'
import { toast, toastError } from '../components/Toast'
import { openDoc } from '../lib/panes'

/** Every file in the Vault, newest first, kept fresh as files arrive or leave. */
export function useVaultFiles() {
  const [files, setFiles] = useState<VaultFile[] | null>(null)
  useEffect(() => {
    let live = true
    const load = () => void listFiles().then((f) => live && setFiles(f))
    load()
    window.addEventListener(VAULT_CHANGED, load)
    window.addEventListener(FILE_ARRIVED, load)
    return () => {
      live = false
      window.removeEventListener(VAULT_CHANGED, load)
      window.removeEventListener(FILE_ARRIVED, load)
    }
  }, [])
  return files
}

/** Opens the file picker and puts what's chosen in the Vault. */
export function uploadFiles() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = async () => {
    const files = [...(input.files ?? [])]
    if (!files.length) return
    try {
      const n = await uploadToVault(files)
      toast(n === 1 ? `“${files[0].name}” is in the Vault` : `${n} files are in the Vault`, { action: { label: 'Open Vault', run: () => useStore.getState().go('vault') } })
    } catch (e) {
      toastError((e as Error).message || 'Couldn’t add that file.')
    }
  }
  input.click()
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Pictures' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'media', label: 'Audio and video' },
  { id: 'other', label: 'Other' },
] as const
type Filter = (typeof FILTERS)[number]['id']
const group = (f: VaultFile): Filter => {
  const k = kindOf(f.name, f.type)
  return k === 'image' ? 'image' : k === 'pdf' ? 'pdf' : k === 'audio' || k === 'video' ? 'media' : 'other'
}

/**
 * The Vault: every file you've added, in one place. Docs don't hold files, they link to them here, so the same file can
 * be in many docs and is stored once. Upload here (or from New), drag a file onto a doc to link it, or pick one from
 * the doc's / menu. A file stays until it's deleted here.
 */
export function VaultView() {
  const files = useVaultFiles()
  const items = useStore((s) => s.items)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [dropping, setDropping] = useState(false)

  // Which docs link to each file.
  const usedBy = useMemo(() => {
    const m = new Map<string, { id: string; title: string }[]>()
    for (const i of items) {
      if (i.deletedAt) continue
      for (const h of new Set(refsIn(i.content))) m.set(h, [...(m.get(h) ?? []), { id: i.id, title: i.title || 'Untitled' }])
    }
    return m
  }, [items])

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return (files ?? []).filter((f) => (filter === 'all' || group(f) === filter) && (!ql || f.name.toLowerCase().includes(ql)))
  }, [files, q, filter])
  const total = files?.reduce((n, f) => n + f.size, 0) ?? 0

  const drop = async (e: React.DragEvent) => {
    setDropping(false)
    const list = [...e.dataTransfer.files]
    if (!list.length) return
    e.preventDefault()
    try {
      const n = await uploadToVault(list)
      toast(n === 1 ? `“${list[0].name}” is in the Vault` : `${n} files are in the Vault`)
    } catch (err) {
      toastError((err as Error).message || 'Couldn’t add that file.')
    }
  }

  return (
    <div
      className={`lib vault page-scroll ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && (e.preventDefault(), setDropping(true))}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={drop}
    >
      <div className="lib-col">
        <header className="hm-head">
          <h1>Vault</h1>
          <p>{files === null ? ' ' : files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatSize(total)}` : 'Nothing here yet'}</p>
          {/* With nothing here yet, the empty state has the Upload button; the header doesn't repeat it. */}
          {!!files?.length && (
            <div className="hm-quick">
              <button className="primary" onClick={uploadFiles}><Upload size={15} aria-hidden="true" /> Upload</button>
            </div>
          )}
        </header>

        {!!files?.length && (
          <div className="lib-bar">
            <label className="lib-search">
              <Search size={15} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" aria-label="Search files" />
              {q && <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Clear"><X size={13} /></button>}
            </label>
            <div className="lib-chips" role="group" aria-label="Kinds of file">
              {FILTERS.map((f) => <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
            </div>
          </div>
        )}

        {shown.length ? (
          <div className="vault-grid">
            {shown.map((f) => <FileCard key={f.hash} f={f} used={usedBy.get(f.hash) ?? []} />)}
          </div>
        ) : (
          files !== null && (
            <div className="lib-empty">
              <span className="blank-ico"><VaultIcon size={22} strokeWidth={1.7} /></span>
              <b>{q || filter !== 'all' ? 'No files match' : 'Your files live here'}</b>
              {!q && filter === 'all' && <p>Upload files, or drop them here. Docs link to them, so each one is stored once.</p>}
              {!q && filter === 'all' && <button className="btn primary" onClick={uploadFiles}><Upload size={15} /> Upload files</button>}
            </div>
          )
        )}
      </div>
      {dropping && <div className="vault-drop" aria-hidden="true"><Upload size={22} /> Drop to add to the Vault</div>}
    </div>
  )
}

function FileCard({ f, used }: { f: VaultFile; used: { id: string; title: string }[] }) {
  const kind = kindOf(f.name, f.type)
  const [thumb, setThumb] = useState<string>()
  const [renaming, setRenaming] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (kind === 'image') void fileUrl(f.hash).then(setThumb)
  }, [f.hash, kind])
  const Icon = kind === 'pdf' || kind === 'text' || kind === 'markdown' ? FileText : kind === 'csv' ? FileSpreadsheet : kind === 'audio' ? Music : kind === 'video' ? Film : VaultIcon
  const open = () => openViewer({ hash: f.hash, name: f.name, type: f.type, size: f.size })
  const download = async () => {
    const url = await fileUrl(f.hash)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = f.name
    a.click()
  }
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${f.name}” from the Vault?`,
      body: used.length ? `${used.length === 1 ? `“${used[0].title}” links` : `${used.length} docs link`} to it, and will show it as missing. This can’t be undone.` : 'This can’t be undone.',
      confirm: 'Delete',
      danger: true,
    })
    if (ok) await deleteFile(f.hash)
  }
  const menu = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Open', run: open },
      { label: 'Rename', run: () => (setRenaming(true), setTimeout(() => nameRef.current?.select(), 0)) },
      { label: 'Download', run: () => void download() },
      ...(used.length ? ['sep' as const, { heading: 'Linked from' }, ...used.slice(0, 8).map((d) => ({ label: d.title, run: () => openDoc(d.id) }))] : []),
      'sep',
      { label: 'Delete from the Vault', danger: true, run: () => void remove() },
    ])
  const saveName = (v: string) => (setRenaming(false), v.trim() && v.trim() !== f.name && void renameFile(f.hash, v))

  return (
    <div className="lib-cell">
      <button
        className="lib-card vault-card"
        onClick={open}
        onContextMenu={menu}
        draggable
        // Dragged onto a doc, it becomes a link to this file (a picture, or an attachment card).
        onDragStart={(e) => {
          e.dataTransfer.setData('text/html', `<img src="${refOf(f.hash)}" alt="${f.name.replace(/"/g, '&quot;')}">`)
          e.dataTransfer.setData('text/plain', f.name)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        title={`${f.name} · drag onto a doc to link it`}
      >
        <span className={`vault-thumb ${thumb ? 'pic' : ''}`}>
          {thumb ? <img src={thumb} alt="" draggable={false} /> : <Icon size={22} strokeWidth={1.6} />}
        </span>
        {renaming ? (
          <input
            ref={nameRef}
            className="vault-name-input"
            defaultValue={f.name}
            aria-label="File name"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => saveName(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' ? (e.target as HTMLInputElement).blur() : e.key === 'Escape' && (e.stopPropagation(), setRenaming(false)))}
          />
        ) : (
          <b>{f.name}</b>
        )}
        <small>
          {formatSize(f.size)} · {formatDistanceToNowStrict(f.at, { addSuffix: true })}
          {used.length > 0 && ` · in ${used.length === 1 ? '1 doc' : `${used.length} docs`}`}
        </small>
      </button>
      <button className="lib-more" aria-label={`More for ${f.name}`} title="More" onClick={menu}><MoreIcon size={16} /></button>
    </div>
  )
}
