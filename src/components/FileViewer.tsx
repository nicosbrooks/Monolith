import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { Download, Maximize2, Minimize2, Plus, X } from 'lucide-react'
import { fileBlob, fileUrl, formatSize, putFile } from '../lib/files'
import { toast, toastError } from './Toast'

/**
 * Viewing (and, for text, editing) a file from a doc without leaving Monolith. Pictures, PDFs (the browser's own
 * viewer), audio and video are shown as they are. Plain text, code, JSON, Markdown and CSV can be edited: saving stores
 * the new version as a file of its own and points the doc at it (`onSave`), so compression, the passcode lock and
 * folder sync treat it like any other file. Office documents and archives have no view here: Download.
 */
export interface Viewing {
  hash: string
  name: string
  type: string
  size: number
  /** Called with the new file's reference after an edit is saved. Missing: view only (e.g. read-only docs). */
  onSave?: (ref: string) => void
}
const useViewer = create<{ cur: Viewing | null }>(() => ({ cur: null }))
export const openViewer = (v: Viewing) => useViewer.setState({ cur: v })
const close = () => useViewer.setState({ cur: null })

type Kind = 'image' | 'pdf' | 'audio' | 'video' | 'markdown' | 'csv' | 'text' | 'other'
const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')
export function kindOf(name: string, type: string): Kind {
  const e = ext(name)
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/pdf' || e === 'pdf') return 'pdf'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  if (type === 'text/markdown' || e === 'md' || e === 'markdown') return 'markdown'
  if (type === 'text/csv' || e === 'csv' || e === 'tsv') return 'csv'
  if (type.startsWith('text/') || /json|xml|javascript|typescript|yaml|toml|x-sh/.test(type) || /^(txt|json|xml|yml|yaml|toml|ini|log|js|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|cs|swift|kt|sh|css|html|sql|tex)$/.test(e)) return 'text'
  return 'other'
}
/** Files this viewer opens; anything else keeps Download only. */
export const viewable = (name: string, type: string) => kindOf(name, type) !== 'other'
/** Editing text bigger than this would be slow in a plain text box. */
const EDIT_LIMIT = 2_000_000

