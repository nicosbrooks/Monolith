import { ChevronLeft } from 'lucide-react'
import { useStore } from '../store'
import type { Item } from '../types'

/** Phone-only back button at the start of a view's toolbar. */
export function MobileBack({ item }: { item: Item }) {
  const back = () => {
    const st = useStore.getState()
    const parent = st.items.find((i) => i.id === item.parentId && !i.deletedAt)
    if (item.kind === 'doc' && parent) st.open(parent.id)
    else useStore.setState({ activeId: null })
  }
  return (
    <button className="tb m-only back" onClick={back} aria-label="Back">
      <ChevronLeft size={22} />
    </button>
  )
}
