// Offline support: the app shell and fonts are cached so the editor opens
// without a connection. Media never touches the network.
const CACHE = 'i-cut-v3';

// The first visit loads the page before this worker controls it, so the
// shell's scripts, styles and font stylesheet are cached here, read from the
// HTML, instead of waiting for a second visit.
async function precache() {
  const c = await caches.open(CACHE);
  const res = await fetch('/', { cache: 'no-cache' });
  const html = await res.clone().text();
  await c.put('/', res);
  const urls = new Set(['/manifest.webmanifest']);
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (u.startsWith('/') || u.startsWith('https://fonts.googleapis.com/css')) urls.add(u);
  }
  await Promise.all([...urls].map(async (u) => {
    try {
      const r = await fetch(u);
      if (!r.ok) return;
      if (u.startsWith('https://fonts.googleapis.com/css')) {
        // Latin font files too, so every font works offline, not only the
        // ones already shown once.
        const css = await r.clone().text();
        const files = [...css.matchAll(/\/\* latin(?:-ext)? \*\/[^}]*?url\(([^)]+)\)/g)].map((m) => m[1]);
        await Promise.all(files.map((f) => fetch(f).then((fr) => fr.ok && c.put(f, fr)).catch(() => {})));
      }
      await c.put(u, r);
    } catch { /* cached later on demand */ }
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    // Only this app's old shells: the caption model has its own cache.
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('i-cut-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // Fonts, and the speech-recognition library used by auto captions
  // (versioned URLs, so cache-first is safe). The model weights are cached
  // by the library itself.
  const cdn = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !cdn) return;

  if (req.mode === 'navigate') {
    // Network first so updates arrive; cached shell when offline.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('/', copy));
        return res;
      }).catch(() => caches.match('/')),
    );
    return;
  }

  // Hashed assets and fonts: cache first, fill the cache on the way.
  e.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
