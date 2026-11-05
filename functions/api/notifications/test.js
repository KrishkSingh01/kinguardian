import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, requirePost, safeError } from "../../_shared/http.js";
import { usableVapidPublicKey } from "../../_shared/notifications.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    if (!usableVapidPublicKey(context.env.VAPID_PUBLIC_KEY)) {
      return jsonResponse({ error: { code: "PUSH_NOT_CONFIGURED", message: "Web Push is not configured for this app yet." } }, 503);
    }
    const recent = await context.env.DB.prepare(`SELECT 1 AS recent FROM notification_events
      WHERE user_id = ? AND category = 'test' AND created_at > ? LIMIT 1`)
      .bind(session.user.user_id, Date.now() - 60_000).first();
    if (recent) {
      return jsonResponse({ error: { code: "TEST_RATE_LIMITED", message: "Wait one minute before queuing another test notification." } }, 429);
    }
    const devices = await context.env.DB.prepare(`SELECT COUNT(*) AS active_count FROM push_subscriptions
      WHERE user_id = ? AND disabled_at IS NULL`).bind(session.user.user_id).first();
    if (!devices?.active_count) {
      return jsonResponse({ error: { code: "NO_PUSH_DEVICE", message: "Enable notifications on this device before sending a test." } }, 409);
    }
    const now = Date.now();
    await context.env.DB.prepare(`
      INSERT INTO notification_events (event_id, event_key, user_id, category, delivery_status, created_at, updated_at)
      VALUES (?, ?, ?, 'test', 'prepared', ?, ?)
    `).bind(crypto.randomUUID(), `test:${crypto.randomUUID()}`, session.user.user_id, now, now).run();
    return jsonResponse({ queued: true, message: "Test notification queued. A scheduled worker will try to send it shortly; this response does not confirm delivery." }, 202);
  } catch (error) {
    return safeError(error);
  }
}
