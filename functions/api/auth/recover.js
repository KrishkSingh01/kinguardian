import { clearRateLimit, isRateLimited, recordAttempt } from "../../_shared/rate-limit.js";
import { derivePasswordHash, normalizeUsername, PASSWORD_ITERATIONS, randomBytes, validatePassword } from "../../_shared/crypto.js";
import { hashRecoveryCode } from "../../_shared/recovery-codes.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const ADDRESS_LIMIT = 10;
const USER_LIMIT = 5;
const RECOVERY_ERROR = "The username, recovery code, or new password could not be accepted.";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const { request, env } = context;
    if (!env.AUTH_RATE_LIMIT_SECRET || env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "RECOVERY_NOT_CONFIGURED", message: "Password recovery is temporarily unavailable." } }, 503);
    }

    const body = await readJsonRequest(request, 4096);
    const remoteAddress = request.headers.get("cf-connecting-ip") || "local";
    const addressBucket = `recovery:address:${remoteAddress}`;
    if (await isRateLimited(env, addressBucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many recovery attempts. Wait before trying again." } }, 429);
    }
    await recordAttempt(env, addressBucket, ADDRESS_LIMIT);

    const username = normalizeUsername(body.username);
    if (username) {
      const userBucket = `recovery:user:${username}`;
      if (await isRateLimited(env, userBucket)) {
        return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many recovery attempts. Wait before trying again." } }, 429);
      }
      await recordAttempt(env, userBucket, USER_LIMIT);
    }
    const codeHash = await hashRecoveryCode(body.recoveryCode);
    if (!username || !codeHash || !validatePassword(body.password)) {
      return jsonResponse({ error: { code: "RECOVERY_REJECTED", message: RECOVERY_ERROR } }, 400);
    }

    const user = await env.DB.prepare(`
      SELECT u.user_id, u.username, u.password_algorithm, u.password_iterations,
             u.password_hash, u.password_salt, r.recovery_code_id
      FROM users AS u
      JOIN account_recovery_codes AS r ON r.user_id = u.user_id
      WHERE u.username = ? AND u.account_status = 'active'
        AND r.code_hash = ? AND r.used_at IS NULL
      LIMIT 1
    `).bind(username, codeHash).first();
    if (!user) return jsonResponse({ error: { code: "RECOVERY_REJECTED", message: RECOVERY_ERROR } }, 400);

    const salt = randomBytes(16);
    const passwordHash = await derivePasswordHash(body.password, salt, PASSWORD_ITERATIONS);
    const now = Date.now();
    const statements = [
      env.DB.prepare(`
        UPDATE account_recovery_codes SET used_at = ?
        WHERE recovery_code_id = ? AND used_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')
      `).bind(now, user.recovery_code_id, user.user_id),
      env.DB.prepare(`
        UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?,
          password_changed_at = ?, updated_at = ?, must_change_password = 0
        WHERE user_id = ? AND account_status = 'active' AND changes() = 1
      `).bind(passwordHash, salt, PASSWORD_ITERATIONS, now, now, user.user_id),
      env.DB.prepare(`
        UPDATE sessions SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND password_changed_at = ? AND password_hash = ?)
      `).bind(now, user.user_id, user.user_id, now, passwordHash),
      env.DB.prepare(`
        UPDATE mobile_refresh_tokens SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND password_changed_at = ? AND password_hash = ?)
      `).bind(now, user.user_id, user.user_id, now, passwordHash),
      env.DB.prepare(`
        UPDATE account_setup_tokens SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL AND redeemed_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND password_changed_at = ? AND password_hash = ?)
      `).bind(now, user.user_id, user.user_id, now, passwordHash),
    ];
    const results = await env.DB.batch(statements);
    if (!results[1]?.meta?.changes) {
      return jsonResponse({ error: { code: "RECOVERY_REJECTED", message: RECOVERY_ERROR } }, 400);
    }
    await clearRateLimit(env, `recovery:user:${username}`);
    return jsonResponse({
      recovered: true,
      message: "Your password has been changed. Sign in with your new password. This recovery code cannot be used again.",
    });
  } catch (error) {
    return safeError(error);
  }
}
