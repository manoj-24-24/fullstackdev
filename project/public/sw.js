// FullstackDev service worker: offline-first app shell with network-first API.
const VERSION = 'fsd-v6';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest?v=3',
  '/icon-192.png?v=2',
  '/icon-512.png?v=2',
  '/icon-maskable.png?v=2',
  '/favicon.png?v=2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API + uploaded files: try the network, fall back to the last cached copy.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/storage/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || new Response(JSON.stringify({ data: null, error: { message: 'You are offline. Showing saved data.' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    );
    return;
  }

  // SPA navigations: network first, cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets (vite bundles, icons): cache-first, they are content-hashed.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(request, copy));
      }
      return res;
    }))
  );
});