// ─── CSV ───────────────────────────────────────────────────────────────────
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && !cell) quoted = true
    else if (c === sep) row.push(cell), (cell = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) (row.push(cell), rows.push(row))
  return rows
}
const csvCell = (v: string, sep: string) => (/["\n\r]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v)
const toCsv = (rows: string[][], sep: string) => rows.map((r) => r.map((v) => csvCell(v, sep)).join(sep)).join('\n') + '\n'

function CsvEditor({ rows, onChange }: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const width = Math.max(1, ...rows.map((r) => r.length))
  const set = (r: number, c: number, v: string) => onChange(rows.map((row, i) => (i !== r ? row : Array.from({ length: width }, (_, j) => (j === c ? v : (row[j] ?? ''))))))
  return (
    <div className="fv-csv">
      <table>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={r === 0 ? 'head' : ''}>
              {Array.from({ length: width }, (_, c) => (
                <td key={c}>
                  <input value={row[c] ?? ''} aria-label={`Row ${r + 1}, column ${c + 1}`} onChange={(e) => set(r, c, e.target.value)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fv-csv-add">
        <button className="btn sm" onClick={() => onChange([...rows, Array(width).fill('')])}><Plus size={13} /> Row</button>
        <button className="btn sm" onClick={() => onChange(rows.map((row) => [...row, ...Array(width - row.length).fill(''), '']))}><Plus size={13} /> Column</button>
      </div>
    </div>
  )
}

// ─── The viewer ────────────────────────────────────────────────────────────
export function FileViewer() {
  const cur = useViewer((s) => s.cur)
  if (!cur) return null
  return <Viewer key={cur.hash} v={cur} />
}

function Viewer({ v }: { v: Viewing }) {
  const kind = kindOf(v.name, v.type)
  const editable = !!v.onSave && (kind === 'text' || kind === 'markdown' || kind === 'csv') && v.size <= EDIT_LIMIT
  const sep = ext(v.name) === 'tsv' ? '\t' : ','
  const [url, setUrl] = useState<string>()
  const [text, setText] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [mdEdit, setMdEdit] = useState(false)
  const [actual, setActual] = useState(false)
  const rows = useMemo(() => (kind === 'csv' && (draft ?? text) !== null ? parseCsv(draft ?? text!, sep) : []), [kind, draft, text, sep])
  const dirty = draft !== null && draft !== text
  // Markdown previews use the same converter as docs (checklists, tables, code), loaded only when needed. It keeps
  // only what a doc can hold, so a file can't put scripts or other markup on the page.
  const [mdHtml, setMdHtml] = useState('')
  useEffect(() => {
    if (kind !== 'markdown' || mdEdit || text === null) return
    let live = true
    void import('../lib/markdown').then((m) => live && setMdHtml(m.markdownToHtml(draft ?? text)))
    return () => void (live = false)
  }, [kind, mdEdit, text, draft])

  useEffect(() => {
    void fileUrl(v.hash).then(setUrl)
    if (kind === 'text' || kind === 'markdown' || kind === 'csv') void fileBlob(v.hash).then((b) => b?.text().then(setText))
  }, [v.hash, kind])

  const leave = () => {
    if (dirty && !window.confirm('Close without saving your changes?')) return
    close()
  }
  const save = async () => {
    if (!dirty || !v.onSave) return
    try {
      const ref = await putFile(new Blob([draft!], { type: v.type || 'text/plain' }), v.name)
      v.onSave(ref)
      setText(draft)
      setDraft(null)
      toast(`Saved “${v.name}”`)
    } catch (e) {
      toastError((e as Error).message || 'Couldn’t save it. Try again.')
    }
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.preventDefault(), leave())
      if ((e.metaKey || e.ctrlKey) && e.key === 's') (e.preventDefault(), void save())
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  const body = () => {
    if (!url) return <div className="fv-empty">Opening…</div>
    switch (kind) {
      case 'image':
        return (
          <div className={`fv-image ${actual ? 'actual' : ''}`} onClick={() => setActual(!actual)}>
            <img src={url} alt={v.name} />
          </div>
        )
      case 'pdf':
        return <iframe className="fv-frame" src={url} title={v.name} />
      case 'audio':
        return <div className="fv-media"><audio src={url} controls autoPlay /></div>
      case 'video':
        return <div className="fv-media"><video src={url} controls autoPlay /></div>
      case 'csv':
        return text === null ? <div className="fv-empty">Opening…</div> : editable ? <CsvEditor rows={rows} onChange={(r) => setDraft(toCsv(r, sep))} /> : <CsvEditor rows={rows} onChange={() => {}} />
      case 'markdown':
        if (text === null) return <div className="fv-empty">Opening…</div>
        return mdEdit && editable ? (
          <textarea className="fv-text" value={draft ?? text} onChange={(e) => setDraft(e.target.value)} spellCheck autoFocus />
        ) : (
          <div className="fv-md prose" dangerouslySetInnerHTML={{ __html: mdHtml }} />
        )
      case 'text':
        if (text === null) return <div className="fv-empty">Opening…</div>
        return <textarea className="fv-text mono" value={draft ?? text} readOnly={!editable} onChange={(e) => setDraft(e.target.value)} spellCheck={false} autoFocus={editable} />
      default:
        return (
          <div className="fv-empty">
            <p>{v.name} can’t be shown here.</p>
            <a className="btn" href={url} download={v.name}><Download size={15} /> Download</a>
          </div>
        )
    }
  }

  return (
    <div className="overlay fv-overlay" onMouseDown={leave}>
      <div className={`fv fv-kind-${kind}`} role="dialog" aria-modal="true" aria-label={v.name} onMouseDown={(e) => e.stopPropagation()}>
        <header className="fv-head">
          <div className="fv-title">
            <b>{v.name}</b>
            <small>{formatSize(v.size)}{dirty ? ' · Edited' : ''}</small>
          </div>
          {kind === 'markdown' && editable && (
            <div className="seg">
              <button className={!mdEdit ? 'on' : ''} onClick={() => setMdEdit(false)}>Preview</button>
              <button className={mdEdit ? 'on' : ''} onClick={() => setMdEdit(true)}>Edit</button>
            </div>
          )}
          {kind === 'image' && (
            <button className="icon-btn" title={actual ? 'Fit to window' : 'Actual size'} onClick={() => setActual(!actual)}>
              {actual ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {editable && <button className="btn sm primary" disabled={!dirty} onClick={() => void save()}>Save</button>}
          {url && <a className="icon-btn" href={url} download={v.name} title="Download" aria-label="Download"><Download size={16} /></a>}
          <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={leave}><X size={17} /></button>
        </header>
        <div className="fv-body">{body()}</div>
      </div>
    </div>
  )
}
