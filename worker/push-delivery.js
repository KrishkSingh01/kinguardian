import { buildPushPayload } from "@block65/webcrypto-web-push";
import { toBase64Url } from "../functions/_shared/crypto.js";
import { usableVapidPublicKey, validPushEndpoint } from "../functions/_shared/notifications.js";

const MAX_EVENTS_PER_TICK = 5;
const MAX_DEVICES_PER_USER = 5;
// One encrypted outbound request per minute keeps the Cron path within the
// Workers Free plan's 10 ms CPU budget for this small prototype.
const MAX_DELIVERIES_PER_TICK = 1;
const MAX_ATTEMPTS = 5;
const CLAIM_MS = 45_000;
const CATEGORY_PREFERENCE = {
  sos: "sos_enabled",
  invitation: "invitations_enabled",
  checkin_reminder: "checkin_reminders_enabled",
  missed_checkin: "missed_checkins_enabled",
  acknowledgement: "acknowledgements_enabled",
  account_security: "account_security_enabled",
};

export async function processPushQueue(env, now = Date.now()) {
  const DB = env.DB;
  await settleExhaustedClaims(DB, now);
  if (!vapidConfigurationIsUsable(env)) return;
  await fanOutPreparedEvents(DB, now);
  const { results = [] } = await DB.prepare(`
    SELECT d.delivery_id, d.event_id, d.subscription_id, d.attempt_count,
           e.user_id, e.category, e.checkin_id, e.related_resource_id,
           s.endpoint, s.p256dh_key, s.auth_secret
    FROM notification_deliveries AS d
    JOIN notification_events AS e ON e.event_id = d.event_id
    JOIN push_subscriptions AS s ON s.subscription_id = d.subscription_id
    WHERE d.delivery_status IN ('prepared', 'attempted')
      AND d.next_attempt_at <= ?
      AND (d.claim_expires_at IS NULL OR d.claim_expires_at <= ?)
      AND d.attempt_count < ? AND s.disabled_at IS NULL
    ORDER BY d.created_at, d.delivery_id LIMIT ?
  `).bind(now, now, MAX_ATTEMPTS, MAX_DELIVERIES_PER_TICK).all();

  for (const delivery of results) {
    await processOneDelivery(DB, delivery, env, now);
  }
}

async function fanOutPreparedEvents(DB, now) {
  const { results = [] } = await DB.prepare(`
    SELECT event_id, user_id, category, checkin_id, related_resource_id
    FROM notification_events
    WHERE delivery_status = 'prepared' AND fanout_at IS NULL
    ORDER BY created_at LIMIT ?
  `).bind(MAX_EVENTS_PER_TICK).all();

  for (const event of results) {
    if (!await eventStillEligible(DB, event, now)) {
      await DB.prepare(`UPDATE notification_events SET fanout_at = ?, delivery_status = 'failed', updated_at = ?
        WHERE event_id = ? AND fanout_at IS NULL AND delivery_status = 'prepared'`)
        .bind(now, now, event.event_id).run();
      continue;
    }
    const subscriptions = await DB.prepare(`SELECT subscription_id FROM push_subscriptions
      WHERE user_id = ? AND disabled_at IS NULL ORDER BY created_at LIMIT ?`)
      .bind(event.user_id, MAX_DEVICES_PER_USER).all();
    if (!(subscriptions.results || []).length) {
      await DB.prepare(`UPDATE notification_events SET fanout_at = ?, delivery_status = 'failed', updated_at = ?
        WHERE event_id = ? AND fanout_at IS NULL AND delivery_status = 'prepared'`)
        .bind(now, now, event.event_id).run();
      continue;
    }
    await DB.batch([
      DB.prepare(`UPDATE notification_events SET fanout_at = ?, updated_at = ?
        WHERE event_id = ? AND fanout_at IS NULL AND delivery_status = 'prepared'`)
        .bind(now, now, event.event_id),
      DB.prepare(`INSERT INTO notification_deliveries (
          delivery_id, event_id, subscription_id, delivery_status, created_at, updated_at
        ) SELECT lower(hex(randomblob(16))), ?, s.subscription_id, 'prepared', ?, ?
        FROM push_subscriptions AS s
        WHERE s.user_id = ? AND s.disabled_at IS NULL AND changes() = 1
        ORDER BY s.created_at LIMIT ?
        ON CONFLICT (event_id, subscription_id) DO NOTHING`)
        .bind(event.event_id, now, now, event.user_id, MAX_DEVICES_PER_USER),
    ]);
  }
}

