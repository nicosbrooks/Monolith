// End-to-end encryption for linked devices. Must match apple/iOS/Link/LinkCrypto.swift byte for byte.
//
// Pairing: the browser shows a QR code with a fresh P-256 public key and a one-time secret. The phone answers with
// its own public key plus an HMAC of it under the secret (so the relay can't swap keys). Both sides run ECDH and
// HKDF-SHA256(salt = secret, info = "socratic/link/v1") to get an AES-256-GCM key. Frames are iv(12) ‖ ciphertext ‖ tag.

const enc = new TextEncoder()
const dec = new TextDecoder()
const INFO = enc.encode('socratic/link/v1')
/** WebCrypto wants bytes backed by a plain ArrayBuffer. */
const B = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>

export const b64u = {
  encode(b: ArrayBuffer | Uint8Array) {
    const bytes = b instanceof Uint8Array ? b : new Uint8Array(b)
    let s = ''
    bytes.forEach((x) => (s += String.fromCharCode(x)))
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(s: string) {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
    return Uint8Array.from(b, (c) => c.charCodeAt(0))
  },
}

export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

export async function newKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)) // 65-byte uncompressed point
  return { priv: kp.privateKey, pub }
}

export async function hmac(secret: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', B(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, B(data)))
}

export function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

/** ECDH + HKDF → raw 32-byte AES key (kept so the pairing survives reloads). */
export async function deriveKey(priv: CryptoKey, peerPub: Uint8Array, secret: Uint8Array) {
  const peer = await crypto.subtle.importKey('raw', B(peerPub), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256)
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: B(secret), info: INFO }, hk, 256))
}

export const aesKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', B(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])

export async function seal(key: CryptoKey, msg: unknown): Promise<string> {
  const iv = random(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(msg))))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return b64u.encode(out)
}

export async function open<T>(key: CryptoKey, box: string): Promise<T> {
  const b = b64u.decode(box)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B(b.slice(0, 12)) }, key, B(b.slice(12)))
  return JSON.parse(dec.decode(pt))
}
