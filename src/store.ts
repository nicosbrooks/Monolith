import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import { addDays, addHours, set as setDate, startOfDay } from 'date-fns'
import type { CalEvent, FileMeta, Folder, Item, ItemKind, Section, Source } from './types'
import { extractTags, htmlToText, uid, withoutLegacyTitle } from './lib/util'
import { APP_NAME } from './brand'
import { openBlob, openText, sealBlob, sealText, vaultReady } from './lib/vault'
import { occurrenceOf } from './lib/repeat'

// Saving. Typing changes state several times a second, and a save writes the whole workspace, so:
//  - nothing is turned into text until a save actually happens (it used to be on every change, including opening a menu);
//  - a change that touches nothing that's saved doesn't cause a save at all;
//  - a save waits for a pause in the changes (0.4 s), but never more than 2 s while they keep coming;
//  - it happens at once when the tab is hidden or closed.
type Saved = { state: Record<string, unknown>; version?: number }
let loaded = false
let pending: { k: string; v: Saved } | null = null
let lastSaved: Record<string, unknown> | null = null
let saveTimer = 0
let firstPending = 0
const flushSave = () => {
  clearTimeout(saveTimer)
  saveTimer = 0
  firstPending = 0
  if (!pending) return saving
  const { k, v } = pending
  pending = null
  lastSaved = v.state
  const text = JSON.stringify(v)
  // In order, so a slow encrypt can't let an older copy land after a newer one.
  const write = saving.then(async () => set(k, await sealText(text)))
  saving = write.catch((e) => console.error('Saving failed', e))
  return write
}
let saving: Promise<unknown> = Promise.resolve()
/** Save everything now, e.g. right after the passcode is turned on or off so the stored copy matches. Rejects if the write fails. */
export function saveNow() {
  lastSaved = null // write even if nothing changed: what's stored may need re-encrypting
  useStore.setState({})
  return flushSave()
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSave())
}
const idbStorage: PersistStorage<unknown> = {
  // With a passcode on, nothing can be read until it's entered.
  getItem: async (k) => {
    await vaultReady
    const raw = await get<string>(k)
    return raw == null ? null : JSON.parse(await openText(raw))
  },
  setItem: (k, v) => {
    // Never save before the stored data has loaded: that would overwrite it with the starter content.
    if (!loaded) return
    const state = (v as Saved).state
    // The same docs, events and settings as the last save (only something on screen changed): nothing to write.
    const base = pending?.v.state ?? lastSaved
    if (base && Object.keys(state).every((key) => state[key] === base[key])) return
    pending = { k, v: v as Saved }
    const now = Date.now()
    firstPending ||= now
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(flushSave, Math.max(0, Math.min(400, firstPending + 2000 - now)))
  },
  removeItem: async (k) => del(k),
}

export interface Settings {
  llmModel: string
  /** The speech-to-text model (named for the first one the app used). */
  whisperModel: string
  proactive: boolean
  accent: string
  theme: 'system' | 'light' | 'dark'
  googleClientId: string
  glass: boolean
  /** What to call the person in greetings. Empty: no name. */
  name: string
  /** A connected folder that new docs are saved in, or null for this browser. */
  home: string | null
  /** When first-time setup was finished, or null to show it. */
  setupAt: number | null
  /** When the workspace was last saved to a backup file. */
  lastBackup?: number
  /** When Monolith last suggested a backup (lib/safekeeping.ts). */
  backupNudgedAt?: number
  /** Integrations turned on in this browser (Settings › Integrations). */
  integrations?: ('location' | 'weather')[]
  /** Settings › Files. Unset means on: pictures resized, other files compressed where it helps. */
  compressFiles?: boolean
  /** Longest side of a stored picture when compressing: small 1280, medium 1920, large 2560 (default). */
  pictureSize?: 'small' | 'medium' | 'large'
  /** Recording bitrate: voice (32 kbps Opus, ~14 MB an hour, the default) or high (96 kbps). */
  recordingQuality?: 'voice' | 'high'
  /** Settings › General › Reminders: notify before events and when timed tasks come due. Unset means off. */
  remind?: boolean
  /** Settings › Assistant › Understand meaning (System 1, EmbeddingGemma). Unset means on. */
  system1?: boolean
  /** How long the general model (System 2) stays in memory. Unset means auto: learned from use, loaded ahead when
   *  System 1 sees a question coming, released when the tab is hidden. */
  keepLoaded?: 'auto' | '2m' | '10m' | 'always'
}

