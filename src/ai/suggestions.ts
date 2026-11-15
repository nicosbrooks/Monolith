import { useEffect, useMemo, useState } from 'react'
import { differenceInMinutes, format, isSameDay } from 'date-fns'
import { useStore } from '../store'
import type { Suggestion } from '../types'
import { findDatedCommitments } from '../lib/dates'
import { htmlToText } from '../lib/util'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()

/** Rule-based proactive suggestions: instant, private, and work even before a model is loaded. */
export function useRuleSuggestions(): Suggestion[] {
  const items = useStore((s) => s.items)
  const events = useStore((s) => s.events)
  const activeId = useStore((s) => s.activeId)
  const dismissed = useStore((s) => s.dismissed)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  return useMemo(() => {
    const st = useStore.getState()
    const now = new Date()
    const out: Suggestion[] = []
    const live = items.filter((i) => !i.deletedAt)
    const active = live.find((i) => i.id === activeId)

    // 1. Dates mentioned in recent writing → calendar
    const recent = [active, ...live.filter((i) => i.id !== activeId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)].filter(Boolean)
    for (const it of recent) {
      for (const p of findDatedCommitments(htmlToText(it!.content), now)) {
        const exists = events.some(
          (e) => isSameDay(e.start, p.start) && (norm(e.title).includes(norm(p.title).slice(0, 12)) || norm(p.title).includes(norm(e.title).slice(0, 12))),
        )
        // Keyed by page and wording, not the date: "due Friday" resolves to a new date each week, and a
        // dismissed suggestion must stay dismissed.
        const id = `cal:${it!.id}:${norm(p.title)}`
        if (exists || dismissed.includes(id)) continue
        out.push({
          id,
          icon: 'calendar',
          source: 'rule',
          title: `Add “${p.title}” to calendar?`,
          detail: `${format(p.start, p.allDay ? 'EEE, MMM d' : 'EEE, MMM d · h:mm a')} — found in “${it!.title || 'Untitled'}”`,
          action: {
            label: 'Add event',
            run: () => {
              st.addEvent({ title: p.title, start: p.start.getTime(), end: p.end.getTime(), allDay: p.allDay, color: /due|exam|quiz|test|deadline|final|midterm/i.test(p.title) ? 'rose' : 'blue', linkedItemId: it!.id })
              st.dismiss(id)
            },
          },
        })
        if (out.length > 3) break
      }
    }

    // 2. Upcoming event
    const next = events
      .filter((e) => !e.allDay && e.start > now.getTime() && differenceInMinutes(e.start, now) <= 90)
      .sort((a, b) => a.start - b.start)[0]
    if (next && !dismissed.includes(`next:${next.id}`)) {
      const mins = differenceInMinutes(next.start, now)
      const linked = live.find((i) => i.id === next.linkedItemId)
      const isClass = /lecture|class|seminar|lab|talk/i.test(next.title)
      out.push({
        id: `next:${next.id}`,
        icon: 'clock',
        source: 'rule',
        title: `${next.title} in ${mins} min`,
        detail: next.location ? `at ${next.location}` : isClass ? 'Get ready to record it' : undefined,
        action: linked
          ? { label: 'Open notes', run: () => st.open(linked.id) }
          : isClass
            ? { label: 'Prepare recording', run: () => { const it = st.createItem('lecture', { title: next.title, eventId: next.id }); st.updateEvent(next.id, { linkedItemId: it.id }) } }
            : { label: 'Prep note', run: () => { const it = st.createItem('doc', { title: `Prep: ${next.title}`, content: `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`, eventId: next.id }); st.updateEvent(next.id, { linkedItemId: it.id }) } },
      })
    }

    // 3. Class just ended without notes
    const ended = events.find((e) => !e.allDay && /lecture|class|seminar/i.test(e.title) && e.end < now.getTime() && now.getTime() - e.end < 3 * 3600e3 && !e.linkedItemId)
    if (ended && !dismissed.includes(`ended:${ended.id}`)) {
      out.push({
        id: `ended:${ended.id}`,
        icon: 'book',
        source: 'rule',
        title: `Capture notes from ${ended.title}?`,
        detail: 'Write them while it’s fresh — memory fades fast.',
        action: { label: 'Start notes', run: () => { const it = st.createItem('doc', { title: ended.title, content: `<h2>Key ideas</h2><ul><li><p></p></li></ul><h2>Questions</h2><ul><li><p></p></li></ul>`, eventId: ended.id }); st.updateEvent(ended.id, { linkedItemId: it.id }); st.dismiss(`ended:${ended.id}`) } },
      })
    }

    // 4. Lectures with a transcript but no notes yet
    for (const l of live.filter((i) => i.kind === 'lecture' && i.lecture?.transcript.length && htmlToText(i.content).length < 40).slice(0, 1)) {
      if (dismissed.includes(`lec:${l.id}`)) continue
      out.push({
        id: `lec:${l.id}`,
        icon: 'sparkles',
        source: 'rule',
        title: `Write notes for “${l.title || 'your recording'}”`,
        detail: 'The transcript is ready',
        action: { label: 'Open', run: () => st.open(l.id) },
      })
    }

    // 6. Long doc with no structure
    if (active?.kind === 'doc') {
      const words = htmlToText(active.content).split(/\s+/).length
      if (words > 350 && !/<h[23]/.test(active.content) && !dismissed.includes(`struct:${active.id}`))
        out.push({ id: `struct:${active.id}`, icon: 'list', source: 'rule', title: 'This doc is getting long', detail: 'Ask the AI to suggest section headings.' })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, events, activeId, dismissed, tick])
}
