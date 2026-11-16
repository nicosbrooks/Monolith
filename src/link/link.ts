import { create } from 'zustand'
import { del, get, set } from 'idb-keyval'
import { useStore } from '../store'
import type { CalEvent, Item } from '../types'
import { inlineFiles } from '../lib/files'
import { aesKey, b64u, deriveKey, equal, hmac, newKeyPair, open, random, seal } from './crypto'

/**
 * Linked devices. The phone is the hub: it holds your library, and browsers pair with it by scanning a QR code.
 * Changes flow both ways through the relay (server/relay.ts), encrypted end to end. Conflicts: newest edit wins.
 */

export interface Pairing { room: string; key: string; name: string; linkedAt: number; relay?: string }

/**
 * Where devices meet. In production this is the hosted relay (relay/, a Cloudflare Worker), so a phone and a computer
 * on different networks can reach each other with no setup. Without one configured, the dev server's relay is used.
 */
export const RELAY = ((import.meta.env.VITE_RELAY_URL as string | undefined) || location.origin).replace(/^http/, 'ws').replace(/\/$/, '')
/** True when pairing goes through this dev server, which a phone off this machine can't reach. */
export const localRelay = !import.meta.env.VITE_RELAY_URL && /^(localhost|127\.|\[::1\])/.test(location.hostname)

/** One note, doc, lecture or event as it travels between devices. Bodies are Markdown. */
export interface Rec {
  id: string
  kind: 'note' | 'doc' | 'lecture' | 'event'
  updatedAt: number
  deletedAt?: number
  title?: string
  body?: string
  emoji?: string
  pinned?: boolean
  folder?: string
  parentId?: string
  duration?: number
  transcript?: { start: number; text: string }[]
  start?: number
  end?: number
  allDay?: boolean
  location?: string
  color?: string
  /** Repeating events (web only for now; the phone keeps what it's given). */
  repeat?: CalEvent['repeat'] | null
  skip?: number[]
}

type Msg = { t: 'hi'; n: string } | { t: 'snap'; recs: Rec[] } | { t: 'put'; recs: Rec[] } | { t: 'bye' }

interface PairingSession { url: string; state: 'waiting' | 'linked' | 'error'; phone?: string; error?: string }

export const useLink = create<{
  pairings: Pairing[]
  peers: Record<string, number>
  lastSync?: number
  session: PairingSession | null
  open: boolean
}>(() => ({ pairings: [], peers: {}, session: null, open: false }))

const conns = new Map<string, { ws: WebSocket; key: CryptoKey; retry: number }>()
const roomURL = (room: string, relay = RELAY) => `${relay}/relay?room=${room}`
const STORE = 'link-pairings'
const TIMES = 'link-event-times'
const TOMBS = 'link-tombstones'
const DAY = 86_400_000

export function deviceName() {
  const ua = navigator.userAgent
  const b = /Edg\//.test(ua) ? 'Edge' : /Arc\//.test(ua) ? 'Arc' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /iPhone|iPad/.test(ua) ? 'iOS' : ''
  return os ? `${b} on ${os}` : b
}

// ─── Start / connect ────────────────────────────────────────────────────────

let started = false
export async function startLink() {
  if (started) return
  started = true
  const pairings = (await get<Pairing[]>(STORE)) || []
  ;((await get<[string, number][]>(TIMES)) || []).forEach(([id, t]) => eventTimes.set(id, t))
  tombstones = ((await get<Rec[]>(TOMBS)) || []).filter((t) => (t.deletedAt || 0) > Date.now() - 180 * DAY)
  useLink.setState({ pairings })
  pairings.forEach(connect)
  watchStore()
  // Relays and networks drop sockets that stay quiet. The relay answers "ping" itself, without waking the other device.
  setInterval(() => {
    conns.forEach((c) => c.ws.readyState === WebSocket.OPEN && c.ws.send('ping'))
    if (pairingWs?.readyState === WebSocket.OPEN) pairingWs.send('ping')
  }, 25000)
  // Back online, or back to this tab: don't wait out the retry timer.
  const wake = () => {
    if (document.visibilityState === 'hidden') return
    useLink.getState().pairings.forEach((p) => {
      const c = conns.get(p.room)
      if (!c || c.ws.readyState === WebSocket.CLOSED) connect(p)
    })
  }
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)
}

/** A relay frame as JSON, or null for keepalives and anything else that isn't ours. */
function frame(e: MessageEvent): Record<string, unknown> | null {
  if (typeof e.data !== 'string' || e.data === 'pong' || e.data === 'ping') return null
  try {
    return JSON.parse(e.data)
  } catch {
    return null
  }
}

async function connect(p: Pairing) {
  const key = await aesKey(b64u.decode(p.key))
  attach(p.room, new WebSocket(roomURL(p.room, p.relay)), key)
}

