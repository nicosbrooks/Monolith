import { create } from 'zustand'
import { useStore } from '../store'
import type { FileMeta, Item, Source } from '../types'
import { uid } from '../lib/util'
import { basename, dirname, joinFile, safeName, splitFile } from '../lib/mdfile'

// The converter pulls in the editor, so it loads only when a sync actually runs.
const converter = () => import('../lib/markdown')
import { toast } from '../components/Toast'
import { AuthError, ConflictError, type BatchProvider, type Entry, type FileProvider, type Provider } from './types'
import { folderProvider, forgetHandle, hasPermission, loadHandle, pickFolder, saveHandle } from './folder'
import { forgetToken, githubProvider, inspectRepo, loadToken, parseRepo, saveToken } from './github'
import { cachedToken, driveProvider, ensureRoot, signInDrive, signOutDrive } from './gdrive'
import { googleClientId } from './accounts'
import { FILE_HEADER, hasKey, openText, sealText } from '../lib/vault'
import { exportAssets, importAssets } from './assets'

export type SyncStatus = 'idle' | 'syncing' | 'needs-auth' | 'error'
export const useSync = create<{ st: Record<string, { status: SyncStatus; error?: string }> }>(() => ({ st: {} }))
const setStatus = (id: string, status: SyncStatus, error?: string) => useSync.setState((s) => ({ st: { ...s.st, [id]: { status, error } } }))

const providers = new Map<string, Provider>()
const queues = new Map<string, Promise<unknown>>()
/** Run one sync task at a time per source. */
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(fn)
  queues.set(id, next)
  return next
}

const src = (id: string) => useStore.getState().sources.find((s) => s.id === id)
const itemsOf = (id: string) => useStore.getState().items.filter((i) => i.sourceId === id)
export const kindLabel: Record<Source['kind'], string> = { folder: 'folder', gdrive: 'Google Drive', github: 'GitHub' }

export const isDirty = (i: Item) => !!i.file && !i.file.dir && !i.deletedAt && (!i.file.path || i.content !== i.file.baseHtml || i.title !== i.file.baseTitle)
/** Local changes not yet written (for GitHub: not yet committed), including deletions. */
export function pendingChanges(sourceId: string) {
  return itemsOf(sourceId).filter((i) => isDirty(i) || (i.deletedAt && i.file?.path && !i.file.dir))
}

// ─── Providers ─────────────────────────────────────────────────────────────

async function provider(s: Source, interactive = false): Promise<Provider | null> {
  if (providers.has(s.id)) return providers.get(s.id)!
  let p: Provider | null = null
  if (s.kind === 'folder') {
    const h = await loadHandle(s.id)
    if (h && (await hasPermission(h, interactive))) {
      rawFolders.set(s.id, folderProvider(h))
      p = sealed(rawFolders.get(s.id)!)
    }
  } else if (s.kind === 'github') {
    const token = await loadToken(s.id)
    const c = s.config
    p = githubProvider({ owner: c.owner!, repo: c.repo!, branch: c.branch!, base: c.base }, token, !c.readOnly)
  } else if (s.kind === 'gdrive') {
    let token = cachedToken()
    if (!token && interactive) token = await signInDrive(await googleClientId())
    if (token) p = driveProvider(token, s.config.rootId!)
  }
  if (p) providers.set(s.id, p)
  return p
}

/** With a passcode on, files written to a folder are encrypted. Plain files (older ones, or added by hand) still read. */
function sealed(p: FileProvider): FileProvider {
  return {
    ...p,
    read: async (e) => {
      const text = await p.read(e)
      return openText(text.startsWith(FILE_HEADER) ? text.slice(FILE_HEADER.length) : text)
    },
    write: async (path, text, prev, force) => {
      const out = await sealText(text)
      return p.write(path, out === text ? text : FILE_HEADER + out, prev, force)
    },
  }
}

/** The folder as it is on disk, without decryption, to tell which files Monolith encrypted. */
const rawFolders = new Map<string, FileProvider>()

/** Ask for access to every connected folder (browsers need a click for this). Returns the names still without access. */
export async function folderAccess() {
  const missing: string[] = []
  for (const s of useStore.getState().sources.filter((x) => x.kind === 'folder')) {
    if (!rawFolders.has(s.id)) await provider(s, true).catch(() => null)
    if (!rawFolders.has(s.id)) missing.push(s.name)
  }
  return missing
}

