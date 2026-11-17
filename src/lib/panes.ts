import { createContext, useContext } from 'react'
import { create } from 'zustand'
import { useStore } from '../store'

/**
 * A doc or recording open beside the page (desktop). Home, Tasks and Calendar open docs here, so the page you were
 * on stays in view; ⌘-click (or "Open beside") does it from anywhere. Remembered in this browser.
 */
const KEY = 'monolith-side-pane'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as { id?: string | null; width?: number }
  } catch {
    return {}
  }
})()

export const useSidePane = create<{ id: string | null; width: number }>(() => ({ id: saved.id ?? null, width: saved.width ?? 560 }))
useSidePane.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private window */
  }
})

export const SIDE_MIN = 380
export const sideMax = () => Math.max(SIDE_MIN, Math.round(window.innerWidth * 0.62))

export function openBeside(id: string) {
  const st = useStore.getState()
  // Already the page itself: nothing to put beside it.
  if (st.activeId === id && st.section !== 'home' && st.section !== 'tasks' && st.section !== 'calendar') return
  useSidePane.setState({ id })
}
export const closeBeside = () => useSidePane.setState({ id: null })
export const setSideWidth = (w: number) => useSidePane.setState({ width: Math.round(Math.min(sideMax(), Math.max(SIDE_MIN, w))) })

/** Moves the doc beside the page into the page itself. */
export function expandBeside() {
  const id = useSidePane.getState().id
  if (!id) return
  closeBeside()
  useStore.getState().open(id)
}

const wide = () => window.matchMedia('(min-width: 900px)').matches

/**
 * Open a doc from a list. From Home, Tasks or Calendar on a computer it opens beside the page; ⌘ or Ctrl-click opens
 * it beside from anywhere. Otherwise it becomes the page.
 */
export function openDoc(id: string, e?: { metaKey?: boolean; ctrlKey?: boolean }) {
  const section = useStore.getState().section
  const beside = wide() && (e?.metaKey || e?.ctrlKey || section === 'home' || section === 'tasks' || section === 'calendar')
  if (beside) openBeside(id)
  else useStore.getState().open(id)
}

/** Which pane a view is drawn in, so its header can offer the right controls. */
export const PaneContext = createContext<'main' | 'side'>('main')
export const usePane = () => useContext(PaneContext)
