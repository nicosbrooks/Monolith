import type { Item } from '../types'
import { htmlToText } from '../lib/util'

/**
 * Files attached to the Ask bar, read as text so the assistant can use them as evidence. A file is never pasted whole
 * (the model's window is small): it becomes a temporary doc, and each question gets the passages that match it, the
 * same way it does for your own docs (context.ts, `fileEvidence`). Nothing is stored or uploaded; the text lives in
 * the conversation and goes with it.
 */

export interface Attached {
  id: string
  name: string
  size: number
  /** Characters of text kept. */
  chars: number
  /** The file as a temporary doc, so the passage search can read it like any other. */
  item: Item
  /** A picture, as a small data URL: shown on its chip and given to a model that can see. */
  image?: string
  /** Something worth telling the person (a scanned PDF with no text, say). */
  note?: string
}

/** Most files in one conversation, the largest file we read, and the most text kept from one. */
export const MAX_FILES = 5
export const MAX_BYTES = 25 * 1024 * 1024
const MAX_CHARS = 200_000

export const ACCEPT =
  'application/pdf,.pdf,image/*,.docx,.pptx,.xlsx,.odt,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.html,.htm,.ics,.log,.srt,.vtt,.yaml,.yml,.toml,.ini,.tex,.sql,.js,.ts,.tsx,.jsx,.py,.c,.h,.cpp,.java,.go,.rs,.swift,.sh,.css,text/*'

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|ics|log|srt|vtt|ya?ml|toml|ini|tex|sql|js|ts|tsx|jsx|py|c|h|cpp|java|go|rs|swift|sh|css)$/i
const KNOWN_BINARY = /\.(docx?|xlsx?|pptx?|pages|key|numbers|odt|zip|png|jpe?g|gif|webp|heic|mp[34]|m4a|mov|wav)$/i

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
let n = 0

export type Read = { ok: Attached } | { error: string }

const IMAGE = /^image\/(png|jpeg|webp|gif)$/
const OFFICE = /\.(docx|pptx|xlsx|odt)$/i

/** A picture shrunk to fit 512 px (what small vision models take) as a data URL. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k))
  c.height = Math.max(1, Math.round(bmp.height * k))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/jpeg', 0.85)
}

function make(name: string, size: number, text: string, extra: Partial<Attached> = {}): Read {
  text = text.replace(/\r\n?/g, '\n').trim()
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)
  const id = `attach:${++n}`
  const now = Date.now()
  const item: Item = { id, kind: 'doc', title: name, content: text.split('\n').filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`).join(''), folderId: null, parentId: null, pinned: false, tags: [], createdAt: now, updatedAt: now }
  return { ok: { id, name, size, chars: text.length, item, ...extra } }
}

/** Read one file: text, PDFs, Word/PowerPoint/Excel files and pictures. Anything else gets a plain reason. */
export async function readAttachment(file: File): Promise<Read> {
  const { name, type } = file
  if (file.size > MAX_BYTES) return { error: `“${name}” is larger than ${MAX_BYTES / 1024 / 1024} MB.` }
  try {
    if (IMAGE.test(type)) return make(name, file.size, `[Picture: ${name}]`, { image: await shrink(file), note: 'Only a model that can see pictures can read this.' })
    if (/pdf/i.test(type) || /\.pdf$/i.test(name)) {
      const r = await (await import('./extract')).pdfText(await file.arrayBuffer())
      if (!r.text) return { error: `“${name}” has no text to read (it looks scanned).` }
      return make(name, file.size, r.text, r.empty ? { note: `${r.empty} of ${r.pages} pages had no text (scanned).` } : {})
    }
    if (OFFICE.test(name)) {
      const text = await (await import('./extract')).officeText(await file.arrayBuffer(), name)
      return text.trim() ? make(name, file.size, text) : { error: `“${name}” has no text to read.` }
    }
  } catch {
    return { error: `Couldn't read “${name}”.` }
  }
  const texty = type.startsWith('text/') || /json|xml|csv|javascript|yaml|markdown/.test(type) || TEXT_EXT.test(name)
  if (!texty || KNOWN_BINARY.test(name)) return { error: `“${name}” can't be read. PDFs, pictures, Word, PowerPoint, Excel, text, Markdown, CSV and JSON files work.` }
  let text: string
  try {
    text = await file.text()
  } catch {
    return { error: `Couldn't read “${name}”.` }
  }
  // Binary data decodes to NULs and replacement characters.
  const head = text.slice(0, 4000)
  if (head.length && (head.match(/[\u0000�]/g)?.length ?? 0) / head.length > 0.01) return { error: `“${name}” isn't a text file.` }
  if (/\.html?$/i.test(name) || type === 'text/html') text = htmlToText(text)
  return text.trim() ? make(name, file.size, text) : { error: `“${name}” is empty.` }
}

export const sizeLabel = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
