const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export const VAULT_KDF = "PBKDF2-HMAC-SHA-256";
export const VAULT_ITERATIONS = 600_000;
export const VAULT_ALGORITHM = "AES-256-GCM";
export const VAULT_KEY_VERSION = 1;

function randomBytes(length) {
  const result = new Uint8Array(length);
  crypto.getRandomValues(result);
  return result;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value, minimumBytes, maximumBytes = 65_536) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Encrypted data is not in a supported format.");
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  let binary;
  try {
    binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  } catch {
    throw new Error("Encrypted data is not in a supported format.");
  }
  if (binary.length < minimumBytes || binary.length > maximumBytes) {
    throw new Error("Encrypted data is not in a supported format.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function validatePassphrase(passphrase) {
  if (typeof passphrase !== "string" || [...passphrase].length < 12
    || encoder.encode(passphrase).length > 256) {
    throw new Error("Use an encryption passphrase of at least 12 characters (up to 256 UTF-8 bytes).");
  }
}

async function deriveWrappingKey(passphrase, salt, iterations = VAULT_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function validateUserId(userId) {
  if (typeof userId !== "string" || userId.length < 1 || userId.length > 80) {
    throw new Error("The signed-in account could not be verified.");
  }
}

export async function createVault(passphrase, userId) {
  validatePassphrase(passphrase);
  validateUserId(userId);
  const salt = randomBytes(16);
  const wrappingIv = randomBytes(12);
  const rawDataKey = randomBytes(32);
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrappingIv, additionalData: encoder.encode(`kinguardian-vault:v1:${userId}`), tagLength: 128 },
    wrappingKey,
    rawDataKey,
  );
  const dataKey = await crypto.subtle.importKey("raw", rawDataKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  rawDataKey.fill(0);
  return {
    dataKey,
    metadata: {
      keyVersion: VAULT_KEY_VERSION,
      wrappingAlgorithm: VAULT_ALGORITHM,
      kdfAlgorithm: VAULT_KDF,
      kdfIterations: VAULT_ITERATIONS,
      kdfSalt: toBase64Url(salt),
      wrappedKey: toBase64Url(new Uint8Array(wrappedKey)),
      wrappingIv: toBase64Url(wrappingIv),
    },
  };
}

export async function unlockVault(passphrase, userId, metadata) {
  validatePassphrase(passphrase);
  validateUserId(userId);
  if (metadata?.wrappingAlgorithm !== VAULT_ALGORITHM
    || metadata?.kdfAlgorithm !== VAULT_KDF
    || metadata?.keyVersion !== VAULT_KEY_VERSION
    || metadata?.kdfIterations !== VAULT_ITERATIONS) {
    throw new Error("This encrypted vault uses settings this version cannot open.");
  }
  const salt = fromBase64Url(metadata.kdfSalt, 16, 64);
  const wrappingIv = fromBase64Url(metadata.wrappingIv, 12, 12);
  const wrappedKey = fromBase64Url(metadata.wrappedKey, 48, 128);
  const wrappingKey = await deriveWrappingKey(passphrase, salt, metadata.kdfIterations);
  let rawDataKey;
  try {
    rawDataKey = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrappingIv, additionalData: encoder.encode(`kinguardian-vault:v1:${userId}`), tagLength: 128 },
      wrappingKey,
      wrappedKey,
    ));
  } catch {
    throw new Error("The passphrase could not unlock this vault.");
  }
  if (rawDataKey.length !== 32) {
    rawDataKey.fill(0);
    throw new Error("The encrypted vault key is not valid.");
  }
  const dataKey = await crypto.subtle.importKey("raw", rawDataKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  rawDataKey.fill(0);
  return dataKey;
}

function recordAdditionalData({ userId, recordType, recordId, keyVersion }) {
  validateUserId(userId);
  if (!/^[a-z_]{1,32}$/u.test(recordType) || typeof recordId !== "string"
    || recordId.length < 1 || recordId.length > 100 || keyVersion !== VAULT_KEY_VERSION) {
    throw new Error("The encrypted record context is not valid.");
  }
  return encoder.encode(`kinguardian-record:v1:${userId}:${recordType}:${recordId}:${keyVersion}`);
}

export async function encryptJson(value, dataKey, context) {
  const plaintext = encoder.encode(JSON.stringify(value));
  if (plaintext.length > 32_768) throw new Error("This record is too large to encrypt.");
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: recordAdditionalData(context), tagLength: 128 },
    dataKey,
    plaintext,
  );
  return { ciphertext: toBase64Url(new Uint8Array(ciphertext)), iv: toBase64Url(iv), keyVersion: VAULT_KEY_VERSION };
}

export async function decryptJson(record, dataKey, context) {
  if (record?.keyVersion !== VAULT_KEY_VERSION) throw new Error("This encrypted record needs a newer key version.");
  const iv = fromBase64Url(record.iv, 12, 12);
  const ciphertext = fromBase64Url(record.ciphertext, 17, 65_552);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: recordAdditionalData(context), tagLength: 128 },
    dataKey,
    ciphertext,
  );
  return JSON.parse(decoder.decode(plaintext));
}

