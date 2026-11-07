import { newOpaqueCredential } from "../../../../_shared/accounts.js";
import { requireOwner } from "../../../../_shared/owner.js";
import { PASSWORD_ITERATIONS, randomToken, sha256 } from "../../../../_shared/crypto.js";
import { jsonResponse, requirePost, safeError } from "../../../../_shared/http.js";

const PASSWORD_SETUP_LIFETIME_MS = 60 * 60 * 1000;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const owner = await requireOwner(context, { write: true });
    if (owner.response) return owner.response;
    const targetId = context.params.user_id;
    const target = await context.env.DB.prepare(
      "SELECT user_id, role, account_status FROM users WHERE user_id = ?",
    ).bind(targetId).first();
    if (!target) return jsonResponse({ error: { code: "USER_NOT_FOUND", message: "That account was not found." } }, 404);
    if (target.role !== "member") {
      return jsonResponse({ error: { code: "OWNER_PASSWORD_RESET_BLOCKED", message: "Use the owner’s signed-in password change flow." } }, 409);
    }
    if (target.account_status !== "active") {
      return jsonResponse({ error: { code: "ACCOUNT_DISABLED", message: "Reactivate the account before issuing a reset." } }, 409);
    }

    const credential = await newOpaqueCredential();
    const setupToken = randomToken(32);
    const tokenHash = await sha256(setupToken);
    const tokenId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + PASSWORD_SETUP_LIFETIME_MS;
    await context.env.DB.batch([
      context.env.DB.prepare(`
        UPDATE users SET password_algorithm = 'PBKDF2-HMAC-SHA-256', password_iterations = ?,
          password_hash = ?, password_salt = ?, password_changed_at = NULL,
          must_change_password = 1, updated_at = ? WHERE user_id = ? AND role = 'member'
      `).bind(PASSWORD_ITERATIONS, credential.hash, credential.salt, now, targetId),
      context.env.DB.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(now, targetId),
      context.env.DB.prepare(
        "UPDATE mobile_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(now, targetId),
      context.env.DB.prepare(`
        UPDATE account_setup_tokens SET revoked_at = ?
        WHERE user_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL
      `).bind(now, targetId),
      context.env.DB.prepare(`
        INSERT INTO account_setup_tokens (
          token_id, token_hash, user_id, issuer_user_id, purpose, created_at, expires_at
        ) VALUES (?, ?, ?, ?, 'password_reset', ?, ?)
      `).bind(tokenId, tokenHash, targetId, owner.user.user_id, now, expiresAt),
      context.env.DB.prepare(`
        INSERT INTO owner_audit_events (event_id, actor_user_id, target_user_id, event_type, outcome, occurred_at)
        VALUES (?, ?, ?, 'password_reset_issued', 'succeeded', ?)
      `).bind(crypto.randomUUID(), owner.user.user_id, targetId, now),
    ]);

    const setupUrl = new URL("account-setup.html", new URL(context.request.url).origin);
    setupUrl.hash = setupToken;
    return jsonResponse({
      userId: targetId,
      setupTokenId: tokenId,
      setupUrl: setupUrl.href,
      expiresAt,
      mustChangePassword: true,
      warning: "Share this single-use password setup link privately. It expires after one hour and replaces any previous setup link.",
    });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestDelete(context) {
  try {
    const owner = await requireOwner(context, { write: true });
    if (owner.response) return owner.response;
    const targetId = context.params.user_id;
    const target = await context.env.DB.prepare(
      "SELECT user_id, role FROM users WHERE user_id = ?",
    ).bind(targetId).first();
    if (!target) return jsonResponse({ error: { code: "USER_NOT_FOUND", message: "That account was not found." } }, 404);
    if (target.role !== "member") {
      return jsonResponse({ error: { code: "OWNER_PASSWORD_RESET_BLOCKED", message: "The owner setup link cannot be revoked here." } }, 409);
    }
    const now = Date.now();
    const result = await context.env.DB.prepare(`
      UPDATE account_setup_tokens SET revoked_at = ?
      WHERE user_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL
    `).bind(now, targetId).run();
    return jsonResponse({ userId: targetId, revoked: Boolean(result.meta?.changes) });
  } catch (error) {
    return safeError(error);
  }
}
