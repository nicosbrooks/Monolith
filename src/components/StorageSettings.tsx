import { formatDistanceToNow } from 'date-fns'
import { Cloud, FileArchive, FolderOpen, GitBranch, Laptop, Lock, Plus, RefreshCw, Unplug } from 'lucide-react'
import { openBackup } from '../lib/backup'
import { useVault } from '../lib/vault'
import { useStore } from '../store'
import type { Source } from '../types'
import { APP_NAME } from '../brand'
import { disconnect, kindLabel, pendingChanges, pull, reconnect, useSync } from '../storage/sync'
import { signOutGitHub, useAccounts } from '../storage/accounts'
import { confirmDialog } from './Overlays'

export const SourceIcon = ({ kind, size = 16 }: { kind: Source['kind']; size?: number }) =>
  kind === 'folder' ? <FolderOpen size={size} /> : kind === 'github' ? <GitBranch size={size} /> : <Cloud size={size} />

export function StorageSettings() {
  const sources = useStore((s) => s.sources)
  const items = useStore((s) => s.items)
  const sync = useSync((s) => s.st)
  const gh = useAccounts((s) => s.github)
  const localCount = items.filter((i) => !i.sourceId && !i.deletedAt).length
  const home = useStore((s) => s.settings.home)
  const locked = useVault((s) => s.state) === 'open'
  const change = () => useStore.setState({ settingsOpen: false, setupOpen: 1 })
  const lastBackup = useStore((s) => s.settings.lastBackup)

  return (
    <section>
      <h3>Storage</h3>
      <p className="muted">Your work is saved here. You can also keep docs in a folder, GitHub or Google Drive.</p>
      <div className="model-list">
        <div className="model">
          <Laptop size={16} />
          <div className="col">
            <b>This browser</b>
            <small>{localCount} items{!home || !sources.some((s) => s.id === home) ? ' · New docs go here' : ''}</small>
          </div>
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

        <div className="model">
          <FileArchive size={16} />
          <div className="col">
            <b>Backup file</b>
            <small>{lastBackup ? `Last backed up ${formatDistanceToNow(lastBackup, { addSuffix: true })}` : 'Everything in one encrypted file, for safekeeping or another browser'}</small>
          </div>
          <button className="btn sm" onClick={() => (useStore.getState().setUI({ settingsOpen: false }), openBackup('export'))}>Back up</button>
          <button className="btn sm" onClick={() => (useStore.getState().setUI({ settingsOpen: false }), openBackup('import'))}>Restore</button>
        </div>

        <button className="model add" onClick={change}>
          <Lock size={16} />
          <div className="col"><b>{locked ? 'Locked with a passcode' : 'Not locked'}</b><small>{locked ? 'Change the passcode, turn it off, or choose where new docs go' : 'Add a passcode, or choose where new docs go'}</small></div>
        </button>

        <button className="model add" onClick={() => useStore.getState().setUI({ settingsOpen: false, connectOpen: true })}>
          <Plus size={16} />
          <div className="col"><b>Connect storage</b><small>Folder, GitHub or Google Drive</small></div>
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