function attach(room: string, ws: WebSocket, key: CryptoKey) {
  const prev = conns.get(room)
  conns.set(room, { ws, key, retry: prev?.retry ?? 0 })
  ws.onmessage = async (e) => {
    const data = frame(e)
    if (!data) return
    if (data.relay === 'peers') {
      const others = Number(data.n) - 1
      useLink.setState((s) => ({ peers: { ...s.peers, [room]: others } }))
      if (others > 0) sendRecs(room, 'snap', await snapshot())
      return
    }
    if (typeof data.c !== 'string') return
    try {
      handle(room, await open<Msg>(key, data.c))
    } catch {
      /* not for us, or tampered with */
    }
  }
  ws.onopen = () => (conns.get(room)!.retry = 0)
  ws.onclose = () => {
    useLink.setState((s) => ({ peers: { ...s.peers, [room]: 0 } }))
    const c = conns.get(room)
    if (!c || c.ws !== ws || !useLink.getState().pairings.some((p) => p.room === room)) return
    c.retry++
    setTimeout(() => conns.get(room)?.ws === ws && connect(useLink.getState().pairings.find((p) => p.room === room)!), Math.min(30000, 1000 * 2 ** c.retry))
  }
}

async function send(room: string, msg: Msg) {
  const c = conns.get(room)
  if (c?.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ c: await seal(c.key, msg) }))
}

/** Sends records in batches small enough for the relay, which refuses very large messages. */
async function sendRecs(room: string, t: 'snap' | 'put', recs: Rec[]) {
  let batch: Rec[] = []
  let size = 0
  for (const r of recs) {
    const n = (r.body?.length || 0) + (r.title?.length || 0) + (r.transcript || []).reduce((a, x) => a + x.text.length + 24, 0) + 200
    if (n > 5_000_000) continue // too big to sync
    if (size + n > 1_000_000 && batch.length) {
      await send(room, { t, recs: batch })
      batch = []
      size = 0
    }
    batch.push(r)
    size += n
  }
  if (batch.length) await send(room, { t, recs: batch })
}
const broadcast = (recs: Rec[]) => useLink.getState().pairings.forEach((p) => sendRecs(p.room, 'put', recs))

async function handle(room: string, msg: Msg) {
  if (msg.t === 'hi') renamePairing(room, msg.n)
  else if (msg.t === 'snap' || msg.t === 'put') await apply(msg.recs)
  else if (msg.t === 'bye') removePairing(room)
}

// ─── Pairing (QR) ───────────────────────────────────────────────────────────

let pairingWs: WebSocket | null = null

/** Show a QR code; resolves when a phone scans it and proves it read the code. */
export async function beginPairing() {
  cancelPairing()
  const room = b64u.encode(random(16))
  const secret = random(16)
  const kp = await newKeyPair()
  const q = new URLSearchParams({ r: room, k: b64u.encode(kp.pub), s: b64u.encode(secret), u: RELAY, n: deviceName() })
  const url = `monolith://pair?${q}`
  useLink.setState({ session: { url, state: 'waiting' } })
  const ws = new WebSocket(roomURL(room))
  pairingWs = ws
  ws.onmessage = async (e) => {
    const data = frame(e)
    if (data?.p !== 'hello') return
    try {
      const phonePub = b64u.decode(String(data.k))
      if (!equal(await hmac(secret, phonePub), b64u.decode(String(data.m)))) throw new Error('This code was answered by something other than your phone.')
      const raw = await deriveKey(kp.priv, phonePub, secret)
      const p: Pairing = { room, key: b64u.encode(raw), name: String(data.n || 'iPhone').slice(0, 60), linkedAt: Date.now(), relay: RELAY }
      await savePairings([...useLink.getState().pairings, p])
      pairingWs = null // hand the socket over to sync
      attach(room, ws, await aesKey(raw))
      useLink.setState((s) => ({ session: { url, state: 'linked', phone: p.name }, peers: { ...s.peers, [room]: 1 } }))
      await send(room, { t: 'hi', n: deviceName() })
      await sendRecs(room, 'snap', await snapshot())
    } catch (err) {
      useLink.setState({ session: { url, state: 'error', error: (err as Error).message } })
    }
  }
  ws.onerror = () => useLink.setState({ session: { url, state: 'error', error: 'Can’t reach the sync relay.' } })
}

export function cancelPairing() {
  pairingWs?.close()
  pairingWs = null
  useLink.setState({ session: null })
}

export async function unlink(room: string) {
  await send(room, { t: 'bye' })
  removePairing(room)
}

function removePairing(room: string) {
  const c = conns.get(room)
  conns.delete(room)
  c?.ws.close()
  const left = useLink.getState().pairings.filter((p) => p.room !== room)
  savePairings(left)
  if (!left.length) {
    // Nothing linked: nothing to remember for.
    tombstones = []
    fresh.length = 0
    saveMemory()
  }
}

