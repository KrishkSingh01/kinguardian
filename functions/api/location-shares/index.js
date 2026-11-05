import { requireSession } from "../../_shared/auth.js";
import { fromBase64Url, toBase64Url } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const MAX_RECIPIENTS = 20;

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
  ]);
}

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const now = Date.now();
    await expireShares(context.env.DB, now);
    const own = await context.env.DB.prepare(`
      SELECT s.share_id, s.share_status, s.started_at, s.expires_at, s.stopped_at,
             r.recipient_user_id, u.username AS recipient_username, e.updated_at AS location_updated_at
      FROM location_shares AS s
      LEFT JOIN location_share_recipients AS r ON r.share_id = s.share_id
      LEFT JOIN users AS u ON u.user_id = r.recipient_user_id
      LEFT JOIN encrypted_location_envelopes AS e
        ON e.share_id = s.share_id AND e.recipient_user_id = r.recipient_user_id
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

    const incoming = await context.env.DB.prepare(`
      SELECT s.share_id, s.owner_user_id, owner.username AS owner_username,
             s.started_at, s.expires_at, sender_key.public_key AS sender_public_key, e.hkdf_salt,
             e.location_ciphertext, e.location_iv, e.updated_at
      FROM location_share_recipients AS r
      JOIN location_shares AS s ON s.share_id = r.share_id
      JOIN users AS owner ON owner.user_id = s.owner_user_id AND owner.account_status = 'active'
      JOIN user_sharing_keys AS sender_key ON sender_key.user_id = s.owner_user_id
      JOIN trusted_connections AS c ON c.connection_status = 'accepted'
        AND ((c.user_low_id = s.owner_user_id AND c.user_high_id = r.recipient_user_id)
          OR (c.user_high_id = s.owner_user_id AND c.user_low_id = r.recipient_user_id))
      JOIN trusted_connection_preferences AS p
        ON p.connection_id = c.connection_id AND p.recipient_user_id = r.recipient_user_id
        AND p.receive_location = 1
      JOIN encrypted_location_envelopes AS e
        ON e.share_id = r.share_id AND e.recipient_user_id = r.recipient_user_id
      WHERE r.recipient_user_id = ? AND s.share_status = 'active' AND s.expires_at > ?
      ORDER BY e.updated_at DESC LIMIT 50
    `).bind(session.user.user_id, now).all();

    return jsonResponse({
      ownShares: [...ownById.values()],
      incomingShares: (incoming.results || []).map((row) => ({
        shareId: row.share_id,
        senderUserId: row.owner_user_id,
        senderUsername: row.owner_username,
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        updatedAt: row.updated_at,
        envelope: {
          senderPublicKey: toBase64Url(new Uint8Array(row.sender_public_key)),
          hkdfSalt: toBase64Url(new Uint8Array(row.hkdf_salt)),
          ciphertext: toBase64Url(new Uint8Array(row.location_ciphertext)),
          iv: toBase64Url(new Uint8Array(row.location_iv)),
          keyVersion: 1,
        },
      })),
    });
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
      || !Number.isInteger(body.expiresInMinutes) || body.expiresInMinutes < 5 || body.expiresInMinutes > 60) {
      return jsonResponse({ error: { code: "INVALID_LOCATION_SHARE", message: "Choose one to twenty trusted members and an expiry from 5 to 60 minutes." } }, 400);
    }
    const ownerKey = await context.env.DB.prepare(
      "SELECT 1 AS present FROM user_sharing_keys WHERE user_id = ?",
    ).bind(session.user.user_id).first();
    if (!ownerKey) return jsonResponse({ error: { code: "SHARING_KEY_REQUIRED", message: "Unlock your encrypted private vault to set up a location-sharing key." } }, 409);

    for (const recipientUserId of recipientUserIds) {
      const eligible = await context.env.DB.prepare(`
        SELECT 1 AS allowed
        FROM users AS recipient
        JOIN trusted_connections AS c ON c.connection_status = 'accepted'
          AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
            OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
        JOIN trusted_connection_preferences AS p
          ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
          AND p.receive_location = 1
        JOIN user_sharing_keys AS sharing ON sharing.user_id = recipient.user_id
        WHERE recipient.user_id = ? AND recipient.account_status = 'active'
        LIMIT 1
      `).bind(session.user.user_id, session.user.user_id, recipientUserId).first();
      if (!eligible) return jsonResponse({ error: { code: "RECIPIENT_NOT_ALLOWED", message: "A selected member has not enabled encrypted location sharing or set up a private vault key." } }, 403);
    }

    const shareId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + body.expiresInMinutes * 60_000;
    const statements = [context.env.DB.prepare(`
      INSERT INTO location_shares (share_id, owner_user_id, share_status, started_at, expires_at)
      VALUES (?, ?, 'active', ?, ?)
    `).bind(shareId, session.user.user_id, now, expiresAt)];
    for (const recipientUserId of recipientUserIds) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO location_share_recipients (share_id, recipient_user_id, added_at)
        SELECT ?, recipient.user_id, ? FROM users AS recipient
        WHERE recipient.user_id = ? AND recipient.account_status = 'active'
          AND EXISTS (
            SELECT 1 FROM trusted_connections AS c
            JOIN trusted_connection_preferences AS p
              ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
            JOIN user_sharing_keys AS sharing ON sharing.user_id = recipient.user_id
            WHERE c.connection_status = 'accepted' AND p.receive_location = 1
              AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
                OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
          )
      `).bind(shareId, now, recipientUserId, session.user.user_id, session.user.user_id));
    }
    const results = await context.env.DB.batch(statements);
    const recipientsCreated = results.slice(1).filter((result) => result?.meta?.changes === 1).length;
    if (recipientsCreated !== recipientUserIds.length) {
      await context.env.DB.batch([
        context.env.DB.prepare("DELETE FROM location_share_recipients WHERE share_id = ?").bind(shareId),
        context.env.DB.prepare("DELETE FROM location_shares WHERE share_id = ? AND owner_user_id = ?")
          .bind(shareId, session.user.user_id),
      ]);
      return jsonResponse({ error: { code: "RECIPIENT_CHANGED", message: "A member's sharing preference changed. Refresh the trusted circle and try again." } }, 409);
    }
    return jsonResponse({ share: { shareId, status: "active", startedAt: now, expiresAt },
      message: "Location sharing is active for the selected members and will expire automatically." }, 201);
  } catch (error) {
    return safeError(error);
  }
}
