import { useState } from 'react'
import { addDays, format, formatDistanceToNowStrict, isSameDay, isToday, startOfDay } from 'date-fns'
import { ArrowUpRight, CalendarDays, FileText, ListChecks, MapPin, AudioWaveform, StickyNote } from 'lucide-react'
import { useMobile, useScrolled } from '../lib/useMobile'
import { PhoneTitle } from '../components/Phone'
import { useStore } from '../store'
import { extractOpenTodos, htmlToText, itemEmoji } from '../lib/util'
import { isReady, useAI } from '../ai/llm'
import { useRuleSuggestions } from '../ai/suggestions'
import { useSubEvents } from '../lib/calendars'
import { COLORS } from '../lib/colors'
import type { CalEvent } from '../types'
import { toast } from '../components/Toast'
import { openMenu } from '../components/Overlays'
import { docMenu } from '../components/Sidebar'
import { awayFor, greeting, startersTitle } from '../lib/greeting'

const KindIcon = { note: StickyNote, doc: FileText, lecture: AudioWaveform }

const same = (a: string, b: string) => a.replace(/\W+/g, '').toLowerCase() === b.replace(/\W+/g, '').toLowerCase()
const SHOWN = 5

export function HomeView() {
  const items = useStore((s) => s.items)
  const own = useStore((s) => s.events)
  const subs = useSubEvents()
  const events = [...own, ...subs]
  const proactive = useStore((s) => s.settings.proactive)
  const st = useStore.getState()
  useAI((s) => s.status)
  const suggestions = useRuleSuggestions()
  const mobile = useMobile()
  const [scrolled, onScroll] = useScrolled()
  const [allTasks, setAllTasks] = useState(false)
  const name = useStore((s) => s.settings.name)
  const setupAt = useStore((s) => s.settings.setupAt)
  const [away] = useState(() => awayFor(new Date()))

  const now = new Date()
  const today = startOfDay(now)
  const live = items.filter((i) => !i.deletedAt)
  const todays = events
    .filter((e) => (e.allDay ? e.start <= now.getTime() && e.end > today.getTime() : isToday(e.start)))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
  const upcoming = events
    .filter((e) => e.start >= addDays(today, 1).getTime() && e.start < addDays(today, 7).getTime())
    .sort((a, b) => a.start - b.start)
    .slice(0, 4)
  const recent = live.filter((i) => !i.file?.dir).sort((a, b) => b.updatedAt - a.updatedAt)
  const nudge = proactive ? suggestions[0] : undefined
  // The assistant is already asking about this line, so it isn't listed a second time under Tasks.
  const todos = live.flatMap((i) => extractOpenTodos(i.content, i.id)).filter((t) => !(nudge?.found && t.itemId === nudge.found.itemId && same(t.text, nudge.found.line)))

  const checkTodo = (itemId: string, text: string) => {
    const it = live.find((i) => i.id === itemId)
    if (!it) return
    const template = document.createElement('template')
    template.innerHTML = it.content
    const li = [...template.content.querySelectorAll('li[data-checked="false"]')].find((l) => (l.textContent || '').trim() === text)
    if (!li) return
    li.setAttribute('data-checked', 'true')
    const before = it.content
    st.updateItem(itemId, { content: template.innerHTML })
    toast('Task done', { ms: 6000, action: { label: 'Undo', run: () => useStore.getState().updateItem(itemId, { content: before }) } })
  }

  const restore = (id: string) => useStore.setState((s) => ({ dismissed: s.dismissed.filter((d) => d !== id) }))
  const notNow = (id: string) => {
    st.dismiss(id)
    toast('Suggestion hidden', { ms: 6000, action: { label: 'Undo', run: () => restore(id) } })
  }
  const addFound = (id: string, add: () => string) => {
    const eventId = add()
    toast('Added to calendar', { ms: 6000, action: { label: 'Undo', run: () => (useStore.getState().deleteEvent(eventId), restore(id)) } })
  }

  // Starting points, built from what's actually on today. Each opens the assistant with the question asked,
  // so the person can take it anywhere from there. Never a fixed plan.
  const next = todays.find((e) => !e.allDay && e.end > now.getTime()) ?? todays.find((e) => e.end > now.getTime()) ?? upcoming[0]
  const lastDoc = recent.find((r) => r.kind !== 'lecture' && htmlToText(r.content).trim())
  const starters: { icon: typeof FileText; text: string }[] = isReady()
    ? [
        next && { icon: CalendarDays, text: `Help me get ready for “${next.title}”` },
        todos.length > 1 ? { icon: ListChecks, text: `Which of my ${todos.length} tasks should I do first?` } : todos[0] && { icon: ListChecks, text: `Help me with “${todos[0].text}”` },
        lastDoc && { icon: FileText, text: `Summarize “${lastDoc.title || 'Untitled'}”` },
      ].filter((x): x is { icon: typeof FileText; text: string } => !!x)
    : []
  const ask = (prompt: string) => useStore.setState({ askDraft: prompt, aiOpen: true })
  const tasks = allTasks ? todos : todos.slice(0, SHOWN)

  return (
    <div className={`home page-scroll ${mobile ? 'p-screen' : ''}`} onScroll={mobile ? onScroll : undefined}>
      {mobile && <PhoneTitle title="" scrolled={scrolled} />}
      <div className="hm">
        <header className="hm-head">
          <h1>{greeting(now, name, away)}</h1>
          <time dateTime={format(now, 'yyyy-MM-dd')}>{format(now, 'EEEE, MMMM d')}</time>
        </header>

        {/* The one place the assistant speaks on Home: a question with its exact source, or a few places to start. */}
        {nudge ? (
          <section className="hm-card hm-asst" aria-label="Assistant" key={nudge.id}>
            <div className="hm-asst-top">Suggestion</div>
            {nudge.found ? (
              <>
                <h2>Add “{nudge.found.what}” to your calendar?</h2>
                <p>{nudge.found.when}</p>
                <button className="hm-source" onClick={() => st.open(nudge.found!.itemId)} title="Open the doc this came from">
                  <FileText size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span><b>{nudge.found.docTitle}</b><q>{nudge.found.line}</q></span>
                </button>
              </>
            ) : (
              <>
                <h2>{nudge.title}</h2>
                {nudge.detail && <p>{nudge.detail}</p>}
              </>
            )}
            <div className="hm-asst-actions">
              {nudge.found ? (
                <button className="btn primary" onClick={() => addFound(nudge.id, nudge.found!.add)}>Add to calendar</button>
              ) : nudge.action ? (
                <button className="btn primary" onClick={() => (nudge.action!.run(), st.dismiss(nudge.id))}>{nudge.action.label}</button>
              ) : null}
              <button className="btn" onClick={() => notNow(nudge.id)}>Not now</button>
            </div>
          </section>
        ) : starters.length ? (
          <section className="hm-card hm-asst" aria-label="Assistant">
            <div className="hm-asst-top">{startersTitle({ now, setupAt, soon: !!next && !next.allDay && next.start - now.getTime() < 90 * 60_000, onlyDocs: starters.length === 1 && starters[0].icon === FileText })}</div>
            <div className="hm-starters">
              {starters.map(({ icon: Icon, text }) => (
                <button key={text} className="hm-starter" onClick={() => ask(text)} title="Ask the assistant">
                  <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span>{text}</span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <Week events={events} today={today} />

        <section className="hm-sec" aria-labelledby="hm-tasks">
          <div className="hm-label"><h2 id="hm-tasks">Tasks</h2></div>
          <div className="hm-card hm-list">
            {tasks.map((t, i) => (
              <div key={`${t.itemId}:${t.text}:${i}`} className="hm-row hm-task">
                <input type="checkbox" checked={false} aria-label={`Mark done: ${t.text}`} onChange={() => checkTodo(t.itemId, t.text)} />
                <button className="hm-row-main" onClick={() => st.open(t.itemId)} title="Open the doc">
                  <span>{t.text}</span>
                  <small>{live.find((x) => x.id === t.itemId)?.title || 'Untitled'}</small>
                </button>
              </div>
            ))}
            {!todos.length && <p className="hm-empty">Nothing to do. Checklist items from your docs show up here.</p>}
            {todos.length > SHOWN && <button className="hm-more" onClick={() => setAllTasks(!allTasks)}>{allTasks ? 'Show fewer' : `Show all ${todos.length}`}</button>}
          </div>
        </section>

        <section className="hm-sec" aria-labelledby="hm-recent">
          <div className="hm-label">
            <h2 id="hm-recent">Recent</h2>
            {recent.length > SHOWN && <button onClick={() => st.go('docs')}>See all</button>}
          </div>
          <div className="hm-card hm-list">
            {recent.slice(0, SHOWN).map((r) => {
              const Icon = KindIcon[r.kind]
              return (
                <button key={r.id} className="hm-row" onClick={() => st.open(r.id)} onContextMenu={r.kind === 'lecture' ? undefined : (e) => openMenu(e, docMenu(r))}>
                  <span className="hm-ico">{itemEmoji(r) || <Icon size={17} strokeWidth={1.8} />}</span>
                  <span className="hm-row-title">{r.title || 'Untitled'}</span>
                  <small>{now.getTime() - r.updatedAt < 60_000 ? 'Just now' : formatDistanceToNowStrict(r.updatedAt, { addSuffix: true })}</small>
                </button>
              )
            })}
            {!recent.length && <p className="hm-empty">Docs and recordings you’ve worked on show up here.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}

/** The next seven days: pick a day to see what's on; pick it again (or the link) to open it in Calendar. */
function Week({ events, today }: { events: CalEvent[]; today: Date }) {
  const [selected, setSelected] = useState(today.getTime())
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const active = days.find((d) => d.getTime() === selected) ?? today
  const on = (d: Date) =>
    events
      .filter((e) => (e.allDay ? e.start < addDays(d, 1).getTime() && e.end > d.getTime() : isSameDay(e.start, d)))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
  const evs = on(active)
  const openDay = () => useStore.getState().openCalendarDate(active)
  return (
    <section className="hm-sec" aria-labelledby="hm-week">
      <div className="hm-label">
        <h2 id="hm-week">Calendar</h2>
        <button onClick={openDay}>Open</button>
      </div>
      <div className="hm-card">
        <div className="hm-week" role="tablist" aria-label="Next seven days">
          {days.map((d, i) => {
            const isOn = d.getTime() === active.getTime()
            const n = on(d)
            return (
              <button key={d.getTime()} role="tab" aria-selected={isOn} className={isOn ? 'on' : undefined} onClick={() => (isOn ? openDay() : setSelected(d.getTime()))} aria-label={`${format(d, 'EEEE, MMMM d')}, ${n.length} event${n.length === 1 ? '' : 's'}`}>
                <span>{i === 0 ? 'Today' : format(d, 'EEE')}</span>
                <b>{format(d, 'd')}</b>
                <i aria-hidden="true">{n.slice(0, 3).map((e) => <u key={e.id} style={{ background: COLORS[e.color] || COLORS.blue }} />)}</i>
              </button>
            )
          })}
        </div>
        <div className="hm-list">
          {evs.slice(0, SHOWN).map((e) => (
            <button key={e.id} className="hm-row" onClick={openDay}>
              <u className="hm-bar" aria-hidden="true" style={{ background: COLORS[e.color] || COLORS.blue }} />
              <span className="hm-ev">
                <span className="hm-row-title">{e.title || 'Untitled event'}</span>
                {e.location?.trim() && <small><MapPin size={12} aria-hidden="true" /> {e.location.trim()}</small>}
              </span>
              {e.allDay ? (
                <span className="hm-ev-time">All day</span>
              ) : (
                <span className="hm-ev-time"><b>{format(e.start, 'h:mm a')}</b>{format(e.end, 'h:mm a')}</span>
              )}
            </button>
          ))}
          {!evs.length && <p className="hm-empty">Nothing scheduled.</p>}
          {evs.length > SHOWN && <button className="hm-more" onClick={openDay}>{evs.length - SHOWN} more in Calendar</button>}
        </div>
      </div>
    </section>
  )
}
