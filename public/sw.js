// Offline cache for the production build. The app shell and its hashed assets are cached as they're used,
// so after one visit the app opens without a network. AI models are cached separately by the AI libraries.
// The build replaces this name with one per release (vite.config.ts), so each release is a new service worker.
const CACHE = 'app-v1'

self.addEventListener('install', (e) => {
  // The first install takes over at once. An update waits for the page's Reload (lib/updates.ts) so a tab is never
  // switched to new code mid-edit; it also takes over once every Monolith tab has been closed.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/favicon.svg', '/manifest.webmanifest'])).then(() => (self.registration.active ? undefined : self.skipWaiting())))
})
self.addEventListener('message', (e) => {
  if (e.data === 'activate') self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('app-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
// LiteRT-LM's runtime (about 25–37 MB of WebAssembly) comes from a CDN at an exact version, so it never changes:
// keep it, so the Gemma models still start without a network. Models themselves are stored by the app (OPFS).
const RUNTIME = 'litert-runtime-v1'
// Also ONNX Runtime's, which Transformers.js (the fallback engine) loads from jsDelivr at an exact version.
const RUNTIME_URL = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@litert-lm\/core|onnxruntime-web)@\d[^/]*\/(wasm|dist)\//

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method === 'GET' && RUNTIME_URL.test(e.request.url)) {
    e.respondWith(
      caches.open(RUNTIME).then((c) =>
        c.match(e.request).then(
          (hit) =>
            hit ||
            fetch(e.request).then((r) => {
              if (r.ok) c.put(e.request, r.clone())
              return r
            }),
        ),
      ),
    )
    return
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/')) return
  // Pages: network first so updates arrive, cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => (caches.open(CACHE).then((c) => c.put('/', r.clone())), r))
        .catch(() => caches.match('/')),
    )
    return
  }
  // Hashed assets never change: serve from cache, fetch once.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((r) => {
          if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone()))
          return r
        }),
    ),
  )
})
