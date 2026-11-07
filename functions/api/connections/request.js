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
    const body = await readJsonRequest(context.request, 2048);
    const username = normalizeUsername(body.username);
    if (!username || username === session.user.username.toLowerCase()) {
      return jsonResponse({ error: { code: "INVALID_USERNAME", message: "Enter another KinGuardian username." } }, 400);
    }
    const bucket = `connection:request:${session.user.user_id}`;
    if (await isRateLimited(context.env, bucket)) return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many requests. Wait a little and try again." } }, 429);
    await recordAttempt(context.env, bucket, 12);
    const target = await context.env.DB.prepare(`SELECT user_id FROM users
      WHERE username = ? COLLATE NOCASE AND account_status = 'active' AND user_id <> ?`)
      .bind(username, session.user.user_id).first();
    if (!target) return jsonResponse({ requestSent: false, message: "No account with that username is available." });
    const [lowId, highId] = [session.user.user_id, target.user_id].sort();
    const old = await context.env.DB.prepare(`SELECT connection_id, connection_status, requested_by_user_id
      FROM trusted_connections WHERE user_low_id = ? AND user_high_id = ?`)
      .bind(lowId, highId).first();
    if (old?.connection_status === "accepted") return jsonResponse({ requestSent: false, message: "You are already trusted people." });
    if (old?.connection_status === "pending") {
      const message = old.requested_by_user_id === session.user.user_id ? "Your request is waiting for their answer." : "This person has already sent you a request. Open Requests to answer it.";
      return jsonResponse({ requestSent: false, message });
    }
    const now = Date.now();
    const connectionId = old?.connection_id || crypto.randomUUID();
    await context.env.DB.batch([
      context.env.DB.prepare(`INSERT INTO trusted_connections (
        connection_id, user_low_id, user_high_id, connection_status, requested_by_user_id, created_at
      ) VALUES (?, ?, ?, 'pending', ?, ?)
      ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET
        connection_status = 'pending', requested_by_user_id = excluded.requested_by_user_id,
        created_at = excluded.created_at, accepted_at = NULL, ended_at = NULL
      WHERE trusted_connections.connection_status IN ('removed', 'rejected')`)
        .bind(connectionId, lowId, highId, session.user.user_id, now),
      context.env.DB.prepare(`INSERT INTO notification_events (
        event_id, event_key, user_id, category, delivery_status, created_at, updated_at, related_resource_id
      ) SELECT lower(hex(randomblob(16))), 'connection-request:' || connection_id,
        CASE WHEN user_low_id = ? THEN user_high_id ELSE user_low_id END, 'invitation', 'prepared', ?, ?, connection_id
      FROM trusted_connections WHERE connection_id = ? AND connection_status = 'pending'
        AND requested_by_user_id = ?
      ON CONFLICT (event_key) DO NOTHING`).bind(session.user.user_id, now, now, connectionId, session.user.user_id),
    ]);
    return jsonResponse({ requestSent: true, message: "Request sent. They must accept before you share alerts or location." }, 201);
  } catch (error) {
    return safeError(error);
  }
}
