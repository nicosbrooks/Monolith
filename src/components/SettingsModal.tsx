import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Monitor, Moon, Sun, Trash2, X } from 'lucide-react'
import { useStore } from '../store'
import { chooseModel, deleteModel, fits, modelForTier, models, refreshCache, resolvedModel, useAI } from '../ai/llm'
import { STT_MODELS, sttModel } from '../ai/stt'
import { StorageSettings } from './StorageSettings'
import { openLink } from './LinkDialog'
import { useLink } from '../link/link'
import { deviceSummary, setIntegration, useDevice } from '../lib/integrations'

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const set = useStore((s) => s.setSettings)
  const ai = useAI()
  useEffect(() => {
    if (open) refreshCache()
  }, [open])
  const close = () => useStore.getState().setUI({ settingsOpen: false })

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" onMouseDown={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="modal" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            <header>
              <h2>Settings</h2>
              <button className="icon-btn" onClick={close}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <section>
                <h3>You</h3>
                <input className="input su-name-field" value={settings.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your first name" aria-label="Your name" maxLength={40} />
                <p className="small muted">Used in greetings. Leave it blank if you’d rather not.</p>
              </section>

              <section>
                <h3>Appearance</h3>
                <div className="seg">
                  {(
                    [
                      ['system', Monitor],
                      ['light', Sun],
                      ['dark', Moon],
                    ] as const
                  ).map(([t, I]) => (
                    <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => set({ theme: t })}>
                      <I size={14} /> {t[0].toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3>Your phone</h3>
                <p className="muted">Use Monolith on your iPhone too. Scan a code once and everything stays in step.</p>
                <button className="btn sm" onClick={() => (close(), openLink())}>
                  {useLink.getState().pairings.length ? 'Your devices' : 'Link your phone'}
                </button>
              </section>

              <StorageSettings />

              <section>
                <h3>Assistant</h3>
                <label className="toggle">
                  <input type="checkbox" checked={settings.proactive} onChange={(e) => set({ proactive: e.target.checked })} />
                  <span />
                  Suggest events, tasks and ideas while I work
                </label>
                <div className="tiers">
                  {(['fast', 'default', 'enhanced'] as const).map((t) => {
                    const m = modelForTier(t)
                    const on = resolvedModel() === m.id
                    const loadingThis = ai.status === 'loading' && resolvedModel() === m.id
                    return (
                      <button key={t} className={`tier ${on ? 'on' : ''}`} onClick={() => chooseModel(m.id)} disabled={t === 'enhanced' && !fits(m)}>
                        <b>{t === 'fast' ? 'Fast' : t === 'default' ? 'Default' : 'Enhanced'}</b>
                        <small>{t === 'enhanced' && !fits(m) ? 'Not on this device' : m.name}</small>
                        {loadingThis && (
                          <span className="bar">
                            <i
                              style={{
                                width: `${Math.max(ai.progress, 0.03) * 100}%`,
                              }}
                            />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {models().some((m) => m.tier === 'more' && !m.hidden && fits(m)) && (
                  <details className="advanced">
                    <summary>More models</summary>
                    <div className="model-list">
                      {models()
                        .filter((m) => m.tier === 'more' && !m.hidden && fits(m))
                        .map((m) => (
                          <ModelRow
                            key={m.id}
                            name={m.name}
                            note={m.note}
                            on={resolvedModel() === m.id}
                            progress={ai.status === 'loading' && resolvedModel() === m.id ? ai.progress : undefined}
                            onPick={() => chooseModel(m.id)}
                            onRemove={ai.cached[m.id] ? () => deleteModel(m.id) : undefined}
                          />
                        ))}
                    </div>
                  </details>
                )}
                <p className="muted small">Open models download the first time you pick them, then work offline.</p>
              </section>

              <Integrations />

              <details className="advanced">
                <summary>Transcription</summary>
                <div className="seg" style={{ marginTop: 6 }}>
                  {STT_MODELS.map((m) => (
                    <button key={m.id} className={sttModel(settings.whisperModel) === m.id ? 'on' : ''} onClick={() => set({ whisperModel: m.id })} title={`${m.name}, ${m.size}`}>
                      {m.note}
                    </button>
                  ))}
                </div>
                <p className="muted small">{STT_MODELS.find((m) => m.id === sttModel(settings.whisperModel))!.name} · {STT_MODELS.find((m) => m.id === sttModel(settings.whisperModel))!.size}, downloaded once. Speech is transcribed on this device as it’s said; nothing is sent anywhere.</p>
              </details>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** One choice in the model list: pick it and it's used (downloading first if it has to). */
function ModelRow({ name, note, on, progress, onPick, onRemove }: { name: string; note: string; on: boolean; progress?: number; onPick: () => void; onRemove?: () => void }) {
  return (
    <div className={`model ${on ? 'on' : ''}`} role="radio" aria-checked={on} tabIndex={0} onClick={onPick} onKeyDown={(e) => e.key === 'Enter' && onPick()}>
      <div className="col">
        <b>{name}</b>
        <small>{note}</small>
        {progress !== undefined && (
          <div className="bar">
            <i style={{ width: `${Math.max(progress, 0.03) * 100}%` }} />
          </div>
        )}
      </div>
      {on && <Check size={16} />}
      {onRemove && !on && (
        <button className="icon-btn sm" title="Remove download" onClick={(e) => (e.stopPropagation(), onRemove())}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

/** What this browser can tell the assistant. Each one is off until it's turned on here. */
function Integrations() {
  const on = useStore((s) => s.settings.integrations) ?? []
  const device = useDevice()
  const rows = [
    { k: 'location' as const, title: 'Location', note: 'Your town, so answers can be about where you are. Your position is rounded to about a kilometre first.' },
    { k: 'weather' as const, title: 'Weather', note: 'Today’s forecast from Open-Meteo, for planning and answers.' },
  ]
  const status =
    device.status === 'denied' ? 'This browser isn’t allowed to share your location. Allow it in the address bar, then turn this on again.'
    : device.status === 'failed' ? 'Couldn’t find where you are just now. It tries again next time you ask.'
    : device.status === 'locating' ? 'Finding where you are…'
    : on.length ? deviceSummary() : ''
  return (
    <section className="integ">
      <h3>Integrations</h3>
      {rows.map((r) => (
        <label key={r.k} className="toggle">
          <input type="checkbox" checked={on.includes(r.k)} onChange={(e) => setIntegration(r.k, e.target.checked)} />
          <span />
          <div>
            {r.title}
            <small>{r.note}</small>
          </div>
        </label>
      ))}
      {status && <p className="small muted integ-status">{status}</p>}
    </section>
  )
}
