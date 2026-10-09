/* sw.js — Service Worker Buku Mewarna Ceria
   · Cache app shell + ikon
   · Cache-first untuk line-art (page_XX.png)
   · Network-first untuk navigasi (fallback ke cache = luar talian OK)
*/
"use strict";

const VERSION = "buku-mewarna-v1.0.0";
const SHELL_CACHE = `${VERSION}-shell`;
const PAGE_CACHE = `${VERSION}-pages`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./editor.html",
  "./manifest.json",
  "./data.json",
  "./assets/css/styles.css",
  "./assets/js/common.js",
  "./assets/js/gallery.js",
  "./assets/js/editor.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(SHELL_ASSETS);
      // pra-muat semua line-art 41 helaian (≈1MB) supaya luar talian terus OK
      const pages = await caches.open(PAGE_CACHE);
      const reqs = [];
      for (let i = 1; i <= 41; i++) {
        const id = String(i).padStart(2, "0");
        reqs.push(`./assets/pages/page_${id}.png`);
      }
      await Promise.allSettled(reqs.map((u) => pages.add(u).catch(() => null)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 1) Line-art: cache-first
  if (url.pathname.includes("/assets/pages/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // 2) Navigasi: network-first, fallback cache (luar talian)
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put("./index.html", res.clone());
          }
          return res;
        } catch (e) {
          const cached =
            (await caches.match(req)) ||
            (await caches.match("./index.html")) ||
            (await caches.match("./editor.html"));
          return cached || new Response("Anda luar talian dan halaman belum disimpan.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // 3) Aset statik lain: stale-while-revalidate ringkas (cache-first + refresh)
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const cache = caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })()
  );
});
