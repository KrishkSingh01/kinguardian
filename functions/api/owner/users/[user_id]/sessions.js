import { clearSessionCookies } from "../../../../_shared/auth.js";
import { requireOwner } from "../../../../_shared/owner.js";
import { jsonResponse, requirePost, safeError } from "../../../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const owner = await requireOwner(context, { write: true });
    if (owner.response) return owner.response;
    const targetId = context.params.user_id;
    const target = await context.env.DB.prepare(
      "SELECT user_id FROM users WHERE user_id = ?",
    ).bind(targetId).first();
    if (!target) return jsonResponse({ error: { code: "USER_NOT_FOUND", message: "That account was not found." } }, 404);

    const now = Date.now();
    await context.env.DB.batch([
      context.env.DB.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(now, targetId),
      context.env.DB.prepare(
        "UPDATE mobile_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(now, targetId),
      context.env.DB.prepare(`
        INSERT INTO owner_audit_events (event_id, actor_user_id, target_user_id, event_type, outcome, occurred_at)
        VALUES (?, ?, ?, 'sessions_revoked', 'succeeded', ?)
      `).bind(crypto.randomUUID(), owner.user.user_id, targetId, now),
    ]);

    const headers = targetId === owner.user.user_id ? { "Set-Cookie": clearSessionCookies() } : {};
    return jsonResponse({ userId: targetId, sessionsRevoked: true }, 200, headers);
  } catch (error) {
    return safeError(error);
  }
}
