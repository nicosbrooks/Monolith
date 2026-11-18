import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import type { AnyIcon } from './icons'

// ─── Confirm dialog ────────────────────────────────────────────────────────

interface ConfirmOpts { title: string; body?: string; confirm?: string; danger?: boolean }
const useConfirm = create<{ cur: (ConfirmOpts & { done: (ok: boolean) => void }) | null }>(() => ({ cur: null }))

/** In-app replacement for window.confirm. Resolves true if the user confirms. */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((done) => useConfirm.setState({ cur: { ...opts, done } }))
}

function ConfirmHost() {
  const cur = useConfirm((s) => s.cur)
  const close = (ok: boolean) => (cur?.done(ok), useConfirm.setState({ cur: null }))
  useEffect(() => {
    if (!cur) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.stopPropagation(), close(false))
      if (e.key === 'Enter') (e.preventDefault(), close(true))
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })
  return (
    <AnimatePresence>
      {cur && (
        <motion.div className="overlay top" onMouseDown={() => close(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <motion.div className="confirm" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, scale: 0.96, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.14 }}>
            <h3>{cur.title}</h3>
            {cur.body && <p>{cur.body}</p>}
            <div className="row end">
              <button className="btn sm" onClick={() => close(false)}>Cancel</button>
              <button autoFocus className={`btn sm ${cur.danger ? 'danger solid' : 'primary'}`} onClick={() => close(true)}>{cur.confirm || 'Confirm'}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Context menu ──────────────────────────────────────────────────────────

export type MenuItem = { label: string; icon?: AnyIcon; run: () => void; danger?: boolean; checked?: boolean; hint?: string } | 'sep' | { heading: string }
const useMenu = create<{ cur: { x: number; y: number; items: MenuItem[] } | null }>(() => ({ cur: null }))

/** Open a menu at the pointer. Use from onContextMenu, or from a "more" button click. */
export function openMenu(e: { preventDefault(): void; clientX: number; clientY: number; currentTarget?: EventTarget | null }, items: MenuItem[]) {
  e.preventDefault()
  let { clientX: x, clientY: y } = e
  // Opened from the keyboard (Enter or Space on a button): no pointer position, so open just under the button.
  const el = e.currentTarget as HTMLElement | null
  if (!x && !y && el?.getBoundingClientRect) {
    const r = el.getBoundingClientRect()
    x = r.left
    y = r.bottom + 4
  }
  useMenu.setState({ cur: { x, y, items } })
}

function MenuHost() {
  const cur = useMenu((s) => s.cur)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const close = () => useMenu.setState({ cur: null })
  useLayoutEffect(() => {
    if (!cur || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.max(8, Math.min(cur.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(cur.y, innerHeight - r.height - 8)) })
  }, [cur])
  useEffect(() => {
    if (!cur) return
    const k = (e: KeyboardEvent) => {
      const btns = [...(ref.current?.querySelectorAll('button') || [])]
      const i = btns.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'Escape') (e.stopPropagation(), close())
      else if (e.key === 'ArrowDown') (e.preventDefault(), btns[(i + 1) % btns.length]?.focus())
      else if (e.key === 'ArrowUp') (e.preventDefault(), btns[(i - 1 + btns.length) % btns.length]?.focus())
    }
    window.addEventListener('keydown', k, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => (window.removeEventListener('keydown', k, true), window.removeEventListener('resize', close), window.removeEventListener('blur', close))
  }, [cur])
  if (!cur) return null
  return (
    <div className="menu-layer" onMouseDown={close} onContextMenu={(e) => (e.preventDefault(), close())} onWheel={close}>
      <div ref={ref} className="drop ctx" role="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        {cur.items.map((it, i) =>
          it === 'sep' ? (
            <div key={i} className="drop-sep" />
          ) : 'heading' in it ? (
            <div key={i} className="drop-head">{it.heading}</div>
          ) : (
            <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => (close(), it.run())}>
              {it.icon ? <it.icon size={14} /> : <span className="ico-gap" />}
              <span>{it.label}</span>
              {it.checked && <span className="tick">✓</span>}
              {it.hint && <kbd>{it.hint}</kbd>}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

// ─── Tooltips ──────────────────────────────────────────────────────────────

/** Upgrades every native `title` to a fast, styled tooltip. A trailing shortcut like "(⌘K)" is shown as a key hint. */
function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; key?: string; x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    if (matchMedia('(hover: none)').matches) return
    let timer = 0
    let cur: HTMLElement | null = null
    const hide = () => (clearTimeout(timer), (cur = null), setTip(null))
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.('[title],[data-tip]') as HTMLElement | null
      if (el === cur) return
      hide()
      if (!el) return
      const t = el.getAttribute('title')
      if (t) (el.dataset.tip = t), el.removeAttribute('title'), el.getAttribute('aria-label') || el.setAttribute('aria-label', t)
      const text = el.dataset.tip
      if (!text) return
      cur = el
      timer = window.setTimeout(() => {
        if (!el.isConnected) return
        const r = el.getBoundingClientRect()
        const m = text.match(/^(.*?)\s*\(?((?:[⌘⌥⇧⌃]|Ctrl\+|Alt\+)+[^)\s]{1,2})\)?$/)
        const below = r.top < 44
        setTip({ text: m ? m[1] : text, key: m?.[2], x: Math.max(60, Math.min(r.left + r.width / 2, innerWidth - 60)), y: below ? r.bottom + 6 : r.top - 6, below })
      }, 350)
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    return () => (document.removeEventListener('mouseover', over), document.removeEventListener('mousedown', hide, true), document.removeEventListener('keydown', hide, true), document.removeEventListener('scroll', hide, true))
  }, [])
  if (!tip) return null
  return (
    <div className={`tip ${tip.below ? 'below' : ''}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
      {tip.key && <kbd>{tip.key}</kbd>}
    </div>
  )
}

// ─── Keyboard shortcuts sheet ──────────────────────────────────────────────

const MOD = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl'
const SHORTCUTS: [string, [string, string][]][] = [
  ['Go', [['Search and commands', `${MOD} K`], ['Assistant', `${MOD} J`], ['Toggle sidebar', `${MOD} \\`], ['Settings', `${MOD} ,`], ['This list', '?']]],
  ['Create', [['New doc', `${MOD} N`], ['Insert a block', '/'], ['Link to a doc', '[[']]],
  ['Write', [['Bold', `${MOD} B`], ['Italic', `${MOD} I`], ['Underline', `${MOD} U`], ['Heading', '#  space'], ['Checklist', '[ ]  space'], ['Quote', '>  space'], ['Code block', '```']]],
  ['Calendar', [['Today', 'T'], ['Week / Month', 'W / M'], ['Previous / Next', '← / →']]],
]
export const useShortcuts = create<{ open: boolean }>(() => ({ open: false }))

function ShortcutsHost() {
  const open = useShortcuts((s) => s.open)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useShortcuts.getState().open) return useShortcuts.setState({ open: false })
      if (e.key !== '?' || e.metaKey || e.ctrlKey || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return
      useShortcuts.setState((s) => ({ open: !s.open }))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" onMouseDown={() => useShortcuts.setState({ open: false })} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="modal keys" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            <header><h2>Keyboard shortcuts</h2></header>
            <div className="modal-body keys-grid">
              {SHORTCUTS.map(([group, rows]) => (
                <div key={group}>
                  <h3>{group}</h3>
                  {rows.map(([label, key]) => (
                    <div key={label} className="key-row"><span>{label}</span><kbd>{key}</kbd></div>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Overlays() {
  return (
    <>
      <ConfirmHost />
      <MenuHost />
      <TooltipHost />
      <ShortcutsHost />
    </>
  )
}
