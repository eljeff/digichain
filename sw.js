const cacheName = 'cache-v131';
const precacheResources = [
  './',
  'index.html',
  'lib.css?v=131',
  'main.css?v=131',
  'resources.js?v=131',
  'main.js?v=131',
  'apple-touch-icon.png',
  'favicon-32x32.png',
  'favicon-16x16.png',
  'site.webmanifest',
  'safari-pinned-tab.svg',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',

];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(precacheResources)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request);
      }),
  );
});