import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { CircleAlert, CircleCheck, Cloud, FileArchive, FolderDown, FolderOpen, GitBranch, Laptop, Lock, Plus, RefreshCw, Unplug } from 'lucide-react'
import { openBackup } from '../lib/backup'
import { useSafekeeping } from '../lib/safekeeping'
import { useVault } from '../lib/vault'
import { useStore } from '../store'
import type { Source } from '../types'
import { APP_NAME } from '../brand'
import { disconnect, kindLabel, pendingChanges, pull, reconnect, useSync } from '../storage/sync'
import { signOutGitHub, useAccounts } from '../storage/accounts'
import { confirmDialog } from './Overlays'
import { toast, toastError } from './Toast'

export const SourceIcon = ({ kind, size = 16 }: { kind: Source['kind']; size?: number }) =>
  kind === 'folder' ? <FolderOpen size={size} /> : kind === 'github' ? <GitBranch size={size} /> : <Cloud size={size} />

/** Bytes as "12 MB". */
const size = (b: number) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : b < 1e9 ? `${Math.round(b / 1e6)} MB` : `${(b / 1e9).toFixed(1)} GB`)
const count = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** How much this site keeps in the browser, when the browser says. */
function useUsage() {
  const [used, setUsed] = useState<number | null>(null)
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsed(e.usage ?? null)).catch(() => {})
  }, [])
  return used
}

/**
 * Settings › Storage and files. Three questions, in order: is my work safe (one line at the top, with what to do if
 * not), where is it saved, and how do I keep a copy (backup file, Markdown export). The passcode is under Privacy.
 */
