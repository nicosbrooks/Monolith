import { Command } from 'cmdk'
import { takeHeld } from '../lib/typeahead'
import { useEffect, useMemo, useState } from 'react'
import { format, isToday, isTomorrow } from 'date-fns'
import {
  CalendarDays, CalendarPlus, ListChecks, Square, FileText, Home, Mic, AudioWaveform, Moon, Settings, MessageCircle, Sun, HardDriveUpload,
  Smartphone, Keyboard, Trash2, ListPlus, FilePlus2, Sparkles, PanelLeft, Download,
} from 'lucide-react'
import { useShortcuts } from './Overlays'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../store'
import { toggleLibrary } from '../lib/shell'
import { itemEmoji } from '../lib/util'
import { fullText, searchText } from '../lib/text'
import { startRecording } from '../lib/recordNext'
import { related } from '../ai/system1'
import { eventColor, whenLabel } from '../lib/dates'
import { addTask, dueLabel, removeTask, useWorkspace, type Task } from '../lib/graph'
import { useOwnEvents } from '../lib/events'
import { readDoc, readEvent, readTask, ruleKind, taskPreview, type RequestKind } from '../lib/request'
import { focusAsk } from './AskBar'
import { toast } from './Toast'
import { completeTask } from '../views/TasksView'
import type { CalEvent, Item } from '../types'

/** What the list is narrowed to. Tab and Shift-Tab move between them; ">" at the start means Commands. */
const SCOPES = [
  { id: 'all', label: 'All' },
  { id: 'docs', label: 'Docs' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'events', label: 'Events' },
  { id: 'recordings', label: 'Recordings' },
  { id: 'commands', label: 'Commands' },
] as const
type Scope = (typeof SCOPES)[number]['id']

/**
 * How well `title` and `body` match every word of the query, or 0 if one is missing. A title that starts with the
 * query beats one with a word that does, beats one that only contains it, beats a match in the text.
 */
function score(words: string[], title: string, body = '') {
  if (!words.length) return 1
  const t = title.toLowerCase()
  let total = 0
  for (const w of words) {
    if (t.startsWith(w)) total += 4
    else if (new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(t)) total += 3
    else if (t.includes(w)) total += 2
    else if (body.includes(w)) total += 1
    else return 0
  }
  return total
}

/** The words around the first match in a doc's text. */
function snippet(item: Item, word: string) {
  const text = fullText(item)
  const at = searchText(item).indexOf(word)
  if (at < 0) return ''
  return (at > 30 ? '…' : '') + text.slice(Math.max(0, at - 30), at + 80).replace(/\s+/g, ' ').trim() + '…'
}

/** Every doc, recording and event as one .zip, the same as Settings › Storage › Export everything. */
async function exportEverything() {
  try {
    const x = await (await import('../lib/exportAll')).exportAll()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(x.blob)
    a.download = x.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    toast('Exported everything')
  } catch (e) {
    toast(`Couldn’t export: ${(e as Error).message}`)
  }
}

const when = (e: CalEvent) => (isToday(e.start) ? 'Today' : isTomorrow(e.start) ? 'Tomorrow' : format(e.start, 'EEE, MMM d')) + (e.allDay ? '' : ` · ${format(e.start, 'h:mm a')}`)

