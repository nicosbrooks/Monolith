import { DurableObject } from 'cloudflare:workers'

/**
 * Monolith sync relay. A person's phone and browsers each open an outgoing WebSocket to the same room, so they
 * can reach each other from any network: no port forwarding, no VPN, no shared Wi-Fi.
 *
 * Everything except the presence count is end-to-end encrypted by the devices with a key agreed through the
 * pairing QR code, so the relay can't read notes. It stores nothing; devices catch up when they reconnect.
 *
 *   wss://<relay>/relay?room=<id>   room ids are random 128-bit values chosen at pairing time
 *   https://<relay>/health          for uptime checks and `npm run smoke`
 *
 * Same protocol as the dev relay in ../server/relay.ts:
 *   - any frame a device sends is passed to the other devices in the room, untouched
 *   - {"relay":"peers","n":<count>} goes to everyone when a device joins or leaves
 *   - "ping" is answered with "pong" and not passed on
 */

const MAX_PEERS = 8
const MAX_FRAME = 8 * 1024 * 1024
/** Per device, per 10 seconds: plenty for a large file going across (256 KB pieces), not enough to flood a room. */
const WINDOW_MS = 10_000
const MAX_FRAMES = 600
const MAX_BYTES = 96 * 1024 * 1024
const ROOM = /^[A-Za-z0-9_-]{16,64}$/

interface Env {
  ROOMS: DurableObjectNamespace<Room>
  /** Optional, comma-separated. When set, browsers may only connect from these origins. See README. */
  ALLOWED_ORIGINS?: string
  /** Optional rate limiter for calendar fetches (wrangler.toml [[ratelimits]]). */
  ICS_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/') return new Response('Monolith relay\n')
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'monolith-relay', protocol: 1 })
    if (url.pathname === '/ics') return calendar(req, url, env)
    if (url.pathname !== '/relay') return new Response('Not found\n', { status: 404 })
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket\n', { status: 426 })
    if (!originAllowed(req, env)) return new Response('Origin not allowed\n', { status: 403 })
    const room = url.searchParams.get('room') || ''
    if (!ROOM.test(room)) return new Response('Bad room\n', { status: 400 })
    // One Durable Object per room keeps a pair's sockets together, wherever in the world each device connects.
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req)
  },
} satisfies ExportedHandler<Env>

/**
 * Subscribed calendars: .ics links from Google, Apple, Outlook… don't let browsers read them directly, so the relay
 * fetches them. https only, no private addresses, 5 MB at most, and it must actually be a calendar.
 */
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd]|.*\.local$|.*\.internal$)/i
async function calendar(req: Request, _url: URL, env: Env): Promise<Response> {
  const origin = req.headers.get('Origin') || '*'
  const cors = { 'access-control-allow-origin': originAllowed(req, env) ? origin : 'null', 'cache-control': 'no-store', vary: 'Origin' }
  const fail = (status: number, msg: string) => new Response(msg, { status, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' } })
  // The link goes in the body, never the URL: private calendar links are secrets and URLs end up in logs.
  if (req.method !== 'POST') return fail(405, 'Send the calendar link in a POST body.')
  if (!originAllowed(req, env)) return fail(403, 'Origin not allowed')
  if (env.ICS_LIMIT) {
    const { success } = await env.ICS_LIMIT.limit({ key: req.headers.get('CF-Connecting-IP') || 'unknown' })
    if (!success) return fail(429, 'Too many calendar refreshes. Try again in a minute.')
  }
  let target: URL
  try {
    target = new URL((await req.text()).slice(0, 2048).trim().replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    return fail(400, 'Use an https:// or webcal:// calendar link.')
  }
  if (target.protocol !== 'https:' || PRIVATE.test(target.hostname)) return fail(400, 'Use an https:// or webcal:// calendar link.')
  // Redirects are followed by hand, so every address on the way gets the same check as the first.
  let res: Response | null = null
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(target, { headers: { accept: 'text/calendar, */*' }, redirect: 'manual' }).catch(() => null)
    const next = res && res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!next) break
    try {
      target = new URL(next, target)
    } catch {
      return fail(502, 'That calendar couldn’t be reached.')
    }
    if (target.protocol !== 'https:' || PRIVATE.test(target.hostname)) return fail(400, 'That calendar link leads somewhere that isn’t allowed.')
    res = null
  }
  if (!res || !res.ok) return fail(502, 'That calendar couldn’t be reached.')
  const text = await res.text()
  if (text.length > 5 * 1024 * 1024) return fail(413, 'That calendar is too large.')
  if (!/^\s*BEGIN:VCALENDAR/i.test(text)) return fail(422, 'That link isn’t a calendar.')
  return new Response(text, { headers: { ...cors, 'content-type': 'text/calendar; charset=utf-8' } })
}

/** Browsers always say where a page came from; the iPhone app sends no Origin, so it is always let through. */
function originAllowed(req: Request, env: Env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
  const origin = req.headers.get('Origin')
  return !allowed.length || !origin || allowed.includes(origin)
}

/** A room: the open sockets of one pairing. Uses WebSocket hibernation, so idle rooms cost nothing. */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Keepalives are answered by the runtime, without waking this object or the other devices.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(): Promise<Response> {
    if (this.ctx.getWebSockets().length >= MAX_PEERS) return new Response('Room full\n', { status: 429 })
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    this.presence()
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Frames and bytes each socket sent in the current window. Lost if the room hibernates, which only resets them. */
  private use = new Map<WebSocket, { since: number; frames: number; bytes: number }>()

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (msg === 'ping') return ws.send('pong')
    const size = typeof msg === 'string' ? msg.length : msg.byteLength
    if (size > MAX_FRAME) return ws.close(1009, 'too big')
    const now = Date.now()
    let u = this.use.get(ws)
    if (!u || now - u.since > WINDOW_MS) this.use.set(ws, (u = { since: now, frames: 0, bytes: 0 }))
    u.frames++
    u.bytes += size
    // A device far over the limit is cut off; it reconnects after a pause and carries on from there.
    if (u.frames > MAX_FRAMES || u.bytes > MAX_BYTES) return ws.close(1008, 'too fast')
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue
      try {
        peer.send(msg)
      } catch {
        /* closing */
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number) {
    this.use.delete(ws)
    try {
      // 1005 and 1006 mean "no code was sent" and can't be sent back.
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {
      /* already closed */
    }
    this.presence(ws)
  }

  webSocketError(ws: WebSocket) {
    this.use.delete(ws)
    this.presence(ws)
  }

  /** Tell everyone how many devices are in the room, so they know when to send a catch-up snapshot. */
  private presence(leaving?: WebSocket) {
    const peers = this.ctx.getWebSockets().filter((w) => w !== leaving)
    const msg = JSON.stringify({ relay: 'peers', n: peers.length })
    for (const p of peers) {
      try {
        p.send(msg)
      } catch {
        /* closing */
      }
    }
  }
}
