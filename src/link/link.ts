import { create } from 'zustand'
import { del, get, set } from 'idb-keyval'
import { useStore } from '../store'
import type { CalEvent, Item } from '../types'
import { fileBlob, fileMeta, hashBlob, inlineFiles, MAX_FILE, putFile, refsIn } from '../lib/files'
import { setRemote, type RemoteModel } from '../ai/remote'
import { aesKey, b64u, checkCode, deriveKey, equal, hmac, newKeyPair, open, random, seal, syncRoom } from './crypto'
import { admit, nextSeq, pad, type Stamp } from './envelope'

/**
 * Linked devices. The phone is the hub: it holds your library, and browsers pair with it by scanning a QR code.
 * Changes flow both ways through the relay (server/relay.ts, relay/), encrypted end to end. Conflicts: newest edit wins.
 *
 * What the relay can't do: read anything but the presence count (every frame is sealed with the pairing's key), swap
 * keys during pairing (the phone proves it read the QR code), replay or bounce back old frames (envelope.ts), or tell
 * much from frame sizes (small frames are padded). It can still see when devices are online and roughly how much they
 * send, and it can drop frames.
 */

/** `ck` is the pairing's key, kept so this page can use it but never read it back out. `key` is its raw form, from
 *  before that, and is moved into `ck` at the next start. `check` is the six digits both screens showed. */
export interface Pairing { room: string; key?: string; ck?: CryptoKey; name: string; linkedAt: number; relay?: string; check?: string }

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

type Turn = { role: string; content: string }
/**
 * What devices say to each other, inside the sealed box. `hi` says what the sender can do (`c`): "files" means it
 * swaps files by hash instead of embedding pictures; "model" means it will answer `ask` with its own model (`m`).
 */
type Msg =
  | { t: 'hi'; n: string; c?: string[]; m?: string; p?: 1 }
  | { t: 'snap' | 'put'; recs: Rec[] }
  | { t: 'bye' }
  | { t: 'want'; hs: string[] }
  | { t: 'file'; h: string; nm: string; ty: string; sz: number; i: number; of: number; d: string }
  | { t: 'ask'; id: string; msgs: Turn[]; max?: number; temp?: number }
  | { t: 'tok'; id: string; full: string }
  | { t: 'done'; id: string; full: string; err?: string }
  | { t: 'stop'; id: string }

/** What this browser can do, sent in every hi. */
const CAPS = ['files']
/** How long a pairing code shown on screen can be answered. */
const CODE_MS = 10 * 60_000

interface PairingSession { url: string; state: 'waiting' | 'linked' | 'error'; phone?: string; error?: string; check?: string; lan?: boolean }
/** What the device at the other end of a pairing said it can do. */
export interface PeerInfo { caps: string[]; model?: string }

export const useLink = create<{
  pairings: Pairing[]
  peers: Record<string, number>
  info: Record<string, PeerInfo>
  lastSync?: number
  session: PairingSession | null
  open: boolean
}>(() => ({ pairings: [], peers: {}, info: {}, session: null, open: false }))

const conns = new Map<string, { ws: WebSocket; key: CryptoKey; retry: number }>()
const roomURL = (room: string, relay = RELAY) => `${relay}/relay?room=${room}`
const STORE = 'link-pairings'
const TIMES = 'link-event-times'
const TOMBS = 'link-tombstones'
const SELF = 'link-device-id'
const SEEN = 'link-seen'
const DAY = 86_400_000

export function deviceName() {
  const ua = navigator.userAgent
  const b = /Edg\//.test(ua) ? 'Edge' : /Arc\//.test(ua) ? 'Arc' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /iPhone|iPad/.test(ua) ? 'iOS' : ''
  return os ? `${b} on ${os}` : b
}

// ─── Envelope: who sent a frame, and in what order ──────────────────────────

