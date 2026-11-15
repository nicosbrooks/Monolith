/**
 * Recordings created by a "Start recording" button, which should start recording as soon as they open. Without this,
 * the button only made an empty recording and a second press was needed. Kept apart from LectureView so the buttons
 * don't pull that view into the startup bundle.
 */
const pending = new Set<string>()
export const recordWhenOpened = (id: string) => void pending.add(id)
export const takeRecordWhenOpened = (id: string) => pending.delete(id)
