import type { Editor } from '@tiptap/core'
import { chat, enqueue, ensureAI, isReady, SYSTEM } from './llm'
import { mdToHtml } from '../lib/util'
import { toast, toastError } from '../components/Toast'

let activeEditor: Editor | null = null
export const setActiveEditor = (e: Editor | null) => (activeEditor = e)
export const getActiveEditor = () => activeEditor

/** Starts the assistant if it isn't running yet; only says something if it can't. */
async function requireModel() {
  if (isReady()) return true
  if (await ensureAI()) return true
  toast('The assistant can’t start in this browser.')
  return false
}

/** Stream model output into the doc at the cursor, then convert Markdown to rich blocks. */
async function streamInto(editor: Editor, prompt: string, opts: { asBlocks?: boolean; temperature?: number } = {}) {
  const from = editor.state.selection.to
  let len = 0
  editor.setEditable(true)
  editor.view.dom.classList.add('ai-writing')
  try {
    const out = await enqueue(() =>
      chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], (full) => {
        const text = full.replace(/\n+/g, ' ')
        editor.chain().insertContentAt({ from, to: from + len }, text, { updateSelection: false }).run()
        len = text.length
      }, { temperature: opts.temperature }),
    )
    if (opts.asBlocks) editor.chain().focus().insertContentAt({ from, to: from + len }, mdToHtml(out)).run()
    return out
  } catch (e) {
    toastError((e as Error).message)
  } finally {
    editor.view.dom.classList.remove('ai-writing')
  }
}

const docText = (e: Editor, max = 6000) => e.getText({ blockSeparator: '\n' }).slice(-max)

export async function runAIBlock(editor: Editor, id: string) {
  if (!(await requireModel())) return
  const before = editor.state.doc.textBetween(Math.max(0, editor.state.selection.from - 2500), editor.state.selection.from, '\n')
  if (id === 'ai-continue') {
    await streamInto(editor, `Continue this text naturally for 1–3 sentences in the same voice. Output ONLY the continuation, no preamble.\n\n---\n${before}`, { temperature: 0.8 })
  } else if (id === 'ai-summary') {
    editor.chain().focus().insertContent('<h3>Summary</h3><p></p>').run()
    await streamInto(editor, `Summarize the following in 3–6 bullet points. Output only Markdown bullets.\n\n---\n${docText(editor)}`, { asBlocks: true })
  } else if (id === 'ai-tasks') {
    editor.chain().focus().insertContent('<h3>Action items</h3><p></p>').run()
    await streamInto(editor, `Extract concrete action items / tasks from this text. Output ONLY a Markdown checklist using "- [ ] task" lines. If none, output "- [ ] Review notes".\n\n---\n${docText(editor)}`, { asBlocks: true })
  }
}

export async function transformSelection(editor: Editor, instruction: string) {
  if (!(await requireModel())) return
  const { from, to } = editor.state.selection
  const text = editor.state.doc.textBetween(from, to, '\n')
  if (!text.trim()) return
  editor.chain().focus().deleteRange({ from, to }).run()
  await streamInto(editor, `${instruction}. Output ONLY the rewritten text, no preamble or quotes.\n\n---\n${text}`, { asBlocks: /list|bullet|table/i.test(instruction) })
}
