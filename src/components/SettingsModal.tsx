import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Monitor, Moon, Sun, Trash2, X } from 'lucide-react'
import { useStore } from '../store'
import { chooseModel, deleteModel, detectMLX, detectOllama, fits, modelForTier, models, refreshCache, resolvedModel, useAI } from '../ai/llm'
import { WHISPER_MODELS } from '../ai/whisper'
import { StorageSettings } from './StorageSettings'
import { openLink } from './LinkDialog'
import { useLink } from '../link/link'

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const set = useStore((s) => s.setSettings)
  const ai = useAI()
  useEffect(() => {
    if (open) (refreshCache(), detectOllama(), detectMLX())
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
                    const on = settings.provider !== 'mlx' && settings.provider !== 'ollama' && resolvedModel() === m.id
                    const loadingThis = ai.status === 'loading' && resolvedModel() === m.id
                    return (
                      <button key={t} className={`tier ${on ? 'on' : ''}`} onClick={() => chooseModel({ kind: 'webllm', id: m.id })} disabled={t === 'enhanced' && !fits(m)}>
                        <b>{t === 'fast' ? 'Fast' : t === 'default' ? 'Default' : 'Enhanced'}</b>
                        <small>{m.name}</small>
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
                {(ai.mlx || !!ai.ollama?.length) && (
                  <div className="model-list" style={{ marginTop: 10 }}>
                    {ai.mlx && <ModelRow name="Your Mac’s model" note="Already running on this computer" on={settings.provider === 'mlx'} onPick={() => chooseModel({ kind: 'mlx' })} />}
                    {ai.ollama?.map((n) => (
                      <ModelRow
                        key={n}
                        name={n.replace(/:latest$/, '')}
                        note="Already on this computer"
                        on={settings.provider === 'ollama' && settings.ollamaModel === n}
                        onPick={() => chooseModel({ kind: 'ollama', id: n })}
                      />
                    ))}
                  </div>
                )}
                {models().some((m) => m.tier === 'more' && fits(m)) && (
                  <details className="advanced">
                    <summary>More models</summary>
                    <div className="model-list">
                      {models()
                        .filter((m) => m.tier === 'more' && fits(m))
                        .map((m) => (
                          <ModelRow
                            key={m.id}
                            name={m.name}
                            note={m.note}
                            on={settings.provider !== 'mlx' && settings.provider !== 'ollama' && resolvedModel() === m.id}
                            progress={ai.status === 'loading' && resolvedModel() === m.id ? ai.progress : undefined}
                            onPick={() => chooseModel({ kind: 'webllm', id: m.id })}
                            onRemove={ai.cached[m.id] ? () => deleteModel(m.id) : undefined}
                          />
                        ))}
                    </div>
                  </details>
                )}
                <p className="muted small">Open models download the first time you pick them, then work offline.</p>
              </section>

              <details className="advanced">
                <summary>Transcription quality</summary>
                <div className="seg" style={{ marginTop: 6 }}>
                  {WHISPER_MODELS.map((m) => (
                    <button key={m.id} className={settings.whisperModel === m.id ? 'on' : ''} onClick={() => set({ whisperModel: m.id })}>
                      {m.note}
                    </button>
                  ))}
                </div>
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
