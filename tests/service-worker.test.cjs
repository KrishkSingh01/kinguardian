const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const workerSource = fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8");

function createWorkerHarness() {
  const handlers = {};
  const installed = [];
  const deleted = [];
  const matched = [];
  const shownNotifications = [];
  const openedWindows = [];
  const cache = { addAll: async (assets) => installed.push(...assets) };
  const caches = {
    open: async () => cache,
    keys: async () => ["kinguardian-static-v0", "unrelated-cache"],
    delete: async (key) => { deleted.push(key); return true; },
    match: async (request) => {
      const name = typeof request === "string" ? request : request.url;
      matched.push(name);
      if (typeof request !== "string" && request.mode === "navigate") {
        if (name.includes("sos.html")) return "offline-sos-page";
        if (name.includes("location.html")) return "offline-location-page";
        if (name.includes("contacts.html")) return "offline-contacts-page";
        if (name.endsWith("/")) return "offline-shell";
        return null;
      }
  if (name.includes("sos.html")) return "offline-sos-page";
  if (name.includes("location.html")) return "offline-location-page";
      if (name.includes("contacts.html")) return "offline-contacts-page";
      if (name.includes("dashboard.html")) return "offline-shell";
      return "cached-static";
    },
  };
  const self = {
    location: { origin: "https://kin.test" },
    registration: { showNotification: async (title, options) => shownNotifications.push({ title, options }) },
    clients: {
      claim: async () => { self.claimed = true; },
      matchAll: async () => [],
      openWindow: async (url) => { openedWindows.push(url); return { url }; },
    },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    skipWaiting: async () => { self.skippedWaiting = true; },
  };
  vm.runInNewContext(workerSource, {
    self, caches, URL, Response,
    fetch: async () => { throw new Error("offline"); },
    Promise,
  });
  return { handlers, caches, self, installed, deleted, matched, shownNotifications, openedWindows };
}

test("service worker caches only the static shell and bypasses APIs", async () => {
  const worker = createWorkerHarness();
  let pending;
  worker.handlers.install({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.equal(worker.installed.length, 42);
  assert.ok(worker.installed.includes("./dashboard.html"));
  assert.ok(worker.installed.includes("./privacy.html"));
  assert.ok(worker.installed.includes("./css/landing.css"));
  assert.ok(worker.installed.includes("./css/privacy.css"));
  assert.ok(!worker.installed.includes("./account-setup.html"));
  assert.ok(!worker.installed.includes("./css/owner.css"));
  assert.ok(worker.installed.includes("./pair-device.html"));
  assert.ok(worker.installed.includes("./css/pair-device.css"));
  assert.ok(!worker.installed.includes("./js/account-setup.js"));
  assert.ok(!worker.installed.includes("./js/owner.js"));
  assert.ok(worker.installed.includes("./js/pair-device.js"));
  assert.ok(worker.installed.includes("./sos.html"));
  assert.ok(worker.installed.includes("./css/sos.css"));
  assert.ok(worker.installed.includes("./js/sos.js"));
  assert.ok(worker.installed.includes("./location.html"));
  assert.ok(worker.installed.includes("./emergency.html"));
  assert.ok(worker.installed.includes("./css/emergency.css"));
  assert.ok(worker.installed.includes("./js/emergency.js"));
  assert.ok(worker.installed.includes("./css/location.css"));
  assert.ok(worker.installed.includes("./js/location.js"));
  assert.ok(worker.installed.includes("./css/checkins.css"));
  assert.ok(worker.installed.includes("./js/checkins.js"));
  assert.ok(worker.installed.includes("./css/notifications.css"));
  assert.ok(worker.installed.includes("./js/notifications.js"));
  assert.ok(worker.installed.includes("./js/install.js"));
  assert.equal(JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "manifest.webmanifest"), "utf8")).start_url, "/dashboard.html");
  assert.ok(worker.installed.includes("./js/auth-client.js"));
  assert.equal(worker.self.skippedWaiting, true);

  worker.handlers.activate({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.deepEqual(worker.deleted, ["kinguardian-static-v0"]);
  assert.equal(worker.self.claimed, true);

  const apiEvent = {
    request: { method: "GET", url: "https://kin.test/api/account", mode: "cors" },
    respondWith() { throw new Error("API requests must not enter a cache handler"); },
  };
  worker.handlers.fetch(apiEvent);
  assert.deepEqual(worker.matched, []);
});

test("service worker serves cached assets and offline app shell", async () => {
  const worker = createWorkerHarness();
  const staticEvent = {
    request: { method: "GET", url: "https://kin.test/css/base.css", mode: "cors" },
    response: undefined,
    respondWith(promise) { this.response = promise; },
  };
  worker.handlers.fetch(staticEvent);
  assert.equal(await staticEvent.response, "cached-static");

  const navigationEvent = {
    request: { method: "GET", url: "https://kin.test/settings", mode: "navigate" },
    response: undefined,
    respondWith(promise) { this.response = promise; },
  };
  worker.handlers.fetch(navigationEvent);
  assert.equal(await navigationEvent.response, "offline-shell");

  const sosNavigationEvent = {
    request: { method: "GET", url: "https://kin.test/sos.html", mode: "navigate" },
    response: undefined,
    respondWith(promise) { this.response = promise; },
  };
  worker.handlers.fetch(sosNavigationEvent);
  assert.equal(await sosNavigationEvent.response, "offline-sos-page");

  const locationNavigationEvent = {
    request: { method: "GET", url: "https://kin.test/location.html", mode: "navigate" },
    response: undefined,
    respondWith(promise) { this.response = promise; },
  };
  worker.handlers.fetch(locationNavigationEvent);
  assert.equal(await locationNavigationEvent.response, "offline-location-page");
});

test("push copy is generic and notification clicks stay on the app origin", async () => {
  const worker = createWorkerHarness();
  let pending;
  worker.handlers.push({
    data: { json: () => ({ category: "sos", body: "Coordinates 12.34,56.78" }) },
    waitUntil: (promise) => { pending = promise; },
  });
  await pending;
  assert.equal(worker.shownNotifications[0].title, "KinGuardian");
  assert.equal(worker.shownNotifications[0].options.body, "A trusted circle member needs your attention.");
  assert.equal(worker.shownNotifications[0].options.data.path, "/dashboard.html");
  assert.doesNotMatch(worker.shownNotifications[0].options.body, /12\.34|56\.78/u);

  worker.handlers.notificationclick({
    notification: { close() {} },
    waitUntil: (promise) => { pending = promise; },
  });
  await pending;
  assert.deepEqual(worker.openedWindows, ["https://kin.test/dashboard.html"]);
});
