const C = 'v13';
const SHELL = ['/', '/book.html', '/manage.html', '/track.html', '/style.css', '/qr.js', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
    .then(() => clients.claim())
    .then(() => clients.matchAll().then(l => l.forEach(c => c.postMessage('updated'))))
));
// Show the saved copy straight away, then fetch a fresh copy for next time.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.origin !== location.origin) return;
  e.respondWith(caches.open(C).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
self.addEventListener('push', e => e.waitUntil(self.registration.showNotification('New booking request', { body: 'Open the app to review and confirm it.', icon: '/icon-192.png', badge: '/icon-192.png', tag: 'new-booking' })));
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : clients.openWindow('/'))); });
