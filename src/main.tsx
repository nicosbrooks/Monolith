import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/newsreader/opsz.css'
import './index.css'
import './theme.css'
import './soft.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Last line of defence: if the app itself fails, a message and Reload, never a blank page. */}
    <ErrorBoundary area="Monolith">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Offline support in the production build only (a service worker would get in the way of hot reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
