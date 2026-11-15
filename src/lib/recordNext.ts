import { format } from 'date-fns'
import { useStore } from '../store'

/**
 * Recordings created by a "Start recording" button, which should start recording as soon as they open. Without this,
 * the button only made an empty recording and a second press was needed. Kept apart from LectureView so the buttons
 * don't pull that view into the startup bundle.
 */
const pending = new Set<string>()
export const recordWhenOpened = (id: string) => void pending.add(id)
export const takeRecordWhenOpened = (id: string) => pending.delete(id)

/** Every "Start recording" button: a new recording that starts as soon as it opens. */
export function startRecording(title?: string) {
  const made = useStore.getState().createItem('lecture', { title: title || `Recording · ${format(new Date(), 'MMM d')}` })
  recordWhenOpened(made.id)
  return made
}
