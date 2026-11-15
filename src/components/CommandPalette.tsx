import { Command } from 'cmdk'
import { useState } from 'react'
import { format } from 'date-fns'
import { CalendarDays, CalendarPlus, FileText, Home, Mic, Moon, Settings, Sparkles, StickyNote, Sun, HardDriveUpload, Smartphone, Keyboard } from 'lucide-react'
import { useShortcuts } from './Overlays'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../store'
import { htmlToText, itemEmoji } from '../lib/util'
import { parseQuickEvent } from '../lib/dates'

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const items = useStore((s) => s.items)
  const events = useStore((s) => s.events)
  const st = useStore.getState()
  const [q, setQ] = useState('')
  const close = () => (st.setUI({ paletteOpen: false }), setQ(''))
  const run = (fn: () => void) => () => (fn(), close())
  const parsed = q.length > 3 ? parseQuickEvent(q) : null

  // full-text matches with snippet
  const ql = q.toLowerCase().trim()
  const hits = items
    .filter((i) => !i.deletedAt)
    .map((i) => {
      const text = htmlToText(i.content) + ' ' + (i.lecture?.transcript.map((s) => s.text).join(' ') || '')
      const idx = ql ? text.toLowerCase().indexOf(ql) : -1
      const inTitle = ql && i.title.toLowerCase().includes(ql)
      return { i, snippet: idx >= 0 ? '…' + text.slice(Math.max(0, idx - 30), idx + 70).replace(/\s+/g, ' ') + '…' : '', score: inTitle ? 2 : idx >= 0 ? 1 : ql ? 0 : 0.5 }
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || b.i.updatedAt - a.i.updatedAt)
    .slice(0, 12)

  const Icon = { note: StickyNote, doc: FileText, lecture: Mic }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" onMouseDown={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <motion.div
            className="palette"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', duration: 0.25, bounce: 0.15 }}
          >
            <Command shouldFilter={false} loop onKeyDown={(e) => e.key === 'Escape' && close()}>
              <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Ask, search, or type “quiz friday 2pm” to schedule…" />
              <Command.List>
                <Command.Empty>No results. Press ↵ to create a note titled “{q}”.</Command.Empty>
                {q.trim().length > 2 && (
                  <Command.Group heading="Ask">
                    <Command.Item value="ask" onSelect={run(() => useStore.setState({ askDraft: q.trim(), aiOpen: true }))}>
                      <Sparkles size={16} />
                      <span>Ask “{q.trim()}”</span>
                    </Command.Item>
                  </Command.Group>
                )}
                {parsed && (
                  <Command.Group heading="Schedule">
                    <Command.Item onSelect={run(() => { st.addEvent({ title: parsed.title, start: parsed.start.getTime(), end: parsed.end.getTime(), allDay: parsed.allDay, color: 'blue' }); st.go('calendar') })}>
                      <CalendarPlus size={16} />
                      <span>Add “{parsed.title}”</span>
                      <small>{format(parsed.start, parsed.allDay ? 'EEE MMM d' : 'EEE MMM d, h:mm a')}</small>
                    </Command.Item>
                  </Command.Group>
                )}
                {hits.length > 0 && (
                  <Command.Group heading={q ? 'Results' : 'Recent'}>
                    {hits.map(({ i, snippet }) => {
                      const I = Icon[i.kind]
                      return (
                        <Command.Item key={i.id} value={i.id} onSelect={run(() => st.open(i.id))}>
                          {itemEmoji(i) ? <span className="emoji">{itemEmoji(i)}</span> : <I size={16} />}
                          <span className="col">
                            <b>{i.title || 'Untitled'}</b>
                            {snippet && <small>{snippet}</small>}
                          </span>
                        </Command.Item>
                      )
                    })}
                  </Command.Group>
                )}
                {q &&
                  events
                    .filter((e) => e.title.toLowerCase().includes(ql))
                    .slice(0, 4)
                    .map((e) => (
                      <Command.Item key={e.id} onSelect={run(() => st.go('calendar'))}>
                        <CalendarDays size={16} />
                        <span>{e.title}</span>
                        <small>{format(e.start, 'EEE MMM d')}</small>
                      </Command.Item>
                    ))}
                <Command.Group heading="Actions">
                  {[
                    { l: q ? `New doc “${q}”` : 'New doc', i: FileText, k: '⌘N', f: () => st.createItem('doc', q ? { title: q } : {}) },
                    { l: 'Start recording', i: Mic, f: () => st.createItem('lecture', { title: q || `Recording · ${format(new Date(), 'MMM d')}` }) },
                    { l: 'Go home', i: Home, f: () => st.go('home') },
                    { l: 'Go to Calendar', i: CalendarDays, f: () => st.go('calendar') },
                    { l: 'Open the assistant', i: Sparkles, k: '⌘J', f: () => st.setUI({ aiOpen: !st.aiOpen }) },
                    { l: document.documentElement.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode', i: document.documentElement.dataset.theme === 'dark' ? Sun : Moon, f: () => st.setSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
                    { l: 'Settings', i: Settings, k: '⌘,', f: () => st.setUI({ settingsOpen: true }) },
                    { l: 'Keep docs in a folder or Drive', i: HardDriveUpload, f: () => st.setUI({ connectOpen: true }) },
                    { l: 'Add a device', i: Smartphone, f: () => import('./LinkDialog').then((m) => m.openLink()) },
                    { l: 'Keyboard shortcuts', i: Keyboard, k: '?', f: () => useShortcuts.setState({ open: true }) },
                  ]
                    .filter((a) => !ql || a.l.toLowerCase().includes(ql) || a.l.startsWith('New note'))
                    .map((a) => (
                      <Command.Item key={a.l} onSelect={run(a.f)}>
                        <a.i size={16} />
                        <span>{a.l}</span>
                        {a.k && <kbd>{a.k}</kbd>}
                      </Command.Item>
                    ))}
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
