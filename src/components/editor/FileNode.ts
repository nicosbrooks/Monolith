import { Image } from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Download, ExternalLink, PenLine, Trash2 } from 'lucide-react'
import { fileMeta, fileUrl, formatSize, hashOf, isImageType } from '../../lib/files'
import { openMenu, type MenuItem } from '../Overlays'

// Lucide's shapes, inline (node views are plain DOM): one per kind of file.
const svg = (inner: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const SHEET = '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'
const ICONS = {
  audio: svg('<path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/>'),
  video: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
  image: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  text: svg(SHEET + '<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  archive: svg(SHEET + '<path d="M10 12v-1"/><path d="M10 18v-2"/><path d="M10 7V6"/>'),
  file: svg(SHEET),
}
const MORE = svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>')

function iconFor(name: string, type: string) {
  if (type.startsWith('audio/')) return ICONS.audio
  if (type.startsWith('video/')) return ICONS.video
  if (type.startsWith('image/')) return ICONS.image
  if (/pdf|text|word|document|rtf|markdown|json|csv|sheet|presentation/.test(type) || /\.(md|txt|pdf|docx?|odt|rtf|csv|xlsx?|pptx?|key|pages|numbers)$/i.test(name)) return ICONS.text
  if (/zip|compressed|tar|gzip|7z|rar/.test(type) || /\.(zip|tar|gz|tgz|7z|rar)$/i.test(name)) return ICONS.archive
  return ICONS.file
}

/** "PDF · 2.3 MB" from a file's name and size. */
function kindOf(name: string, type: string) {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : ''
  return ext && ext.length <= 5 ? ext : type.split('/')[1]?.toUpperCase() || 'File'
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/**
 * Pictures and attachments in the live editor. Stored files (`monolith-file:` references, see lib/files.ts) are
 * looked up and shown as a picture or, for any other file, as a card with Open and Download. Pictures embedded as data
 * or linked from the web show as they are. The node itself stays a plain Markdown image either way.
 * Each has a ··· menu: Rename (the name is the Markdown image's alt text), Open, Download and Remove.
 */
export const FileImage = Image.extend({
  draggable: true,
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('div', 'file-node')
      dom.contentEditable = 'false'
      dom.dataset.dragHandle = ''
      let current: PMNode = node
      // The file's address is looked up as soon as it's shown, so menu actions run within the click (browsers only
      // open a tab then).
      let url: string | undefined

      const pos = () => (typeof getPos === 'function' ? getPos() : undefined)
      const rename = () => {
        const name = window.prompt('Name', String(current.attrs.alt || ''))?.trim()
        const at = pos()
        if (!name || at === undefined || !editor.isEditable) return
        editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...current.attrs, alt: name }))
      }
      const remove = () => {
        const at = pos()
        if (at !== undefined) editor.chain().focus().deleteRange({ from: at, to: at + current.nodeSize }).run()
      }
      const open = () => url && window.open(url, '_blank')
      const save = (name: string) => url && Object.assign(document.createElement('a'), { href: url, download: name }).click()
      const menu = (isPicture: boolean, name: string): MenuItem[] => [
        ...(isPicture ? [] : [{ label: 'Rename', icon: PenLine, run: rename }]),
        { label: 'Open', icon: ExternalLink, run: open },
        { label: 'Download', icon: Download, run: () => save(name) },
        'sep',
        { label: 'Remove', icon: Trash2, danger: true, run: remove },
      ]
      const moreButton = (isPicture: boolean, name: string) => {
        const b = el('button', `icon-btn sm file-more${isPicture ? ' on-picture' : ''}`)
        b.type = 'button'
        b.title = 'More'
        b.setAttribute('aria-label', `More for ${name || 'file'}`)
        b.innerHTML = MORE
        b.onclick = (e) => openMenu(e, menu(isPicture, name))
        return b
      }

      const picture = (src: string, alt: string, stored: boolean) => {
        const img = el('img')
        img.src = src
        img.alt = alt
        img.loading = 'lazy'
        img.decoding = 'async'
        dom.replaceChildren(img, ...(stored ? [moreButton(true, alt || 'Picture')] : []))
      }
      const card = (name: string, type: string, size: number) => {
        const box = el('div', 'file-card')
        const icon = el('span', 'file-icon')
        icon.innerHTML = iconFor(name, type)
        const text = el('div', 'file-text')
        text.append(el('b', undefined, name), el('small', undefined, `${kindOf(name, type)} · ${formatSize(size)}`))
        text.title = name
        const openBtn = el('button', 'btn sm', 'Open')
        openBtn.type = 'button'
        openBtn.onclick = open
        box.append(icon, text, openBtn, moreButton(false, name))
        dom.replaceChildren(box)
      }
      const missing = (name: string) => {
        const box = el('div', 'file-card missing')
        const icon = el('span', 'file-icon')
        icon.innerHTML = ICONS.file
        const text = el('div', 'file-text')
        text.append(el('b', undefined, name || 'File'), el('small', undefined, 'Not on this device'))
        box.append(icon, text, moreButton(false, name))
        dom.replaceChildren(box)
      }

      const render = async (n: PMNode) => {
        const src = String(n.attrs.src ?? '')
        const alt = String(n.attrs.alt ?? '')
        const hash = hashOf(src)
        if (!hash) return picture(src, alt, false)
        const meta = await fileMeta(hash)
        if (current !== n) return // changed while looking it up
        if (!meta) return missing(alt)
        url = await fileUrl(hash)
        if (current !== n) return
        if (isImageType(meta.type)) url ? picture(url, alt, true) : missing(alt)
        else card(alt || meta.name, meta.type, meta.size)
      }
      void render(node)

      return {
        dom,
        update: (n) => {
          if (n.type !== node.type) return false
          const changed = n.attrs.src !== current.attrs.src || n.attrs.alt !== current.attrs.alt
          current = n
          if (changed) void render(n)
          return true
        },
        selectNode: () => dom.classList.add('is-selected'),
        deselectNode: () => dom.classList.remove('is-selected'),
        stopEvent: (e) => !!(e.target as HTMLElement | null)?.closest?.('button'),
        ignoreMutation: () => true,
      }
    }
  },
})
