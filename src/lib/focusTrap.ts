/**
 * Keeps Tab and Shift+Tab inside whichever dialog is on top (Settings, Backup, the file viewer, confirmations, the
 * command menu…), so keyboard and screen-reader users can't wander into the page behind it. One listener covers them
 * all; a dialog only has to be marked `aria-modal="true"` or be a `.modal` in an `.overlay`.
 */
const DIALOG = '[aria-modal="true"], .overlay > .modal, [cmdk-dialog]'
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
/** On screen and reachable: not hidden, and not inside a closed <details> (other than as its summary). */
function shown(el: HTMLElement) {
  if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return false
  const closed = el.closest('details:not([open])')
  if (!closed) return true
  return el.tagName === 'SUMMARY' && el.parentElement === closed && !closed.parentElement?.closest('details:not([open])')
}

export function installFocusTrap() {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const dialogs = [...document.querySelectorAll<HTMLElement>(DIALOG)].filter(shown)
      const top = dialogs[dialogs.length - 1]
      if (!top) return
      const items = [...top.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown)
      const active = document.activeElement as HTMLElement | null
      if (!items.length) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (!active || !top.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      }
    },
    true,
  )
}
