// Confu service worker: makes the app installable, shows review reminders,
// and keeps the on-device app (/app) working offline.
//
// Offline: the build's files (/_next/static, hashed names that never change)
// are kept after the first time they load, and the /app page is kept from
// the last time it loaded online. Nothing else is cached: the rest of the
// site needs the server anyway.
const CACHE = "confu-offline-v1";
const APP = "/app";
const MAX_FILES = 400;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add(APP)).catch(() => {}));
});

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("confu-offline-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

// Only production build files say "immutable"; in development nothing is kept,
// so a stale copy can never hide a code change.
const keepable = (res) => res.ok && res.type === "basic" && /immutable/.test(res.headers.get("cache-control") || "");

async function keep(cache, req, res) {
  await cache.put(req, res);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) if (new URL(old.url).pathname !== APP) await cache.delete(old);
}

async function buildFile(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (keepable(res)) await keep(cache, req, res.clone()).catch(() => {});
  return res;
}

async function appPage(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") await cache.put(APP, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const copy = await cache.match(APP);
    if (copy) return copy;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) return event.respondWith(buildFile(req));
  if (req.mode === "navigate" && url.pathname === APP) return event.respondWith(appPage(req));
});

// The page lists the build files it loaded before this worker took over,
// so one visit is enough to work offline.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "keep-offline" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const raw of event.data.urls.slice(0, MAX_FILES)) {
        const url = new URL(raw, self.location.origin);
        if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/") || (await cache.match(url.href))) continue;
        const res = await fetch(url.href).catch(() => null);
        if (res && keepable(res)) await keep(cache, new Request(url.href), res).catch(() => {});
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Confu", body: "Your reviews are ready.", url: "/review" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: data.url },
      tag: "confu-reviews",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/review", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) return c.navigate(url).then((w) => w?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
