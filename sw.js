// Service Worker: macht die App installierbar und startet die Oberfläche schnell.
// Portfolio-Daten (Sheets API), Kurse und Login werden NIE gecacht.
const CACHE = 'anlagen-v3';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/auth.js', 'js/config.js', 'js/format.js', 'js/history.js', 'js/model.js', 'js/sheets.js',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
];
const CDN = 'https://cdnjs.cloudflare.com/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Chart.js (versionierte URL) → Cache zuerst
  if (req.url.startsWith(CDN)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Nur eigene App-Dateien; alles andere (Google, CoinGecko, Proxy) unangetastet
  if (url.origin !== self.location.origin) return;

  // Netzwerk zuerst → Updates sofort sichtbar; offline aus dem Cache.
  // OAuth-Rückkehr hat das Token nur im Fragment (#…), das nie an den Server/SW geht.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && url.search === '') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