interface State {
  items: Item[]
  folders: Folder[]
  events: CalEvent[]
  section: Section
  activeId: string | null
  calendarDate: number | null
  folderId: string | null
  tagFilter: string | null
  aiOpen: boolean
  /** A question typed into Ask or search, waiting for the assistant panel to pick it up. */
  askDraft: string | null
  paletteOpen: boolean
  /** Setup shown again from Settings, opened at this step. */
  setupOpen: false | 0 | 1
  settingsOpen: boolean
  connectOpen: boolean
  drawerOpen: boolean
  sidebarCollapsed: boolean
  dismissed: string[]
  settings: Settings
  sources: Source[]

  go: (section: Section, activeId?: string | null) => void
  openCalendarDate: (date: Date) => void
  open: (id: string) => void
  createItem: (kind: ItemKind, patch?: Partial<Item>) => Item
  updateItem: (id: string, patch: Partial<Item>) => void
  trashItem: (id: string) => void
  restoreItem: (id: string) => void
  purgeItem: (id: string) => void
  createFolder: (name: string) => void
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string) => void
  setFolder: (id: string | null) => void
  setTag: (t: string | null) => void
  addEvent: (e: Omit<CalEvent, 'id'>) => CalEvent
  updateEvent: (id: string, patch: Partial<CalEvent>) => void
  deleteEvent: (id: string) => void
  /** Turn one date of a repeating event into an event of its own (the series skips that date). */
  detachEvent: (id: string, patch?: Partial<CalEvent>) => CalEvent | null
  dismiss: (id: string) => void
  setUI: (patch: Partial<Pick<State, 'aiOpen' | 'paletteOpen' | 'settingsOpen' | 'connectOpen' | 'drawerOpen' | 'sidebarCollapsed'>>) => void
  setSettings: (patch: Partial<Settings>) => void
  addSource: (s: Source) => void
  updateSource: (id: string, patch: Partial<Source>) => void
  removeSource: (id: string) => void
  /** Update sync metadata without touching updatedAt */
  patchFile: (id: string, patch: Partial<FileMeta>) => void
}

const now = Date.now()
const today = startOfDay(new Date())

/** The docs a new workspace starts with. Their example sentences explain features; they're never suggested as real plans. */
export const SAMPLE_IDS = new Set(['welcome', 'doc-guide'])
const seedItems: Item[] = [
  {
    id: 'welcome',
    kind: 'doc',
    title: `Welcome to ${APP_NAME}`,
    content: `<p>Your docs, tasks, recordings and calendar in one place, with an assistant that runs on your own devices.</p><h2>Try these</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Open the app</p></li><li data-type="taskItem" data-checked="false"><p>Press <code>⌘K</code> to jump anywhere</p></li><li data-type="taskItem" data-checked="false"><p>Type <code>/</code> on an empty line for blocks — checklists, tables, sketches</p></li><li data-type="taskItem" data-checked="false"><p>Record a class or meeting and get notes written for you</p></li></ul><h2>Everything connects</h2><p>Type <code>[[</code> to link one doc to another, like <a href="#doc/doc-guide">Study system</a>. Each doc shows what links to it at the bottom.</p><p>Checklist lines from every doc gather in Tasks. Give one a date (<em>“essay draft by Friday”</em>) and it’s sorted by when it’s due.</p><p>Write something like <em>“Problem set due Friday 5pm”</em> in any doc, and ${APP_NAME} offers to put it on your calendar. #getting-started</p>`,
    folderId: null,
    parentId: null,
    pinned: true,
    tags: ['getting-started'],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-guide',
    kind: 'doc',
    title: 'Study system',
    content: `<p>Docs are for longer, structured writing — like a wiki. They support Markdown shortcuts: type <code>#</code> for a heading, <code>-</code> for a list, <code>[]</code> for a checklist, <code>&gt;</code> for a quote, and <code>\`\`\`</code> for code.</p><h2>Weekly loop</h2><ol><li><p>Record lectures → review AI notes the same day</p></li><li><p>Turn key points into flashcards</p></li><li><p>Plan the week in Calendar every Sunday</p></li></ol><h2>Courses</h2><table><tbody><tr><th><p>Course</p></th><th><p>When</p></th><th><p>Focus</p></th></tr><tr><td><p>Linear Algebra</p></td><td><p>Tue / Thu</p></td><td><p>Eigenvalues</p></td></tr><tr><td><p>Philosophy 101</p></td><td><p>Mon / Wed</p></td><td><p>Socratic method</p></td></tr></tbody></table><blockquote><p>“The unexamined life is not worth living.”</p></blockquote>`,
    folderId: null,
    parentId: null,
    pinned: false,
    tags: [],
    createdAt: now - 1000,
    updatedAt: now - 1000,
  },
]

