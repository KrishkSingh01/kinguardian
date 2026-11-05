import { derivePasswordHash, PASSWORD_ITERATIONS, randomBytes, sha256, validatePassword } from "../../_shared/crypto.js";
import { isRateLimited, recordAttempt } from "../../_shared/rate-limit.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const body = await readJsonRequest(context.request, 4096);
    const { env, request } = context;
    if (typeof env.AUTH_RATE_LIMIT_SECRET !== "string" || env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "AUTH_NOT_CONFIGURED", message: "Account setup is temporarily unavailable." } }, 503);
    }
    const clientAddress = request.headers.get("cf-connecting-ip") || "local";
    const rateBucket = `setup-password:${clientAddress}`;
    if (await isRateLimited(env, rateBucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Wait before trying this setup link again." } }, 429);
    }
    await recordAttempt(env, rateBucket, 8);
    if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(body.token)) {
      return jsonResponse({ error: { code: "SETUP_LINK_UNAVAILABLE", message: "This setup link is invalid, expired, or already used." } }, 404);
    }
    if (!validatePassword(body.newPassword)) {
      return jsonResponse({ error: { code: "INVALID_PASSWORD", message: "Use a password with at least 12 characters and no more than 256 bytes." } }, 400);
    }

    const tokenHash = await sha256(body.token);
    const now = Date.now();
    const setup = await env.DB.prepare(`
      SELECT t.token_id, t.user_id, t.purpose, u.username
      FROM account_setup_tokens AS t
      JOIN users AS u ON u.user_id = t.user_id AND u.account_status = 'active'
      WHERE t.token_hash = ? AND t.redeemed_at IS NULL AND t.revoked_at IS NULL
        AND t.expires_at > ?
        AND (t.purpose = 'password_reset' OR (t.purpose = 'account_activation' AND u.must_change_password = 1))
    `).bind(tokenHash, now).first();
    if (!setup) {
      return jsonResponse({ error: { code: "SETUP_LINK_UNAVAILABLE", message: "This setup link is invalid, expired, or already used." } }, 404);
    }

    const salt = randomBytes(16);
    const passwordHash = await derivePasswordHash(body.newPassword, salt, PASSWORD_ITERATIONS);
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE account_setup_tokens SET redeemed_at = ?
        WHERE token_id = ? AND token_hash = ? AND redeemed_at IS NULL AND revoked_at IS NULL
          AND expires_at > ?
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')
      `).bind(now, setup.token_id, tokenHash, now, setup.user_id),
      env.DB.prepare(`
        UPDATE users SET password_algorithm = 'PBKDF2-HMAC-SHA-256', password_iterations = ?,
          password_hash = ?, password_salt = ?, password_changed_at = ?,
          must_change_password = 0, updated_at = ?
        WHERE user_id = ? AND account_status = 'active'
          AND changes() = 1
          AND EXISTS (SELECT 1 FROM account_setup_tokens WHERE token_id = ? AND redeemed_at = ?)
      `).bind(PASSWORD_ITERATIONS, passwordHash, salt, now, now, setup.user_id, setup.token_id, now),
      env.DB.prepare(`
        UPDATE account_setup_tokens SET revoked_at = ?
        WHERE user_id = ? AND token_id <> ? AND redeemed_at IS NULL AND revoked_at IS NULL
          AND changes() = 1
      `).bind(now, setup.user_id, setup.token_id),
      env.DB.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND changes() = 1",
      ).bind(now, setup.user_id),
    ]);
    if (!results[0].meta?.changes || !results[1].meta?.changes) {
      return jsonResponse({ error: { code: "SETUP_LINK_UNAVAILABLE", message: "This setup link is invalid, expired, or already used." } }, 404);
    }
    return jsonResponse({ ok: true, username: setup.username });
  } catch (error) {
    return safeError(error);
  }
}
