// Guarda solo la interfaz para que cargue aunque el servidor reinicie.
// Nunca se guardan respuestas de /api (datos de pacientes y de inventario).
const C = 'cdi-shell-v6';
self.addEventListener('install', e => e.waitUntil(
  caches.open(C).then(c => c.addAll(['/', '/index.html', '/app.js', '/tema-pre.js', '/modulos.js', '/modulos2.js', '/borradores.js', '/manual.js', '/modulos3.js', '/app.js', '/manifest.webmanifest', '/logo.png', '/icon-192.png'])).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request)
    .then(r => { const copia = r.clone(); caches.open(C).then(c => c.put(e.request, copia)); return r; })
    .catch(() => caches.match(e.request)));
});
