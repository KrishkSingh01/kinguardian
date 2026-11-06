import { createSessionCredentials, sessionCookies } from "../../_shared/auth.js";
import { derivePasswordHash, normalizeUsername, PASSWORD_ITERATIONS, randomBytes, validatePassword } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";
import { isRateLimited, recordAttempt } from "../../_shared/rate-limit.js";
import { createRecoveryCodeSet } from "../../_shared/recovery-codes.js";

const ADDRESS_LIMIT = 10;
const USERNAME_LIMIT = 5;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const { request, env } = context;
    if (!env.AUTH_RATE_LIMIT_SECRET || env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "REGISTRATION_NOT_CONFIGURED", message: "Account creation is temporarily unavailable." } }, 503);
    }

    const remoteAddress = request.headers.get("cf-connecting-ip") || "local";
    const addressBucket = `register:address:${remoteAddress}`;
    if (await isRateLimited(env, addressBucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many account requests. Wait before trying again." } }, 429);
    }
    await recordAttempt(env, addressBucket, ADDRESS_LIMIT);

    const body = await readJsonRequest(request, 4096);
    const username = normalizeUsername(body.username);
    if (!username || username === "owner" || !validatePassword(body.password)) {
      return jsonResponse({ error: { code: "INVALID_REGISTRATION", message: "Choose a valid username and a password with at least 12 characters." } }, 400);
    }

    const usernameBucket = `register:username:${username}`;
    if (await isRateLimited(env, usernameBucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many requests for this username. Wait and try again." } }, 429);
    }
    await recordAttempt(env, usernameBucket, USERNAME_LIMIT);

    const salt = randomBytes(16);
    const passwordHash = await derivePasswordHash(body.password, salt, PASSWORD_ITERATIONS);
    const userId = crypto.randomUUID();
    const now = Date.now();
    const recovery = await createRecoveryCodeSet();
    const session = await createSessionCredentials(now);
    const statements = [env.DB.prepare(`
      INSERT INTO users (
        user_id, username, role, account_status, password_algorithm,
        password_iterations, password_hash, password_salt, password_changed_at,
        must_change_password, created_at, updated_at
      ) VALUES (?, ?, 'member', 'active', 'PBKDF2-HMAC-SHA-256', ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT (username) DO NOTHING
    `).bind(userId, username, PASSWORD_ITERATIONS, passwordHash, salt, now, now, now)];

    for (const record of recovery.records) {
      statements.push(env.DB.prepare(`
        INSERT INTO account_recovery_codes (recovery_code_id, user_id, code_hash, created_at)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE user_id = ?)
      `).bind(record.codeId, userId, record.codeHash, now, userId));
    }
    statements.push(env.DB.prepare(`
      INSERT INTO sessions (session_token_hash, csrf_token_hash, user_id, created_at, expires_at, last_seen_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE user_id = ?)
    `).bind(session.tokenHash, session.csrfHash, userId, now, session.expiresAt, now, userId));

    const inserted = await env.DB.batch(statements);

    if (!inserted[0]?.meta?.changes) {
      return jsonResponse({ error: { code: "USERNAME_UNAVAILABLE", message: "That username is not available. Choose another one." } }, 409);
    }
    if (inserted.slice(1).some((result) => result?.meta?.changes !== 1)) {
      throw new Error("Account recovery data could not be saved.");
    }
    return jsonResponse({
      user: { userId, username, role: "member", mustChangePassword: false },
      csrfToken: session.csrfToken,
      recoveryCodes: recovery.codes,
    }, 201, { "Set-Cookie": sessionCookies(session.token, session.csrfToken) });
  } catch (error) {
    return safeError(error);
  }
}
