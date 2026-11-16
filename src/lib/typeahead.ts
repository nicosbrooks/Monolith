/**
 * Keys typed after ⌘K but before quick access has loaded (its code is fetched the first time it opens). They're kept
 * here and handed to it when it appears, so the first letters of a search aren't lost or typed into the doc behind.
 */
let held = ''
export const holdKey = (key: string) => void (held = key === 'Backspace' ? held.slice(0, -1) : held + key)
export function takeHeld() {
  const out = held
  held = ''
  return out
}
