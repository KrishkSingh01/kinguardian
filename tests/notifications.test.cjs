const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const test = require("node:test");

globalThis.crypto ??= webcrypto;

let notifications;
async function loadHelpers() {
  notifications ??= await import("../functions/_shared/notifications.js");
  return notifications;
}

test("only supported HTTPS push-service endpoints are accepted", async () => {
  const helpers = await loadHelpers();
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/fake-token",
    "https://web.push.apple.com/fake-token",
    "https://updates.push.services.mozilla.com/wpush/v2/fake-token",
    "https://wns2-zone.notify.windows.com/fake-token",
  ]) assert.equal(helpers.validPushEndpoint(endpoint), true, endpoint);
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/fake-token",
    "https://fcm.googleapis.com.attacker.test/fake-token",
    "https://127.0.0.1/fake-token",
    "https://example.com/fake-token",
    "https://user:pass@fcm.googleapis.com/fake-token",
  ]) assert.equal(helpers.validPushEndpoint(endpoint), false, endpoint);
});

test("subscription keys must be a valid P-256 point and 16-byte auth secret", async () => {
  const helpers = await loadHelpers();
  const pair = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const point = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  const encode = (bytes) => Buffer.from(bytes).toString("base64url");
  assert.ok(await helpers.validPushKeys(encode(point), encode(auth)));
  assert.equal(await helpers.validPushKeys("a", encode(auth)), null);
  assert.equal(await helpers.validPushKeys(encode(point), encode(new Uint8Array(15))), null);
});

test("VAPID public keys must decode to an uncompressed P-256 point", async () => {
  const helpers = await loadHelpers();
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  const encode = (bytes) => Buffer.from(bytes).toString("base64url");
  assert.equal(helpers.usableVapidPublicKey(encode(publicKey)), encode(publicKey));
  assert.equal(helpers.usableVapidPublicKey("not-a-vapid-key"), "");
});
