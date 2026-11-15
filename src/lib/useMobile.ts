import { useEffect, useRef, useState } from 'react'

export const MOBILE = '(max-width: 680px)'

export function useMobile() {
  const [m, setM] = useState(() => matchMedia(MOBILE).matches)
  useEffect(() => {
    const mq = matchMedia(MOBILE)
    const f = () => setM(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return m
}

/** Press-and-hold on touch screens, which don't send a right-click. */
export function useLongPress(onHold: (p: { clientX: number; clientY: number; preventDefault(): void }) => void, ms = 480) {
  const t = useRef(0)
  const start = useRef({ x: 0, y: 0 })
  const fired = useRef(false)
  const cancel = () => clearTimeout(t.current)
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const p = e.touches[0]
      start.current = { x: p.clientX, y: p.clientY }
      fired.current = false
      t.current = window.setTimeout(() => {
        fired.current = true
        navigator.vibrate?.(8)
        onHold({ clientX: p.clientX, clientY: p.clientY, preventDefault() {} })
      }, ms)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const p = e.touches[0]
      if (Math.hypot(p.clientX - start.current.x, p.clientY - start.current.y) > 8) cancel()
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    /** Swallow the tap that ends a long press so it doesn't also open the item. */
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) (e.stopPropagation(), e.preventDefault(), (fired.current = false))
    },
  }
}

/** True once the element has scrolled past `px`: drives the compact header. */
export function useScrolled(px = 28) {
  const [s, setS] = useState(false)
  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    const v = e.currentTarget.scrollTop > px
    if (v !== s) setS(v)
  }
  return [s, onScroll] as const
}
