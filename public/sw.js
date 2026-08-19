/**
 * Heard — service worker.
 *
 * Two strategies, on purpose:
 *  - Vite emits content-hashed asset filenames, so those are immutable:
 *    cache-first, which is what makes the app genuinely usable offline a week
 *    later (DESIGN §6 moment 3).
 *  - Everything else (navigations, manifest, icons) is network-first, so a new
 *    deploy is never hidden behind a stale cache. Falling back to the cached
 *    index.html keeps deep links working with no connection.
 *
 * The sample mp3 is runtime-cached on first play and deliberately NOT
 * precached — it is ~4 MB and most first runs never need it offline.
 *
 * `res.ok` guards every put. A 404 is a *successful* fetch as far as JS is
 * concerned; caching one under cache-first pins a dead asset forever, which is
 * exactly how a deploy-window 404 locked users out of the precedent app.
 */
const CACHE = 'heard-__BUILD_ID__';
// build-sw.mjs replaces this marker with every emitted asset, so one successful
// load is a complete offline install rather than a shell with dead routes.
const CORE = ['./', './index.html', './manifest.webmanifest', /*__PRECACHE__*/];

const isImmutable = (url) =>
  url.pathname.includes('/assets/') && /-[A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(url.pathname);

const isSampleAudio = (url) => /\/sample\.mp3$/.test(url.pathname);

self.addEventListener('install', (event) => {
  // No .catch(): a failed precache must keep the previous worker alive rather
  // than activate a half-installed one.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isImmutable(url) || isSampleAudio(url)) {
    event.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('./index.html'))),
  );
});
