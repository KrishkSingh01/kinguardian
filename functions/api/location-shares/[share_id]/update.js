import { requireSession } from "../../../_shared/auth.js";
import { encryptLocationPoint } from "../../../_shared/location-crypto.js";
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
    if (!validId(shareId)) return jsonResponse({ error: { code: "SHARE_NOT_FOUND", message: "That location share was not found." } }, 404);
    const body = await readJsonRequest(context.request, 2048);
    const now = Date.now();
    const capturedAt = body.capturedAt;
    if (!Number.isFinite(body.latitude) || Math.abs(body.latitude) > 90
      || !Number.isFinite(body.longitude) || Math.abs(body.longitude) > 180
      || !Number.isFinite(body.accuracy) || body.accuracy < 0 || body.accuracy > 100_000
      || !Number.isSafeInteger(capturedAt) || capturedAt < now - 7 * 24 * 60 * 60_000 || capturedAt > now + 60_000) {
      return jsonResponse({ error: { code: "INVALID_LOCATION_UPDATE", message: "The location point is invalid or too old. Get a fresh location and try again." } }, 400);
    }

    const db = context.env.DB;
    const share = await db.prepare(`
      SELECT s.share_id FROM location_shares AS s
      WHERE s.share_id = ? AND s.owner_user_id = ? AND s.share_status = 'active' AND s.expires_at > ?
        AND EXISTS (
          SELECT 1 FROM location_share_recipients AS r
          JOIN users AS recipient ON recipient.user_id = r.recipient_user_id AND recipient.account_status = 'active'
          JOIN trusted_connections AS c ON c.connection_status = 'accepted'
            AND ((c.user_low_id = s.owner_user_id AND c.user_high_id = r.recipient_user_id)
              OR (c.user_high_id = s.owner_user_id AND c.user_low_id = r.recipient_user_id))
          JOIN trusted_connection_preferences AS p ON p.connection_id = c.connection_id
            AND p.recipient_user_id = r.recipient_user_id AND p.receive_location = 1
          WHERE r.share_id = s.share_id
        )
    `).bind(shareId, session.user.user_id, now).first();
    if (!share) return jsonResponse({ error: { code: "SHARE_NOT_ACTIVE", message: "This location share stopped, expired, or no longer has an approved recipient." } }, 409);

    const point = {
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
      capturedAt,
      source: "browser location",
    };
    const encrypted = await encryptLocationPoint(context.env, shareId, session.user.user_id, point);
    const write = await db.prepare(`
      INSERT INTO location_share_points (share_id, location_time, encrypted_point, iv, updated_at)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM location_share_points WHERE share_id = ? AND location_time >= ?
      )
      ON CONFLICT (share_id, location_time) DO NOTHING
    `).bind(shareId, capturedAt, encrypted.ciphertext, encrypted.iv, now, shareId, capturedAt).run();
    if (write.meta?.changes !== 1) {
      const latest = await db.prepare("SELECT MAX(location_time) AS location_time FROM location_share_points WHERE share_id = ?")
        .bind(shareId).first();
      return jsonResponse({ updated: false, updatedAt: latest?.location_time || null,
        message: "A newer location is already saved. The older point was not used." });
    }
    await db.prepare(`DELETE FROM location_share_points WHERE share_id = ? AND location_time NOT IN (
      SELECT location_time FROM location_share_points WHERE share_id = ? ORDER BY location_time DESC LIMIT 60
    )`).bind(shareId, shareId).run();
    return jsonResponse({ updated: true, updatedAt: capturedAt });
  } catch (error) {
    return safeError(error);
  }
}
