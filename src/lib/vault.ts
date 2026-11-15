import { create } from 'zustand'
import { del, get, keys, set } from 'idb-keyval'
import { b64u, random } from '../link/crypto'

// Passcode lock for the web app. The passcode never leaves this page: PBKDF2 turns it into an AES-256-GCM key that
// lives only in memory, so a reload locks the app again. With it on, everything Monolith saves is encrypted:
// the app's data in IndexedDB, recorded audio, and the Markdown files it writes to a connected folder.
//
// There is no recovery. Forget the passcode and the encrypted data can't be read, so the UI says so plainly.

const RECORD = 'vault'
const ITER = 600_000 // OWASP's 2023 figure for PBKDF2-HMAC-SHA256
const CHECK = 'monolith-vault-check'
const enc = new TextEncoder()
const dec = new TextDecoder()
const B = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>

/** Saved text that starts with this is ciphertext. */
export const SEALED = 'monolith:sealed:v1:'
/** Files written to a folder start with this line, so a person opening one sees why it isn't readable. */
export const FILE_HEADER = '<!-- Encrypted by Monolith. Unlock Monolith to read it. -->\n'

// The data is encrypted with a random data key. The passcode only wraps that key, so changing the passcode rewrites
// one small record and nothing else, and no crash can leave data under a key that's gone.
// v1 records (before the data key) derived the data key straight from the passcode; they're upgraded on unlock.
interface RecV1 { salt: string; iter: number; check: string }
interface RecV2 { v: 2; salt: string; iter: number; wrapped: string }
type Rec = RecV1 | RecV2

/** 'checking' until we know whether a passcode is set; 'locked' while one is set and not entered yet. */
export const useVault = create<{ state: 'checking' | 'none' | 'locked' | 'open' }>(() => ({ state: 'checking' }))

/** Reads with this key. */
let key: CryptoKey | null = null
/** The data key's bytes, kept so a new passcode can wrap the same key. */
let raw: Uint8Array | null = null
/** Writes with this key; null while the lock is being turned off, so everything is saved in the clear. */
let writeKey: CryptoKey | null = null
let ready: () => void
/** Resolves once saved data can be read: right away with no passcode, after unlocking with one. */
export const vaultReady = new Promise<void>((r) => (ready = r))

const pbkdf2 = async (passcode: string, salt: Uint8Array, iter: number, extractable: boolean) =>
  crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: B(salt), iterations: iter },
    await crypto.subtle.importKey('raw', enc.encode(passcode.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  )
const importData = (bytes: Uint8Array) => crypto.subtle.importKey('raw', B(bytes), 'AES-GCM', false, ['encrypt', 'decrypt'])

async function sealBytes(k: CryptoKey, data: Uint8Array) {
  const iv = random(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, B(data)))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}
async function openBytes(k: CryptoKey, box: Uint8Array) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B(box.slice(0, 12)) }, k, B(box.slice(12))))
}

export const isLocked = () => useVault.getState().state === 'locked'
export const hasKey = () => !!key

/** Encrypt text if a passcode is on; otherwise return it unchanged. */
export async function sealText(text: string) {
  return writeKey ? SEALED + b64u.encode(await sealBytes(writeKey, enc.encode(text))) : text
}
/** Decrypt text sealed by `sealText`; plain text passes through. */
export async function openText(text: string) {
  if (!text.startsWith(SEALED)) return text
  if (!key) throw new Error('Monolith is locked')
  return dec.decode(await openBytes(key, b64u.decode(text.slice(SEALED.length))))
}

/** Audio and other files: an encrypted copy, or the blob as is. */
export async function sealBlob(b: Blob): Promise<Blob | { sealed: Uint8Array; type: string }> {
  return writeKey ? { sealed: await sealBytes(writeKey, new Uint8Array(await b.arrayBuffer())), type: b.type } : b
}
export async function openBlob(v: Blob | { sealed: Uint8Array; type: string } | undefined) {
  if (!v || v instanceof Blob) return v
  if (!key) throw new Error('Monolith is locked')
  return new Blob([B(await openBytes(key, v.sealed))], { type: v.type })
}

/** Run once at startup. */
export async function checkVault() {
  const rec = await get<Rec>(RECORD)
  if (rec) useVault.setState({ state: 'locked' })
  else (useVault.setState({ state: 'none' }), ready())
}

/** The record that wraps `bytes` under `passcode`. */
async function wrap(passcode: string, bytes: Uint8Array): Promise<RecV2> {
  const salt = random(16)
  const kek = await pbkdf2(passcode, salt, ITER, false)
  return { v: 2, salt: b64u.encode(salt), iter: ITER, wrapped: b64u.encode(await sealBytes(kek, bytes)) }
}

/** True if the passcode was right. */
export async function unlock(passcode: string) {
  const rec = await get<Rec>(RECORD)
  if (!rec) return true
  let bytes: Uint8Array
  try {
    if ('v' in rec) bytes = await openBytes(await pbkdf2(passcode, b64u.decode(rec.salt), rec.iter, false), b64u.decode(rec.wrapped))
    else {
      // v1: the passcode-derived key is the data key. Keep it, and wrap it so later changes don't re-encrypt.
      const k = await pbkdf2(passcode, b64u.decode(rec.salt), rec.iter, true)
      if (dec.decode(await openBytes(k, b64u.decode(rec.check))) !== CHECK) return false
      bytes = new Uint8Array(await crypto.subtle.exportKey('raw', k))
      await set(RECORD, await wrap(passcode, bytes))
    }
  } catch {
    return false
  }
  raw = bytes
  key = writeKey = await importData(bytes)
  useVault.setState({ state: 'open' })
  ready()
  return true
}

/** Re-save recordings and doc files with the current write key (sealed, or in the clear while the lock is turned off). */
async function resealAudio() {
  const ids = (await keys()).filter((k): k is string => typeof k === 'string' && (k.startsWith('audio:') || k.startsWith('file:')))
  for (const id of ids) {
    const v = await get(id)
    // Doc files are stored as a record with the file in `data`; recordings are the file itself.
    const rec = id.startsWith('file:') ? (v as { data: Blob | { sealed: Uint8Array; type: string } } | undefined) : undefined
    const inner = rec ? rec.data : v
    const sealedNow = !!inner && !(inner instanceof Blob)
    if (sealedNow === !!writeKey) continue
    const blob = await openBlob(inner)
    if (!blob) continue
    const next = await sealBlob(blob)
    await set(id, rec ? { ...rec, data: next } : next)
  }
}

/**
 * Turn the lock on, or change the passcode. Changing it only re-wraps the data key, so nothing else is rewritten.
 * Turning it on: the caller then re-saves the workspace so it's stored encrypted (plain data stays readable meanwhile).
 */
export async function setPasscode(passcode: string) {
  const bytes = raw ?? random(32)
  await set(RECORD, await wrap(passcode, bytes))
  const fresh = !raw
  raw = bytes
  key = writeKey = await importData(bytes)
  useVault.setState({ state: 'open' })
  if (fresh) await resealAudio()
}

/**
 * Turn the lock off. `resave` must write everything else in the clear (it runs with writes unsealed but reads still
 * able to decrypt). The passcode record is deleted only after it succeeds, so a failure or crash leaves the lock on
 * and every file still readable with the passcode.
 */
export async function clearPasscode(resave: () => Promise<void>) {
  const prev = writeKey
  writeKey = null
  try {
    await resealAudio()
    await resave()
  } catch (e) {
    writeKey = prev
    throw e
  }
  await del(RECORD)
  key = raw = null
  useVault.setState({ state: 'none' })
}

export const PASSCODE_MIN = 6
