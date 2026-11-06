import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, safeError } from "../../_shared/http.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const rows = await context.env.DB.prepare(`
      SELECT event.event_id, event.category, event.delivery_status, event.created_at,
             event.updated_at, event.related_resource_id, event.read_at,
             journey_owner.username AS journey_username,
             sos_owner.username AS sos_username
      FROM notification_events AS event
      LEFT JOIN safe_journeys AS journey
        ON journey.journey_id = event.related_resource_id
        AND event.category IN ('journey_started', 'journey_extended', 'journey_completed', 'journey_overdue')
      LEFT JOIN users AS journey_owner ON journey_owner.user_id = journey.user_id
      LEFT JOIN sos_alerts AS alert
        ON alert.alert_id = event.related_resource_id AND event.category = 'sos'
      LEFT JOIN users AS sos_owner ON sos_owner.user_id = alert.sender_user_id
      WHERE event.user_id = ?
      ORDER BY event.created_at DESC LIMIT 100
    `).bind(session.user.user_id).all();
    return jsonResponse({ events: (rows.results || []).map((row) => ({
      eventId: row.event_id,
      category: row.category,
      status: row.delivery_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      readAt: row.read_at,
      resourceId: row.related_resource_id,
      relatedUsername: row.journey_username || row.sos_username || null,
    })) });
  } catch (error) {
    return safeError(error);
  }
}
