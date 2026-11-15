import type { Item } from '../types'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function itemEmoji(item: Item) {
  if (item.file?.dir || item.kind === 'lecture' || item.emoji === '📄' || (item.id === 'doc-guide' && item.emoji === '📘')) return undefined
  return item.emoji
}

export function withoutLegacyTitle(html: string, title: string) {
  const heading = html.match(/^\s*<(h1|p)>([^<]*)<\/\1>/i)
  return title && heading && htmlToText(heading[0]) === title ? html.slice(heading[0].length) : html
}

export function htmlToText(html: string): string {
  if (!html) return ''
  // Keep images and other embedded resources inert while extracting text.
  const template = document.createElement('template')
  template.innerHTML = html.replace(/<\/(p|h\d|li|div|blockquote|pre|tr)>/g, '</$1>\n')
  return (template.content.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

export function extractTags(text: string): string[] {
  const set = new Set<string>()
  for (const m of text.matchAll(/(?:^|\s)#([a-zA-Z][\w-]{1,30})/g)) set.add(m[1].toLowerCase())
  return [...set]
}

export interface Todo {
  itemId: string
  text: string
}

export function extractOpenTodos(html: string, itemId: string): Todo[] {
  if (!html.includes('data-checked')) return []
  const div = document.createElement('div')
  div.innerHTML = html
  return [...div.querySelectorAll('li[data-checked="false"]')]
    .map((li) => ({ itemId, text: (li.textContent || '').trim() }))
    .filter((t) => t.text)
}

export function firstLine(html: string): string {
  const t = htmlToText(html)
  return t.split('\n').find((l) => l.trim()) || ''
}

export function preview(html: string, title: string): string {
  const lines = htmlToText(html).split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines[0] === title) lines.shift()
  return lines.join(' ').slice(0, 140)
}

export function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/** Very small markdown → HTML for AI output (headings, lists, bold, italics, code, checkboxes). */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | 'task' | null = null
  const close = () => {
    if (list) out.push(list === 'ol' ? '</ol>' : '</ul>')
    list = null
  }
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
  for (const raw of lines) {
    const line = raw.trimEnd()
    let m
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      close()
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`)
    } else if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/i))) {
      if (list !== 'task') {
        close()
        out.push('<ul data-type="taskList">')
        list = 'task'
      }
      out.push(`<li data-type="taskItem" data-checked="${m[1].toLowerCase() === 'x'}"><p>${inline(m[2])}</p></li>`)
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') {
        close()
        out.push('<ul>')
        list = 'ul'
      }
      out.push(`<li><p>${inline(m[1])}</p></li>`)
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') {
        close()
        out.push('<ol>')
        list = 'ol'
      }
      out.push(`<li><p>${inline(m[1])}</p></li>`)
    } else if (!line.trim()) {
      close()
    } else {
      close()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  close()
  return out.join('')
}
