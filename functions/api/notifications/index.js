import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, safeError } from "../../_shared/http.js";
import { NOTIFICATION_CATEGORIES, usableVapidPublicKey } from "../../_shared/notifications.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const userId = session.user.user_id;
    const [preference, subscriptions] = await Promise.all([
      context.env.DB.prepare("SELECT * FROM notification_preferences WHERE user_id = ?")
        .bind(userId).first(),
      context.env.DB.prepare(`SELECT COUNT(*) AS active_count FROM push_subscriptions
        WHERE user_id = ? AND disabled_at IS NULL`).bind(userId).first(),
    ]);
    const preferences = Object.fromEntries(Object.entries(NOTIFICATION_CATEGORIES).map(([key, column]) => [
      key, preference ? Boolean(preference[column]) : true,
    ]));
    const publicKey = usableVapidPublicKey(context.env.VAPID_PUBLIC_KEY);
    return jsonResponse({
      preferences,
      pushAvailable: Boolean(publicKey),
      vapidPublicKey: publicKey,
      activeDeviceCount: subscriptions?.active_count || 0,
      deviceLimit: 5,
    });
  } catch (error) {
    return safeError(error);
  }
}
