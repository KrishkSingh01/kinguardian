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
      UPDATE sos_alerts SET alert_status = 'resolved', resolved_at = ?
      WHERE alert_id = ? AND sender_user_id = ?
        AND alert_status IN ('accepted_by_server', 'notification_attempted', 'recipient_acknowledged')
    `).bind(now, context.params.alert_id, session.user.user_id).run();
    if (!result.meta?.changes) {
      const alert = await context.env.DB.prepare(
        "SELECT alert_status FROM sos_alerts WHERE alert_id = ? AND sender_user_id = ?",
      ).bind(context.params.alert_id, session.user.user_id).first();
      if (!alert) return jsonResponse({ error: { code: "ALERT_NOT_FOUND", message: "That alert was not found." } }, 404);
      if (["resolved", "closed"].includes(alert.alert_status)) return jsonResponse({ resolved: true, status: alert.alert_status });
      return jsonResponse({ error: { code: "ALERT_CANNOT_RESOLVE", message: "This alert cannot be resolved from its current status." } }, 409);
    }
    return jsonResponse({ resolved: true, status: "resolved", resolvedAt: now });
  } catch (error) {
    return safeError(error);
  }
}
