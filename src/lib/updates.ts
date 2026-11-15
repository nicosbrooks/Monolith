import { saveNow } from '../store'
import { toast } from '../components/Toast'

/**
 * Offline support and updates (production build only). Each build gets its own service worker (vite.config.ts stamps
 * its cache name), so a new release is noticed: on start, every hour, and whenever the tab comes back. The new version
 * waits until you choose Reload, so nothing changes under you mid-edit; then the doc in hand is saved first.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const start = async () => {
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null)
    if (!reg) return
    // A version that finished installing while no Monolith tab was open is already waiting.
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const next = reg.installing
      next?.addEventListener('statechange', () => {
        // With no controller this is the first install, not an update: nothing to offer.
        if (next.state === 'installed' && navigator.serviceWorker.controller) offer(next)
      })
    })
    const check = () => void reg.update().catch(() => {})
    setInterval(check, 60 * 60_000)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  }
  if (document.readyState === 'complete') void start()
  else window.addEventListener('load', () => void start())
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !wanted) return
    reloading = true
    location.reload()
  })
}

let wanted = false
let offered = false
function offer(sw: ServiceWorker) {
  if (offered) return
  offered = true
  toast('A new version of Monolith is ready', {
    ms: 24 * 60 * 60_000,
    action: {
      label: 'Reload',
      run: async () => {
        await saveNow().catch(() => {})
        wanted = true
        sw.postMessage('activate')
      },
    },
  })
}
