import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { FileText, Search, Upload, X } from 'lucide-react'
import { VaultIcon } from './icons'
import { fileUrl, formatSize, type VaultFile } from '../lib/files'
import { uploadFiles, useVaultFiles } from '../views/VaultView'
import { kindOf } from './FileViewer'

/**
 * Choosing a file from the Vault to link in a doc (the doc's / menu › From the Vault). Resolves with the file, or null
 * if closed. The doc gets a link to it; the file itself stays in the Vault.
 */
const usePicker = create<{ done: ((f: VaultFile | null) => void) | null }>(() => ({ done: null }))
export const pickFromVault = () => new Promise<VaultFile | null>((done) => usePicker.setState({ done }))

export function VaultPicker() {
  const done = usePicker((s) => s.done)
  if (!done) return null
  const finish = (f: VaultFile | null) => (usePicker.setState({ done: null }), done(f))
  return <Picker finish={finish} />
}

function Picker({ finish }: { finish: (f: VaultFile | null) => void }) {
  const files = useVaultFiles()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const shown = useMemo(() => (files ?? []).filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase())), [files, q])
  useEffect(() => setSel(0), [q])
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') (e.stopPropagation(), finish(null))
    else if (e.key === 'ArrowDown') (e.preventDefault(), setSel(Math.min(sel + 1, shown.length - 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel(Math.max(sel - 1, 0)))
    else if (e.key === 'Enter' && shown[sel]) (e.preventDefault(), finish(shown[sel]))
  }
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && finish(null)}>
      <div className="modal vault-pick" role="dialog" aria-modal="true" aria-label="Link a file from the Vault" onKeyDown={key}>
        <header>
          <VaultIcon size={16} aria-hidden="true" />
          <h2>Link a file from the Vault</h2>
          <button className="icon-btn" onClick={() => finish(null)} aria-label="Close"><X size={16} /></button>
        </header>
        <label className="lib-search">
          <Search size={15} aria-hidden="true" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" aria-label="Search files" />
        </label>
        <div className="vault-pick-list" role="listbox" aria-label="Files">
          {shown.map((f, i) => (
            <button key={f.hash} role="option" aria-selected={i === sel} className={`vault-pick-row ${i === sel ? 'on' : ''}`} onClick={() => finish(f)} onMouseMove={() => setSel(i)}>
              <Thumb f={f} />
              <b>{f.name}</b>
              <small>{formatSize(f.size)}</small>
            </button>
          ))}
          {files !== null && !shown.length && (
            <p className="hm-empty">
              {files.length ? 'No files match.' : 'The Vault is empty.'}{' '}
              <button className="btn sm" onClick={() => (finish(null), uploadFiles())}><Upload size={14} /> Upload files</button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Thumb({ f }: { f: VaultFile }) {
  const [url, setUrl] = useState<string>()
  const pic = kindOf(f.name, f.type) === 'image'
  useEffect(() => void (pic && fileUrl(f.hash).then(setUrl)), [f.hash, pic])
  return <span className="vault-pick-thumb">{url ? <img src={url} alt="" /> : <FileText size={15} />}</span>
}
