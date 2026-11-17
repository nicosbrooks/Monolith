import { create } from 'zustand'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert } from 'lucide-react'

interface T {
  id: number
  text: string
  action?: { label: string; run: () => void }
  error?: boolean
}
const useToasts = create<{ list: T[] }>(() => ({ list: [] }))
const drop = (id: number) => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) }))

/** A short note of what just happened, just above the Ask bar. At most one action (usually Undo). */
export function toast(text: string, opts: { action?: T['action']; ms?: number; error?: boolean } = {}) {
  const id = Date.now() + Math.random()
  useToasts.setState((s) => ({ list: [...s.list.slice(-2), { id, text, action: opts.action, error: opts.error }] }))
  setTimeout(() => drop(id), opts.ms ?? (opts.error ? 6000 : opts.action ? 6000 : 4000))
}

/** Something didn't work: the same notification, marked with an alert icon and kept a little longer. */
export const toastError = (text: string, opts: { action?: T['action']; ms?: number } = {}) => toast(text, { ...opts, error: true })

export function Toaster() {
  const list = useToasts((s) => s.list)
  return (
    <div className="toaster" aria-live="polite">
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div
            key={t.id}
            className={`toast ${t.error ? 'error' : ''}`}
            layout
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
            role={t.error ? 'alert' : 'status'}
          >
            {t.error && <CircleAlert size={16} className="toast-ico" aria-hidden="true" />}
            <span>{t.text}</span>
            {t.action && <button onClick={() => (t.action!.run(), drop(t.id))}>{t.action.label}</button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
