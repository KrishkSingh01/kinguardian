import { requireSession } from "../../../_shared/auth.js";
import { jsonResponse, requirePost, safeError } from "../../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(context.params.share_id || "")) {
      return jsonResponse({ error: { code: "SHARE_NOT_FOUND", message: "That location share was not found." } }, 404);
    }
    const now = Date.now();
    const result = await context.env.DB.batch([
      context.env.DB.prepare(`UPDATE location_shares SET share_status = 'stopped', stopped_at = ?
        WHERE share_id = ? AND owner_user_id = ? AND share_status = 'active' AND expires_at > ?`)
        .bind(now, context.params.share_id, session.user.user_id, now),
      context.env.DB.prepare("DELETE FROM encrypted_location_envelopes WHERE share_id = ? AND changes() = 1")
        .bind(context.params.share_id),
    ]);
    if (!result[0]?.meta?.changes) {
      const existing = await context.env.DB.prepare(
        "SELECT share_status FROM location_shares WHERE share_id = ? AND owner_user_id = ?",
      ).bind(context.params.share_id, session.user.user_id).first();
      if (!existing) return jsonResponse({ error: { code: "SHARE_NOT_FOUND", message: "That location share was not found." } }, 404);
      return jsonResponse({ stopped: existing.share_status !== "active", status: existing.share_status });
    }
    return jsonResponse({ stopped: true, status: "stopped", stoppedAt: now });
  } catch (error) {
    return safeError(error);
  }
}
