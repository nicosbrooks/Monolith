import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Models you trained (training/), served by the dev server so a phone or this browser can try them before they're
 * published anywhere. Development only: the hosted build has no such route.
 *
 *   GET /local-models/index.json          → [{ name, files: [{ path, size }] }] for each folder in models/mlx
 *   GET /local-models/<name>/<file>       → the file (Range requests resume a stopped download)
 *
 * The relay's network listener (relay.ts) answers these too, so a real iPhone on the same Wi-Fi can fetch them.
 */
const ROOT = resolve('models/mlx')
/** ONNX exports for this browser (Transformers.js), at /local-models/onnx/<name>/… */
const ONNX_ROOT = resolve('models/onnx/exports')

function list() {
  if (!existsSync(ROOT)) return []
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => ({
      name: d.name,
      files: readdirSync(join(ROOT, d.name), { withFileTypes: true })
        .filter((f) => f.isFile() && !f.name.startsWith('.') && f.name !== 'README.md')
        .map((f) => ({ path: f.name, size: statSync(join(ROOT, d.name, f.name)).size })),
    }))
}

/** Answers a /local-models request; returns false for anything else. */
export function serveLocalModels(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url || '/', 'http://x')
  if (!url.pathname.startsWith('/local-models/') || req.method !== 'GET') return false
  const rest = decodeURIComponent(url.pathname.slice('/local-models/'.length))
  res.setHeader('Cache-Control', 'no-store')
  if (rest === 'index.json') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(list()))
    return true
  }
  const onnx = rest.startsWith('onnx/')
  const root = onnx ? ONNX_ROOT : ROOT
  const file = resolve(root, onnx ? rest.slice('onnx/'.length) : rest)
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404
    res.end()
    return true
  }
  const size = statSync(file).size
  const range = /^bytes=(\d+)-$/.exec(req.headers.range || '')
  const start = range ? Math.min(Number(range[1]), size) : 0
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Length', String(size - start))
  if (range) {
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${size - 1}/${size}`)
  }
  createReadStream(file, { start }).pipe(res)
  return true
}

export function localModels(): Plugin {
  return {
    name: 'monolith-local-models',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => (serveLocalModels(req, res) ? undefined : next()))
    },
  }
}
