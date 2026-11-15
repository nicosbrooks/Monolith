import type { Editor } from '@tiptap/core'
import {
  CheckSquare, Code2, Heading1, Heading2, Heading3, ImageIcon, List, ListOrdered, Minus, PenTool, Quote, PenLine, Table, Type, Wand2, ListChecks,
  type LucideIcon,
} from 'lucide-react'

export interface Block {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  keywords: string
  run: (e: Editor) => void
  ai?: boolean
}

export function pickImage(editor: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const f = input.files?.[0]
    if (f) insertImageFile(editor, f)
  }
  input.click()
}

export function insertImageFile(editor: Editor, file: File, pos?: number) {
  const r = new FileReader()
  r.onload = () => {
    const node = { type: 'image', attrs: { src: r.result as string, alt: file.name } }
    if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run()
    else editor.chain().focus().insertContent(node).run()
  }
  r.readAsDataURL(file)
}

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
  { id: 'img', label: 'Image', hint: 'Upload a picture', icon: ImageIcon, keywords: 'image photo picture attachment', run: (e) => pickImage(e) },
  { id: 'quote', label: 'Quote', hint: 'Block quote', icon: Quote, keywords: 'quote blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: 'Monospaced', hint: 'Code block', icon: Code2, keywords: 'code mono monospaced', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'hr', label: 'Divider', hint: 'Horizontal line', icon: Minus, keywords: 'divider hr line separator', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: 'ai-continue', label: 'Continue writing', hint: 'Local AI', icon: PenLine, keywords: 'ai continue write', ai: true, run: () => {} },
  { id: 'ai-summary', label: 'Summarize', hint: 'Local AI', icon: Wand2, keywords: 'ai summary summarize tldr', ai: true, run: () => {} },
  { id: 'ai-tasks', label: 'Extract tasks', hint: 'Local AI', icon: ListChecks, keywords: 'ai tasks todo action items', ai: true, run: () => {} },
]
