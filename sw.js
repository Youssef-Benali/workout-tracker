/*
 * Workout Tracker service worker.
 *
 * To ship an update: change only the CACHE_VERSION string below (one line),
 * then commit and deploy. The new worker precaches the new app shell and
 * deletes caches from the previous version when it activates.
 */
const CACHE_VERSION = "wt-v6"; // bump on every release.

const SHELL_CACHE = `workout-tracker-shell-${CACHE_VERSION}`;
const FONT_CACHE = `workout-tracker-fonts-${CACHE_VERSION}`;
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, FONT_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith("workout-tracker-") && !keep.has(name)
            )
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isFontRequest(url) {
  return (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  );
}

function serveFont(event) {
  const request = event.request;
  const cachePromise = caches.open(FONT_CACHE);
  const cachedPromise = cachePromise.then((cache) => cache.match(request));

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && (response.ok || response.type === "opaque")) {
        const cache = await cachePromise;
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // The network refresh may outlive respondWith when we have a cached copy.
  event.waitUntil(networkPromise.then(() => {}).catch(() => {}));

  event.respondWith(
    (async () => {
      const cached = await cachedPromise;
      if (cached) return cached;
      const response = await networkPromise;
      return (
        response ||
        new Response("Font unavailable offline", {
          status: 504,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        })
      );
    })()
  );
}

async function cacheFirstShell(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.mode === "navigate") {
      const shell = await caches.match("./index.html", {
        cacheName: SHELL_CACHE
      });
      if (shell) return shell;
    }
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (isFontRequest(url)) {
    serveFont(event);
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstShell(request));
  }
});
