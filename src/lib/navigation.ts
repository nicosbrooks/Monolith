import { useEffect, useLayoutEffect, useRef } from 'react'
import { useStore } from '../store'
import { listenForSwipes, type SwipeDirection } from './swipe'

type Store = ReturnType<typeof useStore.getState>
type Route = Pick<Store, 'section' | 'activeId' | 'folderId' | 'tagFilter' | 'calendarDate'>
type Entry = { index: number; route: Route }

function routeFor({ section, activeId, folderId, tagFilter, calendarDate }: Store): Route {
  return { section, activeId, folderId: section === 'docs' ? folderId : null, tagFilter: section === 'docs' ? tagFilter : null, calendarDate: section === 'calendar' ? calendarDate : null }
}

function scrollsSideways(target: Element) {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  }
  return false
}

export function useNavigationHistory(ready: boolean) {
  const main = useRef<HTMLElement>(null)
  const route = useStore((s) => s.section)
  const active = useStore((s) => s.activeId)
  const folder = useStore((s) => s.folderId)
  const date = useStore((s) => s.calendarDate)
  const tag = useStore((s) => s.tagFilter)
  const direction = useRef<SwipeDirection | null>(null)
  const motion = useRef<Animation | undefined>(undefined)

  useLayoutEffect(() => {
    if (!main.current || !direction.current) return
    const step = direction.current
    direction.current = null
    motion.current?.cancel()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    motion.current = main.current.animate([{ transform: `translateX(${step * 34}px)`, opacity: 0.72 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.7,.3,1)' })
  }, [route, active, folder, date, tag])

  useEffect(() => {
    if (!ready) return
    const store = useStore.getState()
    let entry: Entry = history.state?.monolith ?? { index: 0, route: routeFor(store) }
    const historyKey = 'monolith-history-end'
    let lastIndex = Math.max(entry.index, Number(sessionStorage.getItem(historyKey)) || 0)
    let signature = JSON.stringify(routeFor(store))
    let restoring = false
    let scheduled = false
    let stopped = false
    let traversing = false
    let traversalTimeout = 0
    const write = (replace: boolean) => {
      const state = { ...history.state, monolith: entry }
      if (replace) history.replaceState(state, '')
      else {
        delete state.calendarPosition
        history.pushState(state, '')
      }
    }
    const saveEnd = () => sessionStorage.setItem(historyKey, String(lastIndex))
    const restore = (next: Route) => {
      const { items, folders } = useStore.getState()
      const selected = items.find((item) => item.id === next.activeId && (next.section === 'trash' ? !!item.deletedAt : !item.deletedAt))
      restoring = true
      useStore.setState({ ...next, activeId: selected?.id ?? null, folderId: folders.some((f) => f.id === next.folderId) ? next.folderId : null })
      signature = JSON.stringify(routeFor(useStore.getState()))
      restoring = false
    }
    if (history.state?.monolith) restore(entry.route)
    else {
      lastIndex = 0
      saveEnd()
    }
    write(true)

    const record = () => {
      scheduled = false
      if (stopped) return
      const next = routeFor(useStore.getState())
      const key = JSON.stringify(next)
      if (key === signature) return
      signature = key
      entry = { index: entry.index + 1, route: next }
      lastIndex = entry.index
      saveEnd()
      write(false)
    }
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (restoring || scheduled) return
      if (state.section === previous.section && state.activeId === previous.activeId && state.folderId === previous.folderId && state.tagFilter === previous.tagFilter && state.calendarDate === previous.calendarDate) return
      scheduled = true
      // Sidebar actions can update both the section and its selection in the same interaction.
      queueMicrotask(record)
    })
    const pop = (event: PopStateEvent) => {
      clearTimeout(traversalTimeout)
      traversing = false
      const next: Entry | undefined = event.state?.monolith
      if (!next) return
      if (signature !== JSON.stringify(next.route)) direction.current = next.index < entry.index ? -1 : 1
      entry = next
      lastIndex = Math.max(lastIndex, next.index)
      saveEnd()
      restore(next.route)
    }
    const canStep = (step: SwipeDirection) => step < 0 ? entry.index > 0 : entry.index < lastIndex
    const step = (dir: SwipeDirection) => {
      if (traversing || !canStep(dir)) return
      traversing = true
      history.go(dir)
      traversalTimeout = window.setTimeout(() => { traversing = false }, 500)
    }
    const preview = (offset: number) => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || !main.current) return
      main.current.style.translate = offset ? `${offset * 0.55}px` : ''
    }
    const stopSwipes = listenForSwipes(document, (event, edge) => {
      if (!(event.target instanceof Element) || !event.target.closest('.app')) return
      if (document.querySelector('.overlay, .p-drawer, .p-sheet, .drop.ctx, .calendar .sheet')) return
      if (event.target.closest('input, textarea, select, .sketch-canvas')) return
      if (event.type === 'touchstart') return edge !== null && canStep(edge) ? { step, preview } : undefined
      if (event.target.closest('.cal-body') || scrollsSideways(event.target)) return
      return { step }
    })
    window.addEventListener('popstate', pop)
    return () => {
      stopped = true
      clearTimeout(traversalTimeout)
      unsubscribe()
      stopSwipes()
      window.removeEventListener('popstate', pop)
    }
  }, [ready])

  return main
}