const seedEvents: CalEvent[] = [
  {
    id: 'ev1',
    title: 'Linear Algebra lecture',
    start: setDate(today, { hours: 10 }).getTime(),
    end: setDate(today, { hours: 11, minutes: 30 }).getTime(),
    color: 'violet',
    location: 'Hall B',
  },
  {
    id: 'ev2',
    title: 'Study group',
    start: addHours(setDate(addDays(today, 1), { hours: 15 }), 0).getTime(),
    end: setDate(addDays(today, 1), { hours: 16, minutes: 30 }).getTime(),
    color: 'teal',
  },
  {
    id: 'ev3',
    title: 'Philosophy essay due',
    start: addDays(today, 3).getTime(),
    end: addDays(today, 4).getTime(),
    color: 'rose',
    allDay: true,
  },
]

export const useStore = create<State>()(
  persist(
    (setS, getS) => ({
      items: seedItems,
      folders: [{ id: 'f-school', name: 'School' }, { id: 'f-personal', name: 'Personal' }],
      events: seedEvents,
      section: 'home',
      activeId: null,
      setupOpen: false,
      calendarDate: null,
      folderId: null,
      tagFilter: null,
      aiOpen: false,
      askDraft: null,
      paletteOpen: false,
      settingsOpen: false,
      connectOpen: false,
      drawerOpen: false,
      sidebarCollapsed: false,
      dismissed: [],
      settings: {
        // 'default' means the Default tier, resolved per device (see modelForTier). Existing installs keep their pick.
        llmModel: 'default',
        whisperModel: 'onnx-community/moonshine-base-ONNX',
        proactive: true,
        accent: '#7c5cff',
        theme: 'dark',
        googleClientId: '',
        glass: true,
        name: '',
        home: null,
        setupAt: null,
      },
      sources: [],

      go: (section, activeId = null) => {
        if (activeId === null && section !== 'home' && section !== 'calendar') {
          const kind = section === 'docs' ? 'doc' : section === 'lectures' ? 'lecture' : null
          const cur = getS().items.find((i) => i.id === getS().activeId)
          if (kind && cur?.kind === kind && !cur.deletedAt) activeId = cur.id
          else if (kind) {
            const first = getS()
              .items.filter((i) => i.kind === kind && !i.deletedAt)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0]
            activeId = first?.id ?? null
          }
        }
        setS({ section, activeId, tagFilter: null, calendarDate: null })
      },
      openCalendarDate: (date) => setS({ section: 'calendar', activeId: null, tagFilter: null, calendarDate: date.getTime() }),
      open: (id) => {
        const it = getS().items.find((i) => i.id === id)
        if (!it) return
        const section: Section = it.deletedAt ? 'trash' : it.kind === 'lecture' ? 'lectures' : 'docs'
        setS({ section, activeId: id, ...(section === 'docs' && getS().folderId && getS().folderId !== it.folderId ? { folderId: null } : {}) })
      },
      createItem: (asked, patch = {}) => {
        const kind = asked === 'note' ? 'doc' : asked // notes were merged into docs
        const t = Date.now()
        const item: Item = {
          id: uid(),
          kind,
          title: '',
          content: '',
          folderId: kind === 'doc' && !patch.parentId ? getS().folderId : null,
          parentId: null,
          pinned: false,
          tags: [],
          createdAt: t,
          updatedAt: t,
          ...(kind === 'lecture' ? { lecture: { duration: 0, transcript: [], hasAudio: false, status: 'idle' as const } } : {}),
          // New docs go to the folder picked in setup, unless they're being put somewhere specific.
          ...(kind === 'doc' && !('sourceId' in patch) && !patch.parentId && getS().sources.some((x) => x.id === getS().settings.home)
            ? { sourceId: getS().settings.home!, folderId: null, file: { baseHtml: '', baseTitle: '' } }
            : {}),
          ...patch,
        }
        setS((s) => ({
          items: [item, ...s.items],
          activeId: item.id,
          section: kind === 'lecture' ? 'lectures' : 'docs',
        }))
        return item
      },
      updateItem: (id, patch) =>
        setS((s) => {
          // A renamed doc keeps its name in the docs that link to it (links still showing the old title, that is;
          // a link someone reworded is theirs). Not counted as an edit of those docs.
          const was = patch.title !== undefined ? s.items.find((i) => i.id === id)?.title : undefined
          const href = `href="#doc/${id}"`
          const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
          const retitle = was !== undefined && was !== patch.title && was.trim() && patch.title!.trim()
            ? (html: string) => html.replace(/<a\b[^>]*>([^<]*)<\/a>/g, (a, text: string) => (a.includes(href) && text === esc(was) ? a.replace(/>[^<]*<\/a>$/, `>${esc(patch.title!)}</a>`) : a))
            : null
          return {
          items: s.items.map((i) => {
            if (i.id !== id) {
              if (!retitle || !i.content.includes(href)) return i
              const content = retitle(i.content)
              return content === i.content ? i : { ...i, content }
            }
            if (Object.keys(patch).every((k) => i[k as keyof Item] === patch[k as keyof Item])) return i
            const next = { ...i, ...patch, updatedAt: patch.pinned !== undefined && Object.keys(patch).length === 1 ? i.updatedAt : Date.now() }
            if (patch.content !== undefined) {
              const text = htmlToText(patch.content)
              next.tags = extractTags(text)
            }
            return next
          }),
          }
        }),
      trashItem: (id) =>
        setS((s) => {
          const ids = new Set([id])
          // trash nested docs too
          let grew = true
          while (grew) {
            grew = false
            for (const i of s.items) if (i.parentId && ids.has(i.parentId) && !ids.has(i.id)) (ids.add(i.id), (grew = true))
          }
          return {
            items: s.items.map((i) => (ids.has(i.id) ? { ...i, deletedAt: Date.now() } : i)),
            activeId: s.activeId && ids.has(s.activeId) ? null : s.activeId,
          }
        }),
      restoreItem: (id) =>
        setS((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, deletedAt: undefined, parentId: s.items.some((p) => p.id === i.parentId && !p.deletedAt) ? i.parentId : null } : i)) })),
      purgeItem: (id) => {
        del(`audio:${id}`)
        setS((s) => ({ items: s.items.filter((i) => i.id !== id), activeId: s.activeId === id ? null : s.activeId }))
      },
      createFolder: (name) => setS((s) => ({ folders: [...s.folders, { id: uid(), name }] })),
      renameFolder: (id, name) => setS((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) })),
      deleteFolder: (id) =>
        setS((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          items: s.items.map((i) => (i.folderId === id ? { ...i, folderId: null } : i)),
          folderId: s.folderId === id ? null : s.folderId,
        })),
      setFolder: (folderId) => setS({ folderId, activeId: null, tagFilter: null, section: 'docs' }),
      setTag: (tagFilter) => setS({ tagFilter, section: 'docs' }),
      addEvent: (e) => {
        const ev = { ...e, id: uid() }
        setS((s) => ({ events: [...s.events, ev] }))
        return ev
      },
      // An id like `<series>@<start>` is one date of a repeating event (lib/repeat.ts). Changing it changes the whole
      // series; a new time moves every date by the same amount.
      updateEvent: (id, patch) => {
        const occ = occurrenceOf(id)
        if (!occ) return setS((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
        setS((s) => ({
          events: s.events.map((e) => {
            if (e.id !== occ.seriesId) return e
            const { start, end, seriesId: _s, id: _i, ...rest } = patch
            const shift = start !== undefined ? start - occ.start : 0
            const len = end !== undefined ? end - (start ?? occ.start) : e.end - e.start
            return { ...e, ...rest, start: e.start + shift, end: e.start + shift + len, skip: shift ? e.skip?.map((x) => x + shift) : e.skip }
          }),
        }))
      },
      // Deleting one date of a series skips that date; deleting the series (its own id) removes them all.
      deleteEvent: (id) => {
        const occ = occurrenceOf(id)
        if (!occ) return setS((s) => ({ events: s.events.filter((e) => e.id !== id) }))
        setS((s) => ({ events: s.events.map((e) => (e.id === occ.seriesId ? { ...e, skip: [...(e.skip ?? []), occ.start] } : e)) }))
      },
      detachEvent: (id, patch) => {
        const occ = occurrenceOf(id)
        const series = occ && getS().events.find((e) => e.id === occ.seriesId)
        if (!occ || !series) return null
        const { repeat: _r, skip: _k, seriesId: _s, ...base } = series
        const one: CalEvent = { ...base, id: uid(), start: occ.start, end: occ.start + (series.end - series.start), ...patch }
        setS((s) => ({ events: [...s.events.map((e) => (e.id === series.id ? { ...e, skip: [...(e.skip ?? []), occ.start] } : e)), one] }))
        return one
      },
      dismiss: (id) => setS((s) => ({ dismissed: [...s.dismissed.filter((d) => d !== id).slice(-499), id] })),
      setUI: (patch) => setS(patch.connectOpen || patch.settingsOpen || patch.paletteOpen ? { ...patch, drawerOpen: false } : patch),
      setSettings: (patch) => setS((s) => ({ settings: { ...s.settings, ...patch } })),
      addSource: (src) => setS((s) => ({ sources: [...s.sources, src] })),
      updateSource: (id, patch) => setS((s) => ({ sources: s.sources.map((x) => (x.id === id ? { ...x, ...patch, config: { ...x.config, ...patch.config } } : x)) })),
      removeSource: (id) =>
        setS((s) => ({
          sources: s.sources.filter((x) => x.id !== id),
          items: s.items.filter((i) => i.sourceId !== id),
          activeId: s.items.find((i) => i.id === s.activeId)?.sourceId === id ? null : s.activeId,
        })),
      patchFile: (id, patch) =>
        setS((s) => ({ items: s.items.map((i) => (i.id === id && i.file ? { ...i, file: { ...i.file, ...patch } } : i)) })),
    }),
    {
      name: 'socratic-v1',
      version: 10,
      migrate: (persisted: unknown, v: number) => {
        const p = persisted as Partial<State>
        if (v < 2) p.aiOpen = false
        if (p.settings && p.settings.googleClientId === undefined) p.settings.googleClientId = ''
        if (p.settings && p.settings.glass === undefined) p.settings.glass = true
        // Models are now picked by tier; older picks were last generation, so move everyone to Default.
        if (v < 6 && p.settings) p.settings.llmModel = 'default'
        if (v < 7 && p.items) p.items = p.items.map((i) => i.kind === 'note' || i.id === 'doc-guide' ? { ...i, content: withoutLegacyTitle(i.content, i.title) } : i)
        // Notes and docs are one thing now.
        if (v < 8 && p.items) p.items = p.items.map((i) => (i.kind === 'note' ? { ...i, kind: 'doc' } : i))
        // First-time setup is for new installs; anyone already using the app has been set up.
        if (v < 9 && p.settings) p.settings = { ...p.settings, name: '', home: null, setupAt: p.settings.setupAt ?? 1 }
        // Models run only in the browser now, managed by the app: drop the old Ollama / MLX choices.
        if (v < 10 && p.settings) {
          const { provider: _p, ollamaModel: _o, localEngines: _l, ...rest } = p.settings as Settings & { provider?: string; ollamaModel?: string; localEngines?: boolean }
          p.settings = rest
        }
        return p as State
      },
      // The saved part of the state (see partialize) goes through as it is; text is made only when a save happens.
      storage: idbStorage as unknown as PersistStorage<Partial<State>>,
      partialize: (s) => ({
        items: s.items,
        folders: s.folders,
        events: s.events,
        settings: s.settings,
        sources: s.sources,
        dismissed: s.dismissed,
        aiOpen: s.aiOpen,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
)

if (useStore.persist.hasHydrated()) loaded = true
useStore.persist.onFinishHydration(() => (loaded = true))

export const saveAudio = async (id: string, blob: Blob) => set(`audio:${id}`, await sealBlob(blob))
export const loadAudio = async (id: string) => openBlob(await get(`audio:${id}`))
