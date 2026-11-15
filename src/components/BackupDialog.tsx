import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { format } from 'date-fns'
import { FileArchive, X } from 'lucide-react'
import { APP_NAME } from '../brand'
import { useStore } from '../store'
import { BACKUP_EXT, BACKUP_MIN, backupName, download, exportWorkspace, peek, restore, unlockBackup, useBackup, type Counts } from '../lib/backup'
import { toast } from './Toast'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const summary = (c: Counts) => [plural(c.docs, 'doc'), plural(c.recordings, 'recording'), plural(c.events, 'event')].join(' · ')

/** Back up everything to one encrypted file, or restore from one. */
export function BackupDialog() {
  const open = useBackup((s) => s.open)
  const close = () => useBackup.setState({ open: null })
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay bk-overlay" onMouseDown={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="modal bk" role="dialog" aria-modal="true" aria-labelledby="bk-title" onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            <button className="icon-btn bk-close" onClick={close} aria-label="Close"><X size={18} /></button>
            {open === 'export' ? <Export done={close} /> : <Import done={close} />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Export({ done }: { done: () => void }) {
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problem = pass.length < BACKUP_MIN ? `Use at least ${BACKUP_MIN} characters.` : pass !== pass2 ? 'The two passwords don’t match.' : ''

  return (
    <form className="bk-body" onSubmit={async (e) => {
      e.preventDefault()
      if (problem) return setError(problem)
      setBusy(true)
      try {
        // Where the browser lets us, ask where to save first (it needs the click), so a cancel isn't counted as a backup.
        const pick = (window as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker
        if (pick) {
          let handle: FileSystemFileHandle
          try {
            handle = await pick({ suggestedName: backupName(), types: [{ description: 'Backup', accept: { 'application/octet-stream': [BACKUP_EXT] } }] })
          } catch (err) {
            if ((err as DOMException).name === 'AbortError') return
            throw err
          }
          const out = await handle.createWritable()
          await out.write(await exportWorkspace(pass))
          await out.close()
          toast('Backup saved')
        } else {
          download(await exportWorkspace(pass), backupName())
          toast('Backup downloaded')
        }
        useStore.getState().setSettings({ lastBackup: Date.now() })
        done()
      } catch (err) {
        setError((err as Error).message || 'The backup couldn’t be made. Try again.')
      } finally {
        setBusy(false)
      }
    }}>
      <h2 id="bk-title">Back up your workspace</h2>
      <p>One encrypted file with your docs, recordings, calendar and preferences. Open it in any browser to get everything back.</p>
      <input className="su-input" type="password" autoFocus value={pass} onChange={(e) => (setPass(e.target.value), setError(''))} placeholder="Backup password" autoComplete="new-password" aria-label="Backup password" />
      <input className="su-input" type="password" value={pass2} onChange={(e) => (setPass2(e.target.value), setError(''))} placeholder="Type it again" autoComplete="new-password" aria-label="Confirm backup password" />
      <small className="su-warn">Without this password the backup can’t be opened, by you or anyone else.</small>
      {error && <p className="su-error" role="alert">{error}</p>}
      <div className="su-actions">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Encrypting…' : 'Download backup'}</button>
      </div>
    </form>
  )
}

function Import({ done }: { done: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ name: string; data: Awaited<ReturnType<typeof peek>> } | null>(null)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function pick(f: File | undefined) {
    if (!f) return
    setError('')
    try {
      setPicked({ name: f.name, data: await peek(f) })
    } catch (e) {
      setPicked(null)
      setError((e as Error).message)
    }
  }

  return (
    <form className="bk-body" onSubmit={async (e) => {
      e.preventDefault()
      if (!picked || !pass || busy) return
      setBusy(true)
      try {
        await restore(await unlockBackup(picked.data, pass))
        toast('Workspace restored')
        done()
      } catch (err) {
        setError((err as Error).message || 'The backup couldn’t be restored.')
        setPass('')
      } finally {
        setBusy(false)
      }
    }}>
      <h2 id="bk-title">Restore from a backup</h2>
      <p>Bring back everything from a {APP_NAME} backup file.</p>
      <input ref={fileRef} type="file" accept={BACKUP_EXT} hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className="su-opt bk-file" onClick={() => fileRef.current?.click()}>
        <FileArchive size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <b>{picked ? picked.name : 'Choose a backup file…'}</b>
          <small>{picked ? `Made ${format(picked.data.header.created, 'MMM d, yyyy, h:mm a')} · ${summary(picked.data.header.counts)}` : `A ${BACKUP_EXT} file`}</small>
        </span>
      </button>
      {picked && (
        <>
          <input className="su-input" type="password" autoFocus value={pass} onChange={(e) => (setPass(e.target.value), setError(''))} placeholder="Backup password" autoComplete="current-password" aria-label="Backup password" />
          <small className="su-warn">This replaces the docs, calendar and preferences in this browser. Connected folders stay connected.</small>
        </>
      )}
      {error && <p className="su-error" role="alert">{error}</p>}
      <div className="su-actions">
        <button className="btn primary" type="submit" disabled={!picked || !pass || busy}>{busy ? 'Restoring…' : 'Restore'}</button>
      </div>
    </form>
  )
}
