import { Image } from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'
import { fileMeta, fileUrl, formatSize, hashOf, isImageType } from '../../lib/files'

const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>'

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
 */
export const FileImage = Image.extend({
  draggable: true,
  addNodeView() {
    return ({ node }) => {
      const dom = el('div', 'file-node')
      dom.contentEditable = 'false'
      dom.dataset.dragHandle = ''
      let current: PMNode = node

      const picture = (src: string, alt: string) => {
        const img = el('img')
        img.src = src
        img.alt = alt
        img.loading = 'lazy'
        img.decoding = 'async'
        dom.replaceChildren(img)
      }
      const card = (hash: string, name: string, type: string, size: number) => {
        const box = el('div', 'file-card')
        const icon = el('span', 'file-icon')
        icon.innerHTML = ICON
        const text = el('div', 'file-text')
        text.append(el('b', undefined, name), el('small', undefined, `${kindOf(name, type)} · ${formatSize(size)}`))
        // The file's address is looked up now, so the buttons act within the click (browsers only open a tab then).
        let url: string | undefined
        void fileUrl(hash).then((u) => (url = u))
        const open = el('button', 'btn sm', 'Open')
        open.type = 'button'
        open.onclick = () => url && window.open(url, '_blank')
        const save = el('button', 'btn sm', 'Download')
        save.type = 'button'
        save.onclick = () => url && Object.assign(document.createElement('a'), { href: url, download: name }).click()
        box.append(icon, text, open, save)
        dom.replaceChildren(box)
      }
      const missing = (name: string) => {
        const box = el('div', 'file-card missing')
        const icon = el('span', 'file-icon')
        icon.innerHTML = ICON
        const text = el('div', 'file-text')
        text.append(el('b', undefined, name || 'File'), el('small', undefined, 'Not on this device'))
        box.append(icon, text)
        dom.replaceChildren(box)
      }

      const render = async (n: PMNode) => {
        const src = String(n.attrs.src ?? '')
        const alt = String(n.attrs.alt ?? '')
        const hash = hashOf(src)
        if (!hash) return picture(src, alt)
        const meta = await fileMeta(hash)
        if (current !== n) return // changed while looking it up
        if (!meta) return missing(alt)
        if (isImageType(meta.type)) {
          const url = await fileUrl(hash)
          if (current === n) (url ? picture(url, alt) : missing(alt))
        } else card(hash, alt || meta.name, meta.type, meta.size)
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
