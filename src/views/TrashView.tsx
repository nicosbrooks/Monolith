import { useMemo } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { AudioWaveform, FileText, RotateCcw, Trash2 } from 'lucide-react'
import { MoreIcon } from '../components/icons'
import { useStore } from '../store'
import type { Item } from '../types'
import { itemEmoji } from '../lib/util'
import { confirmDialog, openMenu } from '../components/Overlays'
import { toast } from '../components/Toast'
import { useMobile, useScrolled } from '../lib/useMobile'
import { PhoneTitle } from '../components/Phone'

const ago = (t: number) => formatDistanceToNowStrict(t, { addSuffix: true })

/**
 * Recently Deleted: docs and recordings you deleted, to get back. (Checked-off tasks wait under Tasks › Done.) Each
 * row has its own Restore; deleting forever is in the row's menu, and always asks first.
 */
export function TrashView() {
  const items = useStore((s) => s.items)
  const mobile = useMobile()
  const [scrolled, onScroll] = useScrolled()
  const st = useStore.getState()
  const deleted = useMemo(() => items.filter((i) => i.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!), [items])

  const restoreItem = (i: Item) => {
    st.restoreItem(i.id)
    toast(`Restored “${i.title || 'Untitled'}”`, { action: { label: 'Open', run: () => useStore.getState().open(i.id) } })
  }
  const purge = async (i: Item) => {
    const what = i.kind === 'lecture' ? 'recording' : 'doc'
    if (await confirmDialog({ title: `Delete this ${what} forever?`, body: 'This can’t be undone.', confirm: 'Delete forever', danger: true })) st.purgeItem(i.id)
  }
  const empty = async () => {
    if (!deleted.length) return
    const n = deleted.length
    if (await confirmDialog({ title: `Delete ${n === 1 ? 'this item' : `all ${n} items`} forever?`, body: 'Deleted docs and recordings can’t be brought back after this.', confirm: 'Delete forever', danger: true }))
      for (const i of deleted) st.purgeItem(i.id)
  }

  return (
    <div className={`home page-scroll ${mobile ? 'p-screen' : ''}`} onScroll={mobile ? onScroll : undefined}>
      {mobile && <PhoneTitle title="Recently Deleted" scrolled={scrolled} />}
      <div className="hm trash">
        <header className="hm-head">
          {!mobile && <h1>Recently Deleted</h1>}
          <p>Deleted docs and recordings wait here. Restore any of them.</p>
        </header>

        <section className="hm-sec" aria-labelledby="tr-items">
          <div className="hm-label">
            <h2 id="tr-items">Docs and recordings</h2>
            {deleted.length > 0 && <button className="danger" onClick={empty}><Trash2 size={13} aria-hidden="true" /> Empty</button>}
          </div>
          {deleted.length ? (
            <div className="hm-card hm-list">
              {deleted.map((i) => {
                const Icon = i.kind === 'lecture' ? AudioWaveform : FileText
                return (
                  <div key={i.id} className="hm-row tr-row" onContextMenu={(e) => openMenu(e, [{ label: 'Restore', icon: RotateCcw, run: () => restoreItem(i) }, 'sep', { label: 'Delete forever', icon: Trash2, danger: true, run: () => void purge(i) }])}>
                    <span className="tr-ico">{itemEmoji(i) || <Icon size={16} strokeWidth={1.8} />}</span>
                    <button className="hm-row-main" onClick={() => useStore.setState({ activeId: i.id })} title="Preview">
                      <span>{i.title || 'Untitled'}</span>
                      <small>{i.kind === 'lecture' ? 'Recording' : 'Doc'} · deleted {ago(i.deletedAt!)}</small>
                    </button>
                    <button className={mobile ? 'icon-btn sm' : 'btn sm'} onClick={() => restoreItem(i)} aria-label={mobile ? `Restore ${i.title || 'Untitled'}` : undefined}><RotateCcw size={mobile ? 16 : 13} />{!mobile && ' Restore'}</button>
                    <button className="icon-btn sm" aria-label={`More for ${i.title || 'Untitled'}`} onClick={(e) => openMenu(e, [{ label: 'Delete forever', icon: Trash2, danger: true, run: () => void purge(i) }])}><MoreIcon size={15} /></button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="tr-none">Nothing deleted. Docs and recordings you delete wait here.</p>
          )}
        </section>

      </div>
    </div>
  )
}
