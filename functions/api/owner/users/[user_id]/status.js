import { requireOwner } from "../../../../_shared/owner.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const owner = await requireOwner(context, { write: true });
    if (owner.response) return owner.response;
    const targetId = context.params.user_id;
    const body = await readJsonRequest(context.request, 2048);
    if (!["active", "disabled"].includes(body.status)) {
      return jsonResponse({ error: { code: "INVALID_STATUS", message: "Choose active or disabled." } }, 400);
    }

    const target = await context.env.DB.prepare(
      "SELECT user_id, role FROM users WHERE user_id = ?",
    ).bind(targetId).first();
    if (!target) return jsonResponse({ error: { code: "USER_NOT_FOUND", message: "That account was not found." } }, 404);
    if (target.role === "owner") {
      return jsonResponse({ error: { code: "OWNER_ACCOUNT_PROTECTED", message: "The sole owner account cannot be disabled here." } }, 409);
    }

    const now = Date.now();
    const auditType = body.status === "disabled" ? "account_disabled" : "account_reactivated";
    const statements = [
      context.env.DB.prepare(`
        UPDATE users SET account_status = ?, disabled_at = ?, updated_at = ? WHERE user_id = ? AND role = 'member'
      `).bind(body.status, body.status === "disabled" ? now : null, now, targetId),
    ];
    if (body.status === "disabled") {
      statements.push(context.env.DB.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(now, targetId));
      statements.push(context.env.DB.prepare(
        "UPDATE mobile_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(now, targetId));
      statements.push(context.env.DB.prepare(`
        UPDATE account_setup_tokens SET revoked_at = ?
        WHERE user_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL
      `).bind(now, targetId));
    }
    statements.push(context.env.DB.prepare(`
      INSERT INTO owner_audit_events (event_id, actor_user_id, target_user_id, event_type, outcome, occurred_at)
      VALUES (?, ?, ?, ?, 'succeeded', ?)
    `).bind(crypto.randomUUID(), owner.user.user_id, targetId, auditType, now));
    await context.env.DB.batch(statements);
    return jsonResponse({ userId: targetId, accountStatus: body.status });
  } catch (error) {
    return safeError(error);
  }
}
