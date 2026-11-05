import { derivePasswordHash, PASSWORD_ITERATIONS, randomBytes, randomToken } from "./crypto.js";

export async function newTemporaryCredential() {
  const password = randomToken(24);
  const salt = randomBytes(16);
  const hash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  return { password, salt, hash };
}

export async function newOpaqueCredential() {
  const inaccessibleSecret = randomToken(48);
  const salt = randomBytes(16);
  const hash = await derivePasswordHash(inaccessibleSecret, salt, PASSWORD_ITERATIONS);
  return { salt, hash };
}

export function newMemberIdentity() {
  const suffix = [...randomBytes(8)].map((part) => part.toString(16).padStart(2, "0")).join("");
  return { userId: crypto.randomUUID(), username: `kg-${suffix}` };
}
