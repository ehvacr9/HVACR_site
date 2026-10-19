const CACHE_NAME = "hvacr-coolprop-v1";
const COOLPROP_ASSET_PATHS = [
  "/assets/coolprop/coolprop.js",
  "/assets/coolprop/coolprop.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith("hvacr-coolprop-") && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  const isCoolPropAsset = COOLPROP_ASSET_PATHS.some((path) => requestUrl.pathname.endsWith(path));
  if (
    event.request.method !== "GET"
    || requestUrl.origin !== self.location.origin
    || !isCoolPropAsset
  ) {
    return;
  }

  const responsePromise = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request);
    if (cachedResponse) return cachedResponse;

    const response = await fetch(event.request);
    if (response.ok) {
      const cacheWrite = cache.put(event.request, response.clone());
      event.waitUntil(cacheWrite.catch((error) => {
        console.error("無法快取 CoolProp 運算模組：", error);
      }));
    }
    return response;
  })();

  event.respondWith(responsePromise);
});
