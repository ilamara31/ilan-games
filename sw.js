/* Ilan's Arcade — service worker (offline support) */
const CACHE = 'ilan-arcade-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './cricket/',
  './cricket/index.html',
  './catch/',
  './catch/index.html'
];

// pre-cache the app shell (resilient: one bad URL won't fail the whole install)
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

// drop old caches
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

// cache-first, fall back to network and cache the result; offline page falls back to cache
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // last resort for navigations when offline
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
