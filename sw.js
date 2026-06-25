/* Ilan's Arcade — service worker (offline support) */
const CACHE = 'ilan-arcade-v26';
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
  './catch/index.html',
  './f1/',
  './f1/index.html',
  './football/',
  './football/index.html',
  './try/',
  './try/index.html',
  './obby/',
  './obby/index.html',
  './obby/css/style.css',
  './obby/libs/three.module.js',
  './obby/js/main.js',
  './obby/js/World.js',
  './obby/js/Player.js',
  './obby/js/Bot.js',
  './obby/js/Net.js',
  './obby/js/Controls.js',
  './obby/js/CameraRig.js',
  './obby/js/Physics.js',
  './obby/js/Particles.js',
  './obby/js/HUD.js',
  './obby/js/Music.js',
  './obby/js/Save.js',
  './obby/js/Cosmetics.js',
  './obby/js/Character.js',
  './obby/js/Trail.js',
  './obby/js/Aura.js',
  './puzzles/',
  './puzzles/index.html'
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

// HTML pages: NETWORK-FIRST so updates appear immediately when online (fall back to cache offline).
// Other assets (icons, manifest): cache-first for speed/offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.includes('text/html');
  if (isHTML) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        return res;
      } catch (err) {
        return (await caches.match(req)) || (await caches.match('./index.html'));
      }
    })());
    return;
  }
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
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
