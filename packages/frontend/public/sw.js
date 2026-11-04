/* AquaPlants — service worker (caché controlada de recursos estáticos).
 * - Nunca cachea /api (datos privados) ni credenciales.
 * - Navegación: red primero; sin red → shell en caché (la app muestra «Sin Internet»).
 * - VERSION y PRECACHE se inyectan en el build (vite.config.ts).
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `aquaplants-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('aquaplants-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // datos privados: siempre red, sin caché
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/offline.html'))));
    return;
  }
  // Recursos estáticos versionados: caché primero.
  e.respondWith(
    caches.match(req).then(
      (r) =>
        r ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return res;
        }),
    ),
  );
});
