/// <reference lib="dom" />
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { expect, test } from '@playwright/test'

// Model downloads (src/ai/resumable.ts) against a real HTTP server that can cut the connection: what arrived is kept,
// the next try asks only for the rest, and the finished file is byte-for-byte right. Run inside a worker on the app's
// own origin, where the models are really stored.

const SIZE = 3_000_000
const body = Buffer.alloc(SIZE)
for (let i = 0; i < SIZE; i++) body[i] = (i * 31 + (i >> 8)) & 255

let server: Server
let port = 0
/** Close the connection after this many bytes of a response (0: never). */
let cutAfter = 0
let ranges: (string | undefined)[] = []
let honourRanges = true

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range, if-range', 'access-control-expose-headers': 'content-range, content-length, etag' }
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end()
    ranges.push(req.headers.range)
    const from = honourRanges && req.headers.range ? Number(/bytes=(\d+)-/.exec(req.headers.range)?.[1] ?? 0) : 0
    const part = body.subarray(from)
    res.writeHead(from ? 206 : 200, { ...cors, etag: '"v1"', 'content-length': part.length, ...(from ? { 'content-range': `bytes ${from}-${SIZE - 1}/${SIZE}` } : {}) })
    if (!cutAfter) return void res.end(part)
    // Give the browser a moment to read what was sent before the line goes dead (a reset can discard unread data).
    res.write(part.subarray(0, cutAfter), () => setTimeout(() => res.destroy(), 250))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  port = (server.address() as { port: number }).port
})
test.afterAll(() => void server.close())
test.beforeEach(() => ((cutAfter = 0), (ranges = []), (honourRanges = true)))

const code = stripTypeScriptTypes(readFileSync('src/ai/resumable.ts', 'utf8')).replace(/^export /gm, '')

/** Run one download try in a worker; resolves with how it ended and what's stored. */
async function attempt(page: import('@playwright/test').Page, file: string, declared = SIZE) {
  return page.evaluate(
    async ({ code, url, file, declared }) => {
      const harness = `
        onmessage = async () => {
          const dir = await navigator.storage.getDirectory()
          let out = { ok: true, error: '', resumable: false, progress: [] }
          try { out.bytes = await download(dir, ${JSON.stringify(file)}, { url: ${JSON.stringify(url)}, size: ${declared} || undefined }, (f) => out.progress.push(f)) }
          catch (e) { out = { ...out, ok: false, error: e.message, resumable: !!e.resumable } }
          const stored = await (await dir.getFileHandle(${JSON.stringify(file)})).getFile().catch(() => null)
          const buf = stored ? new Uint8Array(await stored.arrayBuffer()) : new Uint8Array()
          let sum = 0; for (let i = 0; i < buf.length; i++) sum = (sum * 33 + buf[i]) >>> 0
          out.stored = buf.length; out.sum = sum; out.waiting = await partial(dir, ${JSON.stringify(file)})
          postMessage(out)
        }`
      const w = new Worker(URL.createObjectURL(new Blob([code, harness], { type: 'text/javascript' })), { type: 'module' })
      const done = new Promise<{ ok: boolean; error: string; resumable: boolean; progress: number[]; bytes?: number; stored: number; sum: number; waiting?: number }>((ok, fail) => {
        w.onmessage = (e) => ok(e.data)
        w.onerror = (e) => fail(new Error(e.message))
      })
      w.postMessage(0)
      return done.finally(() => w.terminate())
    },
    { code, url: `http://127.0.0.1:${port}/model`, file, declared },
  )
}
let sum = 0
for (let i = 0; i < SIZE; i++) sum = (sum * 33 + body[i]) >>> 0

test('a model download that is cut off carries on from where it stopped', async ({ page }) => {
  await page.goto(`http://dl${Date.now().toString(36)}.localhost:5220/`)
  cutAfter = 1_200_000
  const first = await attempt(page, 'cut.bin')
  expect(first.ok).toBe(false)
  expect(first.resumable).toBe(true)
  expect(first.stored).toBeGreaterThan(200_000)
  expect(first.stored).toBeLessThan(SIZE)
  expect(first.waiting).toBeCloseTo(first.stored / SIZE, 5)

  // Cut a second time, further on: still only asks for what's missing.
  const second = await attempt(page, 'cut.bin')
  expect(second.ok).toBe(false)
  expect(second.stored).toBeGreaterThan(first.stored)
  expect(ranges[1]).toBe(`bytes=${first.stored}-`)

  cutAfter = 0
  const last = await attempt(page, 'cut.bin')
  expect(last.ok).toBe(true)
  expect(ranges[2]).toBe(`bytes=${second.stored}-`)
  expect(last.bytes).toBe(SIZE)
  expect(last.stored).toBe(SIZE)
  expect(last.sum).toBe(sum) // the pieces joined up exactly
  expect(last.waiting).toBeUndefined()
})

test('a server that ignores ranges gets a clean restart, and a clean download needs one request', async ({ page }) => {
  await page.goto(`http://dl${Date.now().toString(36)}.localhost:5220/`)
  const clean = await attempt(page, 'clean.bin')
  expect(clean.ok).toBe(true)
  expect(clean.sum).toBe(sum)
  expect(ranges).toEqual([undefined])

  cutAfter = 900_000
  await attempt(page, 'norange.bin')
  cutAfter = 0
  honourRanges = false // answers 200 with the whole file
  const again = await attempt(page, 'norange.bin')
  expect(again.ok).toBe(true)
  expect(again.stored).toBe(SIZE)
  expect(again.sum).toBe(sum)
})

test('a part from a different file is not reused', async ({ page }) => {
  await page.goto(`http://dl${Date.now().toString(36)}.localhost:5220/`)
  cutAfter = 900_000
  await attempt(page, 'other.bin')
  cutAfter = 0
  // The same name, but the source now says the file is a different length: start over.
  const r = await attempt(page, 'other.bin', SIZE - 1)
  expect(ranges.at(-1)).toBeUndefined()
  expect(r.ok).toBe(false) // the server sent more than was declared, so it isn't trusted
})
