import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, HardDrive, Info, MessageCircle, Monitor, Moon, SlidersHorizontal, Smartphone, Sun, Trash2, X } from 'lucide-react'
import { useStore } from '../store'
import { chooseModel, deleteModel, fits, modelForTier, models, refreshCache, resolvedModel, useAI } from '../ai/llm'
import { STT_MODELS, sttModel } from '../ai/stt'
import { StorageSettings } from './StorageSettings'
import { About } from './About'
import { toast } from './Toast'
import { openLink } from './LinkDialog'
import { useLink } from '../link/link'
import { useSystem1 } from '../ai/system1'
import { useRemote } from '../ai/remote'
import { reminderStatus } from '../lib/reminders'
import { deviceSummary, setIntegration, useDevice } from '../lib/integrations'

const TABS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'assistant', label: 'Assistant', icon: MessageCircle },
  { id: 'storage', label: 'Storage and files', icon: HardDrive },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'about', label: 'About', icon: Info },
] as const
type Tab = (typeof TABS)[number]['id']

export function SettingsModal() {
  const [tab, setTab] = useState<Tab>('general')
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
          <motion.div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            {/* Sections on the left, one at a time on the right: nothing to scroll past to find a setting. */}
            <div className="set-nav">
              <h2>Settings</h2>
              <div role="tablist" aria-label="Settings sections" aria-orientation="vertical">
              {TABS.map((t) => (
                <button key={t.id} role="tab" id={`set-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="set-panel" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                  <t.icon size={16} strokeWidth={1.8} aria-hidden="true" /> {t.label}
                </button>
              ))}
              </div>
            </div>
            <div className="set-main">
              <header>
                <h2>{TABS.find((t) => t.id === tab)!.label}</h2>
                <button className="icon-btn" onClick={close} aria-label="Close" title="Close (Esc)">
                  <X size={18} />
                </button>
              </header>
              <div className="modal-body" id="set-panel" role="tabpanel" aria-labelledby={`set-tab-${tab}`} key={tab}>
                {tab === 'general' && (
                  <>
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

              <Reminders />

                  </>
                )}
                {tab === 'assistant' && (
                  <>
              <section>
                <label className="toggle">
                  <input type="checkbox" checked={settings.proactive} onChange={(e) => set({ proactive: e.target.checked })} />
                  <span />
                  Suggest events, tasks and ideas while I work
                </label>
                <System1Settings />
                <PhoneModelSettings />
                <div className="tiers">
                  {(['fast', 'default', 'enhanced'] as const).map((t) => {
                    const m = modelForTier(t)
                    const on = resolvedModel() === m.id
                    const loadingThis = ai.status === 'loading' && resolvedModel() === m.id
                    return (
                      <button key={t} className={`tier ${on ? 'on' : ''}`} onClick={() => chooseModel(m.id)} disabled={t === 'enhanced' && !fits(m)}>
                        <b>{t === 'fast' ? 'Fast' : t === 'default' ? 'Default' : 'Enhanced'}</b>
                        <small>{t === 'enhanced' && !fits(m) ? 'Not on this device' : m.name}</small>
                        {/* Where its download stands, when that's worth saying. */}
                        {!(t === 'enhanced' && !fits(m)) && !loadingThis && (ai.cached[m.id] || ai.partial[m.id] !== undefined) && (
                          <small className="tier-state">{ai.cached[m.id] ? 'Downloaded' : `${Math.round(ai.partial[m.id] * 100)}% downloaded · continues when picked`}</small>
                        )}
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
                <p className="muted small">
                  Open models download the first time you pick them, then work offline. A download that’s interrupted carries on from where it stopped.
                  {ai.free !== undefined && ai.free < 6 * 1024 ** 3 ? ` This browser has ${(ai.free / 1024 ** 3).toFixed(1)} GB free.` : ''}
                </p>
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

                  </>
                )}
                {tab === 'storage' && (
                  <>
                    <StorageSettings />
                    <FilesSettings />
                  </>
                )}
                {tab === 'devices' && (
                  <>
              <section>
                <h3>Your phone</h3>
                <p className="muted">Use Monolith on your iPhone too. Scan a code once and everything stays in step.</p>
                <button className="btn sm" onClick={() => (close(), openLink())}>
                  {useLink.getState().pairings.length ? 'Your devices' : 'Link your phone'}
                </button>
              </section>

                  </>
                )}
                {tab === 'about' && <About />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Settings › General: reminders before events and for timed tasks. */
function Reminders() {
  const on = !!useStore((s) => s.settings.remind)
  const [, redraw] = useState(0)
  return (
    <section>
      <h3>Reminders</h3>
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => { const want = e.target.checked; void import('../lib/reminders').then((m) => m.setReminders(want)).then(() => redraw((n) => n + 1)) }} />
        <span />
        Remind me before events and when tasks are due
      </label>
      {on && <p className="small muted">{reminderStatus(on)}</p>}
    </section>
  )
}

/**
 * Settings › Assistant › Use my phone's model. Only shown with a phone linked. A phone that runs a model can answer for
 * this browser, sealed end to end like everything else that goes between them: on a slower computer, or before this
 * browser has downloaded a model, that's quicker than waiting for a download.
 */
function PhoneModelSettings() {
  const pairings = useLink((s) => s.pairings)
  const remote = useRemote((s) => s.remote)
  const pref = useStore((s) => s.settings.phoneModel ?? 'auto')
  const set = useStore((s) => s.setSettings)
  if (!pairings.length) return null
  const status = remote ? `${remote.device} is reachable and runs ${remote.model}.` : 'Open Monolith on your phone to use its model. Phones that run a model show it here.'
  return (
    <>
      <div className="set-row">
        <span>Use my phone’s model</span>
        <div className="seg">
          {(
            [
              ['auto', 'Auto'],
              ['always', 'Always'],
              ['never', 'Never'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} title={k === 'auto' ? 'When this browser has no model ready without a download' : k === 'always' ? 'Whenever your phone is reachable' : 'Only this browser’s model'} className={pref === k ? 'on' : ''} onClick={() => set({ phoneModel: k })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="small muted">{status} Questions and answers go between your devices encrypted end to end.</p>
    </>
  )
}

/** One choice in the model list: pick it and it's used (downloading first if it has to). */
/**
 * Settings › Assistant: System 1 (a small model that understands meaning, always on) and how long the general model
 * stays in memory after answering.
 */
function System1Settings() {
  const settings = useStore((s) => s.settings)
  const set = useStore((s) => s.setSettings)
  const s1 = useSystem1()
  const on = settings.system1 !== false
  const status =
    !on ? 'Off. Search and context use words only.'
    : s1.status === 'loading' ? `Getting ready… ${Math.round(s1.progress * 100)}%`
    : s1.status === 'error' ? `Couldn’t start: ${s1.error}`
    : s1.status === 'ready' ? (s1.indexed < s1.total ? `Reading your docs: ${s1.indexed} of ${s1.total}` : `Ready · ${s1.total} docs and recordings`)
    : 'Starting…'
  return (
    <>
      <label className="toggle">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            set({ system1: e.target.checked })
            void import('../ai/system1').then((m) => (e.target.checked ? m.startSystem1() : m.stopSystem1()))
          }}
        />
        <span />
        Understand meaning, not just words
      </label>
      <p className="small muted">EmbeddingGemma, a small model that stays ready: it finds notes by what they mean for search and for the assistant. {status}</p>
      <div className="set-row">
        <span>Keep the assistant loaded</span>
        <div className="seg">
          {(
            [
              ['auto', 'Auto'],
              ['2m', '2 min'],
              ['10m', '10 min'],
              ['always', 'Always'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} title={k === 'auto' ? 'Loads ahead when a question is coming, keeps it as long as you tend to need it, frees it when you leave the tab' : k === 'always' ? 'Fastest answers; holds the most memory' : 'Frees memory when you’re not asking; reloads in seconds'} className={(settings.keepLoaded ?? 'auto') === k ? 'on' : ''} onClick={() => (set({ keepLoaded: k }), void import('../ai/llm').then((m) => m.scheduleRelease()))}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

/** Settings › Files: how much pictures, attachments and recordings are made smaller, and what they take up. */
function FilesSettings() {
  const settings = useStore((s) => s.settings)
  const set = useStore((s) => s.setSettings)
  const on = settings.compressFiles !== false
  const [use, setUse] = useState<{ files: number; stored: number; original: number } | null>(null)
  const refresh = () => void import('../lib/files').then((f) => f.storageUse()).then(setUse).catch(() => {})
  useEffect(refresh, [])
  const mb = (n: number) => (n < 1e6 ? `${Math.round(n / 1e3)} KB` : `${(n / 1e6).toFixed(n < 1e8 ? 1 : 0)} MB`)
  return (
    <section>
      <h3>Files</h3>
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => set({ compressFiles: e.target.checked })} />
        <span />
        Make files smaller
      </label>
      <p className="small muted">
        {on
          ? 'Pictures are resized as you add them. Other files are compressed without losing anything, when that helps. Files you already added stay as they are.'
          : 'Files are kept exactly as you add them. They take more space and sync more slowly.'}
      </p>
      {on && (
        <div className="set-row">
          <span>Pictures</span>
          <div className="seg">
            {(
              [
                ['small', 'Small', '1280 px'],
                ['medium', 'Medium', '1920 px'],
                ['large', 'Large', '2560 px'],
              ] as const
            ).map(([k, label, hint]) => (
              <button key={k} title={`Longest side ${hint}`} className={(settings.pictureSize ?? 'large') === k ? 'on' : ''} onClick={() => set({ pictureSize: k })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="set-row">
        <span>Recordings</span>
        <div className="seg">
          {(
            [
              ['voice', 'Voice', 'About 14 MB an hour'],
              ['high', 'High quality', 'About 43 MB an hour'],
            ] as const
          ).map(([k, label, hint]) => (
            <button key={k} title={hint} className={(settings.recordingQuality ?? 'voice') === k ? 'on' : ''} onClick={() => set({ recordingQuality: k })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {use && use.files > 0 && (
        <p className="small muted set-row">
          <span>
            {use.files} file{use.files === 1 ? '' : 's'} in docs use {mb(use.stored)}
            {use.original > use.stored * 1.05 ? ` (${mb(use.original - use.stored)} saved)` : ''}
          </span>
          <button
            className="btn sm"
            onClick={async () => {
              const f = await import('../lib/files')
              const freed = await f.collectGarbage(useStore.getState().items.map((i) => i.content), true)
              toast(freed ? `Cleared ${mb(freed)} of files no doc uses` : 'Every file is in use')
              refresh()
            }}
          >
            Clear unused
          </button>
        </p>
      )}
    </section>
  )
}

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
