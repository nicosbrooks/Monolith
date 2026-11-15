import { Editor } from '@tiptap/core'
import { baseExtensions } from '../components/editor/extensions'

// One hidden editor does all conversions, so output matches what the live editor produces.
let ed: Editor | null = null
// It lives in a separate, inert document: in the page's own document, every <img> it builds would start loading.
const conv = () => (ed ??= new Editor({ element: document.implementation.createHTMLDocument('').createElement('div'), extensions: baseExtensions() }))

export function markdownToHtml(md: string): string {
  const e = conv()
  e.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
  return e.getHTML()
}

export function htmlToMarkdown(html: string): string {
  const e = conv()
  e.commands.setContent(html || '<p></p>', { emitUpdate: false })
  // Collapse runs of blank lines (outside code fences) so files stay tidy in diffs.
  const md = e.getMarkdown().split(/(```[\s\S]*?```)/).map((part, i) => (i % 2 ? part : part.replace(/\n{3,}/g, '\n\n'))).join('')
  return md.trim() + '\n'
}
