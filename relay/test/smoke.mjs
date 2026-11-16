// Checks that a relay works: two devices join a room, see each other, and pass messages both ways.
//
//   npm run smoke                                   → the local relay from `npm run dev` (http://localhost:8787)
//   npm run smoke -- https://monolith-relay.<you>.workers.dev
//
// Needs Node 22 or newer (built-in WebSocket).
import { randomBytes } from 'node:crypto'
import { aesKey, b64u, deriveKey, equal, hmac, newKeyPair, open, random, seal } from '../../src/link/crypto.ts'

const base = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')
const ws = base.replace(/^http/, 'ws')
const room = randomBytes(16).toString('base64url')
const TIMEOUT = 8000

let failed = 0
const pass = (name) => console.log(`  ok    ${name}`)
const fail = (name, why) => (failed++, console.log(`  FAIL  ${name}${why ? `: ${why}` : ''}`))

/** A connected device that queues what it receives. */
function device(url = `${ws}/relay?room=${room}`, headers) {
  const sock = headers ? new WebSocket(url, { headers }) : new WebSocket(url)
  const inbox = []
  const waiters = []
  sock.addEventListener('message', (e) => {
    const w = waiters.findIndex((x) => x.match(e.data))
    if (w >= 0) waiters.splice(w, 1)[0].resolve(e.data)
    else inbox.push(e.data)
  })
  const opened = new Promise((resolve, reject) => {
    sock.addEventListener('open', () => resolve(true))
    sock.addEventListener('error', () => reject(new Error('could not connect')))
    sock.addEventListener('close', (e) => reject(new Error(`closed (${e.code})`)))
  })
  /** The next message matching `match`, including ones that already arrived. */
  const next = (match) =>
    new Promise((resolve, reject) => {
      const i = inbox.findIndex(match)
      if (i >= 0) return resolve(inbox.splice(i, 1)[0])
      const t = setTimeout(() => reject(new Error('timed out')), TIMEOUT)
      waiters.push({ match, resolve: (v) => (clearTimeout(t), resolve(v)) })
    })
  const peers = (n) => next((d) => typeof d === 'string' && d.startsWith('{') && JSON.parse(d).relay === 'peers' && JSON.parse(d).n === n)
  return { sock, opened, next, peers }
}

async function check(name, fn) {
  try {
    const why = await fn()
    why ? fail(name, why) : pass(name)
  } catch (e) {
    fail(name, e.message)
  }
}

console.log(`Relay: ${base}`)

await check('answers /health', async () => {
  const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(TIMEOUT) })
  const j = await r.json()
  return j.ok === true ? '' : `unexpected reply ${JSON.stringify(j)}`
})
if (failed) {
  console.log(`\nNothing answered at ${base}. Check the address, or start the local relay with "npm run dev".`)
  process.exit(1)
}

await check('refuses a malformed room', async () => {
  const bad = device(`${ws}/relay?room=short`)
  const joined = await bad.opened.then(() => true, () => false)
  bad.sock.close()
  return joined ? 'it let the device in' : ''
})

const a = device()
await check('first device connects and is alone', async () => {
  await a.opened
  await a.peers(1)
})

const b = device()
await check('second device joins; both see two', async () => {
  await b.opened
  await Promise.all([a.peers(2), b.peers(2)])
})

await check('passes messages both ways, untouched', async () => {
  const one = JSON.stringify({ c: randomBytes(64).toString('base64url') })
  const two = JSON.stringify({ c: randomBytes(64).toString('base64url') })
  a.sock.send(one)
  b.sock.send(two)
  const [gotB, gotA] = await Promise.all([b.next((d) => d === one), a.next((d) => d === two)])
  return gotB === one && gotA === two ? '' : 'payload changed'
})

await check('passes a large message (1 MB)', async () => {
  const big = JSON.stringify({ c: 'x'.repeat(1024 * 1024) })
  a.sock.send(big)
  await b.next((d) => d === big)
})

await check('answers ping without telling the other device', async () => {
  a.sock.send('ping')
  await a.next((d) => d === 'pong')
  const marker = JSON.stringify({ c: 'after-ping' })
  a.sock.send(marker)
  const got = await b.next((d) => d === 'ping' || d === marker)
  return got === marker ? '' : 'the ping was passed on'
})

await check('tells the room when a device leaves', async () => {
  b.sock.close()
  await a.peers(1)
})

await check('keeps other rooms separate', async () => {
  const other = device(`${ws}/relay?room=${randomBytes(16).toString('base64url')}`)
  await other.opened
  await other.peers(1)
  other.sock.close()
})

a.sock.close()

// Pairing the way the app does it, through this relay: a browser shows a code, a phone answers, both seal. The relay
// sees only the hello (public key and proof) and sealed boxes.
await check('pairs through the relay; what it passes on is sealed', async () => {
  const pairRoom = randomBytes(16).toString('base64url')
  const url = `${ws}/relay?room=${pairRoom}`
  const browser = device(url)
  await browser.opened
  const web = await newKeyPair()
  const secret = random(16)
  const phone = device(url)
  await phone.opened
  // The phone, as LinkCrypto.answer does it.
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const phoneRaw = await deriveKey(kp.privateKey, web.pub, secret)
  phone.sock.send(JSON.stringify({ p: 'hello', k: b64u.encode(pub), m: b64u.encode(await hmac(secret, pub)), n: 'iPhone' }))
  const hello = JSON.parse(await browser.next((d) => d.includes('"hello"')))
  if (!equal(await hmac(secret, b64u.decode(hello.k)), b64u.decode(hello.m))) return 'the proof did not check out'
  const webRaw = await deriveKey(web.priv, b64u.decode(hello.k), secret)
  if (!equal(webRaw, phoneRaw)) return 'the two sides got different keys'
  const box = await seal(await aesKey(webRaw), { t: 'put', recs: [{ id: 'x', title: 'Private thoughts' }] })
  browser.sock.send(JSON.stringify({ c: box }))
  const got = await phone.next((d) => d.includes('"c"') && !d.includes('relay'))
  if (got.includes('Private')) return 'plaintext crossed the relay'
  const back = await open(await aesKey(phoneRaw), JSON.parse(got).c)
  browser.sock.close()
  phone.sock.close()
  return back.recs[0].title === 'Private thoughts' ? '' : 'came back different'
})

// The hosted relay cuts off a device that floods a room (relay/src/index.ts). The dev relay doesn't, so this one only
// says what it saw.
await check('cuts off a device that floods a room', async () => {
  const floodRoom = `${ws}/relay?room=${randomBytes(16).toString('base64url')}`
  const loud = device(floodRoom)
  const quiet = device(floodRoom)
  await Promise.all([loud.opened, quiet.opened])
  const closed = new Promise((resolve) => loud.sock.addEventListener('close', (e) => resolve(e.code)))
  for (let i = 0; i < 700 && loud.sock.readyState === 1; i++) loud.sock.send(JSON.stringify({ c: String(i) }))
  const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r(null), 3000))])
  quiet.sock.close()
  loud.sock.close()
  if (code === null && process.argv.includes('--dev')) return ''
  return code === 1008 ? '' : `not cut off (close code ${code})`
})

console.log(failed ? `\n${failed} check${failed === 1 ? '' : 's'} failed.` : '\nAll checks passed. This relay is ready to use.')
process.exit(failed ? 1 : 0)