/** This browser's id in every frame it sends. */
let self = ''
let seq = 0
/** Per room: the highest q taken from each sender, and whether that room's devices stamp their frames. */
const seen = new Map<string, { from: Map<string, number>; strict: boolean }>()
let seenTimer = 0
const room$ = (room: string) => {
  let s = seen.get(room)
  if (!s) seen.set(room, (s = { from: new Map(), strict: false }))
  return s
}
const saveSeen = () => {
  clearTimeout(seenTimer)
  seenTimer = window.setTimeout(() => void set(SEEN, [...seen].map(([room, s]) => [room, [...s.from], s.strict])), 1500)
}

// ─── Start / connect ────────────────────────────────────────────────────────

let started = false
export async function startLink() {
  if (started) return
  started = true
  self = (await get<string>(SELF)) || b64u.encode(random(12))
  void set(SELF, self)
  for (const [room, from, strict] of (await get<[string, [string, number][], boolean][]>(SEEN)) || []) seen.set(room, { from: new Map(from), strict })
  const pairings = await Promise.all(((await get<Pairing[]>(STORE)) || []).map(protect))
  await savePairings(pairings)
  ;((await get<[string, number][]>(TIMES)) || []).forEach(([id, t]) => eventTimes.set(id, t))
  tombstones = ((await get<Rec[]>(TOMBS)) || []).filter((t) => (t.deletedAt || 0) > Date.now() - 180 * DAY)
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

/** A pairing saved with its raw key (before keys were kept unreadable) gets a key this page can use but not export. */
async function protect(p: Pairing): Promise<Pairing> {
  if (p.ck || !p.key) return p
  const { key, ...rest } = p
  return { ...rest, ck: await aesKey(b64u.decode(key)) }
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
  if (!p.ck) return
  attach(p.room, new WebSocket(roomURL(p.room, p.relay)), p.ck)
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
      updateRemote()
      if (others > 0) {
        // p: sent on arrival, with a snapshot right behind it, so the other side needn't answer with another one.
        await send(room, { t: 'hi', n: deviceName(), c: CAPS, p: 1 })
        await sendRecs(room, 'snap', await snapshot(room))
      }
      return
    }
    if (typeof data.c !== 'string') return
    let msg: Msg & Stamp
    try {
      msg = await open<Msg & Stamp>(key, data.c)
    } catch {
      return // not for us, or tampered with
    }
    const r = room$(room)
    if (admit(r.from, self, msg, r.strict) !== 'ok') return
    if (msg.f && !r.strict) r.strict = true
    if (msg.f) saveSeen()
    void handle(room, msg)
  }
  ws.onopen = () => (conns.get(room)!.retry = 0)
  ws.onclose = () => {
    useLink.setState((s) => ({ peers: { ...s.peers, [room]: 0 } }))
    updateRemote()
    failAsks(room)
    const c = conns.get(room)
    if (!c || c.ws !== ws || !useLink.getState().pairings.some((p) => p.room === room)) return
    c.retry++
    setTimeout(() => conns.get(room)?.ws === ws && connect(useLink.getState().pairings.find((p) => p.room === room)!), Math.min(30000, 1000 * 2 ** c.retry))
  }
}

