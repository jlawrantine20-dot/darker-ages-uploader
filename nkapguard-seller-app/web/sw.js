// NKAPGUARD Seller App background worker: shows notifications (new messages, orders, payments)
// and keeps the app's own files so it opens quickly, even on a weak connection.
const CACHE = 'nkg-app-v5';
const SHELL = ['./', './index.html', './app.js', './i18n.js', './styles.css', './config.js', './manifest.webmanifest', './icon-192.png', './badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// The app's own files: fresh from the network when possible, from the cache when not.
// Data from the API is never cached, so nothing shown is out of date.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('./index.html'))),
  );
});

self.addEventListener('push', (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = { title: 'NKAPGUARD', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(n.title || 'NKAPGUARD', {
    body: n.body || '',
    tag: n.tag,
    renotify: !!n.tag,
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    data: { url: n.url || '#/chats', sellerId: n.sellerId },
  }));
});

// Tapping a notification opens the app on that chat or on Orders, reusing an open window.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, sellerId } = e.notification.data || {};
  const target = new URL(`./${url || '#/chats'}`, self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      win.postMessage({ type: 'open', url, sellerId });
      return win.focus();
    }
    return self.clients.openWindow(sellerId ? `${target.split('#')[0]}?shop=${encodeURIComponent(sellerId)}#${(url || '#/chats').slice(1)}` : target);
  })());
});
