const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "install.js"), "utf8");

test("PWA install button only appears when the browser provides a real install prompt", async () => {
  const button = { hidden: true, disabled: false, listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
  const status = { textContent: "" };
  const help = { textContent: "" };
  const nodes = { "#install-app": button, "#pwa-status": status, "#pwa-install-help": help };
  const window = {
    listeners: {},
    matchMedia: () => ({ matches: false }),
    addEventListener(name, handler) { this.listeners[name] = handler; },
  };
  vm.runInNewContext(source, {
    document: { querySelector: (selector) => nodes[selector] },
    window,
    navigator: {},
  });
  assert.equal(button.hidden, true);
  let prevented = false;
  let prompted = false;
  window.listeners.beforeinstallprompt({
    preventDefault() { prevented = true; },
    prompt: async () => { prompted = true; },
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  assert.equal(prevented, true);
  assert.equal(button.hidden, false);
  await button.listeners.click();
  assert.equal(prompted, true);
  assert.equal(button.hidden, true);
  assert.match(help.textContent, /being installed/u);
});

test("PWA page reports installed state when opened as a standalone app", () => {
  const button = { hidden: true, disabled: false, listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
  const status = { textContent: "" };
  const help = { textContent: "" };
  const nodes = { "#install-app": button, "#pwa-status": status, "#pwa-install-help": help };
  vm.runInNewContext(source, {
    document: { querySelector: (selector) => nodes[selector] },
    window: { matchMedia: () => ({ matches: true }), addEventListener() {} },
    navigator: {},
  });
  assert.equal(status.textContent, "Installed on this device");
});
