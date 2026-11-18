import { loadAudio, useStore } from '../store'
import type { CalEvent, Item } from '../types'
import { APP_NAME } from '../brand'
import { fileBlob, fileMeta, FILE_SCHEME } from './files'
import { htmlToMarkdown } from './markdown'
import { formatDuration } from './util'
import { doneTasks, openTasks } from './tasks'

/**
 * Everything, in formats any other app can open: a zip of Markdown files laid out like the sidebar (folders, then
 * sub-docs inside their parent), with pictures and attachments beside them, recordings as Markdown plus their audio,
 * and the calendar as one .ics file. Not encrypted and not a backup (the backup file restores the app exactly); this is
 * the way out, so nothing written here is ever locked in.
 *
 * Links between docs become relative links between the files, so they still work in any Markdown editor.
 */

// ─── A small zip writer (stored, no compression: Markdown is tiny and media is already compressed) ───

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(u: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const enc = new TextEncoder()

export function zip(files: { path: string; data: Uint8Array; at?: number }[]): Blob {
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.path)
    const d = new Date(f.at ?? Date.now())
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    const crc = crc32(f.data)
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true) // names are UTF-8
    head.setUint16(8, 0, true)
    head.setUint16(10, time, true)
    head.setUint16(12, date, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, f.data.length, true)
    head.setUint32(22, f.data.length, true)
    head.setUint16(26, name.length, true)
    parts.push(head.buffer, name as Uint8Array<ArrayBuffer>, f.data as Uint8Array<ArrayBuffer>)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint16(12, time, true)
    cd.setUint16(14, date, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, f.data.length, true)
    cd.setUint32(24, f.data.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...(central as Uint8Array<ArrayBuffer>[]), end.buffer], { type: 'application/zip' })
}

// ─── Where each doc goes ───

