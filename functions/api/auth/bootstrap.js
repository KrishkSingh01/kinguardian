import { createSession } from "../../_shared/auth.js";
import { derivePasswordHash, normalizeUsername, PASSWORD_ITERATIONS, randomBytes, randomToken } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";
import { isRateLimited, recordFailure } from "../../_shared/rate-limit.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;

  try {
    const { request, env } = context;
    if (!env.OWNER_BOOTSTRAP_SECRET || env.OWNER_BOOTSTRAP_SECRET.length < 32
      || !env.AUTH_RATE_LIMIT_SECRET || env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "SETUP_NOT_CONFIGURED", message: "Owner setup has not been configured." } }, 503);
    }
    const body = await readJsonRequest(request, 4096);
    if (typeof body.bootstrapSecret !== "string" || body.bootstrapSecret.length > 512) {
      return jsonResponse({ error: { code: "SETUP_REJECTED", message: "The setup request could not be verified." } }, 403);
    }

    const remoteAddress = request.headers.get("cf-connecting-ip") || "local";
    const rateKey = `bootstrap:${remoteAddress}`;
    if (await isRateLimited(env, rateKey)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Wait before trying owner setup again." } }, 429);
    }

    const suppliedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.bootstrapSecret));
    const expectedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.OWNER_BOOTSTRAP_SECRET));
    let difference = 0;
    const supplied = new Uint8Array(suppliedDigest);
    const expected = new Uint8Array(expectedDigest);
    if (supplied.length !== expected.length) difference = 1;
    for (let index = 0; index < expected.length; index += 1) {
      difference |= expected[index] ^ (supplied[index] || 0);
    }
    if (difference !== 0) {
      await recordFailure(env, rateKey, 5);
      return jsonResponse({ error: { code: "SETUP_REJECTED", message: "The setup request could not be verified." } }, 403);
    }

    const owner = await env.DB.prepare("SELECT 1 AS present FROM users WHERE role = 'owner' LIMIT 1").first();
    const bootstrap = await env.DB.prepare(
      "SELECT consumed_at FROM owner_bootstrap WHERE singleton_id = 1",
    ).first();
    if (owner || !bootstrap || bootstrap.consumed_at) {
      return jsonResponse({ error: { code: "SETUP_ALREADY_USED", message: "Owner setup has already been used." } }, 409);
    }

    const now = Date.now();
    const userId = crypto.randomUUID();
    const temporaryPassword = randomToken(24);
    const salt = randomBytes(16);
    const passwordHash = await derivePasswordHash(temporaryPassword, salt, PASSWORD_ITERATIONS);
    const statements = [
      env.DB.prepare(`
        INSERT INTO users (
          user_id, username, role, account_status, password_algorithm,
          password_iterations, password_hash, password_salt,
          must_change_password, created_at, updated_at
        ) VALUES (?, ?, 'owner', 'active', 'PBKDF2-HMAC-SHA-256', ?, ?, ?, 1, ?, ?)
      `).bind(userId, normalizeUsername("owner"), PASSWORD_ITERATIONS, passwordHash, salt, now, now),
      env.DB.prepare(`
        UPDATE owner_bootstrap
        SET consumed_at = ?, created_owner_user_id = ?
        WHERE singleton_id = 1 AND consumed_at IS NULL
      `).bind(now, userId),
      env.DB.prepare(`
        INSERT INTO owner_audit_events (event_id, actor_user_id, target_user_id, event_type, outcome, occurred_at)
        VALUES (?, ?, ?, 'owner_bootstrapped', 'succeeded', ?)
      `).bind(crypto.randomUUID(), userId, userId, now),
    ];

    await env.DB.batch(statements);
    return jsonResponse({
      user: { userId, username: "owner", role: "owner", mustChangePassword: true },
      temporaryPassword,
      warning: "Copy this temporary password now. It is shown once and must be changed at first sign-in.",
    }, 201);
  } catch (error) {
    return safeError(error);
  }
}