/** The paths of a folder's docs that are stored encrypted on disk. */
async function sealedPaths(id: string, raw: FileProvider) {
  const out: string[] = []
  for (const i of itemsOf(id)) {
    if (!i.file?.path || i.file.dir || i.deletedAt) continue
    const text = await raw.read({ path: i.file.path, rev: i.file.rev || '' }).catch(() => '')
    if (text.startsWith(FILE_HEADER)) out.push(i.id)
  }
  return out
}

/**
 * While the passcode is being turned off: write the files Monolith encrypted again in the clear, from the copy in
 * memory. Files it never encrypted are left exactly as they are. Throws if a folder can't be reached or a file is still
 * encrypted afterwards, so the caller keeps the passcode (and with it, a way to read those files).
 */
export async function rewriteSealedFiles() {
  const missing = await folderAccess()
  if (missing.length) throw new Error(`Allow access to “${missing[0]}” first, so its encrypted files can be saved readable.`)
  const st = useStore.getState()
  for (const s of st.sources.filter((x) => x.kind === 'folder')) {
    const raw = rawFolders.get(s.id)!
    for (const id of await sealedPaths(s.id, raw)) st.patchFile(id, { baseHtml: '\u0000rewrite' })
    await flush(s.id)
    if ((await sealedPaths(s.id, raw)).length) throw new Error(`Some files in “${s.name}” couldn’t be saved readable. Try again.`)
  }
}

function fail(id: string, e: unknown) {
  if (e instanceof AuthError) {
    providers.delete(id)
    setStatus(id, 'needs-auth', e.message)
  } else setStatus(id, 'error', (e as Error).message || String(e))
}

// ─── Connect / disconnect ──────────────────────────────────────────────────

export async function connectFolder() {
  const h = await pickFolder()
  const id = uid()
  await saveHandle(id, h)
  useStore.getState().addSource({ id, kind: 'folder', name: h.name, config: {} })
  await pull(id)
  return id
}

export async function connectGitHub(input: { repo: string; branch?: string; base?: string; token?: string }) {
  const r = parseRepo(input.repo)
  if (!r) throw new Error('Enter a repository like owner/name')
  const token = input.token?.trim() || undefined
  const info = await inspectRepo(r.owner, r.repo, token)
  const id = uid()
  if (token) await saveToken(id, token)
  const base = input.base?.trim().replace(/^\/|\/$/g, '') || undefined
  useStore.getState().addSource({
    id,
    kind: 'github',
    name: info.name + (base ? `/${base}` : ''),
    config: { ...r, branch: input.branch?.trim() || info.branch, base, readOnly: !info.canPush },
  })
  await pull(id)
  return { id, readOnly: !info.canPush }
}

export async function connectDrive() {
  const clientId = await googleClientId()
  if (!clientId) throw new Error('Google sign-in is not set up yet')
  const token = cachedToken() || (await signInDrive(clientId))
  const rootId = await ensureRoot(token)
  const id = uid()
  useStore.getState().addSource({ id, kind: 'gdrive', name: 'Google Drive', config: { rootId } })
  await pull(id)
  return id
}

/** Re-grant access (folder permission or Google sign-in). Call from a click. */
export async function reconnect(id: string) {
  const s = src(id)
  if (!s) return
  providers.delete(id)
  try {
    if (!(await provider(s, true))) return setStatus(id, 'needs-auth', 'Access was not granted')
    await pull(id)
  } catch (e) {
    fail(id, e)
  }
}

export async function disconnect(id: string) {
  const s = src(id)
  if (!s) return
  providers.delete(id)
  await Promise.all([forgetHandle(id), forgetToken(id)])
  if (s.kind === 'gdrive' && !useStore.getState().sources.some((x) => x.id !== id && x.kind === 'gdrive')) signOutDrive()
  useStore.getState().removeSource(id)
  useSync.setState((x) => {
    const st = { ...x.st }
    delete st[id]
    return { st }
  })
}

// ─── Pull: remote → local ──────────────────────────────────────────────────

type Conv = Awaited<ReturnType<typeof converter>>
function fromFile(c: Conv, text: string, path: string): Pick<Item, 'title' | 'content'> & Pick<FileMeta, 'front' | 'h1' | 'baseHtml' | 'baseTitle'> {
  const { front, title, body } = splitFile(text)
  const html = c.markdownToHtml(body)
  const t = title ?? basename(path)
  return { title: t, content: html, front, h1: title !== undefined, baseHtml: html, baseTitle: t }
}

