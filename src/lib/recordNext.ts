import { format } from 'date-fns'
import { useStore } from '../store'

/**
 * Recordings created by a "Start recording" button, which should start recording as soon as they open. Without this,
 * the button only made an empty recording and a second press was needed. Kept apart from LectureView so the buttons
 * don't pull that view into the startup bundle.
 */
const pending = new Set<string>()
export const recordWhenOpened = (id: string) => void pending.add(id)
export const willRecordWhenOpened = (id: string) => pending.has(id)
export const takeRecordWhenOpened = (id: string) => pending.delete(id)

/** Every "Start recording" button: a new recording that starts as soon as it opens. */
export function startRecording(title?: string) {
  const made = useStore.getState().createItem('lecture', { title: title || `Recording · ${format(new Date(), 'MMM d')}` })
  recordWhenOpened(made.id)
  return made
}

const toTranscribe = new Set<string>()
export const takeTranscribeWhenOpened = (id: string) => toTranscribe.delete(id)

/** Every "Upload audio" button: pick a file first (nothing is made if you cancel), then a recording named after it
 *  that starts transcribing as soon as it opens. */
export function uploadRecording() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*,video/*'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    const { saveAudio } = await import('../store')
    const made = useStore.getState().createItem('lecture', { title: f.name.replace(/\.[^.]+$/, '') })
    await saveAudio(made.id, f)
    const cur = useStore.getState().items.find((i) => i.id === made.id)?.lecture
    if (cur) useStore.getState().updateItem(made.id, { lecture: { ...cur, hasAudio: true } })
    toTranscribe.add(made.id)
    // The view may already be open on it; tell it to look again.
    window.dispatchEvent(new CustomEvent('monolith:transcribe', { detail: made.id }))
  }
  input.click()
}
