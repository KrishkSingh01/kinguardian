const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8")
  .replace(/^import \{ requestJson \} from "\.\/auth-client\.js";\s*/u, "");

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
  const views = ["home", "circle", "checkins", "settings"]
    .map((name) => new FakeNode({ view: name }));
  const navigation = ["home", "circle", "checkins", "settings"]
    .map((name) => new FakeNode({ nav: name }));
  const themeButtons = [new FakeNode(), new FakeNode()];
  const selectors = [
    "#page-title", "#live-status", "#app-dialog", "#dialog-title", "#dialog-copy",
    "#dialog-primary", "#dialog-countdown", "#countdown-number", "#theme-select",
    ".notice-close", ".preview-notice", "#offline-notice", "#today-label",
    "#timezone-label", 'meta[name="theme-color"]', "#pwa-status",
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
  const location = { hash: "", protocol: "file:" };
  const history = { replaceState(_state, _title, url) { location.hash = url.slice(url.indexOf("#")); } };
  const window = {
    listeners: {},
    matchMedia: () => ({ matches: false }),
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setInterval(handler) { this.tick = handler; return 7; },
    clearInterval() { this.timerCleared = true; },
  };
  const navigator = { onLine: true };
  vm.runInNewContext(appSource, {
    document, window, localStorage, location, history, navigator, Intl, Date,
    requestJson: async () => ({ ok: true }),
  });
  return { document, views, navigation, nodes, themeButtons, window, navigator, localStorage };
}

function dispatchClick(document, selector, node) {
  document.listeners.click({ target: { closest: (candidate) => candidate === selector ? node : null } });
}

test("navigation and SOS preview remain truthful", () => {
  const app = createAppHarness();
  assert.equal(app.views.find((view) => view.dataset.view === "home").hidden, false);
  dispatchClick(app.document, "[data-nav]", app.navigation.find((item) => item.dataset.nav === "circle"));
  assert.equal(app.views.find((view) => view.dataset.view === "circle").hidden, false);
  assert.equal(app.views.find((view) => view.dataset.view === "home").hidden, true);
  dispatchClick(app.document, "[data-action]", new FakeNode({ action: "sos-preview" }));
  assert.equal(app.nodes["#app-dialog"].open, true);
  assert.match(app.nodes["#dialog-title"].textContent, /cannot reach anyone/i);
  app.nodes["#dialog-primary"].events.click();
  for (let tick = 0; tick < 5; tick += 1) app.window.tick();
  assert.equal(app.nodes["#dialog-title"].textContent, "No alert was sent.");
  assert.match(app.nodes["#dialog-copy"].children[0].textContent, /No alert was created or sent/i);
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
});

test("theme controls remain usable when browser storage is blocked", () => {
  const app = createAppHarness({ storageBlocked: true });
  assert.equal(app.document.documentElement.dataset.theme, "system");
  dispatchClick(app.document, ".theme-cycle", app.themeButtons[0]);
  assert.equal(app.document.documentElement.dataset.theme, "light");
});
