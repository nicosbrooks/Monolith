export type SwipeDirection = -1 | 1

interface SwipeTarget {
  step: (direction: SwipeDirection) => void
  preview?: (offset: number) => void
}

const EDGE = 28
const DISTANCE = 60
const RATIO = 1.5

export function swipeEdge(x: number): SwipeDirection | null {
  if (x <= EDGE) return -1
  if (x >= window.innerWidth - EDGE) return 1
  return null
}

export function listenForSwipes(
  surface: Document | HTMLElement,
  targetFor: (event: TouchEvent | WheelEvent, edge: SwipeDirection | null) => SwipeTarget | undefined,
) {
  let touch: { id: number; x: number; y: number; edge: SwipeDirection | null; target: SwipeTarget; locked: boolean } | undefined
  let wheel: { x: number; y: number; last: number; direction?: SwipeDirection; target?: SwipeTarget } | undefined

  const cancelTouch = () => {
    if (touch?.locked) touch.target.preview?.(0)
    touch = undefined
  }
  const start = (event: TouchEvent) => {
    cancelTouch()
    if (event.touches.length !== 1) return
    const { identifier: id, clientX: x, clientY: y } = event.touches[0]
    const edge = swipeEdge(x)
    const target = targetFor(event, edge)
    if (target) touch = { id, x, y, edge, target, locked: false }
  }
  const move = (event: TouchEvent) => {
    if (!touch) return
    if (event.touches.length !== 1) return cancelTouch()
    const { clientX, clientY } = event.touches[0]
    const dx = clientX - touch.x
    const dy = clientY - touch.y
    if (!touch.locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) return cancelTouch()
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * RATIO) return
      if (touch.edge !== null && dx * touch.edge >= 0) return cancelTouch()
      touch.locked = true
    }
    if (event.cancelable) event.preventDefault()
    touch.target.preview?.(Math.max(-82, Math.min(82, dx * 0.45)))
  }
  const end = (event: TouchEvent) => {
    const gesture = touch
    const finger = gesture && Array.from(event.changedTouches).find((point) => point.identifier === gesture.id)
    if (!gesture || !finger) return
    const dx = finger.clientX - gesture.x
    const dy = finger.clientY - gesture.y
    const direction = dx > 0 ? -1 : 1
    const complete = Math.abs(dx) >= DISTANCE && Math.abs(dx) > Math.abs(dy) * RATIO && (gesture.edge === null || gesture.edge === direction)
    if (complete && event.cancelable) event.preventDefault()
    cancelTouch()
    if (complete) gesture.target.step(direction)
  }
  const scroll = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
    const now = performance.now()
    if (!wheel || now - wheel.last > 150 || (wheel.direction && Math.abs(event.deltaX) >= DISTANCE && Math.sign(event.deltaX) !== wheel.direction)) {
      wheel = { x: 0, y: 0, last: now, target: targetFor(event, null) }
    }
    wheel.last = now
    if (!wheel.target) return
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerWidth : 1
    wheel.x += event.deltaX * unit
    wheel.y += Math.abs(event.deltaY * unit)
    if (Math.abs(wheel.x) <= wheel.y * RATIO || !event.deltaX) return
    if (event.cancelable) event.preventDefault()
    if (!wheel.direction && Math.abs(wheel.x) >= DISTANCE) {
      wheel.direction = wheel.x < 0 ? -1 : 1
      wheel.target.step(wheel.direction)
    }
  }

  // Document listeners can cancel browser overscroll and the synthetic tap after a swipe.
  const options = { passive: false }
  surface.addEventListener('touchstart', start as EventListener, options)
  surface.addEventListener('touchmove', move as EventListener, options)
  surface.addEventListener('touchend', end as EventListener, options)
  surface.addEventListener('touchcancel', cancelTouch)
  surface.addEventListener('wheel', scroll as EventListener, options)
  return () => {
    surface.removeEventListener('touchstart', start as EventListener)
    surface.removeEventListener('touchmove', move as EventListener)
    surface.removeEventListener('touchend', end as EventListener)
    surface.removeEventListener('touchcancel', cancelTouch)
    surface.removeEventListener('wheel', scroll as EventListener)
    cancelTouch()
  }
}
