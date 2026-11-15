import { del, get, keys, set } from 'idb-keyval'
import { openBlob, sealBlob } from './vault'

/**
 * Files in docs: pictures and attachments. Each file is stored once, apart from the docs, under its content hash
 * (`file:<hash>` in IndexedDB, encrypted when the passcode lock is on, like recorded audio). A doc holds only a short
 * reference, a Markdown image `![name](monolith-file:<hash>)`, so saving, syncing and searching docs stays fast however
 * many files they hold, and the same file added twice is stored once. Pictures show as pictures; any other file shows as
 * an attachment card. The reference survives Markdown, phone sync and the iPhone editor unchanged.
 */

export const FILE_SCHEME = 'monolith-file:'
/** Largest attachment accepted. */
export const MAX_FILE = 250 * 1024 * 1024
/** Longest side of a stored picture. */
const MAX_SIDE = 2560

export interface FileMeta { name: string; type: string; size: number }
interface Rec extends FileMeta { data: Blob | { sealed: Uint8Array; type: string }; at: number }

const key = (hash: string) => `file:${hash}`
export const refOf = (hash: string) => FILE_SCHEME + hash
export const hashOf = (src: string | null | undefined) => (src?.startsWith(FILE_SCHEME) ? src.slice(FILE_SCHEME.length) : null)
export const isImageType = (type: string) => type.startsWith('image/')

async function sha(blob: Blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  return [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Store a file (once per content) and return its reference. */
export async function putFile(blob: Blob, name: string): Promise<string> {
  if (blob.size > MAX_FILE) throw new Error(`“${name}” is larger than ${Math.round(MAX_FILE / 1024 / 1024)} MB.`)
  const hash = await sha(blob)
  if (!(await get(key(hash)))) await set(key(hash), { data: await sealBlob(blob), name, type: blob.type || 'application/octet-stream', size: blob.size, at: Date.now() } satisfies Rec)
  return refOf(hash)
}

/** A picture made a sensible size in a worker (see image.worker.ts); the original if that isn't possible. */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (typeof OffscreenCanvas === 'undefined') return file
  const w = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<Blob>((resolve) => {
      w.onmessage = (e) => resolve(e.data.blob as Blob)
      w.onerror = () => resolve(file)
      w.postMessage({ file, max: MAX_SIDE })
    })
  } finally {
    w.terminate()
  }
}

/** Store a file picked, pasted or dropped into a doc. Pictures are resized first. */
export async function addFile(file: File): Promise<{ ref: string; name: string }> {
  const blob = isImageType(file.type) ? await prepareImage(file) : file
  return { ref: await putFile(blob, file.name), name: file.name }
}

export async function fileMeta(hash: string): Promise<FileMeta | undefined> {
  const r = await get<Rec>(key(hash))
  return r && { name: r.name, type: r.type, size: r.size }
}

export async function fileBlob(hash: string): Promise<Blob | undefined> {
  const r = await get<Rec>(key(hash))
  if (!r) return undefined
  const b = await openBlob(r.data)
  return b && (b.type ? b : new Blob([b], { type: r.type }))
}

/** An object URL for showing a file, made once per file per page load. */
const urls = new Map<string, Promise<string | undefined>>()
export function fileUrl(hash: string) {
  let u = urls.get(hash)
  if (!u) {
    u = fileBlob(hash).then((b) => (b ? URL.createObjectURL(b) : undefined))
    urls.set(hash, u)
  }
  return u
}

export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`)

const dataUrlBlob = (u: string) => fetch(u).then((r) => r.blob())
const blobDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

const SRC = /src="(data:image\/[^"]+|monolith-file:[0-9a-f]+)"/g

/** Every file a doc refers to. */
export function refsIn(html: string): string[] {
  return [...html.matchAll(/monolith-file:([0-9a-f]+)/g)].map((m) => m[1])
}

/** Pictures embedded in a doc as data (older docs, pastes from other apps, the phone) moved into the store. */
export async function externalize(html: string): Promise<string> {
  if (!html.includes('src="data:image/')) return html
  const found = [...new Set([...html.matchAll(SRC)].map((m) => m[1]).filter((s) => s.startsWith('data:')))]
  let out = html
  for (const src of found) {
    try {
      const blob = await prepareImage(await dataUrlBlob(src))
      out = out.split(`src="${src}"`).join(`src="${await putFile(blob, 'Picture')}"`)
    } catch {
      /* leave this one embedded */
    }
  }
  return out
}

/** The same doc with its pictures embedded as data, for places that can't reach the store (the phone, exports). */
export async function inlineFiles(html: string): Promise<string> {
  if (!html.includes(FILE_SCHEME)) return html
  let out = html
  for (const hash of new Set(refsIn(html))) {
    const meta = await fileMeta(hash)
    if (!meta || !isImageType(meta.type)) continue // attachments stay references
    const blob = await fileBlob(hash)
    if (blob) out = out.split(`src="${refOf(hash)}"`).join(`src="${await blobDataUrl(blob)}"`)
  }
  return out
}

/** Remove stored files no doc refers to any more (docs in Recently Deleted still count). New files are kept a day. */
export async function collectGarbage(htmls: string[]) {
  const used = new Set(htmls.flatMap(refsIn))
  for (const k of await keys()) {
    if (typeof k !== 'string' || !k.startsWith('file:') || used.has(k.slice(5))) continue
    const r = await get<Rec>(k)
    if (r && Date.now() - r.at > 86_400_000) await del(k)
  }
}

/** For backups: the files the docs use, as base64. */
export async function exportFiles(htmls: string[], encode: (u: Uint8Array) => string) {
  const out: Record<string, FileMeta & { data: string }> = {}
  for (const hash of new Set(htmls.flatMap(refsIn))) {
    const meta = await fileMeta(hash)
    const blob = await fileBlob(hash)
    if (meta && blob) out[hash] = { ...meta, data: encode(new Uint8Array(await blob.arrayBuffer())) }
  }
  return out
}

/** For restoring a backup. */
export async function importFiles(files: Record<string, FileMeta & { data: string }>, decode: (s: string) => Uint8Array) {
  for (const [hash, f] of Object.entries(files)) {
    if (await get(key(hash))) continue
    const blob = new Blob([decode(f.data) as Uint8Array<ArrayBuffer>], { type: f.type })
    await set(key(hash), { data: await sealBlob(blob), name: f.name, type: f.type, size: f.size, at: Date.now() } satisfies Rec)
  }
}