function renamePairing(room: string, name: string) {
  const ps = useLink.getState().pairings
  if (ps.find((p) => p.room === room)?.name === name) return
  savePairings(ps.map((p) => (p.room === room ? { ...p, name: name.slice(0, 60) } : p)))
}

async function savePairings(pairings: Pairing[]) {
  useLink.setState({ pairings })
  await set(STORE, pairings)
}

// ─── Records ────────────────────────────────────────────────────────────────

const md = () => import('../lib/markdown')
const synced = (i: Item) => !i.sourceId && !i.file
/** What each record looked like when we last sent or received it, so only real changes go out. */
const known = new Map<string, string>()
const sig = (x: Item | CalEvent) => JSON.stringify(x)
/** The object last compared for each id: unchanged objects skip the JSON comparison entirely. */
const seen = new Map<string, Item | CalEvent>()
const changed = (x: Item | CalEvent) => {
  if (seen.get(x.id) === x) return false
  seen.set(x.id, x)
  return known.get(x.id) !== sig(x)
}

async function toRec(i: Item): Promise<Rec> {
  const { htmlToMarkdown } = await md()
  const st = useStore.getState()
  return {
    id: i.id,
    kind: i.kind,
    updatedAt: i.updatedAt,
    deletedAt: i.deletedAt,
    title: i.title,
    // The phone can't reach this browser's file store: pictures travel embedded, attachments as references.
    body: htmlToMarkdown(await inlineFiles(i.content)),
    emoji: i.emoji,
    pinned: i.pinned,
    folder: st.folders.find((f) => f.id === i.folderId)?.name,
    parentId: i.parentId ?? undefined,
    duration: i.lecture?.duration,
    transcript: i.lecture?.transcript.map((s) => ({ start: s.start, text: s.text })),
  }
}

const evRec = (e: CalEvent, updatedAt: number): Rec => ({
  id: e.id, kind: 'event', updatedAt, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, color: e.color, repeat: e.repeat, skip: e.skip,
})

async function snapshot(): Promise<Rec[]> {
  const st = useStore.getState()
  const items = await Promise.all(st.items.filter(synced).map(toRec))
  return [...items, ...st.events.map((e) => evRec(e, eventTimes.get(e.id) || 0)), ...tombstones]
}

/** Events have no edit time on the web, so we remember when we saw each one change. */
const eventTimes = new Map<string, number>()
/** Things deleted for good here, and when. Kept so a phone that was away can't hand them straight back. */
let tombstones: Rec[] = []
/** Deletions not yet sent on. */
const fresh: Rec[] = []
const gone = (id: string, kind: Rec['kind'], at: number): Rec => ({ id, kind, updatedAt: at, deletedAt: at })
const bury = (r: Rec) => (tombstones = [...tombstones.filter((t) => t.id !== r.id), r])
const saveMemory = () => (set(TIMES, [...eventTimes]), set(TOMBS, tombstones))