async function send(room: string, msg: Msg) {
  const c = conns.get(room)
  if (c?.ws.readyState !== WebSocket.OPEN) return false
  seq = nextSeq(seq)
  c.ws.send(JSON.stringify({ c: await seal(c.key, pad({ ...msg, f: self, q: seq })) }))
  return true
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

async function handle(room: string, msg: Msg) {
  if (msg.t === 'hi') {
    renamePairing(room, msg.n)
    useLink.setState((s) => ({ info: { ...s.info, [room]: { caps: Array.isArray(msg.c) ? msg.c.map(String) : [], model: msg.m ? String(msg.m).slice(0, 80) : undefined } } }))
    updateRemote()
  } else if (msg.t === 'snap' || msg.t === 'put') {
    await apply(msg.recs)
    void fetchMissing(room, msg.recs)
  } else if (msg.t === 'bye') removePairing(room)
  else if (msg.t === 'want') void serveFiles(room, msg.hs)
  else if (msg.t === 'file') void takeFile(msg)
  else if (msg.t === 'tok' || msg.t === 'done') answered(msg)
}

// ─── Pairing (QR) ───────────────────────────────────────────────────────────

let pairingWs: WebSocket | null = null
let codeTimer = 0

/** Show a QR code; resolves when a phone scans it and proves it read the code. The code works for ten minutes. */
export async function beginPairing() {
  cancelPairing()
  const room = b64u.encode(random(16))
  const secret = random(16)
  const kp = await newKeyPair()
  // On the dev server the phone can't use "localhost" (that's the phone): give it this computer's address on the network.
  const lan = localRelay ? await lanRelay() : ''
  // v2: once paired, both devices move to a room only they can work out (syncRoom).
  const q = new URLSearchParams({ r: room, k: b64u.encode(kp.pub), s: b64u.encode(secret), u: lan || RELAY, n: deviceName(), v: '2' })
  const url = `monolith://pair?${q}`
  useLink.setState({ session: { url, state: 'waiting', lan: !!lan } })
  const ws = new WebSocket(roomURL(room))
  pairingWs = ws
  codeTimer = window.setTimeout(() => {
    if (pairingWs !== ws) return
    ws.close()
    pairingWs = null
    useLink.setState({ session: { url, state: 'error', error: 'This code has expired. Show a new one to link your phone.' } })
  }, CODE_MS)
  ws.onmessage = async (e) => {
    const data = frame(e)
    if (data?.p !== 'hello' || pairingWs !== ws) return
    try {
      const phonePub = b64u.decode(String(data.k))
      if (!equal(await hmac(secret, phonePub), b64u.decode(String(data.m)))) throw new Error('This code was answered by something other than your phone.')
      const raw = await deriveKey(kp.priv, phonePub, secret)
      const ck = await aesKey(raw)
      const p: Pairing = { room: await syncRoom(raw), ck, name: String(data.n || 'iPhone').slice(0, 60), linkedAt: Date.now(), relay: RELAY, check: await checkCode(raw) }
      raw.fill(0)
      await savePairings([...useLink.getState().pairings, p])
      clearTimeout(codeTimer)
      // The code's room has done its job. Sync happens in the pairing's own room; the phone is already on its way there.
      pairingWs = null
      ws.close()
      useLink.setState({ session: { url, state: 'linked', phone: p.name, check: p.check } })
      connect(p)
    } catch (err) {
      useLink.setState({ session: { url, state: 'error', error: (err as Error).message } })
    }
  }
  ws.onerror = () => useLink.setState({ session: { url, state: 'error', error: 'Can’t reach the sync relay.' } })
}

/** The dev server's relay as the phone can reach it: this computer's address on the local network. */
async function lanRelay() {
  try {
    const r = await fetch('/relay/lan')
    const { url } = (await r.json()) as { url?: string }
    return url || ''
  } catch {
    return ''
  }
}

export function cancelPairing() {
  clearTimeout(codeTimer)
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
  failAsks(room)
  seen.delete(room)
  saveSeen()
  useLink.setState((s) => {
    const { [room]: _, ...info } = s.info
    return { info }
  })
  updateRemote()
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
  savePairings(ps.map((p) => (p.room === room ? { ...p, name: String(name).slice(0, 60) } : p)))
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
const seenObj = new Map<string, Item | CalEvent>()
const changed = (x: Item | CalEvent) => {
  if (seenObj.get(x.id) === x) return false
  seenObj.set(x.id, x)
  return known.get(x.id) !== sig(x)
}
/** Whether the device in this room takes files by reference (and fetches them), or needs pictures embedded. */
const takesFiles = (room: string) => !!useLink.getState().info[room]?.caps.includes('files')

async function toRec(i: Item, inline: boolean): Promise<Rec> {
  const { htmlToMarkdown } = await md()
  const st = useStore.getState()
  return {
    id: i.id,
    kind: i.kind,
    updatedAt: i.updatedAt,
    deletedAt: i.deletedAt,
    title: i.title,
    // A device that swaps files gets references and asks for what it lacks. An older one can't reach this browser's
    // file store: pictures travel embedded, attachments as references.
    body: htmlToMarkdown(inline ? await inlineFiles(i.content) : i.content),
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

async function snapshot(room: string): Promise<Rec[]> {
  const st = useStore.getState()
  const inline = !takesFiles(room)
  const items = await Promise.all(st.items.filter(synced).map((i) => toRec(i, inline)))
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
  const pairings = useLink.getState().pairings
  if (!pairings.length) return
  const st = useStore.getState()
  const now = Date.now()
  const items = st.items.filter((i) => synced(i) && changed(i))
  const events = st.events.filter(changed)
  // Pinning doesn't move an item's edit time here; send it as a fresh edit so it still wins on the phone.
  const unstamped = new Set(items.filter((i) => known.get(i.id)?.includes(`"updatedAt":${i.updatedAt}`)).map((i) => i.id))
  items.forEach((i) => known.set(i.id, sig(i)))
  events.forEach((e) => (known.set(e.id, sig(e)), eventTimes.set(e.id, now)))
  if (events.length) saveMemory()
  const rest = [...events.map((e) => evRec(e, now)), ...fresh.splice(0)]
  // Each device gets records in the form it takes: references, or pictures embedded. Built once per form.
  const forms = new Map<boolean, Promise<Rec[]>>()
  const recsFor = (inline: boolean) => {
    let f = forms.get(inline)
    if (!f) forms.set(inline, (f = Promise.all(items.map((i) => toRec(i, inline))).then((rs) => [...rs.map((r) => (unstamped.has(r.id) ? { ...r, updatedAt: now } : r)), ...rest])))
    return f
  }
  if (!items.length && !rest.length) return
  for (const p of pairings) void recsFor(!takesFiles(p.room)).then((recs) => sendRecs(p.room, 'put', recs))
}

// ─── Files: swapped by hash, sealed like everything else ────────────────────
// A record names its files (monolith-file:<hash>). Whoever lacks one asks the room for it (`want`), and a device that
// has it answers in pieces (`file`). What arrives is checked against its hash before it's stored, so a file can't be
// swapped for another on the way. The phone keeps every file it's given, so it can pass them on to other computers.

const PIECE = 256 * 1024
/** Files asked for and not yet here, so the same one isn't asked for twice at once. */
const asked = new Map<string, number>()
/** Files arriving in pieces. */
const incoming = new Map<string, { parts: (Uint8Array | undefined)[]; got: number; nm: string; ty: string; sz: number; at: number }>()
const HASH = /^[0-9a-f]{32}$/

async function fetchMissing(room: string, recs: Rec[]) {
  if (!takesFiles(room)) return
  const want: string[] = []
  const now = Date.now()
  for (const r of recs) {
    if (!r.body || r.deletedAt) continue
    for (const h of refsIn(r.body)) {
      if (want.includes(h) || now - (asked.get(h) ?? 0) < 60_000 || (await fileMeta(h))) continue
      asked.set(h, now)
      want.push(h)
    }
  }
  for (let i = 0; i < want.length; i += 100) await send(room, { t: 'want', hs: want.slice(i, i + 100) })
}

async function serveFiles(room: string, hashes: string[]) {
  for (const h of (Array.isArray(hashes) ? hashes : []).slice(0, 500)) {
    if (typeof h !== 'string' || !HASH.test(h)) continue
    const meta = await fileMeta(h)
    const blob = meta && (await fileBlob(h))
    if (!meta || !blob) continue
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const of = Math.max(1, Math.ceil(bytes.length / PIECE))
    for (let i = 0; i < of; i++) {
      // Let the socket drain: a large file shouldn't queue up hundreds of megabytes in memory.
      const ws = conns.get(room)?.ws
      while (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount > 2 * 1024 * 1024) await new Promise((r) => setTimeout(r, 50))
      if (!(await send(room, { t: 'file', h, nm: meta.name, ty: meta.type, sz: bytes.length, i, of, d: b64u.encode(bytes.subarray(i * PIECE, (i + 1) * PIECE)) }))) return
    }
  }
}

async function takeFile(m: Extract<Msg, { t: 'file' }>) {
  if (!HASH.test(m.h) || !(m.of >= 1) || !(m.i >= 0) || m.i >= m.of || m.sz > MAX_FILE || m.of > Math.ceil(MAX_FILE / PIECE) + 1) return
  if (await fileMeta(m.h)) return
  const now = Date.now()
  // Pieces of files that stopped coming are dropped after two minutes.
  for (const [h, x] of incoming) if (now - x.at > 120_000) incoming.delete(h)
  let x = incoming.get(m.h)
  if (!x || x.parts.length !== m.of) incoming.set(m.h, (x = { parts: new Array(m.of), got: 0, nm: String(m.nm || 'File').slice(0, 200), ty: String(m.ty || 'application/octet-stream').slice(0, 100), sz: m.sz, at: now }))
  if (x.parts[m.i]) return
  x.parts[m.i] = b64u.decode(m.d)
  x.got++
  x.at = now
  if (x.got < m.of) return
  incoming.delete(m.h)
  const blob = new Blob(x.parts as Uint8Array<ArrayBuffer>[], { type: x.ty })
  if (blob.size !== x.sz || (await hashBlob(blob)) !== m.h) return // not the file that was named: dropped
  await putFile(blob, x.nm)
  asked.delete(m.h)
}

// ─── The phone's model, for this browser ────────────────────────────────────
// A phone that says it can ("model" in its hi) answers questions with its own model. The question and the answer travel
// sealed, like everything else. Only works while the phone is reachable: the Monolith app open, or recently so.

const asks = new Map<string, { room: string; text: string; onText: (full: string) => void; resolve: (s: string) => void; reject: (e: Error) => void; timer: number }>()

function answered(m: Extract<Msg, { t: 'tok' | 'done' }>) {
  const a = asks.get(m.id)
  if (!a) return
  clearTimeout(a.timer)
  if (m.t === 'tok') {
    a.text = String(m.full)
    a.onText(a.text)
    a.timer = window.setTimeout(() => finish(m.id, new Error('Your phone stopped answering.')), 60_000)
    return
  }
  asks.delete(m.id)
  if (m.err) a.reject(new Error(String(m.err)))
  else a.resolve(String(m.full ?? ''))
}

function finish(id: string, err: Error) {
  const a = asks.get(id)
  if (!a) return
  asks.delete(id)
  clearTimeout(a.timer)
  a.reject(err)
}

function failAsks(room: string) {
  for (const [id, a] of asks) if (a.room === room) finish(id, new Error('Lost the connection to your phone.'))
}

/** Which phone and model the assistant was last told about, so it's only told again when that changes. */
let remoteKey = ''

/** The first linked phone that's reachable now and offers its model. */
function updateRemote() {
  const { pairings, peers, info } = useLink.getState()
  const p = pairings.find((x) => (peers[x.room] ?? 0) > 0 && info[x.room]?.caps.includes('model'))
  const model = p ? info[p.room].model || 'its model' : ''
  const k = p ? `${p.room}\u0000${p.name}\u0000${model}` : ''
  if (k === remoteKey) return
  remoteKey = k
  if (!p) return setRemote(null)
  const remote: RemoteModel = {
    device: p.name,
    model,
    ask: (msgs, onText, opts) =>
      new Promise<string>((resolve, reject) => {
        const id = b64u.encode(random(9))
        // The first words can take a while: the phone may have to load its model.
        asks.set(id, { room: p.room, text: '', onText, resolve, reject, timer: window.setTimeout(() => finish(id, new Error('Your phone didn’t answer. Open Monolith on it and try again.')), 90_000) })
        // Stopped here: the phone stops too, and what it had written so far is the answer.
        opts.signal?.addEventListener('abort', () => {
          const a = asks.get(id)
          if (!a) return
          void send(p.room, { t: 'stop', id })
          asks.delete(id)
          clearTimeout(a.timer)
          resolve(a.text)
        })
        void send(p.room, { t: 'ask', id, msgs: msgs.map((m) => ({ role: m.role, content: m.content })), max: opts.maxTokens, temp: opts.temperature }).then((ok) => ok || finish(id, new Error('Your phone isn’t connected.')))
      }),
  }
  setRemote(remote)
}
