import { requireSession } from "../../../_shared/auth.js";
import { jsonResponse, requirePost, safeError } from "../../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const shareId = context.params.share_id;
    if (typeof shareId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(shareId)) {
      return jsonResponse({ error: { code: "SHARE_NOT_FOUND", message: "That shared location is not available to this account." } }, 404);
    }
    const results = await context.env.DB.batch([
      context.env.DB.prepare(`DELETE FROM location_share_recipients
        WHERE share_id = ? AND recipient_user_id = ?`).bind(shareId, session.user.user_id),
      context.env.DB.prepare(`DELETE FROM encrypted_location_envelopes
        WHERE share_id = ? AND recipient_user_id = ? AND changes() = 1`)
        .bind(shareId, session.user.user_id),
    ]);
    if (!results[0]?.meta?.changes) {
      return jsonResponse({ error: { code: "SHARE_NOT_FOUND", message: "That shared location is not available to this account." } }, 404);
    }
    return jsonResponse({ stoppedReceiving: true });
  } catch (error) {
    return safeError(error);
  }
}
