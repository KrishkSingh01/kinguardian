import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, safeError } from "../../_shared/http.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const [result, incoming, outgoing] = await Promise.all([
      context.env.DB.prepare(`
      SELECT c.connection_id, c.connection_status, c.created_at, c.accepted_at,
             CASE WHEN c.user_low_id = ? THEN high_user.username ELSE low_user.username END AS username,
             CASE WHEN c.user_low_id = ? THEN c.user_high_id ELSE c.user_low_id END AS user_id,
             COALESCE(p.receive_sos, 0) AS receive_sos,
             COALESCE(p.receive_safe_journeys, 0) AS receive_safe_journeys,
             COALESCE(p.receive_location, 0) AS receive_location
      FROM trusted_connections AS c
      JOIN users AS low_user ON low_user.user_id = c.user_low_id
      JOIN users AS high_user ON high_user.user_id = c.user_high_id
      LEFT JOIN trusted_connection_preferences AS p
        ON p.connection_id = c.connection_id AND p.recipient_user_id = ?
      WHERE (c.user_low_id = ? OR c.user_high_id = ?)
        AND c.connection_status = 'accepted'
      ORDER BY c.accepted_at DESC
    `).bind(session.user.user_id, session.user.user_id, session.user.user_id,
      session.user.user_id, session.user.user_id).all(),
      context.env.DB.prepare(`SELECT c.connection_id, c.created_at, other.username
        FROM trusted_connections AS c
        JOIN users AS other ON other.user_id = c.requested_by_user_id AND other.account_status = 'active'
        WHERE c.connection_status = 'pending' AND c.requested_by_user_id <> ?
          AND (c.user_low_id = ? OR c.user_high_id = ?)
        ORDER BY c.created_at DESC LIMIT 50`).bind(session.user.user_id, session.user.user_id, session.user.user_id).all(),
      context.env.DB.prepare(`SELECT c.connection_id, c.created_at, other.username
        FROM trusted_connections AS c
        JOIN users AS other ON other.user_id = CASE WHEN c.user_low_id = ? THEN c.user_high_id ELSE c.user_low_id END
          AND other.account_status = 'active'
        WHERE c.connection_status = 'pending' AND c.requested_by_user_id = ?
        ORDER BY c.created_at DESC LIMIT 50`).bind(session.user.user_id, session.user.user_id).all(),
    ]);
    return jsonResponse({ connections: (result.results || []).map((row) => ({
      connectionId: row.connection_id,
      userId: row.user_id,
      username: row.username,
      status: row.connection_status,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      receiveSos: Boolean(row.receive_sos),
      receiveSafeJourneys: Boolean(row.receive_safe_journeys),
      receiveLocation: Boolean(row.receive_location),
    })),
    requests: (incoming.results || []).map((row) => ({ connectionId: row.connection_id, username: row.username, createdAt: row.created_at })),
    sentRequests: (outgoing.results || []).map((row) => ({ connectionId: row.connection_id, username: row.username, createdAt: row.created_at })),
    });
  } catch (error) {
    return safeError(error);
  }
}
