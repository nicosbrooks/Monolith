import { format } from 'date-fns'
import { useStore } from '../store'
import { APP_NAME } from '../brand'
import { toast } from '../components/Toast'
import { allEvents } from './events'

/**
 * Reminders: a notification ten minutes before an event starts, and when a task with a time comes due. Off until
 * turned on in Settings › General, which is also when the browser asks for permission.
 *
 * There is no server, so nothing can be sent while Monolith is closed: reminders arrive while it's open in a tab or
 * running as an installed app. Each is shown once (remembered across reloads for a day).
 */

const LEAD = 10 * 60_000
const KEY = 'monolith-reminded'
const seen: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
})()
function once(id: string, now: number) {
  if (seen[id]) return false
  seen[id] = now
  for (const k of Object.keys(seen)) if (now - seen[k] > 864e5) delete seen[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(seen))
  } catch {
    /* private mode: remembered for this visit only */
  }
  return true
}

async function notify(title: string, body: string, tag: string) {
  // In the app itself, when it's what's being looked at.
  if (document.visibilityState === 'visible') toast(`${title} · ${body}`, { ms: 8000 })
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) await reg.showNotification(title, { body, tag, icon: '/icon-192.png' })
    else new Notification(title, { body, tag, icon: '/icon-192.png' })
  } catch {
    /* the toast above still showed */
  }
}

function check() {
  const st = useStore.getState()
  if (!st.settings.remind) return
  const now = Date.now()
  for (const e of allEvents()) {
    if (e.allDay || e.start <= now || e.start - now > LEAD) continue
    if (!once(`e:${e.id}`, now)) continue
    const mins = Math.max(1, Math.round((e.start - now) / 60_000))
    void notify(e.title || 'Event', `In ${mins} min · ${format(e.start, 'h:mm a')}${e.location ? ` · ${e.location}` : ''}`, e.id)
  }
  for (const t of st.tasks) {
    if (t.done || t.due === undefined || t.allDay || t.due > now || now - t.due > 5 * 60_000) continue
    if (!once(`t:${t.id}:${t.due}`, now)) continue
    const doc = t.docId && st.items.find((i) => i.id === t.docId)
    void notify(t.title, `Due now${doc ? ` · ${doc.title || 'Untitled'}` : ''}`, t.id)
  }
}

let timer = 0
export function startReminders() {
  if (timer) return
  timer = window.setInterval(check, 30_000)
  check()
}

/** Turn reminders on or off. Turning them on asks the browser for permission; returns what it said. */
export async function setReminders(on: boolean): Promise<NotificationPermission | 'unsupported'> {
  useStore.getState().setSettings({ remind: on })
  if (!on) return 'default'
  if (typeof Notification === 'undefined') return 'unsupported'
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  startReminders()
  return p
}

/** One line under the switch: what will happen, or why not. */
export function reminderStatus(on: boolean): string {
  if (!on) return ''
  if (typeof Notification === 'undefined') return `This browser can’t show notifications, so reminders appear inside ${APP_NAME} only.`
  if (Notification.permission === 'denied') return `Notifications are blocked for this site, so reminders appear inside ${APP_NAME} only. Allow them in the address bar to see them elsewhere.`
  return `Ten minutes before an event, and when a task with a time is due. They arrive while ${APP_NAME} is open or running as an installed app.`
}
