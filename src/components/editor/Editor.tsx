import { useEditor, EditorContent, type Editor as TEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Placeholder } from '@tiptap/extension-placeholder'
import { baseExtensions } from './extensions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough, Code, Link2, Highlighter, MessageCircle, ChevronDown } from 'lucide-react'
import { Sketch } from './SketchNode'
import { BLOCKS, insertImageFile, type Block } from './blocks'
import { runAIBlock, setActiveEditor, transformSelection } from '../../ai/actions'

interface Props {
  html: string
  onChange: (html: string, editor: TEditor) => void
  placeholder?: string
  autofocus?: boolean
  onReady?: (e: TEditor) => void
  className?: string
  /** Block ids to hide from the slash menu (e.g. sketch in Markdown-backed docs) */
  exclude?: string[]
}

const HL = [
  { c: '#fde68a', n: 'Yellow' },
  { c: '#bbf7d0', n: 'Green' },
  { c: '#bfdbfe', n: 'Blue' },
  { c: '#fbcfe8', n: 'Pink' },
  { c: '#ddd6fe', n: 'Purple' },
]

export function Editor({ html, onChange, placeholder, autofocus, onReady, className, exclude }: Props) {
  const [slash, setSlash] = useState<{ q: string; from: number; x: number; y: number } | null>(null)
  const [sel, setSel] = useState(0)
  const slashRef = useRef(slash)
  slashRef.current = slash
  const selRef = useRef(sel)
  selRef.current = sel
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const saveTimer = useRef<number>(0)

  const filtered = useMemo(() => {
    if (!slash) return []
    const q = slash.q.toLowerCase().trim()
    return BLOCKS.filter((b) => !exclude?.includes(b.id)).filter((b) => !q || b.label.toLowerCase().includes(q) || b.keywords.includes(q))
  }, [slash, exclude])
  const filteredRef = useRef(filtered)
  filteredRef.current = filtered

  const runBlock = (editor: TEditor, b: Block) => {
    const s = slashRef.current
    if (s) editor.chain().focus().deleteRange({ from: s.from, to: editor.state.selection.from }).run()
    setSlash(null)
    if (b.ai) runAIBlock(editor, b.id)
    else b.run(editor)
  }

  const editor = useEditor({
    extensions: [
      ...baseExtensions(),
      Placeholder.configure({
        placeholder: ({ node, pos }) =>
          pos === 0 && placeholder ? placeholder : node.type.name === 'heading' ? 'Heading' : 'Type / for blocks…',
        includeChildren: false,
      }),
      Sketch,
    ],
    content: html,
    autofocus: autofocus ? 'end' : false,
    editorProps: {
      attributes: { class: `prose ${className || ''}`, spellcheck: 'true' },
      handleKeyDown: (view, e) => {
        const s = slashRef.current
        if (!s) return false
        const list = filteredRef.current
        if (e.key === 'ArrowDown') return (setSel((i) => (i + 1) % Math.max(1, list.length)), true)
        if (e.key === 'ArrowUp') return (setSel((i) => (i - 1 + list.length) % Math.max(1, list.length)), true)
        if (e.key === 'Escape') return (setSlash(null), true)
        if (e.key === 'Enter' || e.key === 'Tab') {
          const b = list[selRef.current]
          if (b && editorRef.current) {
            runBlock(editorRef.current, b)
            return true
          }
          setSlash(null)
        }
        void view
        return false
      },
      handleDrop: (view, e) => {
        const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length || !editorRef.current) return false
        const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos
        files.forEach((f) => insertImageFile(editorRef.current!, f, pos))
        return true
      },
      handlePaste: (_view, e) => {
        const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length || !editorRef.current) return false
        files.forEach((f) => insertImageFile(editorRef.current!, f))
        return true
      },
    },
    onUpdate: ({ editor }) => {
      detectSlash(editor)
      clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => onChangeRef.current(editor.getHTML(), editor), 250)
    },
    onSelectionUpdate: ({ editor }) => detectSlash(editor),
    onFocus: ({ editor }) => setActiveEditor(editor),
  })
  const editorRef = useRef(editor)
  editorRef.current = editor
  // Tell the parent once we're mounted (not during render, which React warns about).
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  useEffect(() => {
    if (!editor) return
    setActiveEditor(editor)
    onReadyRef.current?.(editor)
  }, [editor])

  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => void (mounted.current = false)
  }, [])
  function detectSlash(editor: TEditor) {
    if (!mounted.current) return // the editor fires selection events while it is still being created
    const { $from, empty } = editor.state.selection
    if (!empty || $from.parent.type.name === 'codeBlock') return setSlash(null)
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    const m = before.match(/(?:^|\s)\/([\w ]{0,20})$/)
    if (!m || m[1].endsWith('  ')) return setSlash(null)
    const coords = editor.view.coordsAtPos($from.pos)
    setSlash((prev) => {
      if (!prev || prev.q !== m[1]) setSel(0)
      return { q: m[1], from: $from.pos - m[1].length - 1, x: coords.left, y: coords.bottom }
    })
  }

  // flush pending save on unmount
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current)
      const e = editorRef.current
      if (e && !e.isDestroyed) onChangeRef.current(e.getHTML(), e)
    },
    [],
  )

  if (!editor) return null

  return (
    <div className="editor-wrap">
      <BubbleMenu
        editor={editor}
        className="bubble"
        shouldShow={({ editor, state }) => !state.selection.empty && !editor.isActive('sketch') && !editor.isActive('image')}
      >
        <FormatButtons editor={editor} />
      </BubbleMenu>
      <EditorContent editor={editor} />
      {slash && filtered.length > 0 && (
        <div className="slash-menu" style={{ left: Math.min(slash.x, window.innerWidth - 290), top: Math.min(slash.y + 6, window.innerHeight - 340) }}>
          {filtered.map((b, i) => (
            <button
              key={b.id}
              className={i === sel ? 'on' : ''}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => (e.preventDefault(), runBlock(editor, b))}
              ref={i === sel ? (el) => { el?.scrollIntoView({ block: 'nearest' }) } : undefined}
            >
              <span className={`ico ${b.ai ? 'ai' : ''}`}><b.icon size={16} /></span>
              <span className="lbl">{b.label}<small>{b.hint}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FormatButtons({ editor }: { editor: TEditor }) {
  const [menu, setMenu] = useState<null | 'hl' | 'ai' | 'link'>(null)
  const [url, setUrl] = useState('')
  const applyLink = () => {
    const href = url.trim()
    if (!href) c().unsetLink().run()
    else c().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|\/|#)/i.test(href) ? href : `https://${href}` }).run()
    setMenu(null)
  }
  const btn = (on: boolean, fn: () => void, icon: React.ReactNode, title: string) => (
    <button className={on ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), fn())} title={title}>{icon}</button>
  )
  const c = () => editor.chain().focus()
  return (
    <>
      {btn(editor.isActive('bold'), () => c().toggleBold().run(), <Bold size={15} />, 'Bold ⌘B')}
      {btn(editor.isActive('italic'), () => c().toggleItalic().run(), <Italic size={15} />, 'Italic ⌘I')}
      {btn(editor.isActive('underline'), () => c().toggleUnderline().run(), <Underline size={15} />, 'Underline ⌘U')}
      {btn(editor.isActive('strike'), () => c().toggleStrike().run(), <Strikethrough size={15} />, 'Strikethrough')}
      {btn(editor.isActive('code'), () => c().toggleCode().run(), <Code size={15} />, 'Inline code')}
      <div className="bubble-drop">
        {btn(editor.isActive('link'), () => (setUrl(editor.getAttributes('link').href || ''), setMenu(menu === 'link' ? null : 'link')), <Link2 size={15} />, 'Link')}
        {menu === 'link' && (
          <form className="drop link-form" onSubmit={(e) => (e.preventDefault(), applyLink())}>
            <input autoFocus placeholder="Paste or type a link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setMenu(null), editor.commands.focus())} />
            <button className="btn sm primary" type="submit">{url.trim() ? 'Apply' : 'Remove'}</button>
            {editor.isActive('link') && url.trim() && (
              <button className="btn sm" type="button" onMouseDown={(e) => (e.preventDefault(), c().extendMarkRange('link').unsetLink().run(), setMenu(null))}>Remove</button>
            )}
          </form>
        )}
      </div>
      <div className="bubble-drop">
        {btn(editor.isActive('highlight'), () => setMenu(menu === 'hl' ? null : 'hl'), <Highlighter size={15} />, 'Highlight')}
        {menu === 'hl' && (
          <div className="drop">
            {HL.map((h) => (
              <button key={h.c} onMouseDown={(e) => (e.preventDefault(), c().toggleHighlight({ color: h.c }).run(), setMenu(null))}>
                <i style={{ background: h.c }} /> {h.n}
              </button>
            ))}
            <button onMouseDown={(e) => (e.preventDefault(), c().unsetHighlight().run(), setMenu(null))}>None</button>
          </div>
        )}
      </div>
      <span className="sep" />
      <div className="bubble-drop">
        <button className="ai-btn" onMouseDown={(e) => (e.preventDefault(), setMenu(menu === 'ai' ? null : 'ai'))}>
          <MessageCircle size={14} /> Ask AI <ChevronDown size={12} />
        </button>
        {menu === 'ai' && (
          <div className="drop">
            {[
              ['Improve writing', 'Rewrite this to be clearer and more concise'],
              ['Fix spelling & grammar', 'Fix spelling and grammar only, keep wording'],
              ['Explain simply', 'Explain this simply, like a great tutor, in 2–4 sentences'],
              ['Make bullet points', 'Convert this into a concise Markdown bullet list'],
              ['Make shorter', 'Make this about half as long'],
              ['Translate to English', 'Translate this to English'],
            ].map(([l, p]) => (
              <button key={l} onMouseDown={(e) => (e.preventDefault(), setMenu(null), transformSelection(editor, p))}>{l}</button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
