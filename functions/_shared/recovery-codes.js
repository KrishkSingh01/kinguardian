import { randomBytes, sha256 } from "./crypto.js";

export const RECOVERY_CODE_COUNT = 10;

export async function createRecoveryCodeSet() {
  const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    [...randomBytes(16)].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase());
  const records = await Promise.all(rawCodes.map(async (code) => ({
    codeId: crypto.randomUUID(),
    codeHash: await sha256(code),
  })));
  return {
    codes: rawCodes.map((code) => code.match(/.{4}/gu).join("-")),
    records,
  };
}

export function normalizeRecoveryCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\s-]/gu, "").toUpperCase();
  return /^[0-9A-F]{32}$/u.test(normalized) ? normalized : null;
}

export async function hashRecoveryCode(value) {
  const normalized = normalizeRecoveryCode(value);
  return normalized ? sha256(normalized) : null;
}
