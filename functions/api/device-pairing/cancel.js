import { sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const body = await readJsonRequest(context.request, 1024);
    if (typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) {
      return jsonResponse({ error: { code: "PAIRING_UNAVAILABLE", message: "This pairing request is unavailable." } }, 404);
    }
    const now = Date.now();
    const result = await context.env.DB.prepare(`
      UPDATE device_pairing_requests SET revoked_at = ?
      WHERE token_hash = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    `).bind(now, await sha256(body.token), now).run();
    if (!result.meta?.changes) {
      return jsonResponse({ error: { code: "PAIRING_UNAVAILABLE", message: "This pairing request is unavailable." } }, 404);
    }
    return jsonResponse({ cancelled: true });
  } catch (error) {
    return safeError(error);
  }
}