const clean = (s: string) => (s.trim() || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').slice(0, 80).trim() || 'Untitled'
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' }

/** A path for every doc and recording, unique, shaped like the sidebar. */
export function layout(items: Item[], folderName: (id: string | null) => string | undefined): Map<string, string> {
  const live = items.filter((i) => !i.deletedAt && !i.file?.dir)
  const byId = new Map(live.map((i) => [i.id, i]))
  const kids = new Set(live.filter((i) => i.parentId && byId.has(i.parentId)).map((i) => i.parentId!))
  const dirOf = (i: Item): string => {
    if (i.kind === 'lecture') return 'Recordings'
    const parent = i.parentId ? byId.get(i.parentId) : undefined
    // A doc with sub-docs gets a folder of its own name, holding it and them.
    if (parent) return `${dirOf(parent)}/${clean(parent.title)}`
    const folder = folderName(i.folderId)
    return folder ? `Docs/${clean(folder)}` : 'Docs'
  }
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const i of live) {
    const dir = kids.has(i.id) ? `${dirOf(i)}/${clean(i.title)}` : dirOf(i)
    let path = `${dir}/${clean(i.title)}.md`
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${dir}/${clean(i.title)} ${n}.md`
    used.add(path.toLowerCase())
    out.set(i.id, path)
  }
  return out
}

/** A link from one file to another in the zip, e.g. `../School/Essay.md`, with spaces safe for Markdown. */
function relative(from: string, to: string) {
  const a = from.split('/').slice(0, -1)
  const b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].map(encodeURIComponent).join('/')
}

// ─── The calendar as .ics ───

const pad = (n: number) => String(n).padStart(2, '0')
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` }
const local = (t: number) => { const d = new Date(t); return `${day(t)}T${pad(d.getHours())}${pad(d.getMinutes())}00` }
const utc = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')

export function toIcs(events: CalEvent[], now = Date.now()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const when = (name: string, t: number, allDay?: boolean) => (allDay ? `${name};VALUE=DATE:${day(t)}` : `${name};TZID=${zone}:${local(t)}`)
  const rule = (e: CalEvent) => {
    if (!e.repeat) return []
    const freq = { day: 'FREQ=DAILY', weekday: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', week: 'FREQ=WEEKLY', '2weeks': 'FREQ=WEEKLY;INTERVAL=2', month: 'FREQ=MONTHLY', year: 'FREQ=YEARLY' }[e.repeat.every]
    return [`RRULE:${freq}${e.repeat.until ? `;UNTIL=${utc(e.repeat.until)}` : ''}`, ...(e.skip ?? []).map((s) => when('EXDATE', s, e.allDay))]
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${APP_NAME}//EN`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${APP_NAME}`]
  for (const e of events) {
    if (e.calId) continue // subscribed calendars live where they came from
    lines.push('BEGIN:VEVENT', `UID:${e.id}@monolith`, `DTSTAMP:${utc(now)}`, when('DTSTART', e.start, e.allDay), when('DTEND', e.end, e.allDay), `SUMMARY:${text(e.title || 'Untitled')}`)
    if (e.location) lines.push(`LOCATION:${text(e.location)}`)
    if (e.notes) lines.push(`DESCRIPTION:${text(e.notes)}`)
    lines.push(...rule(e), 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// ─── Putting it together ───

export interface Exported { blob: Blob; name: string; docs: number; recordings: number; files: number; events: number; tasks: number }

export async function exportAll(): Promise<Exported> {
  const st = useStore.getState()
  const live = st.items.filter((i) => !i.deletedAt && !i.file?.dir)
  const paths = layout(st.items, (id) => st.folders.find((f) => f.id === id)?.name)
  const out: { path: string; data: Uint8Array; at?: number }[] = []
  const assets = new Map<string, string>() // file hash → its path in the zip
  const usedNames = new Set<string>()

  for (const item of live) {
    const path = paths.get(item.id)!
    let md = htmlToMarkdown(item.content)
    // Links to other docs become links to their files; a link to something deleted keeps its words.
    md = md.replace(/\]\(#doc\/([^)\s]+)\)/g, (_m, id: string) => (paths.has(id) ? `](${relative(path, paths.get(id)!)})` : ']()'))
    // Pictures and attachments are written once under Files/ and pointed at from each doc that uses them.
    const hashes = new Set([...md.matchAll(new RegExp(`${FILE_SCHEME}([0-9a-f]+)`, 'g'))].map((m) => m[1]))
    for (const hash of hashes) {
      if (!assets.has(hash)) {
        const [meta, blob] = await Promise.all([fileMeta(hash), fileBlob(hash)])
        if (!meta || !blob) continue
        const dot = meta.name.lastIndexOf('.')
        const base = clean(dot > 0 ? meta.name.slice(0, dot) : meta.name)
        const ext = dot > 0 ? meta.name.slice(dot + 1).toLowerCase() : EXT[meta.type] ?? 'bin'
        let p = `Files/${base}.${ext}`
        for (let n = 2; usedNames.has(p.toLowerCase()); n++) p = `Files/${base} ${n}.${ext}`
        usedNames.add(p.toLowerCase())
        assets.set(hash, p)
        out.push({ path: p, data: new Uint8Array(await blob.arrayBuffer()), at: item.updatedAt })
      }
      md = md.replaceAll(`${FILE_SCHEME}${hash}`, relative(path, assets.get(hash)!))
    }
    let body = `# ${item.title || 'Untitled'}\n\n${md}`
    if (item.kind === 'lecture' && item.lecture) {
      const audio = item.lecture.hasAudio ? await loadAudio(item.id).catch(() => undefined) : undefined
      if (audio) {
        const p = path.replace(/\.md$/, `.${EXT[audio.type.split(';')[0]] ?? 'webm'}`)
        out.push({ path: p, data: new Uint8Array(await audio.arrayBuffer()), at: item.createdAt })
        body += `\n[Audio](${relative(path, p)})\n`
      }
      if (item.lecture.transcript.length) body += `\n## Transcript\n\n${item.lecture.transcript.map((s) => `**${formatDuration(s.start)}** ${s.text.trim()}`).join('\n\n')}\n`
    }
    out.push({ path, data: enc.encode(body), at: item.updatedAt })
  }
  const own = st.events.filter((e) => !e.calId)
  if (own.length) out.push({ path: 'Calendar.ics', data: enc.encode(toIcs(own)) })
  // Tasks as one checklist, open ones first, each with its date and the doc it goes with.
  const tasks = [...openTasks(st.tasks), ...doneTasks(st.tasks)]
  if (tasks.length) {
    const line = (t: (typeof tasks)[number]) => {
      const doc = t.docId && paths.get(t.docId)
      const bits = [t.due !== undefined && `due ${new Date(t.due).toISOString().slice(0, t.allDay ? 10 : 16).replace('T', ' ')}`, doc && `[${st.items.find((i) => i.id === t.docId)?.title || 'Untitled'}](${relative('Tasks.md', doc)})`].filter(Boolean)
      const notes = t.notes ? `\n${t.notes.split('\n').map((l) => `  ${l}`).join('\n')}` : ''
      return `- [${t.done ? 'x' : ' '}] ${t.title}${bits.length ? ` (${bits.join(', ')})` : ''}${notes}`
    }
    out.push({ path: 'Tasks.md', data: enc.encode(`# Tasks\n\n${tasks.map(line).join('\n')}\n`) })
  }
  const d = new Date()
  return {
    blob: zip(out.map((f) => ({ ...f, path: `${APP_NAME}/${f.path}` }))),
    name: `${APP_NAME} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`,
    docs: live.filter((i) => i.kind !== 'lecture').length,
    recordings: live.filter((i) => i.kind === 'lecture').length,
    files: assets.size,
    events: own.length,
    tasks: tasks.length,
  }
}
