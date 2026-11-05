import { requireSession } from "../../_shared/auth.js";
import { sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 4096);
    if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(body.token)
      || !["accept", "reject"].includes(body.action)) {
      return jsonResponse({ error: { code: "INVITATION_UNAVAILABLE", message: "This invitation is invalid or no longer available." } }, 404);
    }
    const tokenHash = await sha256(body.token);
    const invitation = await context.env.DB.prepare(`
      SELECT i.invitation_id, i.issuer_user_id, u.username AS issuer_username,
             i.expires_at, i.redeemed_at, i.revoked_at
      FROM invitations AS i
      JOIN users AS u ON u.user_id = i.issuer_user_id AND u.account_status = 'active'
      WHERE i.token_hash = ? AND i.invitation_type = 'trusted_connection'
    `).bind(tokenHash).first();
    const now = Date.now();
    if (!invitation || invitation.issuer_user_id === session.user.user_id
      || invitation.redeemed_at || invitation.revoked_at || invitation.expires_at <= now) {
      return jsonResponse({ error: { code: "INVITATION_UNAVAILABLE", message: "This invitation is invalid, expired, or no longer available." } }, 404);
    }

    if (body.action === "reject") {
      const result = await context.env.DB.prepare(`
        UPDATE invitations SET revoked_at = ?
        WHERE invitation_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `).bind(now, invitation.invitation_id, now).run();
      if (!result.meta?.changes) return jsonResponse({ error: { code: "INVITATION_UNAVAILABLE", message: "This invitation is no longer available." } }, 409);
      return jsonResponse({ rejected: true });
    }

    const userLowId = [session.user.user_id, invitation.issuer_user_id].sort()[0];
    const userHighId = [session.user.user_id, invitation.issuer_user_id].sort()[1];
    const connectionId = crypto.randomUUID();
    const statements = [
      context.env.DB.prepare(`
        UPDATE invitations SET redeemed_at = ?, target_user_id = ?
        WHERE invitation_id = ? AND issuer_user_id = ? AND redeemed_at IS NULL
          AND revoked_at IS NULL AND target_user_id IS NULL AND expires_at > ?
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')
          AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')
      `).bind(now, session.user.user_id, invitation.invitation_id, invitation.issuer_user_id,
        now, session.user.user_id, invitation.issuer_user_id),
      context.env.DB.prepare(`
        INSERT INTO trusted_connections (
          connection_id, user_low_id, user_high_id, connection_status,
          requested_by_user_id, created_at, accepted_at
        ) SELECT ?, ?, ?, 'accepted', ?, ?, ? WHERE changes() = 1
        ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET
          connection_status = 'accepted', requested_by_user_id = excluded.requested_by_user_id,
          created_at = excluded.created_at, accepted_at = excluded.accepted_at, ended_at = NULL
      `).bind(connectionId, userLowId, userHighId, invitation.issuer_user_id, now, now),
      context.env.DB.prepare(`
        INSERT INTO trusted_connection_preferences (
          connection_id, recipient_user_id, receive_sos, receive_missed_checkin, receive_location, updated_at
        ) SELECT c.connection_id, ?, 0, 0, 0, ? FROM trusted_connections AS c
          WHERE c.user_low_id = ? AND c.user_high_id = ? AND c.connection_status = 'accepted'
        ON CONFLICT (connection_id, recipient_user_id) DO UPDATE SET
          receive_sos = 0, receive_missed_checkin = 0, receive_location = 0, updated_at = excluded.updated_at
      `).bind(session.user.user_id, now, userLowId, userHighId),
      context.env.DB.prepare(`
        INSERT INTO trusted_connection_preferences (
          connection_id, recipient_user_id, receive_sos, receive_missed_checkin, receive_location, updated_at
        ) SELECT c.connection_id, ?, 0, 0, 0, ? FROM trusted_connections AS c
          WHERE c.user_low_id = ? AND c.user_high_id = ? AND c.connection_status = 'accepted'
        ON CONFLICT (connection_id, recipient_user_id) DO UPDATE SET
          receive_sos = 0, receive_missed_checkin = 0, receive_location = 0, updated_at = excluded.updated_at
      `).bind(invitation.issuer_user_id, now, userLowId, userHighId),
      context.env.DB.prepare(`
        INSERT INTO notification_events (
          event_id, event_key, user_id, category, delivery_status, created_at, updated_at, related_resource_id
        ) SELECT lower(hex(randomblob(16))), 'invitation-accepted:' || i.invitation_id,
          i.issuer_user_id, 'invitation', 'prepared', ?, ?, c.connection_id
        FROM invitations AS i
        JOIN trusted_connections AS c ON c.user_low_id = ? AND c.user_high_id = ?
          AND c.connection_status = 'accepted'
        WHERE i.invitation_id = ? AND i.redeemed_at = ? AND changes() = 1
        ON CONFLICT (event_key) DO NOTHING
      `).bind(now, now, userLowId, userHighId, invitation.invitation_id, now),
    ];
    const results = await context.env.DB.batch(statements);
    if (!results[0]?.meta?.changes) {
      return jsonResponse({ error: { code: "INVITATION_UNAVAILABLE", message: "This invitation was already used or expired." } }, 409);
    }
    const connected = await context.env.DB.prepare(`
      SELECT connection_id FROM trusted_connections
      WHERE user_low_id = ? AND user_high_id = ? AND connection_status = 'accepted'
    `).bind(userLowId, userHighId).first();
    return jsonResponse({
      accepted: true,
      connectionId: connected?.connection_id || connectionId,
      connectedUsername: invitation.issuer_username,
      preferences: { receiveSos: false, receiveMissedCheckin: false },
      warning: "This connection does not enable alerts automatically. Each person can choose what they want to receive.",
    }, 201);
  } catch (error) {
    return safeError(error);
  }
}
