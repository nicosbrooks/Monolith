import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { format, isToday, isYesterday } from 'date-fns'
import { History, X } from 'lucide-react'
import { useStore } from '../store'
import { keepNow, safeHtml, useHistory, versions, type Version } from '../lib/history'
import { htmlToText } from '../lib/util'
import { getActiveEditor } from '../ai/actions'
import { toast } from './Toast'

const when = (t: number) => `${isToday(t) ? 'Today' : isYesterday(t) ? 'Yesterday' : format(t, 'EEE, MMM d')} · ${format(t, 'h:mm a')}`
const words = (html: string) => htmlToText(html).split(/\s+/).filter(Boolean).length

/** Earlier versions of a doc: pick one on the left, read it on the right, restore it (with Undo). */
export function HistoryDialog() {
  const id = useHistory((s) => s.id)
  const item = useStore((s) => s.items.find((i) => i.id === id))
  const [list, setList] = useState<Version[] | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const close = () => useHistory.setState({ id: null })
  useEffect(() => {
    setList(null)
    setAt(null)
    if (!id) return
    let live = true
    void versions(id).then((v) => live && (setList(v), setAt(v[0]?.at ?? null)))
    return () => void (live = false)
  }, [id])
  useEffect(() => {
    if (!id) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [id])

  const shown = list?.find((v) => v.at === at)
  const restore = async () => {
    if (!item || !shown) return
    const before = { title: item.title, content: item.content }
    await keepNow(item) // what's there now becomes a version too, so restoring never loses anything
    const put = (v: { title: string; content: string }) => {
      useStore.getState().updateItem(item.id, v)
      const ed = getActiveEditor()
      if (useStore.getState().activeId === item.id && ed && !ed.isDestroyed) ed.commands.setContent(v.content, { emitUpdate: false })
    }
    put({ title: shown.title, content: shown.content })
    close()
    toast(`Restored the version from ${when(shown.at).toLowerCase()}`, { ms: 6000, action: { label: 'Undo', run: () => put(before) } })
  }

  return (
    <AnimatePresence>
      {id && item && (
        <motion.div className="overlay" onMouseDown={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, pointerEvents: 'none' }}>
          <motion.div className="modal hist" role="dialog" aria-modal="true" aria-labelledby="hist-title" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            <header>
              <h2 id="hist-title">Earlier versions</h2>
              <button className="icon-btn" onClick={close} aria-label="Close" title="Close (Esc)"><X size={18} /></button>
            </header>
            {list && !list.length ? (
              <div className="blank hist-blank">
                <span className="blank-ico"><History size={22} strokeWidth={1.7} /></span>
                <b>No earlier versions yet</b>
                <p>As you keep working on “{item.title || 'Untitled'}”, Monolith keeps how it was, so you can always go back.</p>
              </div>
            ) : (
              <div className="hist-body">
                <div className="hist-list" role="listbox" aria-label="Versions">
                  {list?.map((v) => (
                    <button key={v.at} role="option" aria-selected={v.at === at} className={v.at === at ? 'on' : ''} onClick={() => setAt(v.at)}>
                      <b>{when(v.at)}</b>
                      <small>{words(v.content)} words</small>
                    </button>
                  ))}
                </div>
                <div className="hist-view">
                  {shown && (
                    <>
                      {/* Read-only: the doc's own HTML, as it was saved by the editor. Stored pictures show as their names. */}
                      <div className="hist-page" tabIndex={0} aria-label="This version">
                        <h1>{shown.title || 'Untitled'}</h1>
                        <div className="prose" dangerouslySetInnerHTML={{ __html: safeHtml(shown.content) }} />
                      </div>
                      <footer>
                        <span className="muted small">Restoring keeps today’s version too.</span>
                        <button className="btn primary" onClick={restore}>Restore this version</button>
                      </footer>
                    </>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
