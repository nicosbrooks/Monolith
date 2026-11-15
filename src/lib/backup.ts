import { create } from 'zustand'
import { keys } from 'idb-keyval'
import { loadAudio, saveAudio, saveNow, useStore, type Settings } from '../store'
import { random } from '../link/crypto'
import type { CalEvent, Folder, Item } from '../types'
import { APP_NAME } from '../brand'

// The whole workspace in one encrypted file: docs, recordings (with audio), calendar, folders and preferences.
// Nothing leaves the browser except as the file the person saves. Restoring it in any browser brings everything back,
// so the file can be the backup, the way to move to a new computer, or the only "storage" someone needs.
//
// File layout:  "MONOLITH-BACKUP 1\n" + header JSON + "\n" + ciphertext
//   header: { kdf: 'PBKDF2-SHA256', iter, salt, iv, created, counts }   (counts are shown before the password is asked)
//   ciphertext: AES-256-GCM(gzip(JSON payload))
//
// Device-specific things stay out: connected folders/GitHub/Drive (their access can't move between browsers),
// linked phones, and the passcode lock. Docs that came from a connected folder are included as ordinary docs.

const MAGIC = 'MONOLITH-BACKUP 1\n'
const ITER = 600_000
const enc = new TextEncoder()
const dec = new TextDecoder()
const B = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>
export const BACKUP_MIN = 8
export const BACKUP_EXT = '.monolith'

export interface Counts { docs: number; recordings: number; events: number }
interface Header { kdf: 'PBKDF2-SHA256'; iter: number; salt: string; iv: string; created: number; counts: Counts }
interface Payload {
  app: string
  version: 1
  items: Item[]
  folders: Folder[]
  events: CalEvent[]
  settings: Partial<Settings>
  dismissed: string[]
  audio: Record<string, { type: string; data: string }>
}
export interface Opened { header: Header; payload: Payload }

/** Which backup dialog is open, if any. */
export const useBackup = create<{ open: null | 'export' | 'import' }>(() => ({ open: null }))
export const openBackup = (open: 'export' | 'import') => useBackup.setState({ open })

const b64 = {
  encode(u: Uint8Array) {
    let s = ''
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
    return btoa(s)
  },
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
}

async function key(password: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: B(salt), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const pipe = async (data: Uint8Array, t: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([B(data)]).stream().pipeThrough(t)).arrayBuffer())

function countsOf(items: Item[], events: CalEvent[]): Counts {
  const live = items.filter((i) => !i.deletedAt && !i.file?.dir)
  return { docs: live.filter((i) => i.kind !== 'lecture').length, recordings: live.filter((i) => i.kind === 'lecture').length, events: events.length }
}

/** Everything in this browser as an encrypted file. */
export async function exportWorkspace(password: string): Promise<Blob> {
  const s = useStore.getState()
  // Folder docs become ordinary docs in the backup; the folder connection itself can't travel.
  const items = s.items.filter((i) => !i.file?.dir).map(({ sourceId: _s, file: _f, ...i }) => i as Item)
  const audio: Payload['audio'] = {}
  const audioKeys = new Set((await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith('audio:')))
  for (const i of items) {
    if (i.kind !== 'lecture' || !audioKeys.has(`audio:${i.id}`)) continue
    const blob = await loadAudio(i.id)
    if (blob) audio[i.id] = { type: blob.type, data: b64.encode(new Uint8Array(await blob.arrayBuffer())) }
  }
  const { home: _h, setupAt: _a, ...settings } = s.settings
  const payload: Payload = { app: APP_NAME, version: 1, items, folders: s.folders, events: s.events, settings, dismissed: s.dismissed, audio }

  const salt = random(16)
  const iv = random(12)
  const k = await key(password, salt, ITER)
  const packed = await pipe(enc.encode(JSON.stringify(payload)), new CompressionStream('gzip'))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, B(packed)))
  const header: Header = { kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64.encode(salt), iv: b64.encode(iv), created: Date.now(), counts: countsOf(items, s.events) }
  useStore.getState().setSettings({ lastBackup: Date.now() })
  return new Blob([MAGIC, JSON.stringify(header), '\n', B(ct)], { type: 'application/octet-stream' })
}

export class NotABackup extends Error {
  constructor() { super(`That file isn't a ${APP_NAME} backup.`) }
}
export class WrongPassword extends Error {
  constructor() { super('That password doesn’t open this backup.') }
}

/** Read the unencrypted header, so the dialog can show what's inside before asking for the password. */
export async function peek(file: File): Promise<{ header: Header; body: Uint8Array }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (dec.decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) throw new NotABackup()
  const nl = bytes.indexOf(10, MAGIC.length)
  if (nl < 0) throw new NotABackup()
  try {
    const header = JSON.parse(dec.decode(bytes.subarray(MAGIC.length, nl))) as Header
    return { header, body: bytes.subarray(nl + 1) }
  } catch {
    throw new NotABackup()
  }
}

export async function unlockBackup(p: { header: Header; body: Uint8Array }, password: string): Promise<Opened> {
  const k = await key(password, b64.decode(p.header.salt), p.header.iter)
  let packed: Uint8Array
  try {
    packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B(b64.decode(p.header.iv)) }, k, B(p.body)))
  } catch {
    throw new WrongPassword()
  }
  const payload = JSON.parse(dec.decode(await pipe(packed, new DecompressionStream('gzip')))) as Payload
  if (payload.version !== 1 || !Array.isArray(payload.items)) throw new NotABackup()
  return { header: p.header, payload }
}

/**
 * Replace what's in this browser with the backup. Connected sources stay connected (their docs are re-read from
 * them); this browser's passcode, if any, stays on and the restored data is saved under it.
 */
export async function restore({ payload }: Opened) {
  const s = useStore.getState()
  const fromSources = s.items.filter((i) => i.sourceId)
  useStore.setState({
    items: [...payload.items, ...fromSources],
    folders: payload.folders ?? [],
    events: payload.events ?? [],
    dismissed: payload.dismissed ?? [],
    settings: { ...s.settings, ...payload.settings, home: s.settings.home, setupAt: s.settings.setupAt ?? Date.now() },
    section: 'home',
    activeId: null,
    setupOpen: false,
  })
  for (const [id, a] of Object.entries(payload.audio ?? {})) await saveAudio(id, new Blob([B(b64.decode(a.data))], { type: a.type }))
  await saveNow()
}

/** "Monolith backup 2026-11-15.monolith" */
export function backupName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${APP_NAME} backup ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${BACKUP_EXT}`
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
