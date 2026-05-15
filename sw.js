const CACHE = 'monet-arcade-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/arcade.html',
  '/login.html',
  '/leaderboard.html',
  '/challenge.html',
  '/tournament.html',
  '/styles.css',
  '/wallet.js',
  '/lobby.js',
  '/logo.png',
  '/dino-sprite.png',
  '/favicon.svg',
  '/manifest.json',
  '/mario.html',
  '/pacman.html',
  '/dino.html',
  '/frogger.html',
  '/snake.html',
  '/invaders.html',
  '/pong.html',
  '/fighter.html',
  '/duckhunt.html',
  '/dodger.html',
  '/reaction.html',
  '/tap.html',
  '/tetris.html',
  '/kong.html',
  '/racer.html',
  '/gator.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go network-first for API calls
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && e.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