export async function createSharingIdentity(dataKey, userId) {
  validateUserId(userId);
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const privateKeyIv = randomBytes(12);
  const encryptedPrivateKey = await crypto.subtle.encrypt({
    name: "AES-GCM", iv: privateKeyIv, additionalData: encoder.encode(`kinguardian-sharing-private:v1:${userId}`), tagLength: 128,
  }, dataKey, privateBytes);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8", privateBytes, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
  );
  privateBytes.fill(0);
  const privateKeyCiphertext = new Uint8Array(encryptedPrivateKey);
  return {
    privateKey,
    publicKey: toBase64Url(publicBytes),
    record: {
      keyVersion: 1,
      algorithm: "ECDH-P256-HKDF-SHA256-AES256-GCM",
      publicKey: toBase64Url(publicBytes),
      privateKeyCiphertext: toBase64Url(privateKeyCiphertext),
      privateKeyIv: toBase64Url(privateKeyIv),
    },
  };
}

export async function unlockSharingIdentity(dataKey, userId, record) {
  validateUserId(userId);
  if (record?.keyVersion !== 1 || record?.algorithm !== "ECDH-P256-HKDF-SHA256-AES256-GCM") {
    throw new Error("This account's location-sharing key uses settings this version cannot open.");
  }
  const privateKeyIv = fromBase64Url(record.privateKeyIv, 12, 12);
  const privateKeyCiphertext = fromBase64Url(record.privateKeyCiphertext, 64, 512);
  const publicKey = fromBase64Url(record.publicKey, 65, 65);
  if (!privateKeyIv || !privateKeyCiphertext || !publicKey) throw new Error("The encrypted location-sharing key is not valid.");
  let privateBytes;
  try {
    privateBytes = new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM", iv: privateKeyIv, additionalData: encoder.encode(`kinguardian-sharing-private:v1:${userId}`), tagLength: 128,
    }, dataKey, privateKeyCiphertext));
  } catch {
    throw new Error("Your private location-sharing key could not be unlocked.");
  }
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8", privateBytes, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
    );
    return { privateKey, publicKey: record.publicKey };
  } finally {
    privateBytes.fill(0);
  }
}

function locationContext(shareId, senderUserId, recipientUserId) {
  validateUserId(senderUserId);
  validateUserId(recipientUserId);
  if (typeof shareId !== "string" || shareId.length < 1 || shareId.length > 100) {
    throw new Error("The location-share context is not valid.");
  }
  return encoder.encode(`kinguardian-location:v1:${shareId}:${senderUserId}:${recipientUserId}`);
}

async function deriveLocationKey(privateKey, publicKeyBytes, salt, usages) {
  const publicKey = await crypto.subtle.importKey(
    "raw", publicKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey }, privateKey, 256,
  ));
  const material = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  sharedSecret.fill(0);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("kinguardian-location-key:v1") },
    material, { name: "AES-GCM", length: 256 }, false, usages,
  );
}

export async function encryptLocationForRecipient(location, senderPrivateKey, senderPublicKey, recipientPublicKey, context) {
  if (!Number.isFinite(location?.latitude) || location.latitude < -90 || location.latitude > 90
    || !Number.isFinite(location?.longitude) || location.longitude < -180 || location.longitude > 180
    || !Number.isFinite(location?.accuracy) || location.accuracy < 0
    || !Number.isSafeInteger(location?.capturedAt) || location.capturedAt < 0) {
    throw new Error("The location details are not valid.");
  }
  const aad = locationContext(context.shareId, context.senderUserId, context.recipientUserId);
  const recipientKeyBytes = fromBase64Url(recipientPublicKey, 65, 65);
  if (!recipientKeyBytes) throw new Error("The recipient's public key is not valid.");
  const senderKeyBytes = fromBase64Url(senderPublicKey, 65, 65);
  if (!senderKeyBytes) throw new Error("The sender's public key is not valid.");
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = await deriveLocationKey(senderPrivateKey, recipientKeyBytes, salt, ["encrypt"]);
  const payload = JSON.stringify({
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    capturedAt: location.capturedAt,
  });
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, encoder.encode(payload),
  );
  return {
    senderPublicKey,
    hkdfSalt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    keyVersion: 1,
  };
}

export async function decryptLocationEnvelope(envelope, recipientPrivateKey, context) {
  if (envelope?.keyVersion !== 1) throw new Error("This location uses a newer encryption key version.");
  const senderPublicKey = fromBase64Url(envelope.senderPublicKey, 65, 65);
  const salt = fromBase64Url(envelope.hkdfSalt, 32, 32);
  const iv = fromBase64Url(envelope.iv, 12, 12);
  const ciphertext = fromBase64Url(envelope.ciphertext, 17, 4096);
  if (!senderPublicKey || !salt || !iv || !ciphertext) throw new Error("The encrypted location is not valid.");
  const aad = locationContext(context.shareId, context.senderUserId, context.recipientUserId);
  const key = await deriveLocationKey(recipientPrivateKey, senderPublicKey, salt, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, ciphertext,
  );
  const location = JSON.parse(decoder.decode(plaintext));
  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90
    || !Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180
    || !Number.isFinite(location.accuracy) || !Number.isSafeInteger(location.capturedAt)) {
    throw new Error("The decrypted location details are not valid.");
  }
  return location;
}

