import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, FolderOpen, Laptop, Lock } from 'lucide-react'
import { saveNow, useStore } from '../store'
import { APP_NAME } from '../brand'
import { hasFolderAccess } from '../storage/folder'
import { connectFolder, rewriteSealedFiles } from '../storage/sync'
import { openBackup } from '../lib/backup'
import { clearPasscode, PASSCODE_MIN, setPasscode, unlock, useVault } from '../lib/vault'

type Where = 'folder' | 'browser'

/**
 * First-time setup, two short steps: a name for greetings, then where work is saved and whether it's locked.
 * Shown once on a new install; Settings › "Run setup again" brings it back with the current choices filled in.
 */
export function Setup() {
  const settings = useStore((s) => s.settings)
  const sources = useStore((s) => s.sources)
  const vault = useVault((s) => s.state)
  const again = settings.setupAt !== null
  const canFolder = hasFolderAccess()
  const homeFolder = sources.find((s) => s.id === settings.home)

  const [step, setStep] = useState(useStore.getState().setupOpen || 0)
  const [name, setName] = useState(settings.name)
  const [where, setWhere] = useState<Where>(homeFolder || (canFolder && !again) ? 'folder' : 'browser')
  const [lock, setLock] = useState(vault === 'open')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => nameRef.current?.focus(), [])

  const hadLock = vault === 'open'
  const newPass = lock && (!hadLock || pass.length > 0)
  const passProblem = !newPass ? '' : pass.length < PASSCODE_MIN ? `Use at least ${PASSCODE_MIN} characters.` : pass !== pass2 ? 'The two passcodes don’t match.' : ''
  const needsPick = where === 'folder' && !homeFolder

  async function finish() {
    if (passProblem) return setError(passProblem)
    setError('')
    const st = useStore.getState()
    try {
      // The folder picker first: browsers only open it straight from a click.
      if (needsPick) {
        setBusy('Opening your folder…')
        const id = await connectFolder()
        st.setSettings({ home: id })
      } else if (where === 'browser' && settings.home) st.setSettings({ home: null })

      if (newPass) {
        setBusy('Locking…')
        await setPasscode(pass)
        await saveNow()
        if (hadLock) await rewriteSealedFiles()
      } else if (!lock && hadLock) {
        setBusy('Unlocking your files…')
        await clearPasscode()
        await saveNow()
        await rewriteSealedFiles()
      }
      st.setSettings({ name: name.trim(), setupAt: settings.setupAt ?? Date.now() })
      useStore.setState({ setupOpen: false, section: 'home', activeId: null })
    } catch (e) {
      // Closing the folder picker isn't an error; just stay on this step.
      if ((e as DOMException).name !== 'AbortError') setError((e as Error).message || 'Something went wrong. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const primary = needsPick ? 'Choose folder…' : again ? 'Save' : `Start using ${APP_NAME}`

  return (
    <div className="su" role="dialog" aria-modal="true" aria-labelledby="su-title">
      <div className="su-card">
        <div className="su-top">
          {step > 0 ? (
            <button className="icon-btn" onClick={() => (setStep(0), setError(''))} aria-label="Back"><ArrowLeft size={18} /></button>
          ) : <img className="su-logo" src="/favicon.svg" alt="" />}
          <span className="su-steps" aria-label={`Step ${step + 1} of 2`}><i className={step === 0 ? 'on' : ''} /><i className={step === 1 ? 'on' : ''} /></span>
          {again ? <button className="su-skip" onClick={() => useStore.setState({ setupOpen: false })}>Cancel</button> : <span className="su-skip" />}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {step === 0 ? (
            <motion.form key="name" className="su-step" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}
              onSubmit={(e) => (e.preventDefault(), setStep(1))}>
              <h1 id="su-title">{again ? 'Your setup' : `Welcome to ${APP_NAME}`}</h1>
              <p>Notes, docs, recordings and your calendar in one place, with an assistant that runs on your own devices.</p>
              <label className="su-label" htmlFor="su-name">What should we call you?</label>
              <input id="su-name" ref={nameRef} className="su-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" autoComplete="given-name" maxLength={40} />
              <small className="su-hint">Used in greetings. Leave it blank if you’d rather not.</small>
              <div className="su-actions">
                <button className="btn primary" type="submit">Continue</button>
              </div>
            </motion.form>
          ) : (
            <motion.form key="where" className="su-step" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.18 }}
              onSubmit={(e) => (e.preventDefault(), void finish())}>
              <h1 id="su-title">Where should your work live?</h1>
              <p>Everything stays on this computer. You can connect GitHub or Google Drive later in Settings.</p>

              <div className="su-options" role="radiogroup" aria-label="Where your work is saved">
                <button type="button" role="radio" aria-checked={where === 'folder'} disabled={!canFolder} className="su-opt" onClick={() => setWhere('folder')}>
                  <FolderOpen size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    <b>A folder on this computer {canFolder && !homeFolder && <em>Recommended</em>}</b>
                    <small>{!canFolder ? 'Needs Chrome, Edge or Arc. This browser can’t save to a folder.' : homeFolder ? `Saving to “${homeFolder.name}”` : 'Plain Markdown files you own, readable by any editor.'}</small>
                  </span>
                  <i aria-hidden="true" />
                </button>
                <button type="button" role="radio" aria-checked={where === 'browser'} className="su-opt" onClick={() => setWhere('browser')}>
                  <Laptop size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    <b>This browser</b>
                    <small>Quickest to start. Clearing this site’s data erases it.</small>
                  </span>
                  <i aria-hidden="true" />
                </button>
              </div>

              <div className={`su-lock ${lock ? 'on' : ''}`}>
                <button type="button" role="switch" aria-checked={lock} className="su-lock-row" onClick={() => (setLock(!lock), setError(''))}>
                  <Lock size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    <b>Lock with a passcode</b>
                    <small>Encrypts what {APP_NAME} saves. You’ll enter it each time you open {APP_NAME}.</small>
                  </span>
                  <span className="su-switch" aria-hidden="true" />
                </button>
                {lock && (
                  <div className="su-pass">
                    {hadLock && <small className="su-hint">Your passcode is on. Type a new one only to change it.</small>}
                    <input className="su-input" type="password" value={pass} onChange={(e) => (setPass(e.target.value), setError(''))} placeholder={hadLock ? 'New passcode' : 'Passcode'} autoComplete="new-password" aria-label="Passcode" />
                    <input className="su-input" type="password" value={pass2} onChange={(e) => (setPass2(e.target.value), setError(''))} placeholder="Type it again" autoComplete="new-password" aria-label="Confirm passcode" />
                    <small className="su-warn">There’s no way to recover it. If you forget it, your work can’t be opened.</small>
                    {where === 'folder' && <small className="su-hint">Files already in the folder stay as they are until you edit them.</small>}
                  </div>
                )}
              </div>

              {error && <p className="su-error" role="alert">{error}</p>}
              <div className="su-actions">
                {!again && <button type="button" className="su-link" onClick={() => openBackup('import')}>Restore from a backup</button>}
                <button className="btn primary" type="submit" disabled={!!busy}>{busy || primary}</button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Shown on open while a passcode is set. Nothing is read from storage until it's entered. */
export function Unlock() {
  const [pass, setPass] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="su" role="dialog" aria-modal="true" aria-labelledby="su-title">
      <form className="su-card su-unlock" onSubmit={async (e) => {
        e.preventDefault()
        if (!pass || busy) return
        setBusy(true)
        const ok = await unlock(pass)
        setBusy(false)
        if (!ok) (setWrong(true), setPass(''))
      }}>
        <span className="su-lock-ico"><Lock size={22} strokeWidth={1.8} /></span>
        <h1 id="su-title">{APP_NAME} is locked</h1>
        <p>Enter your passcode to open your work.</p>
        <input className="su-input" type="password" autoFocus value={pass} onChange={(e) => (setPass(e.target.value), setWrong(false))} placeholder="Passcode" autoComplete="current-password" aria-label="Passcode" aria-invalid={wrong} />
        {wrong && <p className="su-error" role="alert">That passcode isn’t right.</p>}
        <button className="btn primary" type="submit" disabled={!pass || busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      </form>
    </div>
  )
}
