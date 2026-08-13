const CACHE = 'kai-shell-v9';
const SHELL = [
  './',
  './index.html',
  './about.html',
  './manifest.webmanifest',
  './icon.svg',
  './tokens.css',
  './src/ui/style.css',
  './src/ui/main.js',
  './src/ui/tubes.js',
  './docs/arena/live.html',
  './docs/arena/live.css',
  './docs/arena/live.js',
  './docs/arena/verified-board.json',
  './docs/arena/verified-replay.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
