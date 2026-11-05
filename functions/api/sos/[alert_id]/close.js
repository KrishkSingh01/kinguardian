import { requireSession } from "../../../_shared/auth.js";
import { jsonResponse, requirePost, safeError } from "../../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const now = Date.now();
    const result = await context.env.DB.prepare(`
      UPDATE sos_alerts SET alert_status = 'closed', closed_at = ?
      WHERE alert_id = ? AND sender_user_id = ? AND alert_status = 'resolved'
    `).bind(now, context.params.alert_id, session.user.user_id).run();
    if (!result.meta?.changes) {
      const alert = await context.env.DB.prepare(
        "SELECT alert_status FROM sos_alerts WHERE alert_id = ? AND sender_user_id = ?",
      ).bind(context.params.alert_id, session.user.user_id).first();
      if (!alert) return jsonResponse({ error: { code: "ALERT_NOT_FOUND", message: "That alert was not found." } }, 404);
      if (alert.alert_status === "closed") return jsonResponse({ closed: true, status: "closed" });
      return jsonResponse({ error: { code: "ALERT_MUST_BE_RESOLVED", message: "Resolve the alert before closing it." } }, 409);
    }
    return jsonResponse({ closed: true, status: "closed", closedAt: now });
  } catch (error) {
    return safeError(error);
  }
}
