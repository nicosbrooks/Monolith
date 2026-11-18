import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, ChevronRight, Cloud, FolderOpen, GitBranch, Lock, Plus, Search, X, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { APP_NAME } from '../brand'
import { hasFolderAccess } from '../storage/folder'
import { preloadGoogle } from '../storage/gdrive'
import { connectDrive, connectFolder, connectGitHub } from '../storage/sync'
import { authConfig, createRepo, listRepos, repoFolders, saveGitHubToken, signInGitHub, signOutGitHub, tokenUrl, useAccounts, type AuthConfig, type Repo } from '../storage/accounts'
import { toast } from './Toast'

type Step = 'choose' | 'github' | 'repo' | 'gdrive-setup'

export function ConnectDialog() {
  const open = useStore((s) => s.connectOpen)
  const close = () => useStore.getState().setUI({ connectOpen: false })
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" onMouseDown={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, pointerEvents: 'none' }}>
          <motion.div className="modal connect" role="dialog" aria-modal="true" aria-label="Connect storage" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            <Flow onDone={close} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Flow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('choose')
  const [cfg, setCfg] = useState<AuthConfig | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [repo, setRepo] = useState<Repo | null>(null)
  const gh = useAccounts((s) => s.github)
  const googleId = useStore((s) => s.settings.googleClientId)

  useEffect(() => {
    authConfig().then(setCfg)
    preloadGoogle()
  }, [])

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      after?.()
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const finish = (msg: string) => () => {
    toast(msg)
    useStore.getState().go('docs')
    onDone()
  }

  const back = step === 'repo' ? () => (setRepo(null), setStep('github')) : step !== 'choose' ? () => setStep('choose') : null
  const title = step === 'choose' ? 'Connect storage' : step === 'gdrive-setup' ? 'Set up Google sign-in' : repo ? repo.full_name : gh ? 'Choose a repository' : 'Connect GitHub'

  return (
    <>
      <header>
        {back && <button className="icon-btn" onClick={() => (setError(null), back())} title="Back"><ArrowLeft size={17} /></button>}
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onDone} title="Close"><X size={18} /></button>
      </header>
      <div className="modal-body">
        {step === 'choose' && (
          <>
            <p className="muted">Keep your docs as Markdown files somewhere you own. You can edit them here, and in any other app.</p>
            <div className="tiles">
              <button
                className="tile"
                disabled={!hasFolderAccess() || !!busy}
                onClick={() => run('folder', connectFolder, finish('Folder connected'))}
              >
                <FolderOpen size={20} strokeWidth={1.6} />
                <b>Folder on this device</b>
                <small>{hasFolderAccess() ? 'Edits files in place. Nothing is uploaded.' : 'Needs Chrome, Edge or Arc'}</small>
                {busy === 'folder' ? <Loader2 size={15} className="spin go" /> : <ChevronRight size={15} className="go" />}
              </button>
              <button className="tile" disabled={!!busy} onClick={() => (setError(null), setStep('github'))}>
                <GitBranch size={20} strokeWidth={1.6} />
                <b>GitHub</b>
                <small>{gh ? `Signed in as ${gh.login}` : 'Version history for every change.'}</small>
                <ChevronRight size={15} className="go" />
              </button>
              <button
                className="tile"
                disabled={!!busy || !cfg}
                onClick={() => (cfg?.google || googleId ? run('gdrive', connectDrive, finish('Google Drive connected')) : setStep('gdrive-setup'))}
              >
                <Cloud size={20} strokeWidth={1.6} />
                <b>Google Drive</b>
                <small>Syncs a “{APP_NAME}” folder. Your other files stay private.</small>
                {busy === 'gdrive' ? <Loader2 size={15} className="spin go" /> : <ChevronRight size={15} className="go" />}
              </button>
            </div>
          </>
        )}

        {step === 'github' && (gh ? <RepoPicker token={gh.token} onPick={(r) => (setRepo(r), setStep('repo'))} /> : <GitHubSignIn cfg={cfg} busy={busy} run={run} />)}

        {step === 'repo' && repo && gh && (
          <RepoOptions
            token={gh.token}
            repo={repo}
            busy={!!busy}
            onConnect={(base) =>
              run('repo', async () => {
                const r = await connectGitHub({ repo: repo.full_name, branch: repo.default_branch, base, token: gh.token })
                if (r.readOnly) toast('Connected read-only: you don’t have write access to this repository.')
              }, finish(`${repo.name} connected`))
            }
          />
        )}

        {step === 'gdrive-setup' && <DriveSetup busy={!!busy} onSave={(id) => (useStore.getState().setSettings({ googleClientId: id }), run('gdrive', connectDrive, finish('Google Drive connected')))} />}

        {error && <p className="form-error">{error}</p>}
      </div>
      {step === 'github' && gh && (
        <footer className="modal-foot">
          {gh.avatar && <img className="avatar-img" src={gh.avatar} alt="" />}
          <span className="muted small">Signed in as <b>{gh.login}</b></span>
          <span className="grow" />
          <button className="text-btn" onClick={() => signOutGitHub()}>Sign out</button>
        </footer>
      )}
    </>
  )
}

