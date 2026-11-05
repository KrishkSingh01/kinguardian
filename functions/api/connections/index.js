import { requireSession } from "../../_shared/auth.js";
import { toBase64Url } from "../../_shared/crypto.js";
import { jsonResponse, safeError } from "../../_shared/http.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const result = await context.env.DB.prepare(`
      SELECT c.connection_id, c.connection_status, c.created_at, c.accepted_at,
             CASE WHEN c.user_low_id = ? THEN high_user.username ELSE low_user.username END AS username,
             CASE WHEN c.user_low_id = ? THEN c.user_high_id ELSE c.user_low_id END AS user_id,
             COALESCE(p.receive_sos, 0) AS receive_sos,
             COALESCE(p.receive_missed_checkin, 0) AS receive_missed_checkin,
             COALESCE(p.receive_location, 0) AS receive_location,
             CASE WHEN p.receive_location = 1 THEN sharing.public_key ELSE NULL END AS location_public_key
      FROM trusted_connections AS c
      JOIN users AS low_user ON low_user.user_id = c.user_low_id
      JOIN users AS high_user ON high_user.user_id = c.user_high_id
      LEFT JOIN trusted_connection_preferences AS p
        ON p.connection_id = c.connection_id AND p.recipient_user_id = ?
      LEFT JOIN user_sharing_keys AS sharing
        ON sharing.user_id = CASE WHEN c.user_low_id = ? THEN c.user_high_id ELSE c.user_low_id END
      WHERE (c.user_low_id = ? OR c.user_high_id = ?)
        AND c.connection_status = 'accepted'
      ORDER BY c.accepted_at DESC
    `).bind(session.user.user_id, session.user.user_id, session.user.user_id,
      session.user.user_id, session.user.user_id, session.user.user_id).all();
    return jsonResponse({ connections: (result.results || []).map((row) => ({
      connectionId: row.connection_id,
      userId: row.user_id,
      username: row.username,
      status: row.connection_status,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      receiveSos: Boolean(row.receive_sos),
      receiveMissedCheckin: Boolean(row.receive_missed_checkin),
      receiveLocation: Boolean(row.receive_location),
      locationPublicKey: row.location_public_key ? toBase64Url(new Uint8Array(row.location_public_key)) : null,
    })) });
  } catch (error) {
    return safeError(error);
  }
}
