import { ArrowLeft, ArrowRight, Maximize2, X } from 'lucide-react'
import { useStore } from '../store'
import type { Item } from '../types'
import { closeBeside, expandBeside, usePane } from '../lib/panes'

/**
 * The start of a doc's or recording's header on a computer: back and forward, then the place it belongs to, so it's
 * always clear where you are and how to get back. Beside the page, the header says "Beside" instead.
 */
export function PaneNav({ item }: { item: Item }) {
  const pane = usePane()
  if (pane === 'side') return null
  const place = item.deletedAt ? 'Recently Deleted' : item.kind === 'lecture' ? 'Recordings' : 'Docs'
  const goPlace = () => {
    const section = item.deletedAt ? 'trash' : item.kind === 'lecture' ? 'lectures' : 'docs'
    useStore.setState({ section, activeId: null, tagFilter: null, calendarDate: null })
  }
  return (
    <span className="pane-nav">
      <button className="pn-step" onClick={() => history.back()} aria-label="Back" title="Back  ⌘[">
        <ArrowLeft size={16} strokeWidth={1.9} />
      </button>
      <button className="pn-step" onClick={() => history.forward()} aria-label="Forward" title="Forward  ⌘]">
        <ArrowRight size={16} strokeWidth={1.9} />
      </button>
      <button className="pn-place" onClick={goPlace}>{place}</button>
      <span className="pn-sep" aria-hidden="true">/</span>
    </span>
  )
}

/** The end of a header beside the page: make it the page, or close it. */
export function SideControls() {
  if (usePane() !== 'side') return null
  return (
    <span className="side-ctl">
      <button className="pn-step" onClick={expandBeside} aria-label="Open as the page" title="Open as the page">
        <Maximize2 size={15} strokeWidth={1.9} />
      </button>
      <button className="pn-step" onClick={closeBeside} aria-label="Close" title="Close  Esc">
        <X size={16} strokeWidth={1.9} />
      </button>
    </span>
  )
}
