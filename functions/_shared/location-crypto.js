const LOCATION_KEY_INFO = new TextEncoder().encode("kinguardian/location-at-rest/v1");

async function locationKey(env) {
  const secret = env.AUTH_RATE_LIMIT_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Location protection is not configured.");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: LOCATION_KEY_INFO, info: LOCATION_KEY_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aadFor(shareId, ownerUserId) {
  return new TextEncoder().encode(`kinguardian-location:${shareId}:${ownerUserId}:v1`);
}

export async function encryptLocationPoint(env, shareId, ownerUserId, point) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(point));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aadFor(shareId, ownerUserId) },
    await locationKey(env),
    plaintext,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function decryptLocationPoint(env, shareId, ownerUserId, ciphertext, iv) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv), additionalData: aadFor(shareId, ownerUserId) },
    await locationKey(env),
    ciphertext,
  );
  const point = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90
    || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180
    || !Number.isFinite(point.capturedAt)) {
    throw new Error("The saved location point is invalid.");
  }
  return point;
}
