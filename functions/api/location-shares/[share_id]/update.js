import { requireSession } from "../../../_shared/auth.js";
import { fromBase64Url } from "../../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../../_shared/http.js";

function validId(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const shareId = context.params.share_id;
    const body = await readJsonRequest(context.request, 32_768);
    if (!validId(shareId) || !Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > 20) {
      return jsonResponse({ error: { code: "INVALID_LOCATION_UPDATE", message: "The encrypted location update is not valid." } }, 400);
    }
    const parsed = body.entries.map((entry) => ({
      recipientUserId: entry.recipientUserId,
      senderPublicKey: fromBase64Url(entry.senderPublicKey, { minimumBytes: 65, maximumBytes: 65 }),
      hkdfSalt: fromBase64Url(entry.hkdfSalt, { minimumBytes: 32, maximumBytes: 32 }),
      ciphertext: fromBase64Url(entry.ciphertext, { minimumBytes: 17, maximumBytes: 4096 }),
      iv: fromBase64Url(entry.iv, { minimumBytes: 12, maximumBytes: 12 }),
    }));
    if (parsed.some((entry) => !validId(entry.recipientUserId) || !entry.senderPublicKey
      || !entry.hkdfSalt || !entry.ciphertext || !entry.iv)
      || new Set(parsed.map((entry) => entry.recipientUserId)).size !== parsed.length) {
      return jsonResponse({ error: { code: "INVALID_LOCATION_UPDATE", message: "The encrypted location update is not valid." } }, 400);
    }
    const now = Date.now();
    const share = await context.env.DB.prepare(`
      SELECT share_id FROM location_shares
      WHERE share_id = ? AND owner_user_id = ? AND share_status = 'active' AND expires_at > ?
    `).bind(shareId, session.user.user_id, now).first();
    if (!share) return jsonResponse({ error: { code: "SHARE_NOT_ACTIVE", message: "This location share has stopped or expired." } }, 409);

    const allowedRows = await context.env.DB.prepare(`
      SELECT r.recipient_user_id
      FROM location_share_recipients AS r
      JOIN users AS recipient ON recipient.user_id = r.recipient_user_id AND recipient.account_status = 'active'
      JOIN trusted_connections AS c ON c.connection_status = 'accepted'
        AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
          OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
      JOIN trusted_connection_preferences AS p
        ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
        AND p.receive_location = 1
      WHERE r.share_id = ?
    `).bind(session.user.user_id, session.user.user_id, shareId).all();
    const allowed = new Set((allowedRows.results || []).map((row) => row.recipient_user_id));
    if (allowed.size !== parsed.length || parsed.some((entry) => !allowed.has(entry.recipientUserId))) {
      return jsonResponse({ error: { code: "RECIPIENT_CHANGED", message: "A selected member's location-sharing consent changed. Stop and review this share." } }, 409);
    }

    const statements = parsed.map((entry) => context.env.DB.prepare(`
      INSERT INTO encrypted_location_envelopes (
        share_id, recipient_user_id, sender_public_key, hkdf_salt,
        location_ciphertext, location_iv, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM location_share_recipients AS r
        JOIN location_shares AS s ON s.share_id = r.share_id
        JOIN users AS recipient ON recipient.user_id = r.recipient_user_id
          AND recipient.account_status = 'active'
        JOIN trusted_connections AS c ON c.connection_status = 'accepted'
          AND ((c.user_low_id = s.owner_user_id AND c.user_high_id = r.recipient_user_id)
            OR (c.user_high_id = s.owner_user_id AND c.user_low_id = r.recipient_user_id))
        JOIN trusted_connection_preferences AS p
          ON p.connection_id = c.connection_id AND p.recipient_user_id = r.recipient_user_id
          AND p.receive_location = 1
        WHERE r.share_id = ? AND r.recipient_user_id = ?
          AND s.owner_user_id = ? AND s.share_status = 'active' AND s.expires_at > ?
          AND EXISTS (SELECT 1 FROM user_sharing_keys AS owner_key
            WHERE owner_key.user_id = s.owner_user_id AND owner_key.public_key = ?)
      ) ON CONFLICT (share_id, recipient_user_id) DO UPDATE SET
        sender_public_key = excluded.sender_public_key,
        hkdf_salt = excluded.hkdf_salt,
        location_ciphertext = excluded.location_ciphertext,
        location_iv = excluded.location_iv,
        updated_at = excluded.updated_at
    `).bind(shareId, entry.recipientUserId, entry.senderPublicKey, entry.hkdfSalt,
      entry.ciphertext, entry.iv, now, shareId, entry.recipientUserId, session.user.user_id, now, entry.senderPublicKey));
    const results = await context.env.DB.batch(statements);
    if (results.filter((result) => result?.meta?.changes === 1).length !== parsed.length) {
      return jsonResponse({ error: { code: "RECIPIENT_CHANGED", message: "A selected member's sharing preference changed. Stop and review this share." } }, 409);
    }
    return jsonResponse({ updated: true, updatedAt: now, recipients: parsed.length });
  } catch (error) {
    return safeError(error);
  }
}
