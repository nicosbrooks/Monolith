import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import QRCode from 'qrcode'
import { Check, Copy, Smartphone, X } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { beginPairing, cancelPairing, localRelay, unlink, useLink } from '../link/link'
import { confirmDialog } from './Overlays'
import { toast } from './Toast'

export const openLink = () => useLink.setState({ open: true })

/** Pair this browser with your phone by scanning a QR code. */
export function LinkDialog() {
  const open = useLink((s) => s.open)
  const close = () => (cancelPairing(), useLink.setState({ open: false }))
  // Escape closes it, like every other dialog.
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open]) // eslint-disable-line
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" onMouseDown={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="modal link-modal" role="dialog" aria-modal="true" aria-label="Your phone" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            <header>
              <h2>Your phone</h2>
              <button className="icon-btn" onClick={close} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="modal-body">
              <LinkBody />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function LinkBody() {
  const pairings = useLink((s) => s.pairings)
  const session = useLink((s) => s.session)
  const peers = useLink((s) => s.peers)
  const lastSync = useLink((s) => s.lastSync)
  const [svg, setSvg] = useState('')

  // Show the QR straight away when nothing is linked yet.
  useEffect(() => {
    if (!pairings.length && !session) beginPairing()
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!session?.url) return setSvg('')
    QRCode.toString(session.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(setSvg)
  }, [session?.url])


  if (session && session.state !== 'linked') {
    return (
      <div className="link-pair">
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label="Pairing code" />
        <div className="link-steps">
          <h3 className="sub">Scan with your iPhone</h3>
          <ol>
            <li>Open the Camera, or Monolith → Settings → <b>Link a computer</b>.</li>
            <li>Point it at this code.</li>
            <li>Your notes, docs, recordings and calendar stay in step from then on.</li>
          </ol>
          {session.state === 'error' ? (
            <p className="link-err">{session.error} <button className="text-btn" onClick={beginPairing}>Try again</button></p>
          ) : (
            <p className="muted small"><span className="pulse-dot" /> Waiting for your phone…</p>
          )}
          {localRelay && (session.lan
            ? <p className="muted small">Your phone needs to be on the same Wi-Fi as this computer. If it asks, allow Monolith to find devices on your network.</p>
            : <p className="muted small">Dev mode: this computer isn’t on a network a phone can reach, so only a simulator can join. Set <code>VITE_RELAY_URL</code> to the hosted relay to pair from anywhere.</p>)}
          <div className="row">
            <button className="btn sm" onClick={() => (navigator.clipboard.writeText(session.url), toast('Pairing link copied'))}><Copy size={14} /> Copy link</button>
            {pairings.length > 0 && <button className="btn sm" onClick={cancelPairing}>Cancel</button>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {session?.state === 'linked' && (
        <motion.div className="link-done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <span className="tick"><Check size={18} /></span>
          <div>
            <b>Linked to {session.phone}</b>
            {session.check && <p className="link-check">Your phone shows <b>{session.check}</b> too. If it doesn’t, unlink it.</p>}
            <p className="muted small">Only these two devices hold the key. The relay passes sealed boxes it can’t open.</p>
          </div>
        </motion.div>
      )}
      <section>
        <h3>Linked phones</h3>
        <div className="choice-list">
          {pairings.map((p) => {
            const on = (peers[p.room] || 0) > 0
            return (
              <div key={p.room} className="link-row">
                <Smartphone size={18} />
                <span className="col">
                  <b>{p.name}</b>
                  <small className="muted">
                    <i className={`status-dot ${on ? 'on' : ''}`} /> {on ? 'Connected' : 'Offline'}
                    {on && lastSync ? ` · synced ${formatDistanceToNowStrict(lastSync, { addSuffix: true })}` : ''}
                    {p.check ? ` · code ${p.check}` : ''}
                  </small>
                </span>
                <button
                  className="btn sm"
                  onClick={async () => (await confirmDialog({ title: `Unlink ${p.name}?`, body: 'This browser stops syncing with it. Nothing is deleted on either device.', confirm: 'Unlink' })) && unlink(p.room)}
                >
                  Unlink
                </button>
              </div>
            )
          })}
        </div>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={beginPairing}><Smartphone size={14} /> Link another phone</button>
      </section>
    </>
  )
}

/** Small phone status button for the sidebar footer. */
/** Sidebar footer: your devices, in as few words as possible. Opens the devices dialog. */
export function DevicesRow() {
  const pairings = useLink((s) => s.pairings)
  const peers = useLink((s) => s.peers)
  const online = pairings.filter((p) => (peers[p.room] || 0) > 0).length
  const label = pairings.length ? `${pairings.length + 1} devices` : 'Your devices'
  return (
    <button className="devices-row" onClick={openLink} title={pairings.length ? `${online} of ${pairings.length} linked online` : 'Add a device'}>
      <i className={pairings.length && online ? '' : 'off'} />
      <span>{label}</span>
    </button>
  )
}

export function LinkStatus() {
  const pairings = useLink((s) => s.pairings)
  const peers = useLink((s) => s.peers)
  const on = pairings.some((p) => (peers[p.room] || 0) > 0)
  return (
    <button className="icon-btn link-status" onClick={openLink} title={pairings.length ? (on ? 'Phone connected' : 'Phone offline') : 'Link your phone'} aria-label="Your phone">
      <Smartphone size={16} />
      {pairings.length > 0 && <i className={`status-dot ${on ? 'on' : ''}`} />}
    </button>
  )
}
