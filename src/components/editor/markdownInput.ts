import { Extension, InputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { textToListHtml } from './lists'

/**
 * Nobody has to write Markdown here: every format is in the toolbar and the / menu. But people who know it type it
 * out of habit, and text copied from chats, READMEs and notes apps is full of it, so it's read wherever it turns up:
 *
 *  - **Typed**: headings, lists, quotes, code, dividers, bold, italic, strike, code and highlight come from the editor's
 *    own rules. This adds `[words](address)`, which becomes a link as the `)` is typed.
 *  - **Pasted** as plain text: Markdown becomes formatted text (lists nest by indent), never symbols on the page.
 */

/** Plain text that reads as Markdown: a heading, list, quote, fence, table or divider line, or inline marks. */
export function looksLikeMarkdown(text: string): boolean {
  const block = /^(#{1,6}\s+\S|\s*([-*+]|\d+[.)])\s+\S|>\s?\S|```|\|.+\||(-{3,}|\*{3,}|_{3,})\s*$|\s*[-*]\s+\[[ xX]\]\s)/m
  const inline = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|(^|\s)\*[^*\s][^*\n]*\*(?=\s|$|[.,!?]))/
  return block.test(text) || inline.test(text)
}

const href = (a: string) => (/^(https?:|mailto:|\/|#)/i.test(a) ? a : `https://${a}`)

export const MarkdownInput = Extension.create({
  name: 'markdownInput',
  // Before the list rules, so a pasted list is read as a whole.
  priority: 210,

  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\][\n]+)\]\(([^)\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const link = state.schema.marks.link
          if (!link) return null
          const mark = link.create({ href: href(match[2]) })
          state.tr.replaceWith(range.from, range.to, state.schema.text(match[1], [mark])).removeStoredMark(link)
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste: (view, e) => {
            const cd = e.clipboardData
            // Rich content (from a web page or another doc) brings its own formatting.
            if (!cd || cd.files.length || cd.getData('text/html')) return false
            const text = cd.getData('text/plain')
            if (!text.trim()) return false
            // Inside code, text stays as it is.
            const { $from } = view.state.selection
            if ($from.parent.type.spec.code) return false
            const list = textToListHtml(text)
            if (list) return editor.chain().focus().insertContent(list).run()
            if (!looksLikeMarkdown(text)) return false
            return editor.chain().focus().insertContent(text, { contentType: 'markdown' }).run()
          },
        },
      }),
    ]
  },
})
