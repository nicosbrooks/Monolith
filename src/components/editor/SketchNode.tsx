import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { getStroke } from 'perfect-freehand'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Highlighter, PenLine, Trash2, Undo2, GripHorizontal } from 'lucide-react'

type Stroke = { pts: [number, number, number][]; color: string; size: number; hl?: boolean }

const W = 1000 // logical width; strokes scale to container
const COLORS = ['currentColor', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7']

function pathFor(s: Stroke) {
  const outline = getStroke(s.pts, { size: s.size, thinning: s.hl ? 0 : 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: s.pts.every((p) => p[2] === 0.5) })
  if (!outline.length) return ''
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...outline[0], 'Q'] as (string | number)[],
  )
  d.push('Z')
  return d.join(' ')
}

function SketchView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const strokes: Stroke[] = node.attrs.strokes || []
  const height: number = node.attrs.height
  const [tool, setTool] = useState<'pen' | 'hl' | 'erase'>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [current, setCurrent] = useState<Stroke | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const toLocal = (e: React.PointerEvent): [number, number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale, e.pointerType === 'pen' ? e.pressure : 0.5]
  }

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const keep = strokes.filter((s) => !s.pts.some(([px, py]) => Math.hypot(px - x, py - y) < 14))
      if (keep.length !== strokes.length) updateAttributes({ strokes: keep })
    },
    [strokes, updateAttributes],
  )

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = toLocal(e)
    if (tool === 'erase') return eraseAt(p[0], p[1])
    const c = color === 'currentColor' ? getComputedStyle(ref.current!).color : color
    setCurrent({ pts: [p], color: tool === 'hl' ? (color === 'currentColor' ? '#facc15' : color) : c, size: tool === 'hl' ? 22 : 5, hl: tool === 'hl' })
  }
  const move = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return
    const p = toLocal(e)
    if (tool === 'erase') return eraseAt(p[0], p[1])
    setCurrent((c) => (c ? { ...c, pts: [...c.pts, p] } : c))
  }
  const up = () => {
    if (current && current.pts.length > 1) updateAttributes({ strokes: [...strokes, current] })
    setCurrent(null)
  }

  const resize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const mv = (ev: PointerEvent) => updateAttributes({ height: Math.max(160, Math.min(1400, startH + (ev.clientY - startY) / scale)) })
    const end = () => (window.removeEventListener('pointermove', mv), window.removeEventListener('pointerup', end))
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', end)
  }

  return (
    <NodeViewWrapper className={`sketch ${selected ? 'is-selected' : ''}`} contentEditable={false} data-drag-handle>
      <div className="sketch-tools">
        <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} title="Pen"><PenLine size={15} /></button>
        <button className={tool === 'hl' ? 'on' : ''} onClick={() => setTool('hl')} title="Highlighter"><Highlighter size={15} /></button>
        <button className={tool === 'erase' ? 'on' : ''} onClick={() => setTool('erase')} title="Eraser"><Eraser size={15} /></button>
        <span className="sep" />
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ color: c }} onClick={() => (setColor(c), tool === 'erase' && setTool('pen'))}><i /></button>
        ))}
        <span className="grow" />
        <button onClick={() => updateAttributes({ strokes: strokes.slice(0, -1) })} disabled={!strokes.length} title="Undo stroke"><Undo2 size={15} /></button>
        <button onClick={() => (strokes.length ? updateAttributes({ strokes: [] }) : deleteNode())} title={strokes.length ? 'Clear' : 'Remove sketch'}><Trash2 size={15} /></button>
      </div>
      <svg
        ref={ref}
        className={`sketch-canvas tool-${tool}`}
        style={{ height: height * scale }}
        viewBox={`0 0 ${W} ${height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {[...strokes, ...(current ? [current] : [])].map((s, i) => (
          <path key={i} d={pathFor(s)} fill={s.color} opacity={s.hl ? 0.35 : 1} style={s.hl ? { mixBlendMode: 'multiply' } : undefined} />
        ))}
      </svg>
      <div className="sketch-resize" onPointerDown={resize}><GripHorizontal size={14} /></div>
    </NodeViewWrapper>
  )
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sketch: { insertSketch: () => ReturnType }
  }
}

export const Sketch = Node.create({
  name: 'sketch',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      strokes: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-strokes') || '[]')
          } catch {
            return []
          }
        },
        renderHTML: (a) => ({ 'data-strokes': JSON.stringify(a.strokes) }),
      },
      height: { default: 360, parseHTML: (el) => +(el.getAttribute('data-height') || 360), renderHTML: (a) => ({ 'data-height': a.height }) },
    }
  },
  parseHTML: () => [{ tag: 'div[data-sketch]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-sketch': '' })],
  addNodeView() {
    return ReactNodeViewRenderer(SketchView)
  },
  addCommands() {
    return {
      insertSketch:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name }, { type: 'paragraph' }]),
    }
  },
})
