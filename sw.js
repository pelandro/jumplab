// Service worker: shell dell'app in cache per l'uso offline; modelli e WASM vengono messi in cache al primo uso.
const VERSION = 'jumplab-v4.11.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './icons/icon-192.png',
  './js/main.js', './js/store.js',
  './js/engine/signal.js', './js/engine/jumps.js', './js/engine/video.js', './js/engine/pose.js', './js/engine/pipeline.js',
  './js/engine/quality.js', './js/engine/footflow.js', './js/engine/validate.js', './js/engine/fusion.js', './js/ui/guide.js',
  './js/ui/dom.js', './js/ui/home.js', './js/ui/analyze.js', './js/ui/review.js', './js/ui/history.js', './js/ui/profile.js',
  './js/ui/player.js', './js/ui/chart.js', './js/ui/camera.js', './js/ui/viz.js', './js/ui/report.js', './js/ui/explain.js',
  './vendor/mp4box.all.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  const heavy = /\/(models|vendor)\//.test(url.pathname);
  if (heavy) {
    // risorse pesanti e immutabili: cache first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // codice dell'app: network first (aggiornamenti immediati), cache come ripiego offline
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
});
