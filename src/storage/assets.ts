import { get, set } from 'idb-keyval'
import { fileBlob, fileMeta, putFile, refOf } from '../lib/files'
import type { FileProvider } from './types'

/**
 * Files in docs that live in a connected folder. In Monolith a doc refers to a stored file (`monolith-file:<hash>`,
 * see lib/files.ts); in the folder, the same file sits in an `assets` folder beside the doc and the Markdown links to it
 * relatively, `![photo.jpg](assets/1a2b3c4d-photo.webp)`, the way other Markdown apps (Obsidian, VS Code, GitHub)
 * expect. Writing turns references into those links (and writes each file once); reading turns links back into
 * references (storing each file once).
 */

const EXT: Record<string, string> = {
  'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/heic': 'heic', 'image/avif': 'avif',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md', 'application/json': 'json', 'application/zip': 'zip',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
}
const TYPE: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]))
TYPE.jpeg = 'image/jpeg'
TYPE.txt = 'text/plain'

/** The file's name in the folder: short hash (unique), then a readable name with the extension its content has. */
function assetName(hash: string, name: string, type: string) {
  const dot = name.lastIndexOf('.')
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file'
  // A picture re-encoded as WebP keeps its name but not its old extension.
  const ext = EXT[type] ?? (dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^\w]/g, '') : '') ?? ''
  return `${hash.slice(0, 8)}-${base}${ext ? '.' + ext : ''}`
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const join = (dir: string, rel: string) => {
  const out: string[] = dir ? dir.split('/') : []
  for (const part of rel.split('/')) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

/**
 * Where each file already lives in a folder (content hash → path from the folder's root), so a file that was there
 * first (an Obsidian vault's `assets/chart.png`) is linked where it is, never copied under a new name.
 */
const placesKey = (sourceId: string) => `asset-places:${sourceId}`
async function places(sourceId: string) {
  return (await get<Record<string, string>>(placesKey(sourceId))) ?? {}
}
/** `to` (from the folder root) as seen from the folder `fromDir`: "assets/x.png", "../img/x.png". */
function relative(fromDir: string, to: string) {
  const a = fromDir ? fromDir.split('/') : []
  const b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/')
}

/** Asset paths already written this session, per folder, so saving a doc doesn't rewrite its pictures every time. */
const written = new Map<string, Set<string>>()

/** For writing a doc at `docPath`: its stored files written to the folder, and its references made relative links. */
export async function exportAssets(sourceId: string, p: FileProvider, html: string, docPath: string): Promise<string> {
  if (!p.writeFile || !html.includes('monolith-file:')) return html
  const done = written.get(sourceId) ?? new Set<string>()
  written.set(sourceId, done)
  const known = await places(sourceId)
  let out = html
  let learned = false
  for (const hash of new Set([...html.matchAll(/monolith-file:([0-9a-f]+)/g)].map((m) => m[1]))) {
    const meta = await fileMeta(hash)
    if (!meta) continue // not on this device: keep the reference
    // Already in the folder (read from it, or written before): link it there, if it's still there.
    const existing = known[hash]
    if (existing && (done.has(existing) || (await p.readFile?.(existing).catch(() => null))?.size === meta.size)) {
      done.add(existing)
      out = out.split(`src="${refOf(hash)}"`).join(`src="${relative(dirOf(docPath), existing)}"`)
      continue
    }
    const rel = `assets/${assetName(hash, meta.name, meta.type)}`
    const path = join(dirOf(docPath), rel)
    known[hash] = path
    learned = true
    if (!done.has(path)) {
      const there = await p.readFile?.(path).catch(() => null)
      if (!there || there.size !== meta.size) {
        const blob = await fileBlob(hash)
        if (!blob) continue
        await p.writeFile(path, blob)
      }
      done.add(path)
    }
    out = out.split(`src="${refOf(hash)}"`).join(`src="${rel}"`)
  }
  if (learned) await set(placesKey(sourceId), known)
  return out
}

const RELATIVE = /^(?![a-z][a-z0-9+.-]*:|\/|#)/i

/** For reading a doc at `docPath`: pictures and files it links relatively, stored and referred to like any other. */
export async function importAssets(sourceId: string, p: FileProvider, html: string, docPath: string): Promise<string> {
  if (!p.readFile || !/<img[^>]+src="(?![a-z][a-z0-9+.-]*:|\/|#)/i.test(html)) return html
  const tpl = document.createElement('template') // inert: nothing in it loads
  tpl.innerHTML = html
  let changed = false
  const known = await places(sourceId)
  for (const img of tpl.content.querySelectorAll('img')) {
    const src = img.getAttribute('src') || ''
    if (!src || !RELATIVE.test(src)) continue
    const path = join(dirOf(docPath), decodeURIComponent(src))
    const found = await p.readFile(path).catch(() => null)
    if (!found) continue // missing in the folder: leave the link as it is
    const name = img.getAttribute('alt') || path.split('/').pop()!.replace(/^[0-9a-f]{8}-/, '')
    const ext = path.split('.').pop()!.toLowerCase()
    const typed = found.type ? found : new Blob([found], { type: TYPE[ext] ?? 'application/octet-stream' })
    const ref = await putFile(typed, name)
    known[ref.slice(ref.indexOf(':') + 1)] = path // linked where it is when the doc is saved
    img.setAttribute('src', ref)
    changed = true
  }
  if (changed) await set(placesKey(sourceId), known)
  return changed ? tpl.innerHTML : html
}