/**
 * Quick access (⌘K): the fastest way to any doc, task, event or recording, to any command, and to the assistant.
 * It understands requests the way the Ask bar does ("dentist friday 3pm" offers to add it), searches by words and by
 * meaning, and works entirely from the keyboard.
 */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const items = useStore((s) => s.items)
  const events = useOwnEvents()
  const ws = useWorkspace()
  const st = useStore.getState()
  const [q, setQ] = useState(takeHeld)
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState('')
  const close = () => (st.setUI({ paletteOpen: false }), setQ(''), setScope('all'))
  const run = (fn: () => void) => () => (close(), fn())
  useEffect(() => {
    if (!open) return void (setQ(''), setScope('all'))
    const held = takeHeld()
    if (held) setQ((q) => q + held)
  }, [open])

  // ">" means commands, like most editors.
  const commandMode = q.startsWith('>')
  const view: Scope = commandMode ? 'commands' : scope
  const query = (commandMode ? q.slice(1) : q).trim()
  const ql = query.toLowerCase()
  const words = useMemo(() => ql.split(/\s+/).filter(Boolean), [ql])
  const show = (s: Scope) => view === 'all' || view === s

  // ─── What the words ask for (same reading as the Ask bar) ───
  const [meant, setMeant] = useState<{ q: string; kind: RequestKind } | null>(null)
  const rule = query.length > 2 && view === 'all' ? ruleKind(query).kind : null
  const kind = meant?.q === query ? meant.kind : rule
  useEffect(() => {
    if (query.length < 3 || view !== 'all') return
    let live = true
    const t = setTimeout(() => void import('../ai/understand').then((m) => m.understand(query)).then((u) => live && setMeant({ q: query, kind: u.kind })), 140)
    return () => ((live = false), clearTimeout(t))
  }, [query, view])
  const ev = kind === 'event' || (rule === 'event' && kind !== 'ask') ? readEvent(query) : null
  const task = kind === 'task' ? taskPreview(readTask(query)) : null

  // ─── Things ───
  const docs = useMemo(() => {
    if (!open) return []
    const out: { i: Item; s: number }[] = []
    for (const i of items) {
      if (i.deletedAt || i.file?.dir) continue
      const s = score(words, i.title || 'Untitled', ql ? searchText(i) : '')
      if (s) out.push({ i, s })
    }
    return out.sort((a, b) => b.s - a.s || b.i.updatedAt - a.i.updatedAt).map((x) => x.i)
  }, [open, items, words, ql])
  const docHits = docs.filter((i) => i.kind !== 'lecture').slice(0, view === 'docs' ? 30 : ql ? 6 : 5)
  const recHits = docs.filter((i) => i.kind === 'lecture').slice(0, view === 'recordings' ? 30 : ql ? 4 : 3)
  const taskHits = useMemo(() => {
    const out = ws.tasks.map((t) => ({ t, s: score(words, t.text) })).filter((x) => x.s)
    return out.sort((a, b) => b.s - a.s).map((x) => x.t).slice(0, view === 'tasks' ? 40 : ql ? 5 : 4)
  }, [ws.tasks, words, view, ql])
  const eventHits = useMemo(() => {
    const now = Date.now()
    const list = events
      .filter((e) => (ql ? score(words, e.title, (e.location || '').toLowerCase()) : e.end > now))
      .sort((a, b) => a.start - b.start)
      // What's coming first, and a repeating event once (its next date).
      .filter((e, _i, all) => e.end > now || !all.some((x) => x.end > now && x.title === e.title))
      .filter((e, i, all) => !e.seriesId || all.findIndex((x) => x.seriesId === e.seriesId) === i)
    return list.slice(0, view === 'events' ? 30 : ql ? 4 : 3)
  }, [events, words, ql, view])

  // Docs close in meaning that the words didn't find ("eigenvectors" → "Linear algebra, week 3").
  const [meaning, setMeaning] = useState<string[]>([])
  useEffect(() => {
    if (ql.length < 3) return setMeaning([])
    let live = true
    const t = setTimeout(() => void related(ql, 6).then((r) => live && setMeaning(r.filter((x) => x.score > 0.45).map((x) => x.id))), 120)
    return () => ((live = false), clearTimeout(t))
  }, [ql])
  const shown = new Set([...docHits, ...recHits].map((i) => i.id))
  const close2 = meaning.map((id) => items.find((i) => i.id === id && !i.deletedAt)).filter((i): i is Item => !!i && !shown.has(i.id)).slice(0, 3)

  // ─── Commands ───
  const dark = document.documentElement.dataset.theme === 'dark'
  const commands = [
    { g: 'Create', l: 'New doc', i: FilePlus2, k: '⌘N', f: () => st.createItem('doc') },
    { g: 'Create', l: 'Start recording', i: Mic, f: () => void startRecording() },
    { g: 'Create', l: 'New event', i: CalendarPlus, f: () => (st.go('calendar'), setTimeout(() => focusAsk(''), 120)) },
    { g: 'Create', l: 'New task', i: ListPlus, f: () => (st.go('tasks'), setTimeout(() => focusAsk(''), 120)) },
    { g: 'Go to', l: 'Home', i: Home, f: () => st.go('home') },
    { g: 'Go to', l: 'Tasks', i: ListChecks, f: () => st.go('tasks') },
    { g: 'Go to', l: 'Calendar', i: CalendarDays, f: () => st.go('calendar') },
    { g: 'Go to', l: 'Recordings', i: Mic, f: () => st.go('lectures') },
    { g: 'Go to', l: 'Recently Deleted', i: Trash2, f: () => st.go('trash') },
    { g: 'Assistant', l: 'Ask the assistant', i: MessageCircle, k: '⌘J', f: () => focusAsk() },
    { g: 'Settings', l: dark ? 'Light mode' : 'Dark mode', i: dark ? Sun : Moon, f: () => st.setSettings({ theme: dark ? 'light' : 'dark' }) },
    { g: 'Settings', l: 'Open library', i: PanelLeft, k: '⌘\\', f: () => toggleLibrary() },
    { g: 'Settings', l: 'Settings', i: Settings, k: '⌘,', f: () => st.setUI({ settingsOpen: true }) },
    { g: 'Settings', l: 'Keep docs in a folder or Drive', i: HardDriveUpload, f: () => st.setUI({ connectOpen: true }) },
    { g: 'Settings', l: 'Add a device', i: Smartphone, f: () => import('./LinkDialog').then((m) => m.openLink()) },
    { g: 'Settings', l: 'Export everything', i: Download, f: () => void exportEverything() },
    { g: 'Settings', l: 'Keyboard shortcuts', i: Keyboard, k: '?', f: () => useShortcuts.setState({ open: true }) },
  ]
  const cmdHits = commands
    .map((c) => ({ c, s: score(words, c.l, c.g.toLowerCase()) }))
    .filter((x) => x.s)
    .sort((a, b) => (ql ? b.s - a.s : 0))
    .map((x) => x.c)
  // With nothing typed, All shows only the few places people go most; Commands shows them all.
  const cmdShown = view === 'commands' ? cmdHits : ql ? cmdHits.slice(0, 4) : cmdHits.filter((c) => c.g === 'Create').slice(0, 3)

  // ─── Doing what the words ask ───
  const ask = () => run(() => void import('../ai/conversation').then((m) => (m.ask(query), focusAsk())))()
  const doEvent = () => {
    if (!ev?.when) return
    const w = ev.when
    // No name in what was typed: ask for one in the Ask bar, as it does, rather than adding "New event".
    if (!ev.title)
      return void import('../ai/conversation').then((m) => {
        m.useConvo.setState({ pending: { need: 'title', start: w.start.getTime(), end: w.end.getTime(), allDay: w.allDay, location: w.location, due: w.due, repeat: w.repeat } })
        m.say(query, `What should I call it? It’s ${whenLabel(w)}.`)
        focusAsk('')
      })
    const title = ev.title
    const added = st.addEvent({ title, start: ev.when.start.getTime(), end: ev.when.end.getTime(), allDay: ev.when.allDay, location: ev.when.location, repeat: ev.when.repeat, color: eventColor({ title, due: ev.when.due }) })
    toast(`Added “${title}” · ${whenLabel(ev.when)}`, { ms: 8000, action: { label: 'Undo', run: () => useStore.getState().deleteEvent(added.id) } })
  }
  const doTask = () => {
    const line = readTask(query)
    const t = addTask(line)
    const { name, due } = taskPreview(line)
    if (t) toast(`Added “${name}”${due ? ` · due ${whenLabel(due)}` : ''}`, { ms: 6000, action: { label: 'Undo', run: () => removeTask(t) } })
  }

  const Icon = (i: Item) => (itemEmoji(i) ? <span className="emoji">{itemEmoji(i)}</span> : i.kind === 'lecture' ? <AudioWaveform size={16} /> : <FileText size={16} />)
  const docRow = (i: Item, prefix = '') => (
    <Command.Item key={prefix + i.id} value={`${prefix}item:${i.id}`} onSelect={run(() => st.open(i.id))}>
      {Icon(i)}
      <span className="col">
        <b>{i.title || 'Untitled'}</b>
        {words[0] && <small>{snippet(i, words[0])}</small>}
      </span>
      <small className="qa-meta">{format(i.updatedAt, isToday(i.updatedAt) ? 'h:mm a' : 'MMM d')}</small>
    </Command.Item>
  )
  const titles = useMemo(() => new Map(items.map((i) => [i.id, i.title || 'Untitled'])), [items])
  const taskRow = (t: Task) => (
    <Command.Item key={`${t.itemId}:${t.n}`} value={`task:${t.itemId}:${t.n}`} onSelect={run(() => st.open(t.itemId))}>
      <Square size={16} />
      <span className="col">
        <b>{t.title}</b>
        <small>{titles.get(t.itemId)}</small>
      </span>
      {t.due !== undefined && <small className="qa-meta">{dueLabel(t)}</small>}
    </Command.Item>
  )

  const cmdGroup = show('commands') && cmdShown.length > 0 && (
                  <Command.Group heading={view === 'commands' || ql ? 'Commands' : 'Create'}>
                    {cmdShown.map((a) => (
                      <Command.Item key={a.l} value={`cmd:${a.l}`} onSelect={run(a.f)}>
                        <a.i size={16} />
                        <span>{a.l}</span>
                        {view === 'commands' && <small className="qa-meta">{a.g}</small>}
                        {a.k && <kbd>{a.k}</kbd>}
                      </Command.Item>
                    ))}
                  </Command.Group>
  )
  // Typing a command's name ("settings", "add a dev…") puts it first, as editors do; Ask is one arrow away.
  const named = view === 'all' && ql.length >= 3 && cmdShown.some((c) => c.l.toLowerCase().startsWith(ql))

  // What ⌘↵ does with the highlighted row, shown in the footer.
  const selTask = selected.startsWith('task:') ? ws.tasks.find((t) => `task:${t.itemId}:${t.n}` === selected) : undefined
  const alt = selTask ? 'check off' : query ? 'ask the assistant' : null
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return close()
    if (e.key === 'Tab') {
      e.preventDefault()
      const at = SCOPES.findIndex((s) => s.id === view)
      const next = SCOPES[(at + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length].id
      if (commandMode) setQ(q.slice(1))
      setScope(next)
    } else if (e.key === 'Backspace' && !q && scope !== 'all') setScope('all')
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (selTask) (completeTask(selTask), close())
      else if (query) ask()
    }
  }

  const nothing = !docHits.length && !recHits.length && !taskHits.length && !eventHits.length && !cmdShown.length && !close2.length

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" onMouseDown={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <motion.div
            className="palette qa"
            role="dialog"
            aria-label="Quick access"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ type: 'spring', duration: 0.22, bounce: 0.1 }}
          >
            <Command shouldFilter={false} loop value={selected} onValueChange={setSelected} onKeyDown={onKey} label="Quick access">
              <Command.Input autoFocus value={q} onValueChange={setQ} placeholder={view === 'all' ? 'Search, ask, or add “dentist friday 3pm”…' : `Search ${SCOPES.find((s) => s.id === view)!.label.toLowerCase()}…`} />
              <div className="qa-scopes" role="tablist" aria-label="Show">
                {SCOPES.map((s) => (
                  <button key={s.id} role="tab" aria-selected={view === s.id} className={view === s.id ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => (commandMode && setQ(q.slice(1)), setScope(s.id))}>
                    {s.label}
                  </button>
                ))}
              </div>
              <Command.List>
                {named && cmdGroup}
                {query && view === 'all' && (
                  <Command.Group heading="Do">
                    {kind === 'event' && ev?.when && (
                      <Command.Item value="do:event" onSelect={run(doEvent)}>
                        <CalendarPlus size={16} />
                        <span className="col"><b>{ev.title ? `Add “${ev.title}”` : 'Add an event'}</b><small>{whenLabel(ev.when)}{ev.title ? '' : ' · you’ll name it next'}</small></span>
                      </Command.Item>
                    )}
                    {kind === 'task' && (
                      <Command.Item value="do:task" onSelect={run(doTask)}>
                        <ListPlus size={16} />
                        <span className="col"><b>Add task “{task?.name}”</b><small>{task?.due ? `Due ${whenLabel(task.due)} · to your Tasks doc` : 'To your Tasks doc'}</small></span>
                      </Command.Item>
                    )}
                    {kind === 'doc' && (
                      <Command.Item value="do:doc" onSelect={run(() => st.createItem('doc', readDoc(query) ? { title: readDoc(query) } : {}))}>
                        <FilePlus2 size={16} />
                        <span className="col"><b>{readDoc(query) ? `New doc “${readDoc(query)}”` : 'New doc'}</b></span>
                      </Command.Item>
                    )}
                    <Command.Item value="do:ask" onSelect={ask}>
                      <Sparkles size={16} />
                      <span className="col"><b>Ask the assistant</b><small>“{query}”</small></span>
                      <kbd>⌘↵</kbd>
                    </Command.Item>
                  </Command.Group>
                )}
                {show('docs') && docHits.length > 0 && <Command.Group heading={ql ? 'Docs' : 'Recent'}>{docHits.map((i) => docRow(i))}</Command.Group>}
                {show('docs') && close2.length > 0 && <Command.Group heading="Related in meaning">{close2.map((i) => docRow(i, 'rel:'))}</Command.Group>}
                {show('tasks') && taskHits.length > 0 && <Command.Group heading={ql ? 'Tasks' : 'Open tasks'}>{taskHits.map(taskRow)}</Command.Group>}
                {show('events') && eventHits.length > 0 && (
                  <Command.Group heading={ql ? 'Events' : 'Coming up'}>
                    {eventHits.map((e) => (
                      <Command.Item key={e.id} value={`event:${e.id}`} onSelect={run(() => st.openCalendarDate(new Date(e.start)))}>
                        <CalendarDays size={16} />
                        <span className="col"><b>{e.title}</b>{e.location && <small>{e.location}</small>}</span>
                        <small className="qa-meta">{when(e)}</small>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {show('recordings') && recHits.length > 0 && <Command.Group heading="Recordings">{recHits.map((i) => docRow(i))}</Command.Group>}
                {!named && cmdGroup}
                {nothing && !(query && view === 'all') && <div className="qa-empty">{query ? `Nothing matches “${query}”` : 'Nothing here yet'}</div>}
              </Command.List>
              <footer className="qa-foot" aria-hidden="true">
                <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
                <span><kbd>↵</kbd> open</span>
                {alt && <span><kbd>⌘↵</kbd> {alt}</span>}
                <span><kbd>Tab</kbd> filter</span>
                <span className="grow" />
                <span><kbd>esc</kbd> close</span>
              </footer>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
