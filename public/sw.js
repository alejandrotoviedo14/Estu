// Service worker: la web se puede instalar y consultar sin conexión con los últimos datos guardados.
const CACHE = 'estu-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Red primero (datos y página siempre al día); si no hay conexión, lo último guardado.
function networkFirst(req) {
  return fetch(req).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then(hit => hit || new Response(JSON.stringify({ error: 'Sin conexión y sin datos guardados' }),
    { status: 503, headers: { 'content-type': 'application/json' } })));
}

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  // Calendarios (.ics), actas sobre demanda, sincronización e imágenes: sin caché propia
  if (u.pathname.startsWith('/calendario') || u.pathname.startsWith('/api/sync') || u.pathname.startsWith('/api/match') || u.pathname.startsWith('/img')) return;
  e.respondWith(networkFirst(e.request));
});
