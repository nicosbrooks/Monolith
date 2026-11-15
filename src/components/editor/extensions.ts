import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { TextAlign } from '@tiptap/extension-text-align'
import { Typography } from '@tiptap/extension-typography'
import { Markdown } from '@tiptap/markdown'

/** Extensions shared by the live editor and the headless Markdown converter, so both produce identical HTML. */
export const baseExtensions = () => [
  StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  Highlight.configure({ multicolor: true }),
  Image.configure({ allowBase64: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Typography,
  Markdown,
]
