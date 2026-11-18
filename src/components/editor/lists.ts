import { Extension, InputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'

/**
 * Lists that behave the way people expect from a doc app (Docs, Notion, Apple Notes):
 *
 *  - **Tab / Shift-Tab** indent and outdent the line, and never move focus out of the doc, even when the line can't
 *    go further.
 *  - **Backspace at the start of a line** takes its bullet away (or, nested, moves it out a level) instead of gluing
 *    it onto the line above.
 *  - **Typing a marker at the start of a line changes the list**: `1. ` in a bulleted list numbers it, `- ` turns a
 *    numbered one back to bullets, `[] ` makes it a checklist. (Before, each nested a new list inside the line.)
 *  - **Pasting plain text** whose lines start with `- `, `* `, `1. ` or `[ ] ` makes a real list, nested by indent.
 */

const ITEMS = ['listItem', 'taskItem'] as const
const LISTS = { bulletList: 'bulletList', orderedList: 'orderedList', taskList: 'taskList' } as const
type ListName = keyof typeof LISTS

/** The list the cursor is in, and whether the cursor is at the very start of its line. */
function where(editor: Editor) {
  const { $from, empty } = editor.state.selection
  let item: string | null = null
  let list: ListName | null = null
  let itemDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (!item && (ITEMS as readonly string[]).includes(name)) (item = name), (itemDepth = d)
    else if (item && name in LISTS) {
      list = name as ListName
      break
    }
  }
  // At the start of the item's first paragraph (not a later paragraph in the same item).
  const atStart = empty && $from.parentOffset === 0 && itemDepth > 0 && $from.index(itemDepth) === 0
  return { item, list, atStart }
}

/** A marker typed at the start of a line already in a list of another kind: change that list instead of nesting. */
function retype(find: RegExp, to: ListName) {
  return new InputRule({
    find,
    handler: ({ state, range, chain }) => {
      const { $from } = state.selection
      let inList: ListName | null = null
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d).type.name
        if (n in LISTS) {
          inList = n as ListName
          break
        }
      }
      // Not in a list, or already this kind: leave it to the usual rules.
      if (!inList || inList === to) return null
      chain().deleteRange(range).run()
      const cmd = chain().focus()
      if (to === 'orderedList') cmd.toggleOrderedList().run()
      else if (to === 'bulletList') cmd.toggleBulletList().run()
      else cmd.toggleTaskList().run()
    },
  })
}

const MARK = /^(\s*)(?:([-*+•])|(\d+)[.)]|\[( |x|X)?\])\s+(.*)$/

/** Plain-text lines as list HTML, nested by indent, or null when the text isn't a list. */
export function textToListHtml(text: string): string | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())
  if (lines.length < 2 || !lines.every((l) => MARK.test(l))) return null
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  type Row = { level: number; kind: ListName; text: string; checked: boolean }
  const rows: Row[] = lines.map((l) => {
    const m = l.match(MARK)!
    const indent = m[1].replace(/\t/g, '  ').length
    const kind: ListName = m[4] !== undefined || /^\[\]/.test(l.trim()) ? 'taskList' : m[3] ? 'orderedList' : 'bulletList'
    return { level: Math.floor(indent / 2), kind, text: m[5], checked: /x/i.test(m[4] ?? '') }
  })
  const open = (k: ListName) => (k === 'taskList' ? '<ul data-type="taskList">' : k === 'orderedList' ? '<ol>' : '<ul>')
  const close = (k: ListName) => (k === 'orderedList' ? '</ol>' : '</ul>')
  const item = (r: Row) => (r.kind === 'taskList' ? `<li data-type="taskItem" data-checked="${r.checked}"><p>${esc(r.text)}</p>` : `<li><p>${esc(r.text)}</p>`)
  let html = ''
  const stack: ListName[] = []
  for (const r of rows) {
    const level = Math.min(r.level, stack.length) // can't skip a level
    while (stack.length > level + 1) html += `</li>${close(stack.pop()!)}`
    if (stack.length === level + 1) {
      if (stack[level] === r.kind) html += '</li>'
      else html += `</li>${close(stack.pop()!)}${open(r.kind)}`, stack.push(r.kind)
    } else {
      html += open(r.kind)
      stack.push(r.kind)
    }
    html += item(r)
  }
  while (stack.length) html += `</li>${close(stack.pop()!)}`
  return html
}

export const ListSmarts = Extension.create({
  name: 'listSmarts',
  // Before the list extensions' own rules and keys.
  priority: 200,

  addKeyboardShortcuts() {
    const sink = () => {
      const w = where(this.editor)
      if (!w.item) return false
      this.editor.commands.sinkListItem(w.item)
      return true // in a list, Tab stays in the doc even when the line can't indent further
    }
    const lift = () => {
      const w = where(this.editor)
      if (!w.item) return false
      this.editor.commands.liftListItem(w.item)
      return true
    }
    return {
      Tab: sink,
      'Shift-Tab': lift,
      Backspace: () => {
        const w = where(this.editor)
        if (!w.item || !w.atStart) return false
        // At the start of a line in a list: the bullet goes (nested lines move out one level).
        return this.editor.commands.liftListItem(w.item)
      },
    }
  },

  addInputRules() {
    return [
      retype(/^(\d+)[.)]\s$/, 'orderedList'),
      retype(/^[-*+•]\s$/, 'bulletList'),
      retype(/^\[( |x)?\]\s$/, 'taskList'),
    ]
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('listPaste'),
        props: {
          handlePaste: (_view, e) => {
            const cd = e.clipboardData
            // Rich content (from a web page or another doc) brings its own lists.
            if (!cd || cd.files.length || cd.getData('text/html')) return false
            const html = textToListHtml(cd.getData('text/plain'))
            if (!html) return false
            editor.chain().focus().insertContent(html).run()
            return true
          },
        },
      }),
    ]
  },
})
