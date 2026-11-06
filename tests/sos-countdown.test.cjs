const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");

test("SOS countdown accepts the listed presets and a bounded custom duration", async () => {
  const { getCountdownDuration } = await import(pathToFileURL(path.join(root, "js", "sos-countdown-state.js")));
  for (const duration of [5, 10, 15, 30, 60]) assert.equal(getCountdownDuration(String(duration), "15"), duration);
  assert.equal(getCountdownDuration("custom", "47"), 47);
  for (const invalid of ["", "4", "301", "5.5", "NaN"]) {
    assert.throws(() => getCountdownDuration("custom", invalid), /5 to 300 seconds/u);
  }
  assert.throws(() => getCountdownDuration("999", "15"), /valid countdown/u);
});

test("SOS countdown remaining time is accurate and never negative", async () => {
  const { getRemainingCountdownSeconds } = await import(pathToFileURL(path.join(root, "js", "sos-countdown-state.js")));
  assert.equal(getRemainingCountdownSeconds(10_000, 1_000), 9);
  assert.equal(getRemainingCountdownSeconds(10_001, 1_000), 10);
  assert.equal(getRemainingCountdownSeconds(9_999, 10_000), 0);
  assert.equal(getRemainingCountdownSeconds(Number.NaN, 10_000), 0);
});

test("SOS page offers cancellation, keeps pending requests idempotent, and does not claim delivery", () => {
  const html = require("node:fs").readFileSync(path.join(root, "sos.html"), "utf8");
  const script = require("node:fs").readFileSync(path.join(root, "js", "sos.js"), "utf8");
  for (const duration of ["5", "10", "15", "30", "60"]) assert.ok(html.includes(`value="${duration}"`));
  assert.ok(html.includes('id="sos-custom-duration"'));
  assert.ok(html.includes('id="cancel-countdown"'));
  assert.ok(script.includes("submissionStarted = true"));
  assert.ok(script.includes("clientAlertId: crypto.randomUUID()"));
  assert.match(html, /does not send push, SMS, email, WhatsApp, or emergency-service messages/u);
});
