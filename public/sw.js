// Offline cache for the production build. The app shell and its hashed assets are cached as they're used,
// so after one visit the app opens without a network. AI models are cached separately by the AI libraries.
const CACHE = 'app-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/favicon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('app-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
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
