import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { TextAlign } from '@tiptap/extension-text-align'
import { Typography } from '@tiptap/extension-typography'
import { Markdown } from '@tiptap/markdown'
import { FileImage } from './FileNode'
import { ListSmarts } from './lists'
import { DOMSerializer } from '@tiptap/pm/model'

// Tiptap's getHTML() (run on every save) builds HTML in the page's own document unless told otherwise, so the browser
// starts loading every picture in the doc each time: failed lookups for stored files, and a full decode of every
// embedded photo. Building it in an inert document instead loads nothing. Callers that pass a document keep theirs.
if (typeof document !== 'undefined') {
  const inert = document.implementation.createHTMLDocument('')
  const serialize = DOMSerializer.prototype.serializeFragment
  DOMSerializer.prototype.serializeFragment = function (fragment, options = {}, target) {
    return serialize.call(this, fragment, { document: inert, ...options }, target)
  }
}

/** For the headless converter: never displayed, so its pictures are drawn as nothing (an <img> would start loading). */
const HiddenImage = Image.extend({ addNodeView: () => () => ({ dom: document.createElement('span') }) })

/**
 * Extensions shared by the live editor and the headless Markdown converter, so both produce identical HTML. The live
 * editor's pictures look up stored files (`live`); the converter only needs the plain node.
 */
export const baseExtensions = (live = false) => [
  StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  Highlight.configure({ multicolor: true }),
  (live ? FileImage : HiddenImage).configure({ allowBase64: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Typography,
  Markdown,
  // Keys, typing and paste only: no change to what's saved, so the headless converter doesn't need it.
  ...(live ? [ListSmarts] : []),
]
