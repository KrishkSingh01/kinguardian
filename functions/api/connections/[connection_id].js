import { requireSession } from "../../_shared/auth.js";
import { errorResponse, jsonResponse, readJsonRequest, requireSameOrigin, safeError } from "../../_shared/http.js";

export async function onRequestPost(context) {
  if (!requireSameOrigin(context.request)) return errorResponse("ORIGIN_REJECTED", 403, "This request did not come from KinGuardian.");
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 2048);
    if (!["accept", "reject"].includes(body.action)) return jsonResponse({ error: { code: "INVALID_REQUEST_ACTION", message: "Choose accept or reject." } }, 400);
    const id = context.params.connection_id;
    const now = Date.now();
    const newStatus = body.action === "accept" ? "accepted" : "rejected";
    const statements = [context.env.DB.prepare(`UPDATE trusted_connections SET connection_status = ?,
      accepted_at = CASE WHEN ? = 'accepted' THEN ? ELSE NULL END, ended_at = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END
      WHERE connection_id = ? AND connection_status = 'pending' AND requested_by_user_id <> ?
        AND (user_low_id = ? OR user_high_id = ?)`)
      .bind(newStatus, newStatus, now, newStatus, now, id, session.user.user_id, session.user.user_id, session.user.user_id)];
    if (body.action === "accept") {
      for (const recipient of [session.user.user_id, "other"]) {
        statements.push(context.env.DB.prepare(`INSERT INTO trusted_connection_preferences (
          connection_id, recipient_user_id, receive_sos, receive_missed_checkin,
          receive_location, receive_safe_journeys, updated_at
        ) SELECT c.connection_id, CASE WHEN ? = 'other' THEN
          CASE WHEN c.user_low_id = ? THEN c.user_high_id ELSE c.user_low_id END ELSE ? END,
          0, 0, 0, 0, ? FROM trusted_connections AS c
        WHERE c.connection_id = ? AND c.connection_status = 'accepted' AND changes() = 1
        ON CONFLICT (connection_id, recipient_user_id) DO NOTHING`)
          .bind(recipient, session.user.user_id, session.user.user_id, now, id));
      }
    }
    statements.push(context.env.DB.prepare(`INSERT INTO notification_events (
      event_id, event_key, user_id, category, delivery_status, created_at, updated_at, related_resource_id
    ) SELECT lower(hex(randomblob(16))), 'connection-answer:' || c.connection_id,
      c.requested_by_user_id, 'invitation', 'prepared', ?, ?, c.connection_id
    FROM trusted_connections AS c WHERE c.connection_id = ? AND c.connection_status = ?
      AND changes() = 1 ON CONFLICT (event_key) DO NOTHING`).bind(now, now, id, newStatus));
    const results = await context.env.DB.batch(statements);
    if (results[0]?.meta?.changes !== 1) return jsonResponse({ error: { code: "REQUEST_UNAVAILABLE", message: "This request has already been answered or is not yours to answer." } }, 409);
    return jsonResponse({ status: newStatus });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestPut(context) {
  if (!requireSameOrigin(context.request)) return errorResponse("ORIGIN_REJECTED", 403, "This request did not come from KinGuardian.");
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 2048);
    if (typeof body.receiveSos !== "boolean" || typeof body.receiveSafeJourneys !== "boolean"
      || typeof body.receiveLocation !== "boolean") {
      return jsonResponse({ error: { code: "INVALID_PREFERENCES", message: "Choose which alerts you want to receive." } }, 400);
    }
    const statements = [context.env.DB.prepare(`
      UPDATE trusted_connection_preferences SET receive_sos = ?,
        receive_safe_journeys = ?, receive_location = ?, updated_at = ?
      WHERE connection_id = ? AND recipient_user_id = ?
        AND EXISTS (
          SELECT 1 FROM trusted_connections AS c WHERE c.connection_id = ?
            AND c.connection_status = 'accepted' AND (c.user_low_id = ? OR c.user_high_id = ?)
        )
    `).bind(body.receiveSos ? 1 : 0, body.receiveSafeJourneys ? 1 : 0,
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
      statements.push(context.env.DB.prepare(`
        DELETE FROM location_share_recipients
        WHERE recipient_user_id = ? AND share_id IN (
          SELECT s.share_id FROM location_shares AS s
          JOIN trusted_connections AS c ON c.connection_id = ?
          WHERE (s.owner_user_id = c.user_low_id AND ? = c.user_high_id)
             OR (s.owner_user_id = c.user_high_id AND ? = c.user_low_id)
        )
      `).bind(session.user.user_id, context.params.connection_id, session.user.user_id, session.user.user_id));
      statements.push(context.env.DB.prepare(`
        DELETE FROM location_share_points WHERE share_id IN (
          SELECT s.share_id FROM location_shares AS s
          JOIN trusted_connections AS c ON c.connection_id = ?
            AND s.owner_user_id IN (c.user_low_id, c.user_high_id)
          WHERE NOT EXISTS (SELECT 1 FROM location_share_recipients AS r WHERE r.share_id = s.share_id)
        )
      `).bind(context.params.connection_id));
      statements.push(context.env.DB.prepare(`
        UPDATE location_shares SET share_status = 'stopped', stopped_at = ?
        WHERE share_status = 'active' AND owner_user_id IN (
          SELECT user_low_id FROM trusted_connections WHERE connection_id = ?
          UNION SELECT user_high_id FROM trusted_connections WHERE connection_id = ?
        ) AND NOT EXISTS (
          SELECT 1 FROM location_share_recipients AS r WHERE r.share_id = location_shares.share_id
        )
      `).bind(Date.now(), context.params.connection_id, context.params.connection_id));
    }
    const results = await context.env.DB.batch(statements);
    if (!results[0]?.meta?.changes) return jsonResponse({ error: { code: "CONNECTION_NOT_FOUND", message: "That trusted connection was not found." } }, 404);
    return jsonResponse({ updated: true, receiveSos: body.receiveSos,
      receiveSafeJourneys: body.receiveSafeJourneys, receiveLocation: body.receiveLocation });
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
      context.env.DB.prepare(`DELETE FROM location_share_points WHERE share_id IN (
        SELECT s.share_id FROM location_shares AS s
        JOIN trusted_connections AS c ON c.connection_id = ?
        WHERE ((s.owner_user_id = c.user_low_id AND c.user_high_id = ?)
          OR (s.owner_user_id = c.user_high_id AND c.user_low_id = ?))
          AND NOT EXISTS (SELECT 1 FROM location_share_recipients AS r WHERE r.share_id = s.share_id)
      )`).bind(context.params.connection_id, session.user.user_id, session.user.user_id),
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
