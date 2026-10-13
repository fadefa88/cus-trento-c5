// Admin V2 service worker: app shell available offline, data always live.
// API responses are never cached (they are private and must be current).
const CACHE = "cms-v2-shell-v1";
const SHELL = ["/admin-v2/", "/admin-v2/manifest.webmanifest", "/admin-v2/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;
  if (!url.pathname.startsWith("/admin-v2/")) return;
  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith("/admin-v2/assets/")) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, res.clone()));
        return res;
      })),
    );
    return;
  }
  // The shell: network first (so updates and Access redirects work), cache as fallback.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put("/admin-v2/", res.clone()));
        return res;
      }).catch(() => caches.match("/admin-v2/")),
    );
  }
});
