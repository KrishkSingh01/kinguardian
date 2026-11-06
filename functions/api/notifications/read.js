import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const MAX_IDS_PER_REQUEST = 100;
const EVENT_ID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f-]{27})$/iu;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 8192);
    const userId = session.user.user_id;
    const now = Date.now();
    if (body.markAll === true && body.notificationIds === undefined) {
      const result = await context.env.DB.prepare(`UPDATE notification_events SET read_at = ?, updated_at = ?
        WHERE user_id = ? AND read_at IS NULL`).bind(now, now, userId).run();
      return jsonResponse({ updated: result.meta?.changes || 0, readAt: now });
    }
    const ids = body.notificationIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS_PER_REQUEST
      || ids.some((id) => typeof id !== "string" || !EVENT_ID_PATTERN.test(id))
      || new Set(ids).size !== ids.length) {
      return jsonResponse({ error: { code: "INVALID_NOTIFICATIONS", message: "Choose valid notifications and try again." } }, 400);
    }
    const results = await context.env.DB.batch(ids.map((id) => context.env.DB.prepare(`
      UPDATE notification_events SET read_at = ?, updated_at = ?
      WHERE event_id = ? AND user_id = ? AND read_at IS NULL
    `).bind(now, now, id, userId)));
    return jsonResponse({ updated: results.reduce((total, result) => total + (result.meta?.changes || 0), 0), readAt: now });
  } catch (error) {
    return safeError(error);
  }
}
