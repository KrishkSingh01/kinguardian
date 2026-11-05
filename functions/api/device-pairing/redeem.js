import { createSessionCredentials, sessionCookies } from "../../_shared/auth.js";
import { sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const body = await readJsonRequest(context.request, 1024);
    if (typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) return unavailable();
    const tokenHash = await sha256(body.token);
    const now = Date.now();
    const request = await context.env.DB.prepare(`
      SELECT p.pairing_id, p.approved_user_id
      FROM device_pairing_requests AS p
      JOIN users AS u ON u.user_id = p.approved_user_id AND u.account_status = 'active'
      WHERE p.token_hash = ? AND p.approved_at IS NOT NULL AND p.redeemed_at IS NULL
        AND p.revoked_at IS NULL AND p.expires_at > ?
    `).bind(tokenHash, now).first();
    if (!request) return unavailable();

    const session = await createSessionCredentials(now);
    const results = await context.env.DB.batch([
      context.env.DB.prepare(`
        UPDATE device_pairing_requests SET redeemed_at = ?
        WHERE pairing_id = ? AND token_hash = ? AND approved_user_id = ?
          AND approved_at IS NOT NULL AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')
      `).bind(now, request.pairing_id, tokenHash, request.approved_user_id, now, request.approved_user_id),
      context.env.DB.prepare(`
        INSERT INTO sessions (
          session_token_hash, csrf_token_hash, user_id, created_at, expires_at, last_seen_at
        ) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1
      `).bind(session.tokenHash, session.csrfHash, request.approved_user_id, now, session.expiresAt, now),
    ]);
    if (!results[0].meta?.changes || !results[1].meta?.changes) return unavailable();

    return jsonResponse({ paired: true }, 200, {
      "Set-Cookie": sessionCookies(session.token, session.csrfToken),
    });
  } catch (error) {
    return safeError(error);
  }
}

function unavailable() {
  return jsonResponse({ error: { code: "PAIRING_UNAVAILABLE", message: "This pairing request is invalid, expired, revoked, or already used." } }, 404);
}
