/* Ilan's Arcade — service worker (offline support) */
const CACHE = 'ilan-arcade-v77';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './analytics.js',
  './announce.js',
  './friends.js',
  './rec.js',
  './supabase-config.js',
  './auth.js',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './cricket/',
  './cricket/index.html',
  './catch/',
  './catch/index.html',
  './catch2/',
  './catch2/index.html',
  './handcricket/',
  './handcricket/index.html',
  './f1/',
  './f1/index.html',
  './f1/2d.html',
  './f1/3d.html',
  './f1/libs/three.module.js',
  './football/',
  './football/index.html',
  './football/2d.html',
  './football/3d.html',
  './pptour/',
  './pptour/index.html',
  './fruit-arena/',
  './fruit-arena/index.html',
  './paper/',
  './paper/index.html',
  './stack/',
  './stack/index.html',
  './archer/',
  './archer/index.html',
  './rescue/',
  './rescue/index.html',
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
  './puzzles/index.html',
  './anime-tycoon/',
  './anime-tycoon/index.html',
  './tennis/',
  './tennis/index.html',
  './karate/',
  './karate/index.html',
  './thisorthat/',
  './thisorthat/index.html',
  './teaser/',
  './teaser/index.html',
  './codebreaker/',
  './codebreaker/index.html'
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
  // never touch cross-origin requests (Supabase API, CDN SDK, etc.) — let the browser handle them
  if (new URL(req.url).origin !== self.location.origin) return;
  const accept = req.headers.get('accept') || '';
  const path = new URL(req.url).pathname;
  // messages.json must always be fresh (announcements). Network-first, no caching.
  if (path.endsWith('messages.json')) {
    e.respondWith(fetch(req).catch(() => new Response('{"messages":[]}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  // auth/config scripts change often — always try the network first (fall back to cache offline)
  if (path.endsWith('/auth.js') || path.endsWith('/supabase-config.js') || path.endsWith('/friends.js')) {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  const isHTML = req.mode === 'navigate' || accept.includes('text/html');
  if (isHTML) {
    // network-first, but don't wait forever: if a cached copy exists and the network
    // takes >2.5s, serve the cache instantly (the network still updates it in the background).
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => { cache.put(req, res.clone()); return res; });
      network.catch(() => {});                       // avoid unhandled rejection when we fall back
      if (!cached) {
        try { return await network; } catch (err) { return (await caches.match('./index.html')); }
      }
      let timer;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(0), 2500); });
      try { const r = await Promise.race([network, timeout]); clearTimeout(timer); return r; }
      catch (err) { return cached; }                 // slow/offline → instant cached copy
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
