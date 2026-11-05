const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const test = require("node:test");

const encryptionUrl = pathToFileURL(path.resolve(__dirname, "../js/encryption.js"));

test("vault passphrase wraps a key and encrypted contact data opens only in its record context", async () => {
  const encryption = await import(encryptionUrl);
  const userId = "account-ü-001";
  const recordId = "4d11b201-54fc-4f50-9fa4-42bbf23cbdc7";
  const passphrase = "A separate memorable private phrase";
  const created = await encryption.createVault(passphrase, userId);
  const metadata = created.metadata;
  assert.equal(metadata.kdfIterations, 600_000);
  assert.equal(metadata.keyVersion, 1);

  const clearContact = { name: "A contact with Unicode: Zoë" };
  const context = { userId, recordType: "external_contact", recordId, keyVersion: 1 };
  const encrypted = await encryption.encryptJson(clearContact, created.dataKey, context);
  const unlockedKey = await encryption.unlockVault(passphrase, userId, metadata);
  assert.deepEqual(await encryption.decryptJson(encrypted, unlockedKey, context), clearContact);
  await assert.rejects(() => encryption.unlockVault("a different memorable phrase", userId, metadata));
  await assert.rejects(() => encryption.decryptJson(encrypted, unlockedKey, { ...context, recordId: "another-record" }));
});

test("vault encryption enforces passphrase, data size, and version bounds", async () => {
  const encryption = await import(encryptionUrl);
  await assert.rejects(() => encryption.createVault("short", "account-a"), /at least 12/);
  const created = await encryption.createVault("another secure phrase to remember", "account-a");
  await assert.rejects(() => encryption.encryptJson("x".repeat(40_000), created.dataKey, {
    userId: "account-a", recordType: "external_contact", recordId: "contact-a", keyVersion: 1,
  }), /too large/);
});
