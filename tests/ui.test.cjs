const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8")
  .replace(/^import .*?;\s*/gmu, "");

class FakeNode {
  constructor(dataset = {}) {
    this.dataset = { ...dataset };
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.open = false;
    this.attributes = {};
    this.events = {};
    this.children = [];
    this.classList = {
      values: new Set(),
      toggle: (name, enabled) => enabled
        ? this.classList.values.add(name)
        : this.classList.values.delete(name),
    };
  }

  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren(...children) { this.children = [...children]; }
  append(...children) { this.children.push(...children); }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function createAppHarness({ storageBlocked = false } = {}) {
  const views = ["home", "circle", "journey", "notifications", "settings"]
    .map((name) => new FakeNode({ view: name }));
  const navigation = ["home", "circle", "journey", "notifications", "settings"]
    .map((name) => new FakeNode({ nav: name }));
  const themeButtons = [new FakeNode(), new FakeNode()];
  const selectors = [
    "#page-title", "#live-status", "#app-dialog", "#dialog-title", "#dialog-copy",
    "#dialog-primary", "#dialog-countdown", "#countdown-number", "#theme-select",
    ".notice-close", ".preview-notice", "#offline-notice", "#today-label",
    "#timezone-label", 'meta[name="theme-color"]', "#pwa-status",
    "#account-indicator", ".profile-meta strong", ".profile-meta small", "#auth-blocker",
    ".mobile-nav", "#app-shell", "#auth-blocker-title", "#auth-blocker-message",
  ];
  const nodes = Object.fromEntries(selectors.map((name) => [name, new FakeNode()]));
  const document = {
    documentElement: { dataset: {} },
    title: "",
    listeners: {},
    querySelectorAll(selector) {
      if (selector === "[data-view]") return views;
      if (selector === "[data-nav]") return navigation;
      if (selector === ".theme-cycle") return themeButtons;
      return [];
    },
    querySelector(selector) { return nodes[selector] || null; },
    createElement() { return new FakeNode(); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => { if (storageBlocked) throw new Error("storage blocked"); return storage.get(key) || null; },
    setItem: (key, value) => { if (storageBlocked) throw new Error("storage blocked"); storage.set(key, value); },
  };
  const location = { hash: "", protocol: "https:", assigned: "", replace() {}, assign(url) { this.assigned = url; } };
  const history = { replaceState(_state, _title, url) { location.hash = url.slice(url.indexOf("#")); } };
  const window = {
    listeners: {},
    dispatched: [],
    matchMedia: () => ({ matches: false }),
    addEventListener(name, handler) { this.listeners[name] = handler; },
    dispatchEvent(event) { this.dispatched.push(event); },
    setInterval(handler) { this.tick = handler; return 7; },
    clearInterval() { this.timerCleared = true; },
  };
  const navigator = { onLine: true };
  class FakeCustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  vm.runInNewContext(appSource, {
    document, window, localStorage, location, history, navigator, Intl, Date,
    CustomEvent: FakeCustomEvent,
    requestJson: async () => ({ ok: true }),
  });
  return { document, views, navigation, nodes, themeButtons, window, navigator, localStorage, location };
}

function dispatchClick(document, selector, node) {
  document.listeners.click({ target: { closest: (candidate) => candidate === selector ? node : null } });
}

test("navigation opens the real SOS screen instead of a preview", () => {
  const app = createAppHarness();
  assert.equal(app.views.find((view) => view.dataset.view === "home").hidden, false);
  dispatchClick(app.document, "[data-nav]", app.navigation.find((item) => item.dataset.nav === "circle"));
  assert.equal(app.views.find((view) => view.dataset.view === "circle").hidden, false);
  assert.equal(app.views.find((view) => view.dataset.view === "home").hidden, true);
  dispatchClick(app.document, "[data-action]", new FakeNode({ action: "sos-preview" }));
  assert.equal(app.location.assigned, "sos.html");
  assert.equal(app.nodes["#app-dialog"].open, false);
});

test("theme selection and offline notice update accessibly", () => {
  const app = createAppHarness();
  dispatchClick(app.document, ".theme-cycle", app.themeButtons[0]);
  assert.equal(app.document.documentElement.dataset.theme, "light");
  assert.equal(app.nodes["#theme-select"].value, "light");
  app.navigator.onLine = false;
  app.window.listeners.offline();
  assert.equal(app.nodes["#offline-notice"].hidden, false);
  assert.match(app.nodes["#live-status"].textContent, /offline/i);
  assert.equal(app.window.dispatched.at(-1).type, "kg:offline");
});

test("theme controls remain usable when browser storage is blocked", () => {
  const app = createAppHarness({ storageBlocked: true });
  assert.equal(app.document.documentElement.dataset.theme, "system");
  dispatchClick(app.document, ".theme-cycle", app.themeButtons[0]);
  assert.equal(app.document.documentElement.dataset.theme, "light");
});
