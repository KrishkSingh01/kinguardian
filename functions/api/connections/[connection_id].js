import { requireSession } from "../../_shared/auth.js";
import { errorResponse, jsonResponse, readJsonRequest, requireSameOrigin, safeError } from "../../_shared/http.js";

export async function onRequestPut(context) {
  if (!requireSameOrigin(context.request)) return errorResponse("ORIGIN_REJECTED", 403, "This request did not come from KinGuardian.");
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 2048);
    if (typeof body.receiveSos !== "boolean" || typeof body.receiveMissedCheckin !== "boolean"
      || typeof body.receiveLocation !== "boolean") {
      return jsonResponse({ error: { code: "INVALID_PREFERENCES", message: "Choose which alerts you want to receive." } }, 400);
    }
    const statements = [context.env.DB.prepare(`
      UPDATE trusted_connection_preferences SET receive_sos = ?, receive_missed_checkin = ?,
        receive_location = ?, updated_at = ?
      WHERE connection_id = ? AND recipient_user_id = ?
        AND EXISTS (
          SELECT 1 FROM trusted_connections AS c WHERE c.connection_id = ?
            AND c.connection_status = 'accepted' AND (c.user_low_id = ? OR c.user_high_id = ?)
        )
    `).bind(body.receiveSos ? 1 : 0, body.receiveMissedCheckin ? 1 : 0,
      body.receiveLocation ? 1 : 0, Date.now(),
      context.params.connection_id, session.user.user_id, context.params.connection_id,
      session.user.user_id, session.user.user_id)];
    if (!body.receiveLocation) {
      statements.push(context.env.DB.prepare(`
        DELETE FROM encrypted_location_envelopes
        WHERE recipient_user_id = ? AND share_id IN (
          SELECT r.share_id FROM location_share_recipients AS r
          JOIN location_shares AS s ON s.share_id = r.share_id
          JOIN trusted_connections AS c ON c.connection_id = ? AND c.connection_status = 'accepted'
          WHERE r.recipient_user_id = ? AND (
            (c.user_low_id = ? AND s.owner_user_id = c.user_high_id)
            OR (c.user_high_id = ? AND s.owner_user_id = c.user_low_id)
          )
        )
      `).bind(session.user.user_id, context.params.connection_id, session.user.user_id,
        session.user.user_id, session.user.user_id));
    }
    const results = await context.env.DB.batch(statements);
    if (!results[0]?.meta?.changes) return jsonResponse({ error: { code: "CONNECTION_NOT_FOUND", message: "That trusted connection was not found." } }, 404);
    return jsonResponse({ updated: true, receiveSos: body.receiveSos,
      receiveMissedCheckin: body.receiveMissedCheckin, receiveLocation: body.receiveLocation });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestDelete(context) {
  if (!requireSameOrigin(context.request)) return errorResponse("ORIGIN_REJECTED", 403, "This request did not come from KinGuardian.");
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const now = Date.now();
    const result = await context.env.DB.prepare(`
      UPDATE trusted_connections SET connection_status = 'removed', ended_at = ?
      WHERE connection_id = ? AND connection_status = 'accepted'
        AND (user_low_id = ? OR user_high_id = ?)
    `).bind(now, context.params.connection_id, session.user.user_id, session.user.user_id).run();
    if (!result.meta?.changes) return jsonResponse({ error: { code: "CONNECTION_NOT_FOUND", message: "That trusted connection was not found." } }, 404);
    await context.env.DB.batch([
      context.env.DB.prepare(`DELETE FROM encrypted_location_envelopes
        WHERE EXISTS (
          SELECT 1 FROM location_share_recipients AS r
          JOIN location_shares AS s ON s.share_id = r.share_id
          JOIN trusted_connections AS c ON c.connection_id = ?
          WHERE r.share_id = encrypted_location_envelopes.share_id
            AND r.recipient_user_id = encrypted_location_envelopes.recipient_user_id
            AND ((s.owner_user_id = c.user_low_id AND r.recipient_user_id = c.user_high_id)
              OR (s.owner_user_id = c.user_high_id AND r.recipient_user_id = c.user_low_id))
        )`).bind(context.params.connection_id),
      context.env.DB.prepare(`DELETE FROM location_share_recipients
        WHERE EXISTS (
          SELECT 1 FROM location_shares AS s
          JOIN trusted_connections AS c ON c.connection_id = ?
          WHERE s.share_id = location_share_recipients.share_id
            AND ((s.owner_user_id = c.user_low_id AND location_share_recipients.recipient_user_id = c.user_high_id)
              OR (s.owner_user_id = c.user_high_id AND location_share_recipients.recipient_user_id = c.user_low_id))
        )`).bind(context.params.connection_id),
      context.env.DB.prepare(`UPDATE location_shares SET share_status = 'stopped', stopped_at = ?
        WHERE share_status = 'active' AND owner_user_id IN (
          SELECT user_low_id FROM trusted_connections WHERE connection_id = ?
          UNION SELECT user_high_id FROM trusted_connections WHERE connection_id = ?
        ) AND NOT EXISTS (
          SELECT 1 FROM location_share_recipients AS r WHERE r.share_id = location_shares.share_id
        )`).bind(now, context.params.connection_id, context.params.connection_id),
    ]);
    return jsonResponse({ removed: true });
  } catch (error) {
    return safeError(error);
  }
}
