import { createSessionCredentials } from "../../_shared/auth.js";
import { isRateLimited, recordAttempt } from "../../_shared/rate-limit.js";
import { createMobileRefreshCredential, isNativeClient } from "../../_shared/mobile-auth.js";
import { sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ADDRESS_LIMIT = 30;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const { env, request } = context;
    if (!isNativeClient(request)) {
      return jsonResponse({ error: { code: "NATIVE_CLIENT_REQUIRED", message: "This session action is only available in the KinGuardian mobile app." } }, 400);
    }
    if (typeof env.AUTH_RATE_LIMIT_SECRET !== "string" || env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "AUTH_NOT_CONFIGURED", message: "Sign-in is temporarily unavailable." } }, 503);
    }
    const address = request.headers.get("cf-connecting-ip") || "local";
    const bucket = `mobile-refresh:address:${address}`;
    if (await isRateLimited(env, bucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Wait before trying to sign in again." } }, 429);
    }
    await recordAttempt(env, bucket, ADDRESS_LIMIT);

    const body = await readJsonRequest(request, 2048);
    if (typeof body.refreshToken !== "string" || !REFRESH_TOKEN_PATTERN.test(body.refreshToken)) {
      return invalidRefresh();
    }
    const tokenHash = await sha256(body.refreshToken);
    const now = Date.now();
    const record = await env.DB.prepare(`
      SELECT refresh.refresh_token_hash, refresh.family_id, refresh.user_id,
             refresh.session_token_hash, refresh.expires_at, refresh.used_at,
             refresh.revoked_at, user.username, user.role, user.must_change_password
      FROM mobile_refresh_tokens AS refresh
      JOIN users AS user ON user.user_id = refresh.user_id AND user.account_status = 'active'
      WHERE refresh.refresh_token_hash = ?
    `).bind(tokenHash).first();
    if (!record || record.revoked_at || record.expires_at <= now) return invalidRefresh();
    if (record.used_at) {
      await revokeFamily(env.DB, record.family_id, now);
      return invalidRefresh();
    }

    const nextSession = await createSessionCredentials(now);
    const nextRefresh = await createMobileRefreshCredential(
      nextSession.tokenHash, now, record.family_id, record.expires_at,
    );
    const statements = [
      env.DB.prepare(`UPDATE mobile_refresh_tokens SET used_at = ?, replaced_by_hash = ?
        WHERE refresh_token_hash = ? AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL
          AND expires_at > ? AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')`)
        .bind(now, nextRefresh.tokenHash, tokenHash, record.user_id, now, record.user_id),
      env.DB.prepare(`UPDATE sessions SET revoked_at = ?
        WHERE session_token_hash = ? AND revoked_at IS NULL AND changes() = 1`)
        .bind(now, record.session_token_hash),
      env.DB.prepare(`INSERT INTO sessions (
          session_token_hash, csrf_token_hash, user_id, created_at, expires_at, last_seen_at
        ) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')`)
        .bind(nextSession.tokenHash, nextSession.csrfHash, record.user_id, now,
          nextSession.expiresAt, now, record.user_id),
      env.DB.prepare(`INSERT INTO mobile_refresh_tokens (
          refresh_token_hash, family_id, user_id, session_token_hash, created_at, expires_at
        ) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(nextRefresh.tokenHash, nextRefresh.familyId, record.user_id,
          nextRefresh.sessionTokenHash, now, nextRefresh.expiresAt),
    ];
    const results = await env.DB.batch(statements);
    if (results.some((result) => result?.meta?.changes !== 1)) {
      // A simultaneous refresh or replay invalidates the family so neither caller
      // can keep a token minted from a raced refresh.
      await revokeFamily(env.DB, record.family_id, now);
      return invalidRefresh();
    }

    return jsonResponse({
      user: {
        userId: record.user_id,
        username: record.username,
        role: record.role,
        mustChangePassword: Boolean(record.must_change_password),
      },
      accessToken: nextSession.token,
      accessExpiresAt: nextSession.expiresAt,
      refreshToken: nextRefresh.token,
      refreshExpiresAt: nextRefresh.expiresAt,
    });
  } catch (error) {
    return safeError(error);
  }
}

async function revokeFamily(DB, familyId, now) {
  await DB.batch([
    DB.prepare("UPDATE mobile_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL")
      .bind(now, familyId),
    DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL
      AND session_token_hash IN (SELECT session_token_hash FROM mobile_refresh_tokens WHERE family_id = ?)`)
      .bind(now, familyId),
  ]);
}

function invalidRefresh() {
  return jsonResponse({ error: { code: "MOBILE_SESSION_INVALID", message: "Your mobile session expired. Sign in again." } }, 401);
}