async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) {
      const k = i++
      out[k] = await fn(xs[k])
    }
  }))
  return out
}

export function pull(id: string): Promise<void> {
  return serial(id, async () => {
    const s = src(id)
    if (!s) return
    setStatus(id, 'syncing')
    try {
      const p = await provider(s)
      if (!p) return setStatus(id, 'needs-auth', s.kind === 'folder' ? 'Allow access to the folder again' : 'Sign in again')
      const entries = await p.list()
      const files = entries.filter((e) => !e.dir)
      const dirs = entries.filter((e) => e.dir && files.some((f) => f.path.startsWith(e.path + '/')))
      const mine = itemsOf(id)
      const byPath = new Map(mine.filter((i) => i.file?.path).map((i) => [i.file!.path!, i]))
      const changed = files.filter((f) => {
        const ex = byPath.get(f.path)
        return !ex || (ex.file!.rev !== f.rev && !ex.deletedAt)
      })
      const texts = await mapLimit(changed, 6, async (f) => {
        const ex = byPath.get(f.path)
        return ex && isDirty(ex) ? null : p.read(f) // local edits win until resolved
      })
      const conv = await converter()
      const t = Date.now()
      const next = new Map<string, Item>()
      const reloaded = new Set<string>()

      // Directories become container docs.
      for (const d of dirs) {
        const ex = byPath.get(d.path)
        next.set(d.path, ex ? { ...ex, file: { ...ex.file!, id: d.id } } : {
          id: uid(), kind: 'doc', title: basename(d.path), content: '', folderId: null, parentId: null, pinned: false, tags: [],
          createdAt: t, updatedAt: t, sourceId: id, file: { path: d.path, dir: true, id: d.id, rev: '', baseHtml: '', baseTitle: basename(d.path) },
        })
      }
      for (const f of files) {
        const ex = byPath.get(f.path)
        const k = changed.indexOf(f)
        if (k < 0) { next.set(f.path, ex!); continue }
        const text = texts[k]
        if (text === null) { next.set(f.path, { ...ex!, file: { ...ex!.file!, conflict: true } }); continue }
        const parsed = fromFile(conv, text, f.path)
        // Pictures and files linked from the doc (assets/…) come in as stored files.
        const imported = await importAssets(id, p as FileProvider, parsed.content, f.path)
        if (imported !== parsed.content) (parsed.content = imported), (parsed.baseHtml = imported)
        const file: FileMeta = { ...ex?.file, path: f.path, rev: f.rev, id: f.id, baseHtml: parsed.baseHtml, baseTitle: parsed.baseTitle, front: parsed.front, h1: parsed.h1, conflict: false, error: undefined, pulls: (ex?.file?.pulls || 0) + 1 }
        if (ex) reloaded.add(ex.id)
        next.set(f.path, ex
          ? { ...ex, title: parsed.title, content: parsed.content, updatedAt: t, file }
          : { id: uid(), kind: 'doc', title: parsed.title, content: parsed.content, folderId: null, parentId: null, pinned: false, tags: [], createdAt: t, updatedAt: t, sourceId: id, file })
      }
      // Parents follow the folder structure.
      const dirId = new Map([...next.values()].filter((i) => i.file?.dir).map((i) => [i.file!.path!, i.id]))
      for (const [path, it] of next) next.set(path, { ...it, parentId: dirId.get(dirname(path)) ?? null })

      // Keep local-only items (new, trashed or edited); drop clean ones deleted remotely.
      const keep = mine
        .filter((i) => !i.file?.path || (!next.has(i.file.path) && (isDirty(i) || i.deletedAt)))
        .map((i) => (i.file?.path ? { ...i, file: { ...i.file, path: undefined, rev: undefined, id: undefined, lastPath: i.file.path } } : i))

      useStore.setState((st) => {
        // Merge against the latest state: the user may have edited or deleted docs while we were fetching.
        const snap = new Map(mine.map((i) => [i.id, i]))
        const cur = new Map(st.items.map((i) => [i.id, i]))
        const merged = [...next.values(), ...keep].flatMap((v) => {
          const c = cur.get(v.id)
          const before = snap.get(v.id)
          if (before && !c) return [] // deleted meanwhile
          if (!c || c === before) return [v]
          return [reloaded.has(v.id) ? { ...c, parentId: v.parentId, file: { ...c.file!, conflict: true } } : { ...c, parentId: v.parentId }]
        })
        return { items: [...st.items.filter((i) => !snap.has(i.id)), ...merged] }
      })
      useStore.getState().updateSource(id, { lastSync: Date.now() })
      setStatus(id, 'idle')
    } catch (e) {
      fail(id, e)
    }
  })
}

