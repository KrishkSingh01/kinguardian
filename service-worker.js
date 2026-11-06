const CACHE_PREFIX = "kinguardian-static-";
const CACHE_NAME = `${CACHE_PREFIX}v10`;
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.html",
  "./account-setup.html",
  "./pair-device.html",
  "./contacts.html",
  "./invite.html",
  "./sos.html",
  "./location.html",
  "./manifest.webmanifest",
  "./css/marketing.css",
  "./css/tokens.css",
  "./css/base.css",
  "./css/auth.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/animations.css",
  "./css/responsive.css",
  "./css/owner.css",
  "./css/pair-device.css",
  "./css/contacts.css",
  "./css/circle.css",
  "./css/invite.css",
  "./css/sos.css",
  "./css/location.css",
  "./css/checkins.css",
  "./css/notifications.css",
  "./js/app.js",
  "./js/auth-client.js",
  "./js/owner.js",
  "./js/account-setup.js",
  "./js/pair-device.js",
  "./js/contacts.js",
  "./js/circle.js",
  "./js/invite.js",
  "./js/sos.js",
  "./js/location.js",
  "./js/checkins.js",
  "./js/notifications.js",
  "./assets/icons/kinguardian.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cachedPage = await caches.match(request, { ignoreSearch: true });
      if (cachedPage) return cachedPage;
      const shell = new URL(request.url).pathname.endsWith("/app.html") ? "./app.html" : "./index.html";
      const cachedShell = await caches.match(shell);
      return cachedShell || new Response("KinGuardian is offline. Reconnect and retry.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

const PUSH_COPY = {
  sos: "A trusted circle member needs your attention.",
  invitation: "A trusted-circle update is ready.",
  checkin_reminder: "A KinGuardian check-in reminder is ready.",
  missed_checkin: "A safety check-in needs attention.",
  acknowledgement: "A trusted circle member has acknowledged an alert.",
  account_security: "There is an account security update.",
  test: "Your KinGuardian test notification arrived.",
};

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let category = "";
    let notificationId = "";
    try {
      const payload = event.data?.json() || {};
      category = payload.category || "";
      notificationId = typeof payload.notificationId === "string"
        && /^(?:[0-9a-f]{32}|[0-9a-f-]{36})$/iu.test(payload.notificationId)
        ? payload.notificationId
        : "";
    } catch { /* Show only a generic fallback for malformed push data. */ }
    const body = PUSH_COPY[category] || "There is a new KinGuardian update.";
    await self.registration.showNotification("KinGuardian", {
      body,
      icon: "./assets/icons/kinguardian.svg",
      badge: "./assets/icons/kinguardian.svg",
      tag: `kinguardian-${PUSH_COPY[category] ? category : "update"}${notificationId ? `-${notificationId}` : ""}`,
      renotify: false,
      data: { path: "/app.html" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL("/app.html", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(destination);
      return existing.focus();
    }
    return self.clients.openWindow(destination);
  })());
});
