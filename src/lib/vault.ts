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

interface Rec { salt: string; iter: number; check: string }

/** 'checking' until we know whether a passcode is set; 'locked' while one is set and not entered yet. */
export const useVault = create<{ state: 'checking' | 'none' | 'locked' | 'open' }>(() => ({ state: 'checking' }))

let key: CryptoKey | null = null
let ready: () => void
/** Resolves once saved data can be read: right away with no passcode, after unlocking with one. */
export const vaultReady = new Promise<void>((r) => (ready = r))

async function derive(passcode: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passcode.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: B(salt), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

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
  return key ? SEALED + b64u.encode(await sealBytes(key, enc.encode(text))) : text
}
/** Decrypt text sealed by `sealText`; plain text passes through. */
export async function openText(text: string) {
  if (!text.startsWith(SEALED)) return text
  if (!key) throw new Error('Monolith is locked')
  return dec.decode(await openBytes(key, b64u.decode(text.slice(SEALED.length))))
}

/** Audio and other files: an encrypted copy, or the blob as is. */
export async function sealBlob(b: Blob): Promise<Blob | { sealed: Uint8Array; type: string }> {
  return key ? { sealed: await sealBytes(key, new Uint8Array(await b.arrayBuffer())), type: b.type } : b
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

/** True if the passcode was right. */
export async function unlock(passcode: string) {
  const rec = await get<Rec>(RECORD)
  if (!rec) return true
  const k = await derive(passcode, b64u.decode(rec.salt), rec.iter)
  try {
    if (dec.decode(await openBytes(k, b64u.decode(rec.check))) !== CHECK) return false
  } catch {
    return false
  }
  key = k
  useVault.setState({ state: 'open' })
  ready()
  return true
}

/** Decrypt recordings with the old key and save them again under the new one (or in the clear). */
async function rekeyAudio(next: CryptoKey | null) {
  const ids = (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith('audio:'))
  for (const id of ids) {
    const blob = await openBlob(await get(id))
    if (!blob) continue
    const prev = key
    key = next
    try {
      await set(id, await sealBlob(blob))
    } finally {
      key = prev
    }
  }
}

/** Turn the lock on (or change the passcode). The caller then re-saves everything so it's written encrypted. */
export async function setPasscode(passcode: string) {
  const salt = random(16)
  const k = await derive(passcode, salt, ITER)
  await rekeyAudio(k)
  await set(RECORD, { salt: b64u.encode(salt), iter: ITER, check: b64u.encode(await sealBytes(k, enc.encode(CHECK))) } satisfies Rec)
  key = k
  useVault.setState({ state: 'open' })
}

/** Turn the lock off. The caller then re-saves everything so it's written in the clear. */
export async function clearPasscode() {
  await rekeyAudio(null)
  await del(RECORD)
  key = null
  useVault.setState({ state: 'none' })
}

export const PASSCODE_MIN = 6