// ─── Push: local → remote ──────────────────────────────────────────────────

function targetPath(it: Item, taken: Set<string>): { path: string; h1: boolean; from?: string } {
  const f = it.file!
  const items = useStore.getState().items
  const dir = items.find((i) => i.id === it.parentId)?.file?.path ?? (f.path ? dirname(f.path) : '')
  const prefix = dir ? dir + '/' : ''
  const unique = (name: string) => {
    let p = `${prefix}${name}.md`
    for (let n = 2; taken.has(p) && p !== f.path; n++) p = `${prefix}${name} ${n}.md`
    return p
  }
  if (!f.path) {
    if (f.lastPath && !taken.has(f.lastPath)) return { path: f.lastPath, h1: !!f.h1 }
    return { path: unique(safeName(it.title)), h1: true }
  }
  // Without a "# Title" line the file name is the title, so renaming the doc renames the file.
  if (!f.h1 && it.title.trim() && safeName(it.title) !== basename(f.path)) return { path: unique(safeName(it.title)), h1: false, from: f.path }
  return { path: f.path, h1: !!f.h1 }
}

const render = (c: Conv, it: Item, h1: boolean, html = it.content) => joinFile(it.file!.front, h1 ? it.title.trim() || 'Untitled' : undefined, c.htmlToMarkdown(html))

/** Write all local changes for a folder or Drive source. */
export function flush(id: string, force: string[] = []): Promise<void> {
  return serial(id, async () => {
    const s = src(id)
    const p = s && (providers.get(id) as FileProvider | undefined)
    if (!s || !p || p.batch) return
    const st = useStore.getState()
    const work = pendingChanges(id).filter((i) => !i.file!.conflict || force.includes(i.id))
    if (!work.length) return
    setStatus(id, 'syncing')
    const conv = await converter()
    const taken = new Set(itemsOf(id).map((i) => i.file?.path).filter(Boolean) as string[])
    try {
      for (const it of work) {
        const f = it.file!
        const prev: Entry | undefined = f.path && f.rev ? { path: f.path, rev: f.rev, id: f.id } : undefined
        const overwrite = force.includes(it.id)
        try {
          if (it.deletedAt) {
            await p.remove({ path: f.path!, rev: f.rev || '', id: f.id })
            st.patchFile(it.id, { path: undefined, rev: undefined, id: undefined, lastPath: f.path })
            continue
          }
          const { path, h1, from } = targetPath(it, taken)
          // Pictures and files go beside the doc in assets/, linked relatively, unless the passcode lock is on: then
          // the Markdown is encrypted and the files stay in Monolith, not written out in the clear.
          const html = hasKey() ? it.content : await exportAssets(id, p, it.content, path)
          let e: Entry
          if (from && p.rename) {
            e = await p.rename({ path: from, rev: f.rev || '', id: f.id }, path)
            e = await p.write(path, render(conv, it, h1, html), e, true)
          } else {
            e = await p.write(path, render(conv, it, h1, html), from ? undefined : prev, overwrite)
            if (from) await p.remove({ path: from, rev: f.rev || '', id: f.id })
          }
          taken.add(path)
          if (from) taken.delete(from)
          st.patchFile(it.id, { path, rev: e.rev, id: e.id, h1, baseHtml: it.content, baseTitle: it.title, conflict: false, error: undefined })
        } catch (err) {
          if (err instanceof ConflictError) st.patchFile(it.id, { conflict: true })
          else if (err instanceof AuthError) throw err
          else st.patchFile(it.id, { error: (err as Error).message })
        }
      }
      useStore.getState().updateSource(id, { lastSync: Date.now() })
      setStatus(id, 'idle')
    } catch (e) {
      fail(id, e)
    }
  })
}