async function processOneDelivery(DB, delivery, env, now) {
  const claim = await DB.prepare(`UPDATE notification_deliveries
    SET delivery_status = 'attempted', attempt_count = attempt_count + 1,
        claim_expires_at = ?, attempted_at = ?, updated_at = ?
    WHERE delivery_id = ? AND delivery_status IN ('prepared', 'attempted')
      AND next_attempt_at <= ? AND (claim_expires_at IS NULL OR claim_expires_at <= ?)
      AND attempt_count < ?`).bind(
    now + CLAIM_MS, now, now, delivery.delivery_id, now, now, MAX_ATTEMPTS,
  ).run();
  if (claim.meta?.changes !== 1) return;
  const event = {
    event_id: delivery.event_id,
    user_id: delivery.user_id,
    category: delivery.category,
    checkin_id: delivery.checkin_id,
    related_resource_id: delivery.related_resource_id,
  };
  if (!await eventStillEligible(DB, event, now)) {
    await DB.prepare(`UPDATE notification_deliveries
      SET delivery_status = 'suppressed', claim_expires_at = NULL, updated_at = ? WHERE delivery_id = ?`)
      .bind(now, delivery.delivery_id).run();
    await updateEventSummary(DB, delivery.event_id, now);
    return;
  }
  if (!validPushEndpoint(delivery.endpoint)) {
    await finishDelivery(DB, delivery, "failed", "permanent", now);
    return;
  }

  const attemptNumber = delivery.attempt_count + 1;
  try {
    let payload;
    try {
      payload = await buildPushPayload({
        data: { category: delivery.category, notificationId: delivery.event_id },
        options: { ttl: 300 },
      }, {
        endpoint: delivery.endpoint,
        expirationTime: null,
        keys: {
          p256dh: toBase64Url(new Uint8Array(delivery.p256dh_key)),
          auth: toBase64Url(new Uint8Array(delivery.auth_secret)),
        },
      }, {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      });
    } catch {
      await finishDelivery(DB, delivery, "failed", "configuration", now);
      return;
    }
    const stillActive = await DB.prepare(`SELECT 1 AS active FROM push_subscriptions
      WHERE subscription_id = ? AND disabled_at IS NULL`).bind(delivery.subscription_id).first();
    if (!stillActive) {
      await DB.prepare(`UPDATE notification_deliveries SET delivery_status = 'suppressed',
        claim_expires_at = NULL, updated_at = ? WHERE delivery_id = ?`)
        .bind(now, delivery.delivery_id).run();
      await updateEventSummary(DB, delivery.event_id, now);
      return;
    }
    let response;
    try {
      response = await fetch(delivery.endpoint, {
        ...payload,
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      await retryOrFinish(DB, delivery, "retryable", attemptNumber, now);
      await updateEventSummary(DB, delivery.event_id, now);
      return;
    }
    if (response.status >= 200 && response.status < 300) {
      await DB.batch([
        DB.prepare(`UPDATE push_subscriptions SET last_success_at = ? WHERE subscription_id = ?`)
          .bind(now, delivery.subscription_id),
        DB.prepare(`UPDATE notification_deliveries SET delivery_status = 'provider_accepted',
          provider_accepted_at = ?, claim_expires_at = NULL, last_error_category = NULL, updated_at = ?
          WHERE delivery_id = ?`).bind(now, now, delivery.delivery_id),
      ]);
    } else if (response.status === 404 || response.status === 410) {
      await DB.batch([
        DB.prepare(`UPDATE push_subscriptions SET endpoint = '', endpoint_hash = randomblob(32),
          p256dh_key = X'', auth_secret = X'', disabled_at = ?
          WHERE subscription_id = ? AND disabled_at IS NULL`)
          .bind(now, delivery.subscription_id),
        DB.prepare(`UPDATE notification_deliveries SET delivery_status = 'failed',
          claim_expires_at = NULL, last_error_category = 'permanent', updated_at = ?
          WHERE delivery_id = ?`).bind(now, delivery.delivery_id),
      ]);
    } else if (response.status === 429 || response.status >= 500) {
      await retryOrFinish(DB, delivery, "retryable", attemptNumber, now);
    } else {
      await finishDelivery(DB, delivery, "failed",
        response.status === 401 || response.status === 403 ? "configuration" : "permanent", now);
    }
  } catch {
    await retryOrFinish(DB, delivery, "retryable", attemptNumber, now);
  }
  await updateEventSummary(DB, delivery.event_id, now);
}

async function settleExhaustedClaims(DB, now) {
  const { results = [] } = await DB.prepare(`SELECT delivery_id, event_id FROM notification_deliveries
    WHERE delivery_status = 'attempted' AND attempt_count >= ?
      AND claim_expires_at IS NOT NULL AND claim_expires_at <= ?
    ORDER BY claim_expires_at LIMIT ?`).bind(MAX_ATTEMPTS, now, MAX_DELIVERIES_PER_TICK).all();
  for (const item of results) {
    const result = await DB.prepare(`UPDATE notification_deliveries SET delivery_status = 'unknown',
      claim_expires_at = NULL, last_error_category = 'retryable', updated_at = ?
      WHERE delivery_id = ? AND delivery_status = 'attempted' AND attempt_count >= ?
        AND claim_expires_at <= ?`).bind(now, item.delivery_id, MAX_ATTEMPTS, now).run();
    if (result.meta?.changes) await updateEventSummary(DB, item.event_id, now);
  }
}

async function retryOrFinish(DB, delivery, category, attemptNumber, now) {
  if (attemptNumber >= MAX_ATTEMPTS) {
    await finishDelivery(DB, delivery, "unknown", category, now);
    return;
  }
  const backoffMs = Math.min(15 * 60_000, 30_000 * (2 ** (attemptNumber - 1)));
  await DB.prepare(`UPDATE notification_deliveries SET delivery_status = 'attempted',
    next_attempt_at = ?, claim_expires_at = NULL, last_error_category = ?, updated_at = ?
    WHERE delivery_id = ?`).bind(now + backoffMs, category, now, delivery.delivery_id).run();
}

async function finishDelivery(DB, delivery, status, category, now) {
  await DB.prepare(`UPDATE notification_deliveries SET delivery_status = ?,
    claim_expires_at = NULL, last_error_category = ?, updated_at = ? WHERE delivery_id = ?`)
    .bind(status, category, now, delivery.delivery_id).run();
  await updateEventSummary(DB, delivery.event_id, now);
}

async function updateEventSummary(DB, eventId, now) {
  const { results = [] } = await DB.prepare(`SELECT delivery_status, COUNT(*) AS total
    FROM notification_deliveries WHERE event_id = ? GROUP BY delivery_status`).bind(eventId).all();
  const counts = Object.fromEntries(results.map((row) => [row.delivery_status, row.total]));
  const hasPending = (counts.prepared || 0) + (counts.attempted || 0) > 0;
  const status = hasPending
    ? ((counts.attempted || 0) > 0 ? "attempted" : "prepared")
    : (counts.provider_accepted ? "provider_accepted" : counts.unknown ? "unknown" : "failed");
  await DB.prepare(`UPDATE notification_events SET delivery_status = ?, updated_at = ? WHERE event_id = ?`)
    .bind(status, now, eventId).run();
  const event = await DB.prepare(`SELECT category, user_id, related_resource_id
    FROM notification_events WHERE event_id = ?`).bind(eventId).first();
  if (event?.category === "sos" && status === "provider_accepted") {
    await DB.batch([
      DB.prepare(`UPDATE sos_alert_recipients SET recipient_status = 'notification_attempted'
        WHERE alert_id = ? AND recipient_user_id = ? AND recipient_status IN ('selected', 'prepared')`)
        .bind(event.related_resource_id, event.user_id),
      DB.prepare(`UPDATE sos_alerts SET alert_status = 'notification_attempted'
        WHERE alert_id = ? AND alert_status = 'accepted_by_server'`)
        .bind(event.related_resource_id),
    ]);
  } else if (event?.category === "sos" && status === "failed") {
    await DB.prepare(`UPDATE sos_alert_recipients SET recipient_status = 'failed'
      WHERE alert_id = ? AND recipient_user_id = ? AND recipient_status IN ('selected', 'prepared')`)
      .bind(event.related_resource_id, event.user_id).run();
  }
}

async function eventStillEligible(DB, event, now) {
  const user = await DB.prepare(`SELECT u.account_status, p.*
    FROM users AS u LEFT JOIN notification_preferences AS p ON p.user_id = u.user_id
    WHERE u.user_id = ?`).bind(event.user_id).first();
  if (!user || user.account_status !== "active") return false;
  const preferenceColumn = CATEGORY_PREFERENCE[event.category];
  if (preferenceColumn && user[preferenceColumn] === 0) return false;
  switch (event.category) {
    case "test":
    case "account_security":
      return true;
    case "checkin_reminder":
      return Boolean(await DB.prepare(`SELECT 1 FROM safety_checkins
        WHERE checkin_id = ? AND user_id = ? AND status = 'pending'
          AND reminder_at_utc IS NOT NULL AND reminder_at_utc <= ?`)
        .bind(event.checkin_id, event.user_id, now).first());
    case "missed_checkin":
      return Boolean(await DB.prepare(`SELECT 1
        FROM safety_checkins AS s
        JOIN safety_checkin_recipients AS r ON r.checkin_id = s.checkin_id
          AND r.recipient_user_id = ?
        JOIN users AS sender ON sender.user_id = s.user_id AND sender.account_status = 'active'
        JOIN trusted_connections AS c ON c.connection_status = 'accepted'
          AND ((c.user_low_id = s.user_id AND c.user_high_id = ?)
            OR (c.user_high_id = s.user_id AND c.user_low_id = ?))
        JOIN trusted_connection_preferences AS cp ON cp.connection_id = c.connection_id
          AND cp.recipient_user_id = ? AND cp.receive_missed_checkin = 1
        WHERE s.checkin_id = ? AND s.status = 'overdue'`)
        .bind(event.user_id, event.user_id, event.user_id, event.user_id, event.checkin_id).first());
    case "sos":
      return Boolean(await DB.prepare(`SELECT 1 FROM sos_alerts AS a
        JOIN users AS sender ON sender.user_id = a.sender_user_id AND sender.account_status = 'active'
        JOIN sos_alert_recipients AS r ON r.alert_id = a.alert_id AND r.recipient_user_id = ?
        JOIN trusted_connections AS c ON c.connection_status = 'accepted'
          AND ((c.user_low_id = a.sender_user_id AND c.user_high_id = ?)
            OR (c.user_high_id = a.sender_user_id AND c.user_low_id = ?))
        JOIN trusted_connection_preferences AS cp ON cp.connection_id = c.connection_id
          AND cp.recipient_user_id = ? AND cp.receive_sos = 1
        WHERE a.alert_id = ? AND a.test_mode = 0 AND a.alert_status NOT IN ('resolved', 'closed')`)
        .bind(event.user_id, event.user_id, event.user_id, event.user_id, event.related_resource_id).first());
    case "invitation":
      return Boolean(await DB.prepare(`SELECT 1 FROM trusted_connections
        WHERE connection_id = ? AND connection_status = 'accepted'
          AND (user_low_id = ? OR user_high_id = ?)`)
        .bind(event.user_id, event.related_resource_id, event.user_id).first());
    case "acknowledgement":
      return Boolean(await DB.prepare(`SELECT 1 FROM sos_alerts AS a
        JOIN users AS recipient ON recipient.user_id = ? AND recipient.account_status = 'active'
        JOIN sos_alert_recipients AS r ON r.alert_id = a.alert_id
          AND r.recipient_user_id = recipient.user_id AND r.recipient_status = 'acknowledged'
        JOIN trusted_connections AS c ON c.connection_status = 'accepted'
          AND ((c.user_low_id = a.sender_user_id AND c.user_high_id = recipient.user_id)
            OR (c.user_high_id = a.sender_user_id AND c.user_low_id = recipient.user_id))
        WHERE a.alert_id = ? AND a.sender_user_id = ?`)
        .bind(event.related_resource_id, event.user_id, event.user_id).first());
    default:
      return false;
  }
}

function vapidConfigurationIsUsable(env) {
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!usableVapidPublicKey(env.VAPID_PUBLIC_KEY)
    || typeof privateKey !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(privateKey)
    || typeof subject !== "string" || subject.length > 200) return false;
  if (subject.startsWith("mailto:")) return /^mailto:[^\s@]+@[^\s@]+$/u.test(subject);
  try {
    const url = new URL(subject);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
