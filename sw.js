// Service worker: cache dell'app shell, rete per il backend
const CACHE = 'spiccioli-v1.10.1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon2-192.png', 'icons/icon2-512.png', 'icons.js', 'icons/apple-touch-icon2.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // backend Apps Script: sempre rete
  // network-first per l'app shell: gli aggiornamenti arrivano subito, offline usa la cache
  e.respondWith(
    // cache:'no-cache' = rivalida sempre col server, ignora il max-age=600 di GitHub Pages
    fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
