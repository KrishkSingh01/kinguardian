const encoder = new TextEncoder();
export const PASSWORD_ALGORITHM = "PBKDF2-HMAC-SHA-256";
export const PASSWORD_ITERATIONS = 600_000;

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value, { minimumBytes = 1, maximumBytes = 65_536 } = {}) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  let binary;
  try {
    binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  } catch {
    return null;
  }
  if (binary.length < minimumBytes || binary.length > maximumBytes) return null;
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function randomToken(byteLength = 32) {
  return toBase64Url(randomBytes(byteLength));
}

export async function sha256(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function hmacSha256(secret, value) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("AUTH_RATE_LIMIT_SECRET must contain at least 32 characters.");
  }
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function derivePasswordHash(password, salt, iterations = PASSWORD_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations < PASSWORD_ITERATIONS || iterations > 1_200_000) {
    throw new Error("Unsupported password hashing work factor.");
  }
  const material = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256,
  );
  return new Uint8Array(bits);
}

export function constantTimeEqual(leftValue, rightValue) {
  const left = leftValue instanceof Uint8Array ? leftValue : new Uint8Array(leftValue);
  const right = rightValue instanceof Uint8Array ? rightValue : new Uint8Array(rightValue);
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if ([...normalized].length < 3 || [...normalized].length > 40) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]{2,39}$/u.test(normalized)) return null;
  return normalized;
}

export function validatePassword(value) {
  if (typeof value !== "string") return false;
  const bytes = encoder.encode(value).byteLength;
  return [...value].length >= 12 && bytes <= 256;
}
