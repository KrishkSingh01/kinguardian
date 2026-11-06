import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";
import { NOTIFICATION_CATEGORIES } from "../../_shared/notifications.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 4096);
    const expectedKeys = Object.keys(NOTIFICATION_CATEGORIES).sort();
    if (Object.keys(body).sort().join("|") !== expectedKeys.join("|")
      || expectedKeys.some((key) => typeof body[key] !== "boolean")) {
      return jsonResponse({ error: { code: "INVALID_PREFERENCES", message: "Choose a setting for each notification category." } }, 400);
    }
    const columns = Object.entries(NOTIFICATION_CATEGORIES);
    const now = Date.now();
    await context.env.DB.prepare(`
      INSERT INTO notification_preferences (
        user_id, sos_enabled, invitations_enabled, safe_journeys_enabled,
        acknowledgements_enabled, account_security_enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        sos_enabled = excluded.sos_enabled,
        invitations_enabled = excluded.invitations_enabled,
        safe_journeys_enabled = excluded.safe_journeys_enabled,
        acknowledgements_enabled = excluded.acknowledgements_enabled,
        account_security_enabled = excluded.account_security_enabled,
        updated_at = excluded.updated_at
    `).bind(session.user.user_id, ...columns.map(([key]) => body[key] ? 1 : 0), now).run();
    return jsonResponse({ preferences: body, updatedAt: now });
  } catch (error) {
    return safeError(error);
  }
}