function GitHubSignIn({ cfg, busy, run }: { cfg: AuthConfig | null; busy: string | null; run: (l: string, f: () => Promise<unknown>) => void }) {
  const [token, setToken] = useState('')
  const [manual, setManual] = useState(false)
  const oneClick = !!cfg?.github
  return (
    <div className="signin">
      <GitBranch size={28} strokeWidth={1.5} />
      <p>Sign in to pick a repository. Docs are saved as <code>.md</code> files and you commit changes when you’re ready.</p>
      {oneClick && (
        <button className="btn primary wide" disabled={!!busy} onClick={() => run('gh', () => signInGitHub(cfg!.github!.clientId))}>
          {busy === 'gh' ? <Loader2 size={15} className="spin" /> : <GitBranch size={15} />} Continue with GitHub
        </button>
      )}
      {oneClick && !manual ? (
        <button className="text-btn muted" onClick={() => setManual(true)}>Use an access token instead</button>
      ) : (
        <form className="token-form" onSubmit={(e) => (e.preventDefault(), run('token', () => saveGitHubToken(token.trim())))}>
          <ol className="steps">
            <li><a href={tokenUrl(APP_NAME)} target="_blank" rel="noreferrer">Create a token on GitHub</a>. It opens with the right access already selected.</li>
            <li>Click <b>Generate token</b>, copy it, and paste it here.</li>
          </ol>
          <input type="password" autoComplete="off" required placeholder="ghp_…" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn primary wide" disabled={!!busy || !token.trim()}>{busy === 'token' ? 'Checking…' : 'Continue'}</button>
          <small className="muted">The token stays in this browser. Only GitHub sees it.</small>
        </form>
      )}
    </div>
  )
}

function RepoPicker({ token, onPick }: { token: string; onPick: (r: Repo) => void }) {
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState(`${APP_NAME.toLowerCase()}-notes`)
  const [priv, setPriv] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    listRepos(token).then(setRepos, (e) => setErr(e.message))
  }, [token])
  const shown = useMemo(() => (repos || []).filter((r) => r.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 60), [repos, q])

  return (
    <div className="picker">
      <label className="search">
        <Search size={14} />
        <input autoFocus placeholder="Search repositories" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {creating ? (
        <form
          className="create-repo"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              onPick(await createRepo(token, name.trim(), priv, APP_NAME))
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value.replace(/[^\w.-]/g, '-'))} />
          <div className="seg">
            <button type="button" className={priv ? 'on' : ''} onClick={() => setPriv(true)}><Lock size={12} /> Private</button>
            <button type="button" className={!priv ? 'on' : ''} onClick={() => setPriv(false)}>Public</button>
          </div>
          <button className="btn sm primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create'}</button>
        </form>
      ) : (
        <button className="repo-row new" onClick={() => setCreating(true)}>
          <Plus size={15} /> <span>Create a new repository for notes</span>
        </button>
      )}
      <div className="repo-list">
        {!repos && !err && <div className="muted small pad"><Loader2 size={14} className="spin" /> Loading repositories…</div>}
        {shown.map((r) => (
          <button key={r.full_name} className="repo-row" onClick={() => onPick(r)}>
            <span className="rname">
              <b>{r.name}</b>
              <small>{r.owner.login}</small>
            </span>
            {r.private && <Lock size={12} className="muted" />}
            <small className="muted">{formatDistanceToNow(new Date(r.pushed_at), { addSuffix: true })}</small>
          </button>
        ))}
        {repos && !shown.length && <div className="muted small pad">No repositories match “{q}”.</div>}
      </div>
      {err && <p className="form-error">{err}</p>}
    </div>
  )
}

