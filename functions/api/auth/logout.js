import { clearSessionCookies, requireSession } from "../../_shared/auth.js";
import { isNativeClient } from "../../_shared/mobile-auth.js";
import { sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true, allowPasswordChange: true });
    if (session.response) return session.response;
    const now = Date.now();
    await context.env.DB.prepare(
      "UPDATE sessions SET revoked_at = ? WHERE session_token_hash = ? AND revoked_at IS NULL",
    ).bind(now, session.tokenHash).run();

    if (isNativeClient(context.request)) {
      const body = await readJsonRequest(context.request, 2048);
      if (typeof body.refreshToken === "string" && REFRESH_TOKEN_PATTERN.test(body.refreshToken)) {
        const refreshHash = await sha256(body.refreshToken);
        const record = await context.env.DB.prepare(`SELECT family_id FROM mobile_refresh_tokens
          WHERE refresh_token_hash = ? AND user_id = ? AND revoked_at IS NULL`)
          .bind(refreshHash, session.user.user_id).first();
        if (record) {
          await context.env.DB.batch([
            context.env.DB.prepare("UPDATE mobile_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL")
              .bind(now, record.family_id),
            context.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL
              AND session_token_hash IN (SELECT session_token_hash FROM mobile_refresh_tokens WHERE family_id = ?)`)
              .bind(now, record.family_id),
          ]);
        }
      }
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearSessionCookies() });
  } catch (error) {
    return safeError(error);
  }
}
