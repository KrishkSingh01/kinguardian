import { errorResponse } from "./http.js";
import { constantTimeEqual, randomToken, sha256 } from "./crypto.js";

const SESSION_COOKIE = "__Host-kg_session";
const CSRF_COOKIE = "__Host-kg_csrf";
const SESSION_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const LAST_SEEN_INTERVAL_MS = 15 * 60 * 1000;

export function passwordCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_MS / 1000}`;
}

export function sessionCookies(token, csrfToken) {
  return [
    passwordCookie(token),
    `${CSRF_COOKIE}=${csrfToken}; Path=/; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_MS / 1000}`,
  ];
}

export function clearSessionCookies() {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; Secure; SameSite=Strict; Max-Age=0`,
  ];
}

export async function createSessionCredentials(now = Date.now()) {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  return {
    token,
    csrfToken,
    tokenHash: await sha256(token),
    csrfHash: await sha256(csrfToken),
    expiresAt: now + SESSION_DURATION_MS,
  };
}

function readCookie(request, wantedName) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator >= 0 && item.slice(0, separator).trim() === wantedName) {
      return item.slice(separator + 1).trim();
    }
  }
  return null;
}

function readSessionToken(request) {
  return readCookie(request, SESSION_COOKIE);
}

export async function createSession(env, userId, now = Date.now()) {
  const credentials = await createSessionCredentials(now);
  await env.DB.prepare(`
    INSERT INTO sessions (session_token_hash, csrf_token_hash, user_id, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(credentials.tokenHash, credentials.csrfHash, userId, now, credentials.expiresAt, now).run();
  return credentials;
}

export async function requireSession(context, { write = false, allowPasswordChange = false } = {}) {
  const token = readSessionToken(context.request);
  if (!token || token.length > 100) {
    return { response: errorResponse("AUTH_REQUIRED", 401, "Sign in to continue.") };
  }

  const tokenHash = await sha256(token);
  const now = Date.now();
  const user = await context.env.DB.prepare(`
    SELECT s.session_token_hash, s.csrf_token_hash, s.expires_at, s.last_seen_at,
           u.user_id, u.username, u.role, u.account_status, u.must_change_password
    FROM sessions AS s
    JOIN users AS u ON u.user_id = s.user_id
    WHERE s.session_token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.account_status = 'active'
  `).bind(tokenHash, now).first();

  if (!user) {
    return { response: errorResponse("AUTH_REQUIRED", 401, "Sign in to continue.") };
  }
  if (user.must_change_password && !allowPasswordChange) {
    return { response: errorResponse("PASSWORD_CHANGE_REQUIRED", 403, "Change your temporary password to continue.") };
  }
  if (write) {
    const origin = context.request.headers.get("origin");
    let sameOrigin = false;
    try { sameOrigin = Boolean(origin && origin === new URL(context.request.url).origin); } catch { /* reject below */ }
    const csrfToken = context.request.headers.get("x-csrf-token") || "";
    if (!sameOrigin || csrfToken.length > 100) {
      return { response: errorResponse("CSRF_REJECTED", 403, "Refresh your session and try again.") };
    }
    const csrfCookie = readCookie(context.request, CSRF_COOKIE) || "";
    if (!constantTimeEqual(new TextEncoder().encode(csrfToken), new TextEncoder().encode(csrfCookie))) {
      return { response: errorResponse("CSRF_REJECTED", 403, "Refresh your session and try again.") };
    }
    const csrfHash = await sha256(csrfToken);
    if (!constantTimeEqual(csrfHash, user.csrf_token_hash)) {
      return { response: errorResponse("CSRF_REJECTED", 403, "Refresh your session and try again.") };
    }
  }

  if (user.last_seen_at < now - LAST_SEEN_INTERVAL_MS) {
    await context.env.DB.prepare(`
      UPDATE sessions SET last_seen_at = ?
      WHERE session_token_hash = ? AND revoked_at IS NULL
    `).bind(now, tokenHash).run();
  }

  return { user, tokenHash };
}
