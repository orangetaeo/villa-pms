// [SHARED-MODULE] from traveldiary-mvp public/sw.js
/**
 * 서비스 워커 v3 — PWA installability + 오프라인 fallback + 정적 자원 캐싱.
 *
 * 전략:
 *   - navigation → Network-first, offline.html fallback
 *   - 정적 자원 (폰트) → Stale-While-Revalidate
 *   - _next/static → Cache-first (immutable hashed assets)
 *   - API/동적 → Network-only
 */

const CACHE_NAME = "traveldiary-v3";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

const STATIC_PATTERNS = [
  /\.(woff2?|ttf|otf)$/,
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn\.jsdelivr\.net/,
  /icon-\d+\.png$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/_next/data/")) return;

  // Navigation → Network-first + offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets → Stale-While-Revalidate
  if (STATIC_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const fetched = fetch(request).then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || fetched;
        })
      )
    );
    return;
  }

  // _next/static → Cache-first (immutable)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }
});
