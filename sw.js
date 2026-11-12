// Service worker van de Zakkaart-apps (gegenereerd uit src/sw.js door build.mjs).
// Doel: de apps blijven werken zonder internet of bij slecht bereik.
//  - Pagina's (html): eerst het netwerk, zodat een nieuwe versie direct binnenkomt;
//    reageert het netwerk niet binnen 3 seconden, of is er geen verbinding, dan de bewaarde kopie.
//  - Overige bestanden (iconen, manifest): eerst de bewaarde kopie, op de achtergrond verversen.
const CACHE = "zakkaart-28d3d6d09ffa";
const ASSETS = ["./","./index.html","./manifest.webmanifest","./icons/icon-full-512.png","./icons/icon-full-192.png","./apple-touch-icon.png","./info.html","./manifest-info.webmanifest","./icons/icon-info-512.png","./icons/icon-info-192.png","./apple-touch-icon-info.png","./calculator.html","./manifest-calc.webmanifest","./icons/icon-calc-512.png","./icons/icon-calc-192.png","./apple-touch-icon-calculator.png"];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(ASSETS.map(url =>
        cache.add(new Request(url, { cache: "reload" })).catch(() => {})   // één ontbrekend bestand mag de rest niet blokkeren
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("zakkaart-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetwork(request, cache) {
  return fetch(request).then(response => {
    if (response && response.ok && response.type === "basic") cache.put(request, response.clone());
    return response;
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isPage = request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
  event.respondWith(caches.open(CACHE).then(cache => {
    const cached = cache.match(request, { ignoreSearch: true });
    if (!isPage) {
      return cached.then(hit => {
        const fresh = fromNetwork(request, cache).catch(() => hit);
        return hit || fresh;
      });
    }
    const network = fromNetwork(request, cache);
    const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
    return Promise.race([network.catch(() => null), timeout]).then(response => {
      if (response) return response;
      return cached.then(hit => hit || network);   // niets bewaard: dan toch op het netwerk wachten
    });
  }));
});
