import { create } from 'zustand'
import { AnimatePresence, motion } from 'motion/react'

interface T {
  id: number
  text: string
  action?: { label: string; run: () => void }
}
const useToasts = create<{ list: T[] }>(() => ({ list: [] }))

export function toast(text: string, opts: { action?: T['action']; ms?: number } = {}) {
  const id = Date.now() + Math.random()
  useToasts.setState((s) => ({ list: [...s.list.slice(-2), { id, text, action: opts.action }] }))
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), opts.ms ?? 4000)
}

export function Toaster() {
  const list = useToasts((s) => s.list)
  return (
    <div className="toaster">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div key={t.id} className="toast" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}>
            <span>{t.text}</span>
            {t.action && (
              <button onClick={() => (t.action!.run(), useToasts.setState((s) => ({ list: s.list.filter((x) => x.id !== t.id) })))}>{t.action.label}</button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
