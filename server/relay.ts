import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Plugin } from 'vite'
import { WebSocketServer, type WebSocket } from 'ws'

/**
 * Sync relay: passes messages between a user's linked devices (phone ↔ browsers).
 * Everything except the presence count is end-to-end encrypted by the devices with a key agreed through
 * the pairing QR code, so this server can't read notes. It stores nothing; devices catch up when they reconnect.
 *
 * ws(s)://<host>/relay?room=<id>   ·  room ids are random 128-bit values chosen at pairing time.
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

  return {
    name: 'monolith-relay',
    configureServer(server) {
      server.httpServer?.on('upgrade', upgrade)
    },
    configurePreviewServer(server) {
      server.httpServer?.on('upgrade', upgrade)
    },
  }
}
