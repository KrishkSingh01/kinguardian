const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const cryptoModuleUrl = pathToFileURL(path.resolve(__dirname, "../functions/_shared/crypto.js"));

test("password hashes use the configured PBKDF2 work factor and compare safely", async () => {
  const cryptoModule = await import(cryptoModuleUrl);
  const salt = cryptoModule.randomBytes(16);
  const first = await cryptoModule.derivePasswordHash("a unique test phrase with 24 chars", salt);
  const same = await cryptoModule.derivePasswordHash("a unique test phrase with 24 chars", salt);
  const different = await cryptoModule.derivePasswordHash("a different test phrase", salt);
  assert.equal(first.byteLength, 32);
  assert.equal(cryptoModule.constantTimeEqual(first, same), true);
  assert.equal(cryptoModule.constantTimeEqual(first, different), false);
  await assert.rejects(() => cryptoModule.derivePasswordHash("x", salt, 1000), /work factor/);
});

test("account identifiers support Unicode and reject unsafe punctuation", async () => {
  const cryptoModule = await import(cryptoModuleUrl);
  assert.equal(cryptoModule.normalizeUsername("  TÉST.User  "), "tést.user");
  assert.equal(cryptoModule.normalizeUsername("name@example.com"), null);
  assert.equal(cryptoModule.normalizeUsername("a"), null);
  assert.equal(cryptoModule.validatePassword("correct horse battery staple"), true);
  assert.equal(cryptoModule.validatePassword("short"), false);
  assert.equal(cryptoModule.validatePassword("é".repeat(129)), false);
});

test("session and temporary tokens are unpredictable-format base64url strings", async () => {
  const cryptoModule = await import(cryptoModuleUrl);
  const first = cryptoModule.randomToken();
  const second = cryptoModule.randomToken();
  assert.match(first, /^[-_A-Za-z0-9]{43}$/u);
  assert.notEqual(first, second);
});
