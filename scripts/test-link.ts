// The link's security rules, checked without a relay: pairing, sealing, and the envelope that stops replays.
// The phone's side is played here with WebCrypto, step for step as apple/iOS/Link/LinkCrypto.swift does it.
//   npm run test:link
import { aesKey, b64u, deriveKey, equal, hmac, newKeyPair, open, random, seal } from '../src/link/crypto.ts'
import { admit, nextSeq, pad } from '../src/link/envelope.ts'

let failed = 0
let n = 0
async function check(name: string, fn: () => Promise<string | void> | string | void) {
  n++
  try {
    const why = await fn()
    if (why) throw new Error(why)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${name}: ${(e as Error).message}`)
  }
}

const enc = new TextEncoder()
const INFO = enc.encode('socratic/link/v1')

/** The phone: answers a QR code with its own key and an HMAC of it under the code's secret (LinkCrypto.answer). */
async function phoneAnswers(webPub: Uint8Array, secret: Uint8Array) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const peer = await crypto.subtle.importKey('raw', webPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, kp.privateKey, 256)
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  const raw = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: secret, info: INFO }, hk, 256))
  return { pub, mac: await hmac(secret, pub), raw }
}

// ─── Pairing and sealing ────────────────────────────────────────────────────
const web = await newKeyPair()
const secret = random(16)
const phone = await phoneAnswers(web.pub, secret)

await check('the phone proves it read the code', async () => (equal(await hmac(secret, phone.pub), phone.mac) ? '' : 'HMAC did not match'))

await check('a key swapped on the way is caught', async () => {
  const intruder = await newKeyPair()
  return equal(await hmac(secret, intruder.pub), phone.mac) ? 'a different key passed the check' : ''
})

await check('both sides arrive at the same key', async () => {
  const mine = await deriveKey(web.priv, phone.pub, secret)
  return equal(mine, phone.raw) ? '' : 'keys differ'
})

const key = await aesKey(phone.raw)
await check('a sealed message opens with the key', async () => {
  const box = await seal(key, { t: 'put', recs: [{ id: 'a', title: 'Secret plans' }] })
  if (box.includes('Secret')) return 'plaintext visible in the sealed box'
  const back = await open<{ recs: { title: string }[] }>(key, box)
  return back.recs[0].title === 'Secret plans' ? '' : 'came back different'
})

await check('a changed byte is refused', async () => {
  const box = b64u.decode(await seal(key, { t: 'bye' }))
  box[20] ^= 1
  return (await open(key, b64u.encode(box)).then(() => 'opened', () => '')) || ''
})

await check('another pairing’s key can’t open it', async () => {
  const other = await aesKey(random(32))
  return (await open(other, await seal(key, { t: 'hi' })).then(() => 'opened', () => '')) || ''
})

await check('the same message seals differently each time', async () => ((await seal(key, { t: 'hi' })) === (await seal(key, { t: 'hi' })) ? 'identical boxes (nonce reused)' : ''))

await check('the key kept by the page can’t be read back out', async () => {
  const exported = await crypto.subtle.exportKey('raw', key).then(() => true, () => false)
  return exported ? 'the key was extractable' : ''
})

// ─── Envelope ───────────────────────────────────────────────────────────────
await check('frames in order are taken', () => {
  const seen = new Map<string, number>()
  return admit(seen, 'me', { f: 'phone', q: 1 }, true) === 'ok' && admit(seen, 'me', { f: 'phone', q: 2 }, true) === 'ok' ? '' : 'refused'
})

await check('a replayed frame is refused', () => {
  const seen = new Map<string, number>()
  admit(seen, 'me', { f: 'phone', q: 5 }, true)
  return admit(seen, 'me', { f: 'phone', q: 5 }, true) === 'replay' && admit(seen, 'me', { f: 'phone', q: 3 }, true) === 'replay' ? '' : 'replay taken'
})

await check('our own frame bounced back is refused', () => (admit(new Map(), 'me', { f: 'me', q: 9 }, false) === 'self' ? '' : 'taken'))

await check('older devices without stamps still work, until the room stamps', () => {
  const seen = new Map<string, number>()
  if (admit(seen, 'me', {}, false) !== 'ok') return 'unstamped refused before the room stamped'
  return admit(seen, 'me', {}, true) === 'unstamped' ? '' : 'unstamped taken in a stamping room'
})

await check('senders are counted separately', () => {
  const seen = new Map<string, number>()
  admit(seen, 'me', { f: 'phone', q: 100 }, true)
  return admit(seen, 'me', { f: 'ipad', q: 2 }, true) === 'ok' ? '' : 'a second device was refused'
})

await check('sequence numbers only go up, even if the clock goes back', () => {
  const a = nextSeq(0, 1_000)
  const b = nextSeq(a, 500)
  return b > a ? '' : `${b} after ${a}`
})

await check('small frames are padded to 512-byte steps', () => {
  for (const len of [0, 10, 300, 505, 506, 1000, 5000]) {
    const size = JSON.stringify(pad({ t: 'tok', full: 'x'.repeat(len) })).length
    if (size % 512) return `${len} → ${size}`
  }
})

await check('large frames are not padded', () => {
  const big = { t: 'put', body: 'x'.repeat(70_000) }
  return JSON.stringify(pad(big)).length === JSON.stringify(big).length ? '' : 'padded'
})

console.log(failed ? `${failed} of ${n} failed` : `${n}/${n} pass`)
process.exit(failed ? 1 : 0)
