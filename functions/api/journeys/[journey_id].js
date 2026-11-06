import { requireSession } from "../../_shared/auth.js";
import { clearRateLimit, isRateLimited, recordFailure } from "../../_shared/rate-limit.js";
import { constantTimeEqual, derivePasswordHash } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const MAX_PASSWORD_BYTES = 256;
const MAX_DURATION_MINUTES = 24 * 60;

function validDuration(value) {
  return Number.isInteger(value) && value >= 15 && value <= MAX_DURATION_MINUTES;
}

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const { env } = context;
    const journeyId = context.params.journey_id;
    const body = await readJsonRequest(context.request, 4096);
    if (!/^[0-9a-f-]{36}$/iu.test(journeyId || "")
      || !["complete", "extend"].includes(body.operation)
      || typeof body.password !== "string"
      || new TextEncoder().encode(body.password).byteLength > MAX_PASSWORD_BYTES) {
      return jsonResponse({ error: { code: "INVALID_JOURNEY_ACTION", message: "Enter your account password and choose a valid journey action." } }, 400);
    }
    if (body.operation === "extend" && !validDuration(body.extendMinutes)) {
      return jsonResponse({ error: { code: "INVALID_EXTENSION", message: "Choose an extension from 15 minutes to 24 hours." } }, 400);
    }
    if (body.operation === "complete" && body.attemptedAt !== undefined
      && (!Number.isSafeInteger(body.attemptedAt) || body.attemptedAt > Date.now() + 60_000)) {
      return jsonResponse({ error: { code: "INVALID_ATTEMPT_TIME", message: "The saved finish time is not valid. Try again online." } }, 400);
    }

    const userId = session.user.user_id;
    const passwordBucket = `journey:password:${userId}`;
    if (await isRateLimited(env, passwordBucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many password checks. Wait before trying again." } }, 429);
    }
    const [account, journey] = await Promise.all([
      env.DB.prepare(`SELECT password_algorithm, password_iterations, password_hash, password_salt
        FROM users WHERE user_id = ? AND account_status = 'active'`).bind(userId).first(),
      env.DB.prepare(`SELECT journey_id, user_id, status, started_at, expected_return_at
        FROM safe_journeys WHERE journey_id = ? AND user_id = ?`)
        .bind(journeyId, userId).first(),
    ]);
    if (!account || !journey) return jsonResponse({ error: { code: "JOURNEY_NOT_FOUND", message: "This journey is not available in your account." } }, 404);
    const actualHash = await derivePasswordHash(body.password, new Uint8Array(account.password_salt), account.password_iterations);
    if (account.password_algorithm !== "PBKDF2-HMAC-SHA-256"
      || !constantTimeEqual(actualHash, account.password_hash)) {
      await recordFailure(env, passwordBucket, 5);
      return jsonResponse({ error: { code: "PASSWORD_REJECTED", message: "That password did not match. Check it and try again." } }, 401);
    }
    await clearRateLimit(env, passwordBucket);

    const now = Date.now();
    if (body.operation === "extend") {
      if (journey.status !== "active" || journey.expected_return_at <= now) {
        return jsonResponse({ error: { code: "JOURNEY_OVERDUE", message: "This journey is already overdue. Finish it if you are back, or ask your trusted people to check on you." } }, 409);
      }
      const nextExpectedAt = journey.expected_return_at + body.extendMinutes * 60_000;
      const eventKey = `journey-extended:${journeyId}:${now}`;
      const result = await env.DB.batch([env.DB.prepare(`UPDATE safe_journeys SET expected_return_at = ?, updated_at = ?
        WHERE journey_id = ? AND user_id = ? AND status = 'active' AND expected_return_at > ?`)
        .bind(nextExpectedAt, now, journeyId, userId, now),
        env.DB.prepare(`INSERT INTO safe_journey_events (
          event_id, event_key, journey_id, actor_user_id, event_type,
          previous_expected_at, expected_return_at, created_at
        ) VALUES (?, ?, ?, ?, 'extended', ?, ?, ?)`)
          .bind(crypto.randomUUID(), eventKey, journeyId, userId, journey.expected_return_at, nextExpectedAt, now),
        journeyNotificationInsert(env.DB, journeyId, "journey_extended", eventKey, now),
      ]);
      if (result[0]?.meta?.changes !== 1) return jsonResponse({ error: { code: "JOURNEY_CHANGED", message: "The journey changed before the extension was saved. Refresh and try again." } }, 409);
      return jsonResponse({ journeyId, status: "active", expectedReturnAt: nextExpectedAt, message: "Safe Journey extended. Your trusted people have an in-app update." });
    }

    if (!new Set(["active", "overdue"]).has(journey.status)) {
      return jsonResponse({ error: { code: "JOURNEY_ALREADY_COMPLETED", message: "This journey has already been completed." } }, 409);
    }
    const attemptedAt = body.attemptedAt ?? now;
    if (attemptedAt < journey.started_at || attemptedAt > now + 60_000) {
      return jsonResponse({ error: { code: "INVALID_ATTEMPT_TIME", message: "The saved finish time is outside this journey. Try again." } }, 400);
    }
    // For a device that recorded the return while offline, this is the user's
    // reported attempt time. It is not a trusted clock proof; server time remains
    // the completion record, and a previously sent overdue alert cannot be undone.
    const missedDeadline = attemptedAt > journey.expected_return_at;
    const overdueNoticeMayExist = journey.status === "overdue";
    const completionKey = `journey-completed:${journeyId}`;
    const statements = [env.DB.prepare(`UPDATE safe_journeys SET status = 'completed',
        overdue_at = CASE WHEN ? = 1 THEN COALESCE(overdue_at, expected_return_at) ELSE overdue_at END,
        completion_attempted_at = ?, completed_at = ?, updated_at = ?
      WHERE journey_id = ? AND user_id = ? AND status = ?`)
      .bind(missedDeadline ? 1 : 0, attemptedAt, now, now, journeyId, userId, journey.status)];

    if (missedDeadline && journey.status === "active") {
      statements.push(env.DB.prepare(`INSERT INTO safe_journey_events (
        event_id, event_key, journey_id, actor_user_id, event_type,
        expected_return_at, created_at
      ) VALUES (?, ?, ?, ?, 'overdue', ?, ?)
      ON CONFLICT (event_key) DO NOTHING`).bind(
        crypto.randomUUID(), `journey-overdue:${journeyId}`, journeyId, userId, journey.expected_return_at, now,
      ));
      statements.push(journeyNotificationInsert(env.DB, journeyId, "journey_overdue", `journey-overdue:${journeyId}`, now));
    }
    statements.push(env.DB.prepare(`INSERT INTO safe_journey_events (
      event_id, event_key, journey_id, actor_user_id, event_type,
      expected_return_at, client_occurred_at, created_at
    ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?)
    ON CONFLICT (event_key) DO NOTHING`).bind(
      crypto.randomUUID(), completionKey, journeyId, userId, journey.expected_return_at, attemptedAt, now,
    ));
    statements.push(journeyNotificationInsert(env.DB, journeyId, "journey_completed", completionKey, now));
    const results = await env.DB.batch(statements);
    if (results[0]?.meta?.changes !== 1) return jsonResponse({ error: { code: "JOURNEY_CHANGED", message: "The journey changed before it could be completed. Refresh and try again." } }, 409);
    return jsonResponse({
      journeyId,
      status: "completed",
      completedAt: now,
      completionAttemptedAt: attemptedAt,
      wasOverdue: missedDeadline,
      message: missedDeadline || overdueNoticeMayExist
        ? "Your journey is marked complete. Because the timer had expired, trusted people may already have received an overdue notice."
        : "Safe Journey completed. Your trusted people have an in-app update.",
    });
  } catch (error) {
    return safeError(error);
  }
}

