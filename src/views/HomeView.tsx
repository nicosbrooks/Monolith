import { useId, useState } from 'react'
import { addDays, format, formatDistanceToNowStrict, isSameDay, isToday, startOfDay } from 'date-fns'
import { ArrowUpRight, CalendarDays, CheckSquare, Clock3, FileText, Mic, StickyNote, Loader2, X } from 'lucide-react'
import { useMobile, useScrolled } from '../lib/useMobile'
import { PhoneTitle } from '../components/Phone'
import { useStore } from '../store'
import { extractOpenTodos, htmlToText, itemEmoji, mdToHtml } from '../lib/util'
import { chat, enqueue, isReady, SYSTEM, useAI } from '../ai/llm'
import { useRuleSuggestions } from '../ai/suggestions'
import { useSubEvents } from '../lib/calendars'
import { COLORS } from '../lib/colors'
import type { CalEvent } from '../types'

const KindIcon = { note: StickyNote, doc: FileText, lecture: Mic }

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
  const [brief, setBrief] = useState<{ text: string; done: boolean } | null>(null)

  const now = new Date()
  const live = items.filter((i) => !i.deletedAt)
  const todays = events
    .filter((e) => (e.allDay ? e.start <= now.getTime() && e.end > startOfDay(now).getTime() : isToday(e.start)))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
  const upcoming = events
    .filter((e) => e.start >= addDays(startOfDay(now), 1).getTime() && e.start < addDays(startOfDay(now), 7).getTime())
    .sort((a, b) => a.start - b.start)
    .slice(0, 4)
  const recent = live.filter((i) => !i.file?.dir).sort((a, b) => b.updatedAt - a.updatedAt)
  const todos = live.flatMap((i) => extractOpenTodos(i.content, i.id))

  const toggleTodo = (itemId: string, text: string) => {
    const it = live.find((i) => i.id === itemId)
    if (!it) return
    const template = document.createElement('template')
    template.innerHTML = it.content
    const li = [...template.content.querySelectorAll('li[data-checked="false"]')].find((l) => (l.textContent || '').trim() === text)
    if (!li) return
    li.setAttribute('data-checked', 'true')
    st.updateItem(itemId, { content: template.innerHTML })
  }

  const makeBrief = async () => {
    setBrief({ text: '', done: false })
    const ctx = `Today: ${format(now, 'EEEE, MMMM d, h:mm a')}\nToday's events:\n${todays.map((e) => `- ${e.allDay ? 'all day' : format(e.start, 'h:mm a')} ${e.title}`).join('\n') || '(none)'}\nThis week:\n${upcoming.map((e) => `- ${format(e.start, 'EEE h:mm a')} ${e.title}`).join('\n') || '(none)'}\nOpen tasks:\n${todos.slice(0, 6).map((t) => `- ${t.text}`).join('\n') || '(none)'}\nRecently worked on:\n${recent.slice(0, 5).map((r) => `- ${r.title}: ${htmlToText(r.content).slice(0, 160)}`).join('\n')}`
    const out = await enqueue(() =>
      chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: `Write a calm daily brief in under 90 words: name the single most important thing today, then 2–3 bullets for a realistic plan with times when possible. No greeting, no exclamation marks.\n\n${ctx}` }], (t) => setBrief({ text: t, done: false }), { temperature: 0.4, maxTokens: 260 }),
    )
    setBrief({ text: out, done: true })
  }

  const nudge = proactive ? suggestions[0] : undefined
  const remaining = todays.filter((event) => event.allDay || event.end > now.getTime()).length
  const scheduleStatus = remaining ? `${remaining} event${remaining === 1 ? '' : 's'} left today` : todays.length ? 'Finished for today' : 'Nothing scheduled today'

  return (
    <div className={`home page-scroll ${mobile ? 'p-screen' : ''}`} onScroll={mobile ? onScroll : undefined}>
      {mobile && <PhoneTitle title="" scrolled={scrolled} />}
      <div className="home-page">
        <header className="home-header">
          <div>
            <h1>Home</h1>
            <time dateTime={format(now, 'yyyy-MM-dd')}>{format(now, 'EEEE, MMMM d')}</time>
          </div>
          {isReady() && (
            <button className="btn sm" disabled={brief?.done === false} onClick={makeBrief}>Plan my day</button>
          )}
        </header>

        {brief && (
          <section className="home-panel home-brief" aria-labelledby="home-plan-title">
            <div className="home-panel-head">
              <h2 id="home-plan-title">Daily plan</h2>
              {brief.done ? <button className="icon-btn sm" aria-label="Dismiss daily plan" onClick={() => setBrief(null)}><X size={15} /></button> : <Loader2 size={14} className="spin muted" aria-label="Writing daily plan" />}
            </div>
            <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(brief.text) || '<p class="muted">Thinking…</p>' }} />
          </section>
        )}

        <div className="home-panels">
          <section className="home-panel home-schedule" aria-labelledby="home-schedule-title">
            <div className="home-panel-head">
              <h2 id="home-schedule-title"><CalendarDays size={16} aria-hidden="true" /> Schedule</h2>
              <span>{scheduleStatus}</span>
            </div>
            <WeekStrip events={events} today={startOfDay(now)} />
            {nudge && (
              <div className="nudge" key={nudge.id}>
                <i className="dot" />
                <span>{nudge.title}{nudge.detail && <small>{nudge.detail}</small>}</span>
                {nudge.action && <button className="btn sm primary" onClick={() => (nudge.action!.run(), st.dismiss(nudge.id))}>{nudge.action.label.replace(/ event$/, '')}</button>}
                <button className="icon-btn" onClick={() => st.dismiss(nudge.id)} aria-label="Not needed" title="Not needed"><X size={16} /></button>
              </div>
            )}
          </section>

          <section className="home-panel home-tasks" aria-labelledby="home-tasks-title">
            <div className="home-panel-head">
              <h2 id="home-tasks-title"><CheckSquare size={16} aria-hidden="true" /> Open tasks</h2>
              {todos.length > 0 && <span>{todos.length} open</span>}
            </div>
            {todos.length > 0 ? (
              <div className="home-rows">
                {todos.slice(0, 6).map((t, i) => (
                  <label key={`${t.itemId}:${t.text}:${i}`} className="soft-row">
                    <input type="checkbox" checked={false} onChange={() => toggleTodo(t.itemId, t.text)} />
                    <span className="home-row-copy">
                      <span>{t.text}</span>
                      <small>{live.find((x) => x.id === t.itemId)?.title || 'Untitled'}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : <p className="home-empty">No open tasks.</p>}
          </section>

          <section className="home-panel home-recent" aria-labelledby="home-recent-title">
            <div className="home-panel-head"><h2 id="home-recent-title"><Clock3 size={16} aria-hidden="true" /> Recent work</h2></div>
            {recent.length > 0 ? (
              <div className="home-rows">
                {recent.slice(0, 3).map((r) => {
                  const Icon = KindIcon[r.kind]
                  const emoji = itemEmoji(r)
                  return (
                    <button key={r.id} className="soft-row" onClick={() => st.open(r.id)}>
                      <span className="home-item-icon">{emoji || <Icon size={17} strokeWidth={1.8} />}</span>
                      <span className="home-row-copy">
                        <span>{r.title || 'Untitled'}</span>
                        <small>{formatDistanceToNowStrict(r.updatedAt, { addSuffix: true })}</small>
                      </span>
                      <ArrowUpRight size={14} className="home-recent-arrow" aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            ) : <p className="home-empty">Your recent notes, docs and recordings will appear here.</p>}
          </section>
        </div>
      </div>
    </div>
  )
}

function WeekStrip({ events, today }: { events: CalEvent[]; today: Date }) {
  const id = useId()
  const [selected, setSelected] = useState<number | null>(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const active = days.some((d) => d.getTime() === selected) ? selected : today.getTime()
  const on = (d: Date) =>
    events
      .filter((e) => (e.allDay ? e.start < addDays(d, 1).getTime() && e.end > d.getTime() : isSameDay(e.start, d)))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
  return (
    <div className="week-strip-shell">
      <ul className="week-strip" role="list" aria-label="Next seven days">
        {days.map((d, i) => {
          const day = d.getTime()
          const expanded = day === active
          const evs = on(d)
          const dateLabel = format(d, 'EEEE, MMMM d')
          const countLabel = `${evs.length} event${evs.length === 1 ? '' : 's'}`
          return (
            <li key={day} className={expanded ? 'expanded' : undefined}>
              <button type="button" className={`ws-day${i === 0 ? ' today' : ''}`} onClick={() => { if (!expanded) setSelected(day) }} aria-current={i === 0 ? 'date' : undefined} aria-expanded={expanded} aria-disabled={expanded || undefined} aria-controls={`${id}-${i}`} aria-label={`${dateLabel}, ${countLabel}`}>
                <span className="ws-dow">{i === 0 ? 'Today' : format(d, 'EEE')}</span>
                <span className="ws-num">{format(d, 'd')}</span>
                <span className="ws-dots" aria-hidden="true">
                  {evs.slice(0, 3).map((e) => <i key={e.id} style={{ background: COLORS[e.color] || COLORS.blue }} />)}
                </span>
              </button>
              <div id={`${id}-${i}`} className="ws-details" hidden={!expanded}>
                {evs.length ? (
                  <ul className="ws-evs" role="list">
                    {evs.slice(0, 3).map((e) => (
                      <li key={e.id} className="ws-event" style={{ '--c': COLORS[e.color] || COLORS.blue } as React.CSSProperties}>
                        <span className="ws-time">{e.allDay ? 'All day' : format(e.start, 'h:mm a').replace(':00', '')}</span>
                        <span className="ws-event-title" title={e.title || 'Untitled event'}>{e.title || 'Untitled event'}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="ws-empty">Nothing scheduled</p>}
                <div className="ws-footer">
                  <button type="button" className="ws-open" onClick={() => useStore.getState().openCalendarDate(d)}>Open in Calendar <ArrowUpRight size={13} aria-hidden="true" /></button>
                  {evs.length > 3 && <small>+{evs.length - 3} more</small>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
