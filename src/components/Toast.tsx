import { useEffect, useLayoutEffect, useState } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CircleAlert } from 'lucide-react'

interface T {
  id: number
  text: string
  action?: { label: string; run: () => void }
  error?: boolean
  ms: number
}
/** One notification at a time: a new one replaces the one showing, never stacks under it. */
const useToast = create<{ current: T | null }>(() => ({ current: null }))
const drop = (id: number) => useToast.setState((s) => (s.current?.id === id ? { current: null } : s))

/** A short note of what just happened, in from the top right. At most one action (usually Undo). */
export function toast(text: string, opts: { action?: T['action']; ms?: number; error?: boolean } = {}) {
  const id = Date.now() + Math.random()
  useToast.setState({ current: { id, text, action: opts.action, error: opts.error, ms: opts.ms ?? (opts.error || opts.action ? 6000 : 4000) } })
}

/** Something didn't work: the same notification, marked with an alert icon and kept a little longer. */
export const toastError = (text: string, opts: { action?: T['action']; ms?: number } = {}) => toast(text, { ...opts, error: true })

/** How wide a strip at the right the notification may land in (the whole width on a phone, where it's centred). */
const ZONE = 460
// Buttons and small fields only: a doc's title or text is reading, not a control, so it doesn't push the note down.
const CONTROLS = 'button, a[href], select, input:not([type="hidden"]), [role="button"], [role="tab"]'

/**
 * Where the notification can sit without covering anything you can press: just below the lowest control in the top
 * right of the window (a page's header pills, Calendar's Week / Month, the header of a doc open beside, a dialog's
 * close button). Measured each time one appears, so it follows whatever is on screen.
 */
function clearTop(phone: boolean) {
  const w = window.innerWidth
  const from = phone ? 0 : w - ZONE
  let bottom = phone ? 8 : 12
  document.querySelectorAll<HTMLElement>(CONTROLS).forEach((el) => {
    if (el.closest('.toaster, .rail-slot, [contenteditable="true"]')) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height || r.height > 48 || r.top > 150 || r.bottom <= 0 || r.right < from) return
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || Number(s.opacity) === 0) return
    bottom = Math.max(bottom, r.bottom)
  })
  return Math.round(Math.min(bottom + 10, 190))
}

export function Toaster() {
  const t = useToast((s) => s.current)
  const reduced = useReducedMotion()
  const [top, setTop] = useState(16)
  const [paused, setPaused] = useState(false)
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches

  useLayoutEffect(() => {
    if (t) setTop(clearTop(phone))
    setPaused(false)
  }, [t?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // It leaves on its own after a few seconds; resting the pointer on it holds it there.
  useEffect(() => {
    if (!t || paused) return
    const id = t.id
    const timer = window.setTimeout(() => drop(id), t.ms)
    return () => window.clearTimeout(timer)
  }, [t, paused])

  const from = reduced ? 0 : phone ? -12 : 28
  return (
    <div className="toaster" aria-live="polite" style={{ top }}>
      <AnimatePresence mode="wait" initial={false}>
        {t && (
          <motion.div
            key={t.id}
            className={`toast ${t.error ? 'error' : ''}`}
            initial={{ opacity: 0, ...(phone ? { y: from } : { x: from }) }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, ...(phone ? { y: from } : { x: from }), transition: { duration: 0.14 } }}
            transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
            role={t.error ? 'alert' : 'status'}
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
          >
            {t.error && <CircleAlert size={16} className="toast-ico" aria-hidden="true" />}
            <span>{t.text}</span>
            {t.action && <button onClick={() => (t.action!.run(), drop(t.id))}>{t.action.label}</button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
