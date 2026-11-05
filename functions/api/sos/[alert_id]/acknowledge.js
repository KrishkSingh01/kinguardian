import { requireSession } from "../../../_shared/auth.js";
import { jsonResponse, requirePost, safeError } from "../../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const alert = await context.env.DB.prepare(`
      SELECT a.alert_status, r.recipient_status, r.acknowledged_at
      FROM sos_alerts AS a
      JOIN sos_alert_recipients AS r ON r.alert_id = a.alert_id
      WHERE a.alert_id = ? AND r.recipient_user_id = ?
    `).bind(context.params.alert_id, session.user.user_id).first();
    if (!alert) return jsonResponse({ error: { code: "ALERT_NOT_FOUND", message: "That alert is not available to this account." } }, 404);
    if (alert.recipient_status === "acknowledged" || alert.acknowledged_at) {
      return jsonResponse({ acknowledged: true, alreadyAcknowledged: true, alertStatus: alert.alert_status });
    }
    if (["resolved", "closed"].includes(alert.alert_status)) {
      return jsonResponse({ error: { code: "ALERT_CLOSED", message: "This alert has already been resolved." } }, 409);
    }

    const now = Date.now();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(`
        UPDATE sos_alert_recipients SET recipient_status = 'acknowledged', acknowledged_at = ?
        WHERE alert_id = ? AND recipient_user_id = ? AND recipient_status <> 'acknowledged'
      `).bind(now, context.params.alert_id, session.user.user_id),
      context.env.DB.prepare(`
        INSERT OR IGNORE INTO sos_acknowledgements (
          acknowledgement_id, alert_id, recipient_user_id, acknowledged_at
        ) SELECT ?, ?, ?, ? WHERE changes() = 1
      `).bind(crypto.randomUUID(), context.params.alert_id, session.user.user_id, now),
      context.env.DB.prepare(`
        INSERT INTO notification_events (
          event_id, event_key, user_id, category, delivery_status, created_at, updated_at, related_resource_id
        ) SELECT lower(hex(randomblob(16))), 'acknowledgement:' || a.alert_id || ':' || ?,
          a.sender_user_id, 'acknowledgement', 'prepared', ?, ?, a.alert_id
        FROM sos_alerts AS a WHERE a.alert_id = ? AND changes() = 1
        ON CONFLICT (event_key) DO NOTHING
      `).bind(session.user.user_id, now, now, context.params.alert_id),
      context.env.DB.prepare(`
        UPDATE sos_alerts SET alert_status = 'recipient_acknowledged'
        WHERE alert_id = ? AND alert_status IN ('accepted_by_server', 'notification_attempted')
      `).bind(context.params.alert_id),
    ]);
    return jsonResponse({
      acknowledged: true,
      alreadyAcknowledged: results[0]?.meta?.changes !== 1,
      alertStatus: results[2]?.meta?.changes === 1 ? "recipient_acknowledged" : alert.alert_status,
    });
  } catch (error) {
    return safeError(error);
  }
}