let applying = false
async function apply(recs: Rec[]) {
  if (!recs.length) return
  const { markdownToHtml } = await md()
  const st = useStore.getState()
  let items = [...st.items]
  const events = [...st.events]
  let folders = [...st.folders]
  let changed = false
  let noted = false

  for (const r of recs) {
    const stamp = Math.max(r.updatedAt, r.deletedAt || 0)
    const tomb = tombstones.find((t) => t.id === r.id)
    if (tomb) {
      if ((tomb.deletedAt || 0) >= stamp) continue // deleted here after that edit
      tombstones = tombstones.filter((t) => t !== tomb) // edited somewhere else since, so it comes back
      noted = true
    }
    if (r.kind === 'event') {
      const i = events.findIndex((e) => e.id === r.id)
      if (r.deletedAt) {
        if (i >= 0) {
          if (r.deletedAt < (eventTimes.get(r.id) || 0)) continue
          events.splice(i, 1)
          eventTimes.delete(r.id)
          known.delete(r.id)
          changed = true
        }
        bury(gone(r.id, 'event', r.deletedAt))
        noted = true
        continue
      }
      if (i >= 0 && (eventTimes.get(r.id) || 0) >= r.updatedAt) continue
      if (r.start == null || r.end == null) continue
      const ev: CalEvent = { ...(i >= 0 ? events[i] : { color: 'blue' }), id: r.id, title: r.title || '', start: r.start, end: r.end, allDay: r.allDay, location: r.location, ...(r.color ? { color: r.color } : {}), ...(r.repeat !== undefined ? { repeat: r.repeat ?? undefined, skip: r.skip } : {}) } as CalEvent
      if (i >= 0) events[i] = ev
      else events.push(ev)
      eventTimes.set(r.id, r.updatedAt)
      known.set(r.id, sig(ev))
      changed = noted = true
      continue
    }
    const i = items.findIndex((x) => x.id === r.id)
    const cur = i >= 0 ? items[i] : undefined
    if (r.deletedAt && r.title === undefined && r.body === undefined) {
      // Deleted for good on the phone.
      if (!cur) {
        bury(gone(r.id, r.kind, stamp))
        noted = true
        continue
      }
      if (cur.sourceId || cur.updatedAt >= stamp) continue
      if (cur.deletedAt) {
        // Already in the trash here too: it goes for good.
        items = items.filter((x) => x.id !== r.id)
        del(`audio:${r.id}`)
        known.delete(r.id)
        bury(gone(r.id, r.kind, stamp))
        noted = true
      } else {
        // Still in use here: move it to the trash, where it can be restored.
        items[i] = { ...cur, deletedAt: stamp, updatedAt: stamp }
        known.set(r.id, sig(items[i]))
      }
      changed = true
      continue
    }
    if (cur && (cur.sourceId || cur.updatedAt >= stamp)) continue
    let folderId: string | null = null
    if (r.folder) {
      let f = folders.find((x) => x.name === r.folder)
      if (!f) folders = [...folders, (f = { id: `f-${r.folder.toLowerCase().replace(/\W+/g, '-')}`, name: r.folder })]
      folderId = f.id
    }
    const body = r.body || ''
    const content = markdownToHtml(body)
    const next: Item = {
      ...(cur || { createdAt: r.updatedAt, tags: [], parentId: null }),
      id: r.id,
      kind: r.kind === 'note' ? 'doc' : r.kind, // notes were merged into docs
      title: r.title || '',
      content,
      emoji: r.emoji,
      pinned: !!r.pinned,
      folderId,
      parentId: r.parentId && r.parentId !== r.id ? r.parentId : null,
      updatedAt: stamp,
      deletedAt: r.deletedAt,
      lecture: r.kind === 'lecture' ? { ...(cur?.lecture || { hasAudio: false, status: 'done' }), duration: r.duration || 0, transcript: (r.transcript || []).map((s) => ({ start: s.start, end: s.start, text: s.text })) } : cur?.lecture,
    } as Item
    if (i >= 0) items[i] = next
    else items.push(next)
    known.set(r.id, sig(next))
    changed = true
  }
  if (noted) saveMemory()
  if (!changed) return
  applying = true
  useStore.setState({ items, events, folders })
  applying = false
  useLink.setState({ lastSync: Date.now() })
}

/** Send local edits as they happen (debounced). */
function watchStore() {
  const st = useStore.getState()
  st.items.forEach((i) => known.set(i.id, sig(i)))
  st.events.forEach((e) => known.set(e.id, sig(e)))
  let timer = 0
  useStore.subscribe((s, prev) => {
    if (applying || (s.items === prev.items && s.events === prev.events)) return
    if (useLink.getState().pairings.length) {
      // Anything deleted for good here becomes a tombstone, so the phone deletes it too and can't hand it back.
      const now = Date.now()
      const lost: Rec[] = []
      if (s.events !== prev.events) {
        const ids = new Set(s.events.map((e) => e.id))
        prev.events.forEach((e) => !ids.has(e.id) && lost.push(gone(e.id, 'event', now)))
      }
      if (s.items !== prev.items && s.items.length < prev.items.length) {
        const ids = new Set(s.items.map((i) => i.id))
        prev.items.forEach((i) => synced(i) && !ids.has(i.id) && lost.push(gone(i.id, i.kind, now)))
      }
      // People delete one thing at a time. A big batch vanishing is a reset, and must not be passed on as deletions.
      if (lost.length && lost.length <= 20) {
        lost.forEach(bury)
        fresh.push(...lost)
        saveMemory()
      }
    }
    clearTimeout(timer)
    timer = window.setTimeout(flushChanges, 600)
  })
}

async function flushChanges() {
  if (!useLink.getState().pairings.length) return
  const st = useStore.getState()
  const now = Date.now()
  const items = st.items.filter((i) => synced(i) && changed(i))
  const events = st.events.filter(changed)
  // Pinning doesn't move an item's edit time here; send it as a fresh edit so it still wins on the phone.
  const unstamped = new Set(items.filter((i) => known.get(i.id)?.includes(`"updatedAt":${i.updatedAt}`)).map((i) => i.id))
  items.forEach((i) => known.set(i.id, sig(i)))
  events.forEach((e) => (known.set(e.id, sig(e)), eventTimes.set(e.id, now)))
  if (events.length) saveMemory()
  const itemRecs = (await Promise.all(items.map(toRec))).map((r) => (unstamped.has(r.id) ? { ...r, updatedAt: now } : r))
  const recs = [...itemRecs, ...events.map((e) => evRec(e, now)), ...fresh.splice(0)]
  if (recs.length) broadcast(recs)
}