function journeyNotificationInsert(DB, journeyId, category, eventKey, now) {
  return DB.prepare(`INSERT INTO notification_events (
      event_id, event_key, user_id, category, delivery_status, created_at,
      updated_at, related_resource_id
    ) SELECT lower(hex(randomblob(16))), ? || ':' || selected.recipient_user_id,
      selected.recipient_user_id, ?, 'prepared', ?, ?, journey.journey_id
    FROM safe_journeys AS journey
    JOIN safe_journey_recipients AS selected ON selected.journey_id = journey.journey_id
    JOIN users AS recipient ON recipient.user_id = selected.recipient_user_id
      AND recipient.account_status = 'active'
    JOIN trusted_connections AS connection ON connection.connection_status = 'accepted'
      AND ((connection.user_low_id = journey.user_id AND connection.user_high_id = recipient.user_id)
        OR (connection.user_high_id = journey.user_id AND connection.user_low_id = recipient.user_id))
    JOIN trusted_connection_preferences AS permission ON permission.connection_id = connection.connection_id
      AND permission.recipient_user_id = recipient.user_id AND permission.receive_safe_journeys = 1
    LEFT JOIN notification_preferences AS preference ON preference.user_id = recipient.user_id
    WHERE journey.journey_id = ? AND COALESCE(preference.safe_journeys_enabled, 1) = 1
    ON CONFLICT (event_key) DO NOTHING`).bind(eventKey, category, now, now, journeyId);
}
