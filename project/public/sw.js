// FullstackDev service worker: offline-first app shell with network-first API.
const VERSION = 'fsd-v9';
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

// ---- Real-time notification delivery ----
// OS-level push while the app is closed or in the background: show a system
// notification that deep-links into the notification panel on click. When an
// app window is visible on screen, skip the system notification — the app's
// own poller toasts the message, and showing both would duplicate it.
self.addEventListener('push', (event) => {
  let payload = { title: 'FullstackDev', body: 'You have a new notification', url: '/notifications' };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* keep defaults */ }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.some((client) => client.visibilityState === 'visible')) return;
      return self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon-192.png?v=2',
        badge: '/icon-192.png?v=2',
        tag: 'fsd-notification',
        data: { url: payload.url || '/notifications' },
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing app window and navigate it to the notification panel.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
