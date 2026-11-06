import { requireSession } from "../../_shared/auth.js";
import { normalizeUsername } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";
import { isRateLimited, recordAttempt } from "../../_shared/rate-limit.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const bucket = `connection:search:${session.user.user_id}`;
    if (await isRateLimited(context.env, bucket)) return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many username searches. Wait a little and try again." } }, 429);
    await recordAttempt(context.env, bucket, 20);
    const body = await readJsonRequest(context.request, 2048);
    const username = normalizeUsername(body.username);
    if (!username) return jsonResponse({ error: { code: "INVALID_USERNAME", message: "Enter a username with 3 to 40 letters, numbers, dots, underscores, or dashes." } }, 400);
    if (username === session.user.username.toLowerCase()) return jsonResponse({ found: false });
    const result = await context.env.DB.prepare(`SELECT user_id, username FROM users
      WHERE username = ? COLLATE NOCASE AND account_status = 'active' AND user_id <> ?`)
      .bind(username, session.user.user_id).first();
    return jsonResponse(result ? { found: true, username: result.username } : { found: false });
  } catch (error) {
    return safeError(error);
  }
}
