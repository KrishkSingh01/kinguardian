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
    const alertId = context.params.alert_id;
    const body = await readJsonRequest(context.request, 2048);
    const now = Date.now();
    if (!validId(alertId) || !Number.isFinite(body.latitude) || Math.abs(body.latitude) > 90
      || !Number.isFinite(body.longitude) || Math.abs(body.longitude) > 180
      || !Number.isFinite(body.accuracy) || body.accuracy < 0 || body.accuracy > 100_000
      || !Number.isSafeInteger(body.capturedAt) || body.capturedAt > now + 60_000
      || body.capturedAt < now - 7 * 24 * 60 * 60_000) {
      return jsonResponse({ error: { code: "INVALID_LOCATION", message: "The location point is not valid or is too old." } }, 400);
    }
    const DB = context.env.DB;
    const alert = await DB.prepare(`SELECT alert_id FROM sos_alerts
      WHERE alert_id = ? AND sender_user_id = ? AND alert_status NOT IN ('resolved', 'closed')`)
      .bind(alertId, session.user.user_id).first();
    if (!alert) return jsonResponse({ error: { code: "ALERT_NOT_ACTIVE", message: "This SOS is not active for your account." } }, 404);

    const point = {
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
      capturedAt: body.capturedAt,
      source: "browser location",
    };
    const encrypted = await encryptLocationPoint(context.env, alertId, session.user.user_id, point);
    const result = await DB.prepare(`UPDATE sos_alerts SET location_ciphertext = ?, location_iv = ?, location_time = ?
      WHERE alert_id = ? AND sender_user_id = ? AND alert_status NOT IN ('resolved', 'closed')
        AND (location_time IS NULL OR location_time < ?)`)
      .bind(encrypted.ciphertext, encrypted.iv, body.capturedAt, alertId, session.user.user_id, body.capturedAt).run();
    if (result.meta?.changes !== 1) {
      const current = await DB.prepare("SELECT location_time FROM sos_alerts WHERE alert_id = ?").bind(alertId).first();
      return jsonResponse({ updated: false, updatedAt: current?.location_time || null,
        message: "A newer location is already saved. The older point was ignored." });
    }
    return jsonResponse({ updated: true, updatedAt: body.capturedAt });
  } catch (error) {
    return safeError(error);
  }
}
