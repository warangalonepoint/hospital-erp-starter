// service-worker.js — static PWA caching for Hospital ERP Starter
// Bump CACHE_VERSION whenever you ship new JS/HTML to force refresh.
const CACHE_VERSION = 'erp-cache-v5';
const CACHE_NAME = `${CACHE_VERSION}`;

// Try to infer the repo base path (works on GitHub Pages subpaths)
const SCOPE = self.registration.scope || '/';
const BASE = new URL(SCOPE).pathname.replace(/\/$/, '');

// Core assets to pre-cache (add more pages here if needed)
const PRECACHE_URLS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/styles/styles.css`,
  `${BASE}/scripts/utils.js`,
  `${BASE}/scripts/scanner.js`,
  `${BASE}/pages/dashboard.html`,
  `${BASE}/pages/pharmacy.html`,
  `${BASE}/pages/login.html`,
  `${BASE}/manifest.json`,
];

// Install: pre-cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//  - HTML pages: Network-first (so UI updates when online)
//  - Assets (css/js/png): Cache-first, then network fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // HTML pages -> network-first
  const isHTML = req.destination === 'document' || req.headers.get('accept')?.includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match(`${BASE}/index.html`)))
    );
    return;
  }

  // Assets -> cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return resp;
      });
    })
  );
});

// Optional: background refresh for frequently used CSVs (if you add them to data/)
