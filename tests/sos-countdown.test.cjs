const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");

test("SOS countdown is exactly ten seconds and never displays negative time", async () => {
  const { SOS_COUNTDOWN_MS, getRemainingSOSCountdownSeconds } = await import(
    pathToFileURL(path.join(root, "js", "sos-countdown.js"))
  );
  assert.equal(SOS_COUNTDOWN_MS, 10_000);
  assert.equal(getRemainingSOSCountdownSeconds(11_000, 1_000), 10);
  assert.equal(getRemainingSOSCountdownSeconds(10_999, 1_000), 10);
  assert.equal(getRemainingSOSCountdownSeconds(10_999, 2_000), 9);
  assert.equal(getRemainingSOSCountdownSeconds(999, 1_000), 0);
  assert.equal(getRemainingSOSCountdownSeconds(Number.NaN, 1_000), 0);
});

test("SOS screen cancels before saving, and reports honest location and alert limits", () => {
  const html = fs.readFileSync(path.join(root, "sos.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "js", "sos-activation.js"), "utf8");
  assert.match(html, /id="sos-countdown-number"[^>]*>10</u);
  assert.match(html, /Call your local emergency number/u);
  assert.match(html, /does not call emergency services/u);
  assert.match(script, /const COUNTDOWN_MS = SOS_COUNTDOWN_MS/u);
  assert.match(script, /clientAlertId: crypto\.randomUUID\(\)/u);
  assert.match(script, /function cancelCountdown\(\)[\s\S]*?pendingSubmission = null/u);
  assert.match(script, /Nobody has been notified yet/u);
  assert.ok(!html.includes('id="sos-custom-duration"'));
  assert.ok(!html.includes('id="sos-duration"'));
});
