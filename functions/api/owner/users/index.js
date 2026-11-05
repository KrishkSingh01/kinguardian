import { newMemberIdentity, newOpaqueCredential } from "../../../_shared/accounts.js";
import { requireOwner, recordOwnerAudit } from "../../../_shared/owner.js";
import { randomToken, sha256 } from "../../../_shared/crypto.js";
import { jsonResponse, requirePost, safeError } from "../../../_shared/http.js";

const ACCOUNT_SETUP_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function onRequestGet(context) {
  try {
    const owner = await requireOwner(context);
    if (owner.response) return owner.response;
    const result = await context.env.DB.prepare(`
      SELECT user_id, username, role, account_status, must_change_password, created_at,
        (SELECT MAX(t.expires_at) FROM account_setup_tokens AS t
          WHERE t.user_id = users.user_id AND t.redeemed_at IS NULL
            AND t.revoked_at IS NULL AND t.expires_at > ?) AS setup_link_expires_at
      FROM users ORDER BY created_at ASC
    `).bind(Date.now()).all();
    return jsonResponse({ users: result.results || [] });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const owner = await requireOwner(context, { write: true });
    if (owner.response) return owner.response;

    const identity = newMemberIdentity();
    const credential = await newOpaqueCredential();
    const setupToken = randomToken(32);
    const tokenHash = await sha256(setupToken);
    const tokenId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + ACCOUNT_SETUP_LIFETIME_MS;
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO users (
          user_id, username, role, account_status, password_algorithm,
          password_iterations, password_hash, password_salt,
          must_change_password, created_at, updated_at
        ) VALUES (?, ?, 'member', 'active', 'PBKDF2-HMAC-SHA-256', ?, ?, ?, 1, ?, ?)
      `).bind(identity.userId, identity.username, 600_000, credential.hash, credential.salt, now, now),
      context.env.DB.prepare(`
        INSERT INTO notification_preferences (user_id, updated_at) VALUES (?, ?)
      `).bind(identity.userId, now),
      context.env.DB.prepare(`
        INSERT INTO account_setup_tokens (
          token_id, token_hash, user_id, issuer_user_id, purpose, created_at, expires_at
        ) VALUES (?, ?, ?, ?, 'account_activation', ?, ?)
      `).bind(tokenId, tokenHash, identity.userId, owner.user.user_id, now, expiresAt),
      context.env.DB.prepare(`
        INSERT INTO owner_audit_events (event_id, actor_user_id, target_user_id, event_type, outcome, occurred_at)
        VALUES (?, ?, ?, 'account_created', 'succeeded', ?)
      `).bind(crypto.randomUUID(), owner.user.user_id, identity.userId, now),
    ]);

    const setupUrl = new URL("account-setup.html", new URL(context.request.url).origin);
    setupUrl.hash = setupToken;
    return jsonResponse({
      user: { userId: identity.userId, username: identity.username, accountStatus: "active", mustChangePassword: true },
      setupTokenId: tokenId,
      setupUrl: setupUrl.href,
      expiresAt,
      warning: "Share this single-use setup link privately. The member chooses their own password; the link expires after 24 hours.",
    }, 201);
  } catch (error) {
    return safeError(error);
  }
}
