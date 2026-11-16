import { useMemo } from 'react'
import { useStore } from '../store'
import type { CalEvent } from '../types'
import { useCalendars, useSubEvents } from './calendars'
import { expandAround } from './repeat'

// What's on the calendar, as everything outside the calendar grid should see it: your own events with each repeating
// one laid out as its dates (a year ahead), plus the calendars you subscribe to.

let last: { src: CalEvent[]; day: number; out: CalEvent[] } | null = null
/** Your own events with repeats laid out. The same list comes back until an event changes or the day does. */
export function ownEvents(events = useStore.getState().events): CalEvent[] {
  const day = new Date().setHours(0, 0, 0, 0)
  if (last?.src === events && last.day === day) return last.out
  last = { src: events, day, out: events.some((e) => e.repeat) ? expandAround(events) : events }
  return last.out
}

export function useOwnEvents(): CalEvent[] {
  const events = useStore((s) => s.events)
  return useMemo(() => ownEvents(events), [events])
}

/** Own events and subscribed calendars together. */
export function useEvents(): CalEvent[] {
  const own = useOwnEvents()
  const subs = useSubEvents()
  return useMemo(() => [...own, ...subs], [own, subs])
}

/** The same, outside a component. */
export function allEvents(): CalEvent[] {
  const c = useCalendars.getState()
  return [...ownEvents(), ...c.subs.filter((s) => !s.hidden).flatMap((s) => c.events[s.id] || [])]
}
