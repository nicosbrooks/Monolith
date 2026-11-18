import { toast } from '../components/Toast'
import { useStore } from '../store'

/**
 * Delete a folder, with Undo. Its docs aren't touched: they stay in Docs, just not filed. Undo puts the folder back
 * where it was, with the same docs in it. The Docs page and the phone drawer both delete folders this way.
 */
export function removeFolder(id: string) {
  const st = useStore.getState()
  const at = st.folders.findIndex((f) => f.id === id)
  if (at < 0) return
  const folder = st.folders[at]
  const docs = new Set(st.items.filter((i) => i.folderId === id).map((i) => i.id))
  st.deleteFolder(id)
  toast(`Deleted “${folder.name}”${docs.size ? `. Its ${docs.size === 1 ? 'doc stays' : `${docs.size} docs stay`} in Docs` : ''}`, {
    ms: 6000,
    action: {
      label: 'Undo',
      run: () =>
        useStore.setState((s) => ({
          folders: s.folders.some((f) => f.id === id) ? s.folders : [...s.folders.slice(0, at), folder, ...s.folders.slice(at)],
          items: s.items.map((i) => (docs.has(i.id) ? { ...i, folderId: id } : i)),
        })),
    },
  })
}
