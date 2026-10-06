/* The Family Ground service worker: offline-first static assets, fresh HTML. */
var CACHE = "tfg-v1";
var STATIC_RE = /\.(css|js|png|jpg|jpeg|svg|webp|woff2?)(\?|$)/i;

self.addEventListener("install", function (e) {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  // Never cache API calls or Supabase.
  if (url.hostname.indexOf("supabase.co") !== -1 || url.pathname.indexOf("/rest/") === 0 || url.pathname.indexOf("/auth/") === 0) return;
  if (e.request.method !== "GET") return;

  // Static assets: cache-first.
  if (STATIC_RE.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
          if (hit) return hit;
          return fetch(e.request).then(function (res) {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // Pages: network-first, fall back to cache when offline.
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
