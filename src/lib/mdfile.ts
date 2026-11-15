// Pure helpers for Markdown files (no editor dependency, safe to load at startup).

/** Split a Markdown file into front matter, an optional leading "# Title", and the body. */
export function splitFile(text: string): { front?: string; title?: string; body: string } {
  let rest = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  let front: string | undefined
  const fm = rest.match(/^---\n[\s\S]*?\n---\n/)
  if (fm) (front = fm[0]), (rest = rest.slice(fm[0].length))
  const h = rest.match(/^\s*# (.+)\n?/)
  if (h) return { front, title: h[1].trim(), body: rest.slice(h[0].length) }
  return { front, body: rest }
}

export function joinFile(front: string | undefined, title: string | undefined, body: string): string {
  return `${front ?? ''}${title !== undefined ? `# ${title}\n\n` : ''}${body.replace(/^\n+/, '')}`
}

export const basename = (p: string) => p.split('/').pop()!.replace(/\.(md|markdown)$/i, '')
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const safeName = (t: string) => (t.trim() || 'Untitled').replace(/[\\/:*?"<>|#]+/g, '-').replace(/\s+/g, ' ').slice(0, 80)
