// Admin V2 service worker. HTML navigations and private API calls must
// always use the network: an offline app shell could display stale CMS code
// even after a successful Cloudflare Pages deployment.
const CACHE = "cms-v2-assets-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("cms-v2-") && key !== CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  // Do not intercept HTML, the manifest, release marker, or authenticated API.
  // This also avoids serving stale UI when Cloudflare Access redirects.
  if (!url.pathname.startsWith("/admin-v2/assets/")) return;
  // Vite's assets are content-hashed. Cache only immutable asset URLs.
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
      }
      return res;
    })),
  );
});
