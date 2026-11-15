import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, ArrowUpRight, CalendarPlus, FileText, MessageCircle, AudioWaveform, StickyNote } from 'lucide-react'
import { useStore } from '../store'
import { eventColor, parseQuickEvent, whenLabel } from '../lib/dates'
import { htmlToText, itemEmoji } from '../lib/util'
import { toast } from './Toast'

/**
 * The bar at the bottom of every page. It knows where you are: on the calendar, typing an event adds it; with a
 * note, doc or recording open, questions are about that page; elsewhere it asks, searches and adds.
 */
export function AskBar({ phone = false }: { phone?: boolean }) {
  const section = useStore((s) => s.section)
  const active = useStore((s) => s.items.find((i) => i.id === s.activeId && !i.deletedAt))
  const items = useStore((s) => s.items)
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const st = useStore.getState()

  // What this page is about decides the wording and the suggestions.
  const page = active && section !== 'home' && section !== 'calendar' ? active : undefined
  const ctx = useMemo(() => {
    const t = page ? `“${(page.title || 'Untitled').slice(0, 32)}”` : ''
    if (section === 'calendar')
      return {
        hint: 'Add an event or ask about your schedule',
        chips: ['What’s on this week?', 'What’s left today?', 'Find a free hour tomorrow'],
      }
    if (page?.kind === 'lecture')
      return {
        hint: `Ask about ${t}`,
        chips: ['Summarize this recording', 'List the to-dos mentioned', 'Make flashcards'],
      }
    if (page)
      return {
        hint: `Ask about ${t}`,
        chips: ['Summarize this', 'Find the to-dos', 'What’s missing?'],
      }
    if (section === 'home')
      return {
        hint: 'Ask, search or add anything',
        chips: ['What’s on my calendar?', 'Find my open tasks', 'What did I work on recently?'],
      }
    return {
      hint: 'Ask about your notes, or search',
      chips: ['What did I write about this week?', 'Find my open to-dos'],
    }
  }, [section, page?.id, page?.title, page?.kind]) // eslint-disable-line

  const text = q.trim()
  const event = text.length > 3 ? parseQuickEvent(text.replace(/^\s*(add|schedule|book|new( event)?)\s+/i, '')) : null
  // On the calendar anything with a date is an event; elsewhere it needs to read like one ("add …").
  const isEvent = !!event && (section === 'calendar' || /^\s*(add|schedule|book|new)\b/i.test(text))
  const ql = text.toLowerCase()
  const hits = ql.length > 1 && !isEvent ? items.filter((i) => !i.deletedAt && (i.title.toLowerCase().includes(ql) || htmlToText(i.content).toLowerCase().includes(ql))).slice(0, 4) : []

  const ask = (prompt: string) => {
    useStore.setState({ askDraft: prompt, aiOpen: true })
    setQ('')
    input.current?.blur()
  }
  const addEvent = () => {
    if (!event) return
    const title = event.title.replace(/\s+(to|on) (my )?calendar$/i, '') || 'New event'
    const ev = st.addEvent({
      title,
      start: event.start.getTime(),
      end: event.end.getTime(),
      allDay: event.allDay,
      location: event.location,
      color: eventColor({ title, due: event.due }),
    })
    toast(`Added “${title}” · ${whenLabel(event)}`, { action: { label: 'Undo', run: () => st.deleteEvent(ev.id) } })
    setQ('')
  }
  const submit = () => {
    if (!text) return
    if (isEvent) addEvent()
    else ask(text)
  }

  // ⌘K-style focus from anywhere with "/" when not typing elsewhere.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as HTMLElement).closest('input,textarea,[contenteditable]')) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const Icon = { note: StickyNote, doc: FileText, lecture: AudioWaveform }
  const open = focused && (!!text || ctx.chips.length > 0)

  return (
    <div className={`ask-bar ${phone ? 'phone' : ''} ${focused ? 'focus' : ''}`}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="ask-pop"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {!text &&
              ctx.chips.map((c) => (
                <button key={c} className="ask-opt" onClick={() => (/^add\b/i.test(c) ? setQ(c) : ask(c))}>
                  <ArrowUpRight size={14} /> <span>{c}</span>
                </button>
              ))}
            {isEvent && event && (
              <button className="ask-opt on" onClick={addEvent}>
                <CalendarPlus size={14} /> <span>Add “{event.title || 'New event'}”</span>
                <small>{whenLabel(event)}</small>
              </button>
            )}
            {text && !isEvent && (
              <button className="ask-opt on" onClick={() => ask(text)}>
                <MessageCircle size={14} />{' '}
                <span>
                  Ask
                  {page ? ` about ${(page.title || 'this').slice(0, 24)}` : ''}: “{text.slice(0, 60)}”
                </span>
              </button>
            )}
            {hits.map((i) => {
              const I = Icon[i.kind]
              return (
                <button key={i.id} className="ask-opt" onClick={() => (st.open(i.id), setQ(''), input.current?.blur())}>
                  {itemEmoji(i) ? <span>{itemEmoji(i)}</span> : <I size={14} />} <span>{i.title || 'Untitled'}</span>
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="ask-field">
        <MessageCircle size={16} className="ask-ico" />
        <input
          ref={input}
          value={q}
          placeholder={ctx.hint}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') (setQ(''), input.current?.blur())
          }}
          aria-label={ctx.hint}
        />
        {text && (
          <button className="ask-send" onClick={submit} aria-label={isEvent ? 'Add event' : 'Ask'}>
            {isEvent ? <CalendarPlus size={15} /> : <ArrowUp size={15} />}
          </button>
        )}
      </div>
    </div>
  )
}
