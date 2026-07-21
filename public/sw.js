/**
 * Cache-first service worker for instant launch from the Home Screen.
 *
 * Bump CACHE_VERSION whenever shell files change. The browser reinstalls the
 * worker on any byte change to this file, and skipWaiting + clients.claim make
 * the new shell take effect on the next launch rather than lingering for a
 * session — without that, cache-first would pin users to a stale app forever.
 */
const CACHE_VERSION = 'v9';
const CACHE_NAME = `niche-eats-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manage.html',
  './manifest.json',
  './js/app.js',
  './js/manage.js',
  './js/api.js',
  './js/spots.js',
  './js/config.js',
  './js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Individual puts: one 404 in addAll would reject the whole install and
      // leave the app with no worker at all.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase: spot data and function results must be live, and a
  // stale open/closed list is worse than no list.
  if (url.hostname.endsWith('.supabase.co')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache successful same-origin responses, plus the Tailwind CDN
          // (opaque) so the app still renders styled when offline.
          const cacheable =
            response.ok || (response.type === 'opaque' && url.hostname === 'cdn.tailwindcss.com');
          if (cacheable) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and uncached: for a navigation, fall back to the shell so
          // the app opens and can show its own error state.
          if (request.mode === 'navigate') return caches.match('./index.html');
          throw new Error('Offline and not cached');
        });
    }),
  );
});