export function StorageSettings() {
  const sources = useStore((s) => s.sources)
  const items = useStore((s) => s.items)
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const used = useUsage()
  const sync = useSync((s) => s.st)
  const gh = useAccounts((s) => s.github)
  const mine = items.filter((i) => !i.sourceId && !i.deletedAt && !i.file?.dir)
  const docs = mine.filter((i) => i.kind !== 'lecture').length
  const recordings = mine.length - docs
  const openTasks = tasks.filter((t) => !t.done).length
  const ownEvents = events.filter((e) => !e.calId).length
  const home = useStore((s) => s.settings.home)
  const locked = useVault((s) => s.state) === 'open'
  const change = () => useStore.setState({ settingsOpen: false, setupOpen: 1 })
  const lastBackup = useStore((s) => s.settings.lastBackup)
  const persisted = useSafekeeping((s) => s.persisted)
  // Safe means: the browser promised to keep it, or there's a backup from the last two weeks.
  const recent = !!lastBackup && Date.now() - lastBackup < 14 * 864e5
  const safe = recent || persisted === true
  const [exporting, setExporting] = useState(false)
  const exportEverything = async () => {
    setExporting(true)
    try {
      const { exportAll } = await import('../lib/exportAll')
      const x = await exportAll()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(x.blob)
      a.download = x.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      const n = (k: number, w: string) => (k ? [`${k} ${w}${k === 1 ? '' : 's'}`] : [])
      toast(`Exported ${[...n(x.docs, 'doc'), ...n(x.recordings, 'recording'), ...n(x.tasks, 'task'), ...n(x.files, 'file'), ...n(x.events, 'event')].join(', ') || 'an empty workspace'}`)
    } catch (e) {
      toastError(`Couldn’t export: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  const backUp = () => (useStore.getState().setUI({ settingsOpen: false }), openBackup('export'))
  return (
    <section className="storage">
      <div className={`st-status ${safe ? 'ok' : 'warn'}`} role="status">
        {safe ? <CircleCheck size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
        <div className="col">
          <b>{safe ? 'Your work is kept' : 'Your work has no copy yet'}</b>
          <small>
            {persisted === true ? 'This browser has promised to keep it.' : persisted === false ? 'This browser may clear it when space runs low.' : 'This browser keeps it until its site data is cleared.'}{' '}
            {lastBackup ? `Last backup ${formatDistanceToNow(lastBackup, { addSuffix: true })}.` : 'No backup file yet.'}
          </small>
        </div>
        {!recent && <button className="btn sm primary" onClick={backUp}>Back up now</button>}
      </div>

      <h3>Where it’s saved</h3>
      <div className="model-list">
        <div className="model">
          <Laptop size={16} />
          <div className="col">
            <b>This browser</b>
            <small>
              {[count(docs, 'doc'), count(recordings, 'recording'), count(openTasks, 'open task'), count(ownEvents, 'event')].join(' · ')}
              {used !== null ? ` · ${size(used)} used` : ''}
              {!home || !sources.some((s) => s.id === home) ? ' · New docs go here' : ''}
            </small>
          </div>
          {(!home || !sources.some((s) => s.id === home)) && <button className="btn sm" onClick={change}>Change</button>}
        </div>
        {sources.map((s) => {
          const st = sync[s.id]?.status || 'idle'
          const pending = pendingChanges(s.id).length
          return (
            <div key={s.id} className="model">
              <SourceIcon kind={s.kind} />
              <div className="col">
                <b>{s.name}</b>
                <small>
                  {s.kind === 'folder' ? 'Folder on this device' : kindLabel[s.kind]}
                  {s.id === home ? ' · New docs go here' : ''}
                  {s.config.readOnly ? ' · read-only' : ''}
                  {' · '}
                  {st === 'syncing' ? 'Syncing…' : st === 'needs-auth' ? 'Needs access' : st === 'error' ? sync[s.id]?.error : s.lastSync ? `Synced ${formatDistanceToNow(s.lastSync, { addSuffix: true })}` : 'Not synced yet'}
                  {pending ? ` · ${pending} ${s.kind === 'github' ? 'uncommitted' : 'unsaved'}` : ''}
                </small>
              </div>
              {s.id === home && <button className="btn sm" onClick={change}>Change</button>}
              {st === 'needs-auth' ? (
                <button className="btn sm" onClick={() => reconnect(s.id)}>Reconnect</button>
              ) : (
                <button className="icon-btn sm" title="Sync now" disabled={st === 'syncing'} onClick={() => pull(s.id)}><RefreshCw size={13} className={st === 'syncing' ? 'spin' : ''} /></button>
              )}
              <button
                className="icon-btn sm"
                title="Disconnect"
                onClick={async () => {
                  const body = pending
                    ? `${pending} change${pending > 1 ? 's' : ''} haven't been ${s.kind === 'github' ? 'committed' : 'saved'} and will be lost. Files already in ${kindLabel[s.kind]} are not touched.`
                    : `Its docs are removed from ${APP_NAME}. The files stay in ${kindLabel[s.kind]}.`
                  if (await confirmDialog({ title: `Disconnect ${s.name}?`, body, confirm: 'Disconnect', danger: !!pending })) disconnect(s.id)
                }}
              >
                <Unplug size={13} />
              </button>
            </div>
          )
        })}

        <button className="model add" onClick={() => useStore.getState().setUI({ settingsOpen: false, connectOpen: true })}>
          <Plus size={16} />
          <div className="col"><b>Connect storage</b><small>A folder on this device, GitHub or Google Drive. Docs there are plain Markdown files.</small></div>
        </button>
      </div>
      <p className="small muted st-note">Tasks, events, recordings and settings always stay in this browser. Backups and exports include all of it.</p>

      <h3>Keep a copy</h3>
      <div className="model-list">
        <div className="model">
          <FileArchive size={16} />
          <div className="col">
            <b>Backup file</b>
            <small>One encrypted file with everything, to restore here or in another browser{lastBackup ? ` · last ${formatDistanceToNow(lastBackup, { addSuffix: true })}` : ''}</small>
          </div>
          <button className="btn sm" onClick={backUp}>Back up</button>
          <button className="btn sm" onClick={() => (useStore.getState().setUI({ settingsOpen: false }), openBackup('import'))}>Restore</button>
        </div>
        <div className="model">
          <FolderDown size={16} />
          <div className="col">
            <b>Export as Markdown</b>
            <small>A zip any app can read: docs, pictures, recordings, Tasks.md and Calendar.ics. Not for restoring.</small>
          </div>
          <button className="btn sm" disabled={exporting} onClick={exportEverything}>{exporting ? 'Preparing…' : 'Export'}</button>
        </div>
      </div>

      <h3>Privacy</h3>
      <div className="model-list">
        <button className="model add" onClick={change}>
          <Lock size={16} />
          <div className="col"><b>Passcode</b><small>{locked ? 'On · Change it or turn it off' : `Off · Add one to encrypt what ${APP_NAME} saves in this browser`}</small></div>
        </button>
      </div>
      {gh && (
        <p className="small muted account-line">
          GitHub: signed in as <b>{gh.login}</b> · <button className="link" onClick={() => signOutGitHub()}>Sign out</button>
        </p>
      )}
    </section>
  )
}
