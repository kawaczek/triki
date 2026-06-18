// sw.js — Triki Games Service Worker
const CACHE = 'triki-v202606182100';

const PRECACHE = [
  '/',
  '/static/triki.js?v=202606182100',
  '/static/app.js?v=202606182100',
  '/static/style.css?v=202606182100',
  '/static/gameutils.js',
  '/static/sound.js',
  '/static/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API i BLE — zawsze z sieci
  if (url.pathname.startsWith('/api/') || e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok && (
          url.searchParams.has('v') ||
          url.pathname.startsWith('/static/') ||
          url.pathname.startsWith('/games/')
        )) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
      // Wersjonowane assety: cache-first; HTML: network-first
      if (cached && url.searchParams.has('v')) return cached;
      return network.catch(() => cached || new Response('Offline — brak połączenia', { status: 503 }));
    })
  );
});
