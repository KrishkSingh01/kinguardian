const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const encryptionUrl = pathToFileURL(path.resolve(__dirname, "../js/encryption.js"));

test("location envelopes encrypt for one trusted member and bind share context", async () => {
  const encryption = await import(encryptionUrl);
  const senderDataKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const recipientDataKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const senderCreated = await encryption.createSharingIdentity(senderDataKey, "sender-account");
  const recipientCreated = await encryption.createSharingIdentity(recipientDataKey, "recipient-account");
  const recipient = await encryption.unlockSharingIdentity(recipientDataKey, "recipient-account", recipientCreated.record);
  const sender = await encryption.unlockSharingIdentity(senderDataKey, "sender-account", senderCreated.record);
  const context = { shareId: "share-123", senderUserId: "sender-account", recipientUserId: "recipient-account" };
  const position = { latitude: 51.5072, longitude: -0.1276, accuracy: 42, capturedAt: 1_800_000_000_000 };
  const envelope = await encryption.encryptLocationForRecipient(position, sender.privateKey,
    sender.publicKey, recipientCreated.record.publicKey, context);

  assert.equal(envelope.keyVersion, 1);
  assert.notEqual(envelope.ciphertext.includes("51.5072"), true);
  assert.deepEqual(await encryption.decryptLocationEnvelope(envelope, recipient.privateKey, context), position);
  await assert.rejects(() => encryption.decryptLocationEnvelope(envelope, sender.privateKey, context));
  await assert.rejects(() => encryption.decryptLocationEnvelope(envelope, recipient.privateKey,
    { ...context, shareId: "another-share" }));
});

test("location encryption rejects invalid coordinates and account vaults do not share private keys", async () => {
  const encryption = await import(encryptionUrl);
  const keyA = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const keyB = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const identityA = await encryption.createSharingIdentity(keyA, "account-a");
  assert.notEqual(identityA.record.privateKeyCiphertext, identityA.record.publicKey);
  await assert.rejects(() => encryption.unlockSharingIdentity(keyB, "account-a", identityA.record));
  await assert.rejects(() => encryption.encryptLocationForRecipient(
    { latitude: 95, longitude: 0, accuracy: 10, capturedAt: 1 }, identityA.privateKey,
    identityA.publicKey, identityA.record.publicKey, { shareId: "share-a", senderUserId: "account-a", recipientUserId: "account-b" },
  ), /location details are not valid/i);
});
