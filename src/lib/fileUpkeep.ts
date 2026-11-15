import { useStore } from '../store'
import { collectGarbage, externalize } from './files'

/**
 * Keeps docs light without anyone doing anything:
 * - Pictures embedded as data in docs that aren't open (from older versions, or synced from the phone) move into the
 *   file store. The open doc is left to its editor, which does the same (see Editor.tsx). Docs kept as Markdown files
 *   in a folder, GitHub or Drive keep theirs, since those sources hold text only.
 * - Stored files no doc uses any more are removed once a day has passed.
 * The doc's date isn't touched, so nothing jumps to the top of Recent.
 */
let running = false
async function storeEmbedded() {
  if (running) return
  running = true
  try {
    for (;;) {
      const st = useStore.getState()
      const next = st.items.find((i) => !i.sourceId && i.id !== st.activeId && i.content.includes('src="data:image/'))
      if (!next) break
      const before = next.content
      const after = await externalize(before)
      if (after === before) break // nothing could be moved; don't loop on it
      useStore.setState((s) => ({ items: s.items.map((i) => (i.id === next.id && i.content === before ? { ...i, content: after } : i)) }))
    }
  } finally {
    running = false
  }
}

export function startFileUpkeep() {
  let t = 0
  const soon = () => (clearTimeout(t), (t = window.setTimeout(() => void storeEmbedded(), 1500)))
  soon()
  useStore.subscribe((s, prev) => s.items !== prev.items && soon())
  window.setTimeout(() => void collectGarbage(useStore.getState().items.map((i) => i.content)).catch(() => {}), 20_000)
}
