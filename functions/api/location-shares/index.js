import { requireSession } from "../../_shared/auth.js";
import { decryptLocationPoint } from "../../_shared/location-crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const MAX_RECIPIENTS = 20;
const MAX_SHARE_MINUTES = 24 * 60;

function validId(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

async function expireShares(db, now) {
  await db.batch([
    db.prepare(`UPDATE location_shares SET share_status = 'expired', stopped_at = ?
      WHERE share_status = 'active' AND expires_at <= ?`).bind(now, now),
    db.prepare(`DELETE FROM encrypted_location_envelopes WHERE share_id IN (
      SELECT share_id FROM location_shares WHERE share_status = 'expired'
    )`),
    db.prepare(`DELETE FROM location_share_points WHERE share_id IN (
      SELECT share_id FROM location_shares WHERE share_status = 'expired'
    )`),
  ]);
}

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const now = Date.now();
    const db = context.env.DB;
    await expireShares(db, now);
    const own = await db.prepare(`
      SELECT s.share_id, s.share_status, s.started_at, s.expires_at, s.stopped_at,
             r.recipient_user_id, u.username AS recipient_username,
             p.location_time, p.updated_at AS location_updated_at
      FROM location_shares AS s
      LEFT JOIN location_share_recipients AS r ON r.share_id = s.share_id
      LEFT JOIN users AS u ON u.user_id = r.recipient_user_id
      LEFT JOIN location_share_points AS p ON p.share_id = s.share_id
        AND p.location_time = (SELECT MAX(p2.location_time) FROM location_share_points AS p2 WHERE p2.share_id = s.share_id)
      WHERE s.owner_user_id = ?
      ORDER BY s.started_at DESC LIMIT 100
    `).bind(session.user.user_id).all();
    const ownById = new Map();
    for (const row of own.results || []) {
      let share = ownById.get(row.share_id);
      if (!share) {
        share = {
          shareId: row.share_id,
          status: row.share_status,
          startedAt: row.started_at,
          expiresAt: row.expires_at,
          stoppedAt: row.stopped_at,
          recipients: [],
          lastUpdatedAt: null,
        };
        ownById.set(row.share_id, share);
      }
      if (row.recipient_user_id) share.recipients.push({ userId: row.recipient_user_id, username: row.recipient_username });
      if (row.location_updated_at && (!share.lastUpdatedAt || row.location_updated_at > share.lastUpdatedAt)) {
        share.lastUpdatedAt = row.location_updated_at;
      }
    }

    const incoming = await db.prepare(`
      SELECT s.share_id, s.owner_user_id, owner.username AS owner_username,
             s.started_at, s.expires_at, p.encrypted_point, p.iv, p.location_time, p.updated_at
      FROM location_share_recipients AS r
      JOIN location_shares AS s ON s.share_id = r.share_id
      JOIN users AS owner ON owner.user_id = s.owner_user_id AND owner.account_status = 'active'
      JOIN trusted_connections AS c ON c.connection_status = 'accepted'
        AND ((c.user_low_id = s.owner_user_id AND c.user_high_id = r.recipient_user_id)
          OR (c.user_high_id = s.owner_user_id AND c.user_low_id = r.recipient_user_id))
      JOIN trusted_connection_preferences AS preference
        ON preference.connection_id = c.connection_id AND preference.recipient_user_id = r.recipient_user_id
        AND preference.receive_location = 1
      LEFT JOIN location_share_points AS p ON p.share_id = s.share_id
        AND p.location_time = (SELECT MAX(p2.location_time) FROM location_share_points AS p2 WHERE p2.share_id = s.share_id)
      WHERE r.recipient_user_id = ? AND s.share_status = 'active' AND s.expires_at > ?
      ORDER BY COALESCE(p.updated_at, s.started_at) DESC LIMIT 50
    `).bind(session.user.user_id, now).all();

    const incomingShares = [];
    for (const row of incoming.results || []) {
      let point = null;
      if (row.encrypted_point && row.iv && Number.isFinite(row.location_time)) {
        try {
          point = await decryptLocationPoint(context.env, row.share_id, row.owner_user_id,
            row.encrypted_point, row.iv);
        } catch {
          // A damaged point is omitted. Never return undeciphered database content.
        }
      }
      incomingShares.push({
        shareId: row.share_id,
        senderUserId: row.owner_user_id,
        senderUsername: row.owner_username,
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        updatedAt: row.updated_at || null,
        location: point,
      });
    }

    return jsonResponse({ ownShares: [...ownById.values()], incomingShares });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 8192);
    const recipientUserIds = body.recipientUserIds;
    if (!Array.isArray(recipientUserIds) || recipientUserIds.length < 1
      || recipientUserIds.length > MAX_RECIPIENTS || recipientUserIds.some((id) => !validId(id))
      || new Set(recipientUserIds).size !== recipientUserIds.length
      || !Number.isInteger(body.expiresInMinutes) || body.expiresInMinutes < 5 || body.expiresInMinutes > MAX_SHARE_MINUTES) {
      return jsonResponse({ error: { code: "INVALID_LOCATION_SHARE", message: "Choose one to twenty trusted people and a sharing time from 5 minutes to 24 hours." } }, 400);
    }
    const db = context.env.DB;
    for (const recipientUserId of recipientUserIds) {
      const eligible = await db.prepare(`
        SELECT 1 AS allowed
        FROM users AS recipient
        JOIN trusted_connections AS c ON c.connection_status = 'accepted'
          AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
            OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
        JOIN trusted_connection_preferences AS p
          ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
          AND p.receive_location = 1
        WHERE recipient.user_id = ? AND recipient.account_status = 'active'
        LIMIT 1
      `).bind(session.user.user_id, session.user.user_id, recipientUserId).first();
      if (!eligible) return jsonResponse({ error: { code: "RECIPIENT_NOT_ALLOWED", message: "A selected trusted person has not allowed location sharing from you." } }, 403);
    }

    const shareId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + body.expiresInMinutes * 60_000;
    const statements = [db.prepare(`
      INSERT INTO location_shares (share_id, owner_user_id, share_status, started_at, expires_at)
      VALUES (?, ?, 'active', ?, ?)
    `).bind(shareId, session.user.user_id, now, expiresAt)];
    for (const recipientUserId of recipientUserIds) {
      statements.push(db.prepare(`
        INSERT INTO location_share_recipients (share_id, recipient_user_id, added_at)
        SELECT ?, recipient.user_id, ? FROM users AS recipient
        WHERE recipient.user_id = ? AND recipient.account_status = 'active'
          AND EXISTS (
            SELECT 1 FROM trusted_connections AS c
            JOIN trusted_connection_preferences AS p
              ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
            WHERE c.connection_status = 'accepted' AND p.receive_location = 1
              AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
                OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
          )
      `).bind(shareId, now, recipientUserId, session.user.user_id, session.user.user_id));
    }
    const results = await db.batch(statements);
    const recipientsCreated = results.slice(1).filter((result) => result?.meta?.changes === 1).length;
    if (recipientsCreated !== recipientUserIds.length) {
      await db.batch([
        db.prepare("DELETE FROM location_share_recipients WHERE share_id = ?").bind(shareId),
        db.prepare("DELETE FROM location_shares WHERE share_id = ? AND owner_user_id = ?").bind(shareId, session.user.user_id),
      ]);
      return jsonResponse({ error: { code: "RECIPIENT_CHANGED", message: "A trusted person's permission changed. Refresh the list and try again." } }, 409);
    }
    return jsonResponse({
      share: { shareId, status: "active", startedAt: now, expiresAt },
      message: "Location sharing started for the selected trusted people. It stops at the time you chose.",
    }, 201);
  } catch (error) {
    return safeError(error);
  }
}
