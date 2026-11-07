import { requireSession } from "../../_shared/auth.js";
import { derivePasswordHash, PASSWORD_ITERATIONS, randomBytes, validatePassword, constantTimeEqual } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true, allowPasswordChange: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 4096);
    if (typeof body.currentPassword !== "string" || !validatePassword(body.newPassword)) {
      return jsonResponse({ error: { code: "INVALID_PASSWORD", message: "Use a new passphrase with at least 12 characters." } }, 400);
    }

    const user = await context.env.DB.prepare(`
      SELECT password_algorithm, password_iterations, password_hash, password_salt
      FROM users WHERE user_id = ? AND account_status = 'active'
    `).bind(session.user.user_id).first();
    if (!user || user.password_algorithm !== "PBKDF2-HMAC-SHA-256") {
      return jsonResponse({ error: { code: "PASSWORD_CHANGE_FAILED", message: "The password could not be changed." } }, 400);
    }

    const currentHash = await derivePasswordHash(
      body.currentPassword, new Uint8Array(user.password_salt), user.password_iterations,
    );
    if (!constantTimeEqual(currentHash, user.password_hash)) {
      return jsonResponse({ error: { code: "CURRENT_PASSWORD_INCORRECT", message: "The current password is incorrect." } }, 401);
    }
    if (body.currentPassword === body.newPassword) {
      return jsonResponse({ error: { code: "PASSWORD_UNCHANGED", message: "Choose a different password." } }, 400);
    }

    const now = Date.now();
    const salt = randomBytes(16);
    const newHash = await derivePasswordHash(body.newPassword, salt, PASSWORD_ITERATIONS);
    await context.env.DB.batch([
      context.env.DB.prepare(`
        UPDATE users SET password_algorithm = 'PBKDF2-HMAC-SHA-256', password_iterations = ?,
          password_hash = ?, password_salt = ?, password_changed_at = ?,
          must_change_password = 0, updated_at = ?
        WHERE user_id = ? AND account_status = 'active'
      `).bind(PASSWORD_ITERATIONS, newHash, salt, now, now, session.user.user_id),
      context.env.DB.prepare(`
        UPDATE sessions SET revoked_at = ?
        WHERE user_id = ? AND session_token_hash <> ? AND revoked_at IS NULL
      `).bind(now, session.user.user_id, session.tokenHash),
      context.env.DB.prepare(`
        INSERT INTO notification_events (
          event_id, event_key, user_id, category, delivery_status, created_at, updated_at
        ) SELECT ?, ?, user_id, 'account_security', 'prepared', ?, ?
          FROM users WHERE user_id = ? AND account_status = 'active'
      `).bind(crypto.randomUUID(), `account-security:password:${crypto.randomUUID()}`,
        now, now, session.user.user_id),
    ]);

    return jsonResponse({ ok: true, mustChangePassword: false });
  } catch (error) {
    return safeError(error);
  }
}