/** Commit all pending changes for a GitHub source in one commit. */
export function commit(id: string, message: string): Promise<boolean> {
  return serial(id, async () => {
    const s = src(id)
    const p = s && ((await provider(s)) as BatchProvider | null)
    if (!s || !p?.batch) return false
    if (p.readOnly) {
      toast('This repository is read-only. Reconnect it with a token that can write.')
      return false
    }
    const work = pendingChanges(id)
    if (!work.length) return false
    setStatus(id, 'syncing')
    const conv = await converter()
    const taken = new Set(itemsOf(id).map((i) => i.file?.path).filter(Boolean) as string[])
    const plan = work.map((it) => {
      if (it.deletedAt) return { it, changes: [{ path: it.file!.path!, text: null, prevRev: it.file!.rev }] }
      const { path, h1, from } = targetPath(it, taken)
      taken.add(path)
      const text = render(conv, it, h1)
      return { it, path, h1, changes: [{ path, text, prevRev: from ? undefined : it.file!.rev }, ...(from ? [{ path: from, text: null, prevRev: it.file!.rev }] : [])] }
    })
    try {
      const revs = await p.commit(plan.flatMap((x) => x.changes as { path: string; text: string | null; prevRev?: string }[]), message)
      const st = useStore.getState()
      for (const x of plan) {
        if (x.it.deletedAt) st.patchFile(x.it.id, { path: undefined, rev: undefined, lastPath: x.it.file!.path })
        else st.patchFile(x.it.id, { path: x.path, rev: revs[x.path!], h1: x.h1, baseHtml: x.it.content, baseTitle: x.it.title, conflict: false, error: undefined })
      }
      useStore.getState().updateSource(id, { lastSync: Date.now() })
      setStatus(id, 'idle')
      return true
    } catch (e) {
      if (e instanceof ConflictError) {
        setStatus(id, 'idle')
        toast('Files changed on GitHub since you last synced. Refresh, then commit again.')
        return false
      }
      fail(id, e)
      return false
    }
  })
}

/** Resolve a conflict by keeping the local copy (overwrite) or taking the remote one. */
export async function resolve(itemId: string, keep: 'mine' | 'theirs') {
  const it = useStore.getState().items.find((i) => i.id === itemId)
  if (!it?.sourceId || !it.file) return
  const s = src(it.sourceId)!
  if (keep === 'mine') {
    if (s.kind === 'github') {
      // Re-base on the current remote revision so the next commit goes through.
      const p = (await provider(s))!
      const cur = (await p.list()).find((e) => e.path === it.file!.path)
      useStore.getState().patchFile(itemId, { rev: cur?.rev, conflict: false })
    } else {
      useStore.getState().patchFile(itemId, { conflict: false })
      await flush(s.id, [itemId])
    }
  } else {
    // Drop local edits, then pull fresh content.
    useStore.getState().updateItem(itemId, { content: it.file.baseHtml, title: it.file.baseTitle })
    useStore.getState().patchFile(itemId, { conflict: false, rev: 'stale' })
    await pull(s.id)
  }
}

// ─── Wiring ────────────────────────────────────────────────────────────────

const timers = new Map<string, number>()
function schedule(id: string, ms = 1200) {
  clearTimeout(timers.get(id))
  timers.set(id, window.setTimeout(() => flush(id), ms))
}

let started = false
/** Call once after the store has loaded: pulls every source, autosaves edits, and refreshes on focus. */
export function startSync() {
  if (started) return
  started = true
  for (const s of useStore.getState().sources) pull(s.id)

  useStore.subscribe((st, prev) => {
    if (st.items === prev.items) return
    const before = new Map(prev.items.map((i) => [i.id, i]))
    const touched = new Set<string>()
    for (const i of st.items) if (i.sourceId && before.get(i.id) !== i) touched.add(i.sourceId)
    for (const id of touched) {
      const s = st.sources.find((x) => x.id === id)
      if (s && s.kind !== 'github' && pendingChanges(id).some((i) => !i.file!.conflict)) schedule(id)
    }
  })

  window.addEventListener('focus', () => {
    for (const s of useStore.getState().sources)
      if (Date.now() - (s.lastSync || 0) > 30_000 && useSync.getState().st[s.id]?.status !== 'syncing') pull(s.id)
  })
  window.addEventListener('beforeunload', (e) => {
    if (useStore.getState().sources.some((s) => s.kind !== 'github' && pendingChanges(s.id).length)) e.preventDefault()
  })
}

/** Create a new file in a source, inside `parentId` (a folder doc) or at the root. */
export function createFile(sourceId: string, parentId: string | null = null) {
  const parent = useStore.getState().items.find((i) => i.id === parentId)
  return useStore.getState().createItem('doc', {
    sourceId,
    parentId: parent?.file?.dir ? parent.id : (parent?.parentId ?? null),
    file: { baseHtml: '', baseTitle: '' },
  })
}
