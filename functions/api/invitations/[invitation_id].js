import { requireSession } from "../../_shared/auth.js";
import { errorResponse, jsonResponse, requireSameOrigin, safeError } from "../../_shared/http.js";

export async function onRequestDelete(context) {
  if (!requireSameOrigin(context.request)) return errorResponse("ORIGIN_REJECTED", 403, "This request did not come from KinGuardian.");
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const result = await context.env.DB.prepare(`
      UPDATE invitations SET revoked_at = ?
      WHERE invitation_id = ? AND issuer_user_id = ? AND redeemed_at IS NULL
        AND revoked_at IS NULL AND expires_at > ?
    `).bind(Date.now(), context.params.invitation_id, session.user.user_id, Date.now()).run();
    if (!result.meta?.changes) return jsonResponse({ error: { code: "INVITATION_NOT_FOUND", message: "That pending invitation was not found." } }, 404);
    return jsonResponse({ revoked: true });
  } catch (error) {
    return safeError(error);
  }
}
