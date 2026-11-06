import { createSession } from "../../_shared/auth.js";
import { derivePasswordHash, normalizeUsername, PASSWORD_ITERATIONS, randomBytes, randomToken } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";
import { isRateLimited, recordFailure } from "../../_shared/rate-limit.js";
import { createRecoveryCodeSet } from "../../_shared/recovery-codes.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;

  let failureStage = "configuration";
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
    failureStage = "rate-limit lookup";
    if (await isRateLimited(env, rateKey)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Wait before trying owner setup again." } }, 429);
    }

    failureStage = "setup-secret verification";
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

    failureStage = "owner-state lookup";
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
    failureStage = "temporary-password hashing";
    const passwordHash = await derivePasswordHash(temporaryPassword, salt, PASSWORD_ITERATIONS);
    const recovery = await createRecoveryCodeSet();
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
    for (const record of recovery.records) {
      statements.push(env.DB.prepare(`
        INSERT INTO account_recovery_codes (recovery_code_id, user_id, code_hash, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(record.codeId, userId, record.codeHash, now));
    }

    failureStage = "owner database write";
    await env.DB.batch(statements);
    return jsonResponse({
      user: { userId, username: "owner", role: "owner", mustChangePassword: true },
      temporaryPassword,
      recoveryCodes: recovery.codes,
      warning: "Copy this temporary password now. It is shown once and must be changed at first sign-in.",
    }, 201);
  } catch (error) {
    console.error("[KinGuardian] owner bootstrap failed", {
      stage: failureStage,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message.slice(0, 240) : "No error details",
    });
    return safeError(error);
  }
}
