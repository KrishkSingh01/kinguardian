import { requireSession } from "../../_shared/auth.js";
import { sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";
import { usableVapidPublicKey, validPushEndpoint, validPushKeys } from "../../_shared/notifications.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    if (!usableVapidPublicKey(context.env.VAPID_PUBLIC_KEY)) {
      return jsonResponse({ error: { code: "PUSH_NOT_CONFIGURED", message: "Web Push is not configured for this app yet." } }, 503);
    }
    const body = await readJsonRequest(context.request, 8192);
    const endpoint = body?.endpoint;
    const keys = body?.keys;
    if (!validPushEndpoint(endpoint) || !keys || typeof keys !== "object") {
      return jsonResponse({ error: { code: "INVALID_SUBSCRIPTION", message: "This browser subscription is not supported." } }, 400);
    }
    const decoded = await validPushKeys(keys.p256dh, keys.auth);
    if (!decoded) {
      return jsonResponse({ error: { code: "INVALID_SUBSCRIPTION", message: "This browser subscription is not valid." } }, 400);
    }
    const userId = session.user.user_id;
    const endpointHash = await sha256(endpoint);
    const now = Date.now();
    const result = await context.env.DB.prepare(`
      INSERT INTO push_subscriptions (
        subscription_id, user_id, endpoint, endpoint_hash, p256dh_key, auth_secret, created_at, disabled_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, NULL
        WHERE (SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ? AND disabled_at IS NULL) < 5
          OR EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?)
      ON CONFLICT (endpoint_hash) DO UPDATE SET
        p256dh_key = excluded.p256dh_key, auth_secret = excluded.auth_secret,
        disabled_at = NULL
      WHERE push_subscriptions.user_id = excluded.user_id
    `).bind(crypto.randomUUID(), userId, endpoint, endpointHash, decoded.p256dh, decoded.auth,
      now, userId, endpointHash, userId).run();
    if (result.meta?.changes !== 1) {
      return jsonResponse({ error: { code: "DEVICE_LIMIT_OR_OWNERSHIP", message: "This device could not be added. Check that you are signed into the right account and have fewer than five active devices." } }, 409);
    }
    const count = await context.env.DB.prepare(`SELECT COUNT(*) AS active_count FROM push_subscriptions
      WHERE user_id = ? AND disabled_at IS NULL`).bind(userId).first();
    return jsonResponse({ subscribed: true, activeDeviceCount: count?.active_count || 0 });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestDelete(context) {
  if (context.request.method !== "DELETE") return new Response(null, { status: 405, headers: { Allow: "DELETE" } });
  if (context.request.headers.get("origin") !== new URL(context.request.url).origin) {
    return jsonResponse({ error: { code: "ORIGIN_REJECTED", message: "This request did not come from KinGuardian." } }, 403);
  }
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 4096);
    if (!validPushEndpoint(body.endpoint)) {
      return jsonResponse({ error: { code: "INVALID_SUBSCRIPTION", message: "The browser subscription could not be removed." } }, 400);
    }
    const endpointHash = await sha256(body.endpoint);
    const subscription = await context.env.DB.prepare(`SELECT subscription_id FROM push_subscriptions
      WHERE user_id = ? AND endpoint_hash = ?`).bind(session.user.user_id, endpointHash).first();
    if (subscription) {
      const now = Date.now();
      await context.env.DB.batch([
        context.env.DB.prepare(`UPDATE notification_deliveries SET delivery_status = 'suppressed',
          claim_expires_at = NULL, updated_at = ?
          WHERE subscription_id = ? AND delivery_status IN ('prepared', 'attempted')`)
          .bind(now, subscription.subscription_id),
        context.env.DB.prepare(`UPDATE notification_events AS e SET delivery_status = CASE
          WHEN EXISTS (SELECT 1 FROM notification_deliveries AS d WHERE d.event_id = e.event_id
            AND d.delivery_status = 'attempted') THEN 'attempted'
          WHEN EXISTS (SELECT 1 FROM notification_deliveries AS d WHERE d.event_id = e.event_id
            AND d.delivery_status = 'prepared') THEN 'prepared'
          WHEN EXISTS (SELECT 1 FROM notification_deliveries AS d WHERE d.event_id = e.event_id
            AND d.delivery_status = 'provider_accepted') THEN 'provider_accepted'
          WHEN EXISTS (SELECT 1 FROM notification_deliveries AS d WHERE d.event_id = e.event_id
            AND d.delivery_status = 'unknown') THEN 'unknown'
          ELSE 'failed' END, updated_at = ?
          WHERE e.event_id IN (SELECT event_id FROM notification_deliveries WHERE subscription_id = ?)
            AND e.delivery_status IN ('prepared', 'attempted')`)
          .bind(now, subscription.subscription_id),
        context.env.DB.prepare(`UPDATE push_subscriptions SET endpoint = '', endpoint_hash = randomblob(32),
          p256dh_key = X'', auth_secret = X'', disabled_at = ?
          WHERE subscription_id = ? AND user_id = ?`)
          .bind(now, subscription.subscription_id, session.user.user_id),
      ]);
    }
    return jsonResponse({ removed: true });
  } catch (error) {
    return safeError(error);
  }
}
