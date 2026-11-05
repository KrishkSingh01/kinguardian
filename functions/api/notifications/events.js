import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, safeError } from "../../_shared/http.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const rows = await context.env.DB.prepare(`
      SELECT event_id, category, delivery_status, created_at, updated_at
      FROM notification_events WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 30
    `).bind(session.user.user_id).all();
    return jsonResponse({ events: (rows.results || []).map((row) => ({
      eventId: row.event_id,
      category: row.category,
      status: row.delivery_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) });
  } catch (error) {
    return safeError(error);
  }
}
