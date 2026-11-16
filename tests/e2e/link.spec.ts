/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { aesKey, b64u, deriveKey, hmac, open, seal } from '../../src/link/crypto.ts'

// Linking a phone, end to end: the browser shows a pairing code, and this test plays the phone (as
// apple/iOS/Link/Linker.swift does) through the relay the preview server runs. It checks what crosses the relay
// stays sealed, that records sync both ways, and that the browser's assistant can answer with the phone's model.

async function start(page: Page) {
  await page.goto(`http://link${Date.now().toString(36)}.localhost:5220/`)
  await page.fill('#su-name', 'Sam')
  await page.click('.su button[type=submit]')
  await page.click('.su-opt:has-text("This browser")')
  await page.click('.su button.primary[type=submit]')
  await expect(page.locator('.su')).toHaveCount(0)
}

/** The phone's end: a socket in the pairing room, and the sealed messages that come through it. */
async function phone(pairURL: string) {
  const q = new URL(pairURL).searchParams
  const room = q.get('r')!
  const secret = b64u.decode(q.get('s')!)
  const ws = new WebSocket(`ws://localhost:5220/relay?room=${room}`)
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
  const raw: string[] = []
  const inbox: Record<string, unknown>[] = []
  let key: CryptoKey | null = null
  ws.onmessage = async (e) => {
    const d = String(e.data)
    raw.push(d)
    const f = JSON.parse(d)
    if (key && typeof f.c === 'string') inbox.push(await open(key, f.c))
  }
  // Answer the code: our key, and proof we read the secret.
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  key = await aesKey(await deriveKey(kp.privateKey, b64u.decode(q.get('k')!), secret))
  ws.send(JSON.stringify({ p: 'hello', k: b64u.encode(pub), m: b64u.encode(await hmac(secret, pub)), n: 'Test iPhone' }))
  let q_ = Date.now() * 1000
  const send = async (msg: object) => {
    const frame = JSON.stringify({ c: await seal(key!, { ...msg, f: 'test-phone', q: ++q_ }) })
    ws.send(frame)
    return frame
  }
  const next = async (t: string, after = 0) => {
    await expect.poll(() => inbox.slice(after).some((m) => m.t === t), { timeout: 15_000 }).toBe(true)
    return inbox.slice(after).find((m) => m.t === t)!
  }
  return { ws, raw, inbox, send, next }
}

test('a linked phone syncs sealed records and lends the browser its model', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await start(page)
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('Add a device')
  // A command's name typed in ⌘K puts that command first.
  await expect(page.locator('[cmdk-item][aria-selected=true]')).toHaveText('Add a device')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Copy link' }).click()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  expect(url).toMatch(/^monolith:\/\/pair\?/)

  const p = await phone(url)
  // The browser checks the proof, says hello and sends what it has, all sealed.
  await expect(page.getByText('Test iPhone').first()).toBeVisible()
  const hi = await p.next('hi')
  expect(hi.c).toContain('files')
  await p.next('snap')
  await p.send({ t: 'hi', n: 'Test iPhone', c: ['files', 'model'], m: 'Test Model' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Your phone' })).toHaveCount(0)

  // A note made on the phone shows up here.
  const first = await p.send({ t: 'put', recs: [{ id: 'phone-note-1', kind: 'note', title: 'Written on the phone', body: 'Hello from the phone', updatedAt: Date.now() }] })
  await expect(page.getByText('Written on the phone').first()).toBeVisible()
  // The relay replaying an old frame can't undo a later edit.
  await p.send({ t: 'put', recs: [{ id: 'phone-note-1', kind: 'note', title: 'Renamed on the phone', body: 'Hello from the phone', updatedAt: Date.now() + 5 }] })
  await expect(page.getByText('Renamed on the phone').first()).toBeVisible()
  p.ws.send(first)
  await page.waitForTimeout(500)
  await expect(page.getByText('Written on the phone')).toHaveCount(0)

  // A picture in a phone doc arrives by hash: the browser asks for it, the phone sends it in pieces, and it shows.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64')
  const h = Buffer.from(await crypto.subtle.digest('SHA-256', png)).subarray(0, 16).toString('hex')
  let mark = p.inbox.length
  await p.send({ t: 'put', recs: [{ id: 'phone-doc-1', kind: 'doc', title: 'Photo from the phone', body: `A picture:\n\n![board](monolith-file:${h})`, updatedAt: Date.now() }] })
  const want = await p.next('want', mark)
  expect(want.hs).toContain(h)
  await p.send({ t: 'file', h, nm: 'board.png', ty: 'image/png', sz: png.length, i: 0, of: 1, d: b64u.encode(new Uint8Array(png)) })
  await page.getByText('Photo from the phone').first().click()
  await expect.poll(() => page.locator('.ProseMirror img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 10_000 }).toBe(2)

  // A question goes to the phone's model, sealed, and its answer streams back.
  const before = p.inbox.length
  const bar = page.locator('.ask-field input')
  await bar.fill('explain photosynthesis in one line')
  await bar.press('Enter')
  const ask = await p.next('ask', before)
  const msgs = ask.msgs as { role: string; content: string }[]
  expect(msgs.at(-1)!.content).toContain('photosynthesis')
  await p.send({ t: 'tok', id: ask.id, full: 'Plants turn light' })
  await p.send({ t: 'done', id: ask.id, full: 'Plants turn light into sugar.' })
  await expect(page.locator('.convo .cv-a .md')).toContainText('Plants turn light into sugar.')
  await expect(page.locator('.convo-model')).toContainText('Test Model on Test iPhone')

  // Nothing readable crossed the relay: every frame was the pairing hello, presence, or a sealed box.
  const plain = p.raw.filter((d) => /photosynthesis|on the phone|Sugar|sugar/.test(d))
  expect(plain).toEqual([])
  p.ws.close()
})
