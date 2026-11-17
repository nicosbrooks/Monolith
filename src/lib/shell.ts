import { create } from 'zustand'

/**
 * The desktop sidebar (Rail.tsx). `open`: showing names and docs because the pointer rests on it or focus is in it.
 * `pinned`: kept open beside the page (⌘\), remembered in this browser.
 */
const KEY = 'monolith-sidebar-pinned'
const saved = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
export const useShell = create<{ open: boolean; pinned: boolean }>(() => ({ open: false, pinned: saved() }))
export const setSidebar = (open: boolean) => useShell.setState({ open })
export const toggleSidebar = (on?: boolean) => {
  const pinned = on ?? !useShell.getState().pinned
  useShell.setState({ pinned, open: false })
  try {
    localStorage.setItem(KEY, pinned ? '1' : '0')
  } catch {
    /* private window */
  }
}
