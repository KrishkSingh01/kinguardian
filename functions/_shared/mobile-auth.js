import { randomToken, sha256 } from "./crypto.js";
import { sessionCookies } from "./auth.js";

export const NATIVE_CLIENT_HEADER = "x-kg-client";
export const NATIVE_CLIENT_VALUE = "native";
export const MOBILE_REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function isNativeClient(request) {
  return request.headers.get(NATIVE_CLIENT_HEADER) === NATIVE_CLIENT_VALUE;
}

export async function createMobileRefreshCredential(sessionTokenHash, now = Date.now(), familyId = crypto.randomUUID(), expiresAt = now + MOBILE_REFRESH_LIFETIME_MS) {
  const token = randomToken(32);
  return {
    token,
    tokenHash: await sha256(token),
    familyId,
    sessionTokenHash,
    createdAt: now,
    expiresAt,
  };
}

export function mobileAuthPayload(request, session, refreshCredential) {
  if (!isNativeClient(request)) return { csrfToken: session.csrfToken };
  if (!refreshCredential) throw new Error("Native session refresh credentials are missing.");
  return {
    accessToken: session.token,
    accessExpiresAt: session.expiresAt,
    refreshToken: refreshCredential.token,
    refreshExpiresAt: refreshCredential.expiresAt,
  };
}

export function authResponseHeaders(request, session) {
  if (isNativeClient(request)) return {};
  return { "Set-Cookie": sessionCookies(session.token, session.csrfToken) };
}

export function insertMobileRefreshStatement(DB, userId, credential) {
  return DB.prepare(`
    INSERT INTO mobile_refresh_tokens (
      refresh_token_hash, family_id, user_id, session_token_hash,
      created_at, expires_at
    ) SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')
  `).bind(credential.tokenHash, credential.familyId, userId, credential.sessionTokenHash,
    credential.createdAt, credential.expiresAt, userId);
}