function RepoOptions({ token, repo, busy, onConnect }: { token: string; repo: Repo; busy: boolean; onConnect: (base?: string) => void }) {
  const [folders, setFolders] = useState<{ path: string; count: number }[] | null>(null)
  const [base, setBase] = useState('')
  useEffect(() => {
    repoFolders(token, repo.full_name, repo.default_branch).then(setFolders, () => setFolders([]))
  }, [token, repo])
  const total = folders?.filter((f) => !f.path.includes('/')).reduce((n, f) => n + f.count, 0)
  return (
    <div className="repo-opts">
      <p className="muted">Which part of <b>{repo.name}</b> should show up as docs?</p>
      <div className="choice-list">
        <label className={`choice ${base === '' ? 'on' : ''}`}>
          <input type="radio" checked={base === ''} onChange={() => setBase('')} />
          <span>Whole repository</span>
          {total !== undefined && <small>{folders!.length ? `${total}+ files` : 'Empty — new docs go here'}</small>}
        </label>
        {folders?.map((f) => (
          <label key={f.path} className={`choice ${base === f.path ? 'on' : ''}`} style={{ paddingLeft: 12 + f.path.split('/').length * 12 }}>
            <input type="radio" checked={base === f.path} onChange={() => setBase(f.path)} />
            <span>{f.path.split('/').pop()}</span>
            <small>{f.count} file{f.count === 1 ? '' : 's'}</small>
          </label>
        ))}
        {!folders && <div className="muted small pad"><Loader2 size={14} className="spin" /> Looking for Markdown files…</div>}
      </div>
      <button className="btn primary wide" disabled={busy} onClick={() => onConnect(base || undefined)}>
        {busy ? <><Loader2 size={15} className="spin" /> Connecting…</> : `Connect ${base ? base.split('/').pop() : repo.name}`}
      </button>
      <small className="muted center">Branch: {repo.default_branch}</small>
    </div>
  )
}

function DriveSetup({ busy, onSave }: { busy: boolean; onSave: (id: string) => void }) {
  const [id, setId] = useState(useStore.getState().settings.googleClientId)
  return (
    <form className="token-form" onSubmit={(e) => (e.preventDefault(), onSave(id.trim()))}>
      <p className="muted">Google Drive isn’t available here yet.</p>
      <details className="advanced">
        <summary>Set it up for this copy</summary>
        <p className="muted small">Add <code>GOOGLE_CLIENT_ID</code> to <code>.env.local</code>, or paste a client ID below.</p>
        <ol className="steps">
          <li>In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud → Credentials</a>, create an OAuth client of type <b>Web application</b>.</li>
          <li>Add <code>{location.origin}</code> as an authorized JavaScript origin.</li>
          <li>Enable the <b>Google Drive API</b> for the project.</li>
        </ol>
        <input required placeholder="…apps.googleusercontent.com" value={id} onChange={(e) => setId(e.target.value)} />
        <button className="btn primary wide" disabled={busy || !id.trim()}>{busy ? 'Connecting…' : 'Continue with Google'}</button>
      </details>
    </form>
  )
}
