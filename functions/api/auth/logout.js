import { clearSessionCookies, requireSession } from "../../_shared/auth.js";
import { jsonResponse, requirePost, safeError } from "../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true, allowPasswordChange: true });
    if (session.response) return session.response;
    await context.env.DB.prepare(
      "UPDATE sessions SET revoked_at = ? WHERE session_token_hash = ? AND revoked_at IS NULL",
    ).bind(Date.now(), session.tokenHash).run();
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearSessionCookies() });
  } catch (error) {
    return safeError(error);
  }
}
