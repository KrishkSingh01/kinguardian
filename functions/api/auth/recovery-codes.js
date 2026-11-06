import { requireSession } from "../../_shared/auth.js";
import { clearRateLimit, isRateLimited, recordAttempt } from "../../_shared/rate-limit.js";
import { constantTimeEqual, derivePasswordHash, PASSWORD_ITERATIONS } from "../../_shared/crypto.js";
import { createRecoveryCodeSet } from "../../_shared/recovery-codes.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const ADDRESS_LIMIT = 10;
const USER_LIMIT = 5;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    if (!context.env.AUTH_RATE_LIMIT_SECRET || context.env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "RECOVERY_NOT_CONFIGURED", message: "Recovery codes are temporarily unavailable." } }, 503);
    }
    const body = await readJsonRequest(context.request, 2048);
    if (typeof body.password !== "string" || new TextEncoder().encode(body.password).byteLength > 256) {
      return jsonResponse({ error: { code: "PASSWORD_REJECTED", message: "Enter your current password and try again." } }, 401);
    }

    const remoteAddress = context.request.headers.get("cf-connecting-ip") || "local";
    const addressBucket = `recovery-codes:address:${remoteAddress}`;
    const userBucket = `recovery-codes:user:${session.user.user_id}`;
    if (await isRateLimited(context.env, addressBucket) || await isRateLimited(context.env, userBucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many attempts. Wait before trying again." } }, 429);
    }
    await Promise.all([
      recordAttempt(context.env, addressBucket, ADDRESS_LIMIT),
      recordAttempt(context.env, userBucket, USER_LIMIT),
    ]);

    const user = await context.env.DB.prepare(`
      SELECT password_algorithm, password_iterations, password_hash, password_salt
      FROM users WHERE user_id = ? AND account_status = 'active'
    `).bind(session.user.user_id).first();
    const candidate = user
      ? await derivePasswordHash(body.password, new Uint8Array(user.password_salt), user.password_iterations)
      : new Uint8Array(32);
    if (!user || user.password_algorithm !== "PBKDF2-HMAC-SHA-256"
      || user.password_iterations !== PASSWORD_ITERATIONS
      || !constantTimeEqual(candidate, new Uint8Array(user.password_hash))) {
      return jsonResponse({ error: { code: "PASSWORD_REJECTED", message: "The current password was not accepted." } }, 401);
    }

    const recovery = await createRecoveryCodeSet();
    const now = Date.now();
    const statements = [context.env.DB.prepare(`
      DELETE FROM account_recovery_codes WHERE user_id = ?
        AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')
    `).bind(session.user.user_id, session.user.user_id)];
    for (const record of recovery.records) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO account_recovery_codes (recovery_code_id, user_id, code_hash, created_at)
        SELECT ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active'
        )
      `).bind(record.codeId, session.user.user_id, record.codeHash, now, session.user.user_id));
    }
    const results = await context.env.DB.batch(statements);
    if (results.slice(1).some((result) => result?.meta?.changes !== 1)) {
      return jsonResponse({ error: { code: "RECOVERY_NOT_SAVED", message: "The new recovery codes could not be saved. Try again." } }, 409);
    }
    await Promise.all([clearRateLimit(context.env, addressBucket), clearRateLimit(context.env, userBucket)]);
    return jsonResponse({
      recoveryCodes: recovery.codes,
      message: "Save these new codes now. All previous recovery codes have been replaced.",
    });
  } catch (error) {
    return safeError(error);
  }
}
