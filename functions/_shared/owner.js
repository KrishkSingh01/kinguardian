import { requireSession } from "./auth.js";
import { errorResponse } from "./http.js";

export async function requireOwner(context, options = {}) {
  const session = await requireSession(context, options);
  if (session.response) return session;
  if (session.user.role !== "owner") {
    return { response: errorResponse("OWNER_REQUIRED", 403, "An owner account is required for this action.") };
  }
  return session;
}

export async function recordOwnerAudit(env, actorUserId, targetUserId, eventType, now = Date.now()) {
  await env.DB.prepare(`
    INSERT INTO owner_audit_events (event_id, actor_user_id, target_user_id, event_type, outcome, occurred_at)
    VALUES (?, ?, ?, ?, 'succeeded', ?)
  `).bind(crypto.randomUUID(), actorUserId, targetUserId, eventType, now).run();
}
