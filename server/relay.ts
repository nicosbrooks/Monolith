import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import type { Plugin } from 'vite'
import { WebSocketServer, type WebSocket } from 'ws'
import { serveLocalModels } from './models.ts'

/**
 * Sync relay: passes messages between a user's linked devices (phone ↔ browsers).
 * Everything except the presence count is end-to-end encrypted by the devices with a key agreed through
 * the pairing QR code, so this server can't read notes. It stores nothing; devices catch up when they reconnect.
 *
 * ws(s)://<host>/relay?room=<id>   ·  room ids are random 128-bit values chosen at pairing time.
 *
 * A phone can't reach the dev server at "localhost", so the relay alone (not the app) also listens on this computer's
 * network address, one port below the server's. GET /relay/lan tells the page that address for the pairing code.
 */
const MAX_PEERS = 8
const MAX_FRAME = 8 * 1024 * 1024

export function relay(): Plugin {
  const rooms = new Map<string, Set<WebSocket>>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME })

  const presence = (room: string) => {
    const peers = rooms.get(room)
    if (!peers) return
    const msg = JSON.stringify({ relay: 'peers', n: peers.size })
    peers.forEach((p) => p.readyState === p.OPEN && p.send(msg))
  }

  wss.on('connection', (ws: WebSocket, room: string) => {
    const peers = rooms.get(room) ?? new Set<WebSocket>()
    if (peers.size >= MAX_PEERS) return ws.close(1008, 'room full')
    rooms.set(room, peers)
    peers.add(ws)
    presence(room)
    let alive = true
    ws.on('pong', () => (alive = true))
    const ping = setInterval(() => {
      if (!alive) return ws.terminate()
      alive = false
      ws.ping()
    }, 25000)
    ws.on('message', (data, binary) => {
      // Keepalive from a browser, answered here so it never wakes the other device.
      if (!binary && (data as Buffer).length === 4 && data.toString() === 'ping') return ws.send('pong')
      peers.forEach((p) => p !== ws && p.readyState === p.OPEN && p.send(data, { binary }))
    })
    ws.on('close', () => {
      clearInterval(ping)
      peers.delete(ws)
      if (peers.size) presence(room)
      else rooms.delete(room)
    })
  })

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url || '/', 'http://x')
    if (url.pathname !== '/relay') return // leave Vite's own hot-reload socket alone
    const room = url.searchParams.get('room') || ''
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(room)) return socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, room))
  }

  // The relay on the local network: answers /relay upgrades and, on the dev server, the models you trained
  // (models.ts), so a real phone can try them. Nothing else.
  let lan: Server | null = null
  let lanURL = ''
  const openLan = (http: Server | null | undefined, dev = false) => {
    if (!http || lan) return
    http.once('listening', () => {
      const port = (http.address() as AddressInfo | null)?.port
      const ip = lanAddress()
      if (!port || !ip) return
      lan = createServer((req, res) => (dev && serveLocalModels(req, res) ? undefined : (res.statusCode = 404, res.end())))
      lan.on('upgrade', upgrade)
      lan.on('error', () => (lanURL = '')) // port taken: pairing falls back to the simulator-only path
      lan.listen(port - 1, '0.0.0.0', () => (lanURL = `ws://${ip}:${port - 1}`))
      http.once('close', () => lan?.close())
    })
  }
  const where = (req: IncomingMessage, res: { setHeader(k: string, v: string): void; end(s: string): void }, next: () => void) => {
    if (req.url !== '/relay/lan') return next()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ url: lanAddress() ? lanURL : '' }))
  }

  return {
    name: 'monolith-relay',
    configureServer(server) {
      server.httpServer?.on('upgrade', upgrade)
      server.middlewares.use(where)
      openLan(server.httpServer as Server | null, true)
    },
    configurePreviewServer(server) {
      server.httpServer?.on('upgrade', upgrade)
      server.middlewares.use(where)
      openLan(server.httpServer as Server | null)
    },
  }
}

/** This computer's private IPv4 address (Wi-Fi or Ethernet), the one a phone on the same network can reach. Some
 *  networks, and Tailscale, hand out 100.64.0.0/10 addresses, so those count too. */
function lanAddress() {
  const all = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list || []).map((a) => ({ name, ...a })))
  const ok = all.filter((a) => a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a.address))
  // Wi-Fi and Ethernet first; VPN tunnels (utun) and bridges last.
  ok.sort((a, b) => Number(/^(utun|bridge|vmnet)/.test(a.name)) - Number(/^(utun|bridge|vmnet)/.test(b.name)))
  return ok[0]?.address || ''
}
