import { useEffect, useState } from 'react'
import { format, isToday, isTomorrow } from 'date-fns'
import { AudioWaveform, CalendarDays, FileText } from 'lucide-react'
import { useStore } from '../store'
import type { Item } from '../types'
import { useWorkspace } from '../lib/graph'
import { htmlToText, itemEmoji } from '../lib/util'
import { related, useSystem1 } from '../ai/system1'

const KindIcon = { note: FileText, doc: FileText, lecture: AudioWaveform }

/**
 * What a doc or recording is connected to, under its text: the docs that link to it (with the sentence), its events on
 * the calendar, and docs close to it in meaning. Shown only when there is something to show.
 */
export function Connections({ item }: { item: Item }) {
  const ws = useWorkspace()
  const items = useStore((s) => s.items)
  const events = useStore((s) => s.events)
  const st = useStore.getState()
  const mentions = ws.mentions.get(item.id) ?? []
  const now = Date.now()
  const onCalendar = events.filter((e) => e.linkedItemId === item.id && e.end > now).sort((a, b) => a.start - b.start).slice(0, 3)

  // Close in meaning (System 1), leaving out what's already linked either way.
  const ready = useSystem1((s) => s.status === 'ready')
  const [near, setNear] = useState<string[]>([])
  useEffect(() => {
    setNear([])
    if (!ready) return
    let live = true
    const about = `${item.title}. ${htmlToText(item.content).slice(0, 600)}`
    if (about.trim().length < 40) return
    void related(about, 8, 600).then((r) => live && setNear(r.filter((x) => x.id !== item.id && x.score > 0.5).map((x) => x.id)))
    return () => void (live = false)
  }, [item.id, ready]) // eslint-disable-line
  const linked = new Set([...(ws.links.get(item.id) ?? []), ...mentions.map((m) => m.from.id)])
  const similar = near.map((id) => items.find((i) => i.id === id && !i.deletedAt && !i.file?.dir)).filter((i): i is Item => !!i && !linked.has(i.id)).slice(0, 3)

  if (!mentions.length && !onCalendar.length && !similar.length) return null
  const row = (i: Item, line?: string) => {
    const Icon = KindIcon[i.kind]
    return (
      <button key={i.id} className="cx-row" onClick={() => st.open(i.id)}>
        <span className="cx-ico">{itemEmoji(i) || <Icon size={16} strokeWidth={1.8} aria-hidden="true" />}</span>
        <span className="cx-main">
          <b>{i.title || 'Untitled'}</b>
          {line && <q>{line}</q>}
        </span>
      </button>
    )
  }
  return (
    <section className="cx" aria-label="Connections">
      {mentions.length > 0 && (
        <div className="cx-group">
          <h2>Linked from</h2>
          {mentions.map((m) => row(m.from, m.line === (m.from.title || '') ? undefined : m.line))}
        </div>
      )}
      {onCalendar.length > 0 && (
        <div className="cx-group">
          <h2>On your calendar</h2>
          {onCalendar.map((e) => (
            <button key={e.id} className="cx-row" onClick={() => st.openCalendarDate(new Date(e.start))}>
              <span className="cx-ico"><CalendarDays size={16} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="cx-main">
                <b>{e.title || 'Untitled event'}</b>
                <small>{isToday(e.start) ? 'Today' : isTomorrow(e.start) ? 'Tomorrow' : format(e.start, 'EEE, MMM d')}{e.allDay ? '' : ` · ${format(e.start, 'h:mm a')}`}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {similar.length > 0 && (
        <div className="cx-group">
          <h2>Related</h2>
          {similar.map((i) => row(i))}
        </div>
      )}
    </section>
  )
}
