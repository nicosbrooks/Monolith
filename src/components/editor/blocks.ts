import type { Editor } from '@tiptap/core'
import {
  CheckSquare, Code2, Link2, Heading1, Heading2, Heading3, ImageIcon, List, ListOrdered, Minus, PenTool, Quote, PenLine, Paperclip, Table, Type, Wand2, ListChecks, Mic,
} from 'lucide-react'
import { VaultIcon, type AnyIcon } from '../icons'
import { addFile, refOf } from '../../lib/files'
import { pickFromVault } from '../VaultPicker'
import { toast, toastError } from '../Toast'

export interface Block {
  id: string
  label: string
  hint: string
  icon: AnyIcon
  keywords: string
  run: (e: Editor) => void
  ai?: boolean
}

/** Pick files and add them to the doc. `accept` narrows the picker (pictures only for the Image block). */
export function pickFiles(editor: Editor, accept?: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  if (accept) input.accept = accept
  input.onchange = () => insertFiles(editor, [...(input.files ?? [])])
  input.click()
}

/** Whether this editor stores files apart from the doc (set per editor; off for docs kept in a folder, GitHub or Drive). */
const storing = new WeakMap<Editor, boolean>()
export const setStoresFiles = (editor: Editor, on: boolean) => void storing.set(editor, on)

/**
 * Add files to a doc. Normally each goes into the file store and the doc gets a reference: pictures (resized first) show
 * as pictures, anything else as an attachment card. Docs kept as Markdown files elsewhere hold pictures embedded as
 * data, as before, and can't hold other files.
 */
export async function insertFiles(editor: Editor, files: File[], pos?: number) {
  const store = storing.get(editor) ?? true
  type FileNode = { type: 'image'; attrs: { src: string; alt: string } }
  const nodes: FileNode[] = []
  for (const file of files) {
    try {
      if (store) {
        const { ref, name } = await addFile(file)
        nodes.push({ type: 'image', attrs: { src: ref, alt: name } })
      } else if (file.type.startsWith('image/')) {
        nodes.push({ type: 'image', attrs: { src: await readDataUrl(file), alt: file.name } })
      } else toast('Docs kept in a folder, GitHub or Drive can hold pictures, but not other files.')
    } catch (e) {
      toastError((e as Error).message || `Couldn’t add “${file.name}”.`)
    }
  }
  // All at once: an inserted file is selected, so inserting the next one separately would replace it.
  if (!nodes.length || editor.isDestroyed) return
  if (pos !== undefined) editor.chain().focus().insertContentAt(pos, nodes).run()
  else editor.chain().focus().insertContent(nodes).run()
}

/** Link a file that's already in the Vault: the doc gets a link to it; nothing is copied. */
async function linkFromVault(editor: Editor) {
  if (storing.get(editor) === false) return void toast('Docs kept in a folder, GitHub or Drive can’t link to Vault files yet.')
  const at = editor.state.selection.from
  const f = await pickFromVault()
  if (!f || editor.isDestroyed) return
  editor.chain().focus().insertContentAt(at, { type: 'image', attrs: { src: refOf(f.hash), alt: f.name } }).run()
}

const readDataUrl = (f: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })

export const BLOCKS: Block[] = [
  { id: 'p', label: 'Body', hint: 'Plain text', icon: Type, keywords: 'text paragraph body', run: (e) => e.chain().focus().setParagraph().run() },
  { id: 'h1', label: 'Title', hint: 'Large heading', icon: Heading1, keywords: 'h1 heading title', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Heading', hint: 'Section heading', icon: Heading2, keywords: 'h2 heading', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Subheading', hint: 'Small heading', icon: Heading3, keywords: 'h3 subheading', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'todo', label: 'Checklist', hint: 'Track tasks', icon: CheckSquare, keywords: 'todo task check checklist', run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'ul', label: 'Bulleted list', hint: '• item', icon: List, keywords: 'bullet unordered list', run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ol', label: 'Numbered list', hint: '1. item', icon: ListOrdered, keywords: 'numbered ordered list', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'table', label: 'Table', hint: '3 × 3 grid', icon: Table, keywords: 'table grid', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'sketch', label: 'Sketch', hint: 'Draw with pen or finger', icon: PenTool, keywords: 'draw sketch canvas pen handwriting scratch', run: (e) => e.chain().focus().insertSketch().run() },
  { id: 'img', label: 'Image', hint: 'Add a picture', icon: ImageIcon, keywords: 'image photo picture', run: (e) => pickFiles(e, 'image/*') },
  { id: 'file', label: 'File', hint: 'Attach any file', icon: Paperclip, keywords: 'file attachment attach pdf document upload', run: (e) => pickFiles(e) },
  { id: 'vault', label: 'From the Vault', hint: 'Link a file you already have', icon: VaultIcon, keywords: 'vault file link existing attachment picture pdf', run: (e) => void linkFromVault(e) },
  { id: 'record', label: 'Record', hint: 'Record audio into this doc', icon: Mic, keywords: 'record recording audio voice mic microphone meeting lecture transcribe', run: () => {} },
  { id: 'link', label: 'Link to a doc', hint: 'Or type [[', icon: Link2, keywords: 'link doc page mention reference backlink wiki connect', run: (e) => e.chain().focus().insertContent('[[').run() },
  { id: 'quote', label: 'Quote', hint: 'Block quote', icon: Quote, keywords: 'quote blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: 'Monospaced', hint: 'Code block', icon: Code2, keywords: 'code mono monospaced', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'hr', label: 'Divider', hint: 'Horizontal line', icon: Minus, keywords: 'divider hr line separator', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: 'ai-continue', label: 'Continue writing', hint: 'Local AI', icon: PenLine, keywords: 'ai continue write', ai: true, run: () => {} },
  { id: 'ai-summary', label: 'Summarize', hint: 'Local AI', icon: Wand2, keywords: 'ai summary summarize tldr', ai: true, run: () => {} },
  { id: 'ai-tasks', label: 'Extract tasks', hint: 'Local AI', icon: ListChecks, keywords: 'ai tasks todo action items', ai: true, run: () => {} },
]
