import { requireSession } from "../../_shared/auth.js";
import { sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 1024);
    if (typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) {
      return unavailable();
    }
    const now = Date.now();
    const result = await context.env.DB.prepare(`
      UPDATE device_pairing_requests SET approved_user_id = ?, approved_at = ?
      WHERE token_hash = ? AND approved_user_id IS NULL AND approved_at IS NULL
        AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    `).bind(session.user.user_id, now, await sha256(body.token), now).run();
    if (!result.meta?.changes) return unavailable();
    return jsonResponse({ approved: true });
  } catch (error) {
    return safeError(error);
  }
}

function unavailable() {
  return jsonResponse({ error: { code: "PAIRING_UNAVAILABLE", message: "This pairing request is unavailable. Create a new request and scan its QR code again." } }, 404);
}
