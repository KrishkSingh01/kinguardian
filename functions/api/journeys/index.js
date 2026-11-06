import { requireSession } from "../../_shared/auth.js";
import { isRateLimited, recordAttempt } from "../../_shared/rate-limit.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const MAX_RECIPIENTS = 20;
const MAX_DURATION_MINUTES = 24 * 60;
const JOURNEY_DURATION_PRESETS = new Set([15, 30, 45, 60, 120]);

function validUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function validDuration(value) {
  return Number.isInteger(value) && value >= 15 && value <= MAX_DURATION_MINUTES;
}

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const userId = session.user.user_id;
    const now = Date.now();
    const [ownResult, sharedResult] = await Promise.all([
      context.env.DB.prepare(`
        SELECT journey.*, owner.username
        FROM safe_journeys AS journey
        JOIN users AS owner ON owner.user_id = journey.user_id
        WHERE journey.user_id = ?
        ORDER BY journey.started_at DESC LIMIT 50
      `).bind(userId).all(),
      context.env.DB.prepare(`
        SELECT journey.*, owner.username
        FROM safe_journeys AS journey
        JOIN users AS owner ON owner.user_id = journey.user_id AND owner.account_status = 'active'
        JOIN safe_journey_recipients AS recipient ON recipient.journey_id = journey.journey_id
          AND recipient.recipient_user_id = ?
        JOIN trusted_connections AS connection ON connection.connection_status = 'accepted'
          AND ((connection.user_low_id = journey.user_id AND connection.user_high_id = ?)
            OR (connection.user_high_id = journey.user_id AND connection.user_low_id = ?))
        JOIN trusted_connection_preferences AS permission ON permission.connection_id = connection.connection_id
          AND permission.recipient_user_id = ? AND permission.receive_safe_journeys = 1
        WHERE journey.status IN ('active', 'overdue')
        ORDER BY journey.expected_return_at LIMIT 50
      `).bind(userId, userId, userId, userId).all(),
    ]);
    const own = ownResult.results || [];
    const shared = sharedResult.results || [];
    const recipientNames = new Map();
    for (const journey of own) {
      const result = await context.env.DB.prepare(`
        SELECT recipient.user_id, recipient.username
        FROM safe_journeys AS journey
        JOIN safe_journey_recipients AS selected ON selected.journey_id = journey.journey_id
        JOIN users AS recipient ON recipient.user_id = selected.recipient_user_id
          AND recipient.account_status = 'active'
        JOIN trusted_connections AS connection ON connection.connection_status = 'accepted'
          AND ((connection.user_low_id = journey.user_id AND connection.user_high_id = recipient.user_id)
            OR (connection.user_high_id = journey.user_id AND connection.user_low_id = recipient.user_id))
        JOIN trusted_connection_preferences AS permission ON permission.connection_id = connection.connection_id
          AND permission.recipient_user_id = recipient.user_id AND permission.receive_safe_journeys = 1
        WHERE selected.journey_id = ?
        ORDER BY recipient.username
      `).bind(journey.journey_id).all();
      recipientNames.set(journey.journey_id, (result.results || []).map((row) => ({
        userId: row.user_id,
        username: row.username,
      })));
    }
    return jsonResponse({
      journeys: [
        ...own.map((row) => summarizeJourney(row, true, recipientNames.get(row.journey_id) || [])),
        ...shared.map((row) => summarizeJourney(row, false, [])),
      ],
      serverTime: now,
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
    const { request, env } = context;
    const userId = session.user.user_id;
    const attemptBucket = `journey:create:${userId}`;
    if (await isRateLimited(env, attemptBucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many journey starts. Wait a little and try again." } }, 429);
    }
    await recordAttempt(env, attemptBucket, 10);

    const body = await readJsonRequest(request, 8192);
    const recipientUserIds = body.recipientUserIds;
    if (!validUuid(body.clientJourneyId) || !validDuration(body.durationMinutes)
      || !Array.isArray(recipientUserIds) || recipientUserIds.length < 1
      || recipientUserIds.length > MAX_RECIPIENTS
      || recipientUserIds.some((id) => !validUuid(id))
      || new Set(recipientUserIds).size !== recipientUserIds.length
      || recipientUserIds.includes(userId)) {
      return jsonResponse({ error: { code: "INVALID_JOURNEY", message: "Choose a timer from 15 minutes to 24 hours and select at least one trusted person who can receive safety alerts." } }, 400);
    }
    const startedAt = body.startedAt === undefined ? Date.now() : body.startedAt;
    const now = Date.now();
    if (!Number.isSafeInteger(startedAt) || startedAt > now + 60_000 || startedAt < now - 7 * 24 * 60 * 60_000) {
      return jsonResponse({ error: { code: "INVALID_JOURNEY_TIME", message: "The saved start time is too old or not valid. Start a new Safe Journey." } }, 400);
    }
    const existing = await env.DB.prepare(`
      SELECT journey.*, user.username
      FROM safe_journeys AS journey JOIN users AS user ON user.user_id = journey.user_id
      WHERE journey.user_id = ? AND journey.client_journey_id = ?
    `).bind(userId, body.clientJourneyId).first();
    if (existing) return jsonResponse({ journey: summarizeJourney(existing, true, []), idempotentReplay: true });

    const active = await env.DB.prepare(`SELECT journey_id FROM safe_journeys
      WHERE user_id = ? AND status IN ('active', 'overdue') LIMIT 1`).bind(userId).first();
    if (active) {
      return jsonResponse({ error: { code: "JOURNEY_ALREADY_OPEN", message: "You already have a journey in progress. Finish it before starting another." } }, 409);
    }
    for (const recipientUserId of recipientUserIds) {
      const permitted = await env.DB.prepare(`
        SELECT 1 AS permitted FROM trusted_connections AS connection
        JOIN users AS recipient ON recipient.user_id = ? AND recipient.account_status = 'active'
        JOIN trusted_connection_preferences AS permission
          ON permission.connection_id = connection.connection_id
          AND permission.recipient_user_id = recipient.user_id AND permission.receive_safe_journeys = 1
        WHERE connection.connection_status = 'accepted'
          AND ((connection.user_low_id = ? AND connection.user_high_id = recipient.user_id)
            OR (connection.user_high_id = ? AND connection.user_low_id = recipient.user_id))
        LIMIT 1
      `).bind(recipientUserId, userId, userId).first();
      if (!permitted) {
        return jsonResponse({ error: { code: "RECIPIENT_NOT_ALLOWED", message: "A selected trusted person is no longer available for safety alerts. Refresh your list and try again." } }, 403);
      }
    }

    const journeyId = crypto.randomUUID();
    const dueAt = startedAt + body.durationMinutes * 60_000;
    const statements = [env.DB.prepare(`
      INSERT INTO safe_journeys (
        journey_id, client_journey_id, user_id, status, started_at,
        expected_return_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `).bind(journeyId, body.clientJourneyId, userId, startedAt, dueAt, now, now)];
    for (const recipientUserId of recipientUserIds) {
      statements.push(env.DB.prepare(`
        INSERT INTO safe_journey_recipients (journey_id, recipient_user_id, created_at)
        SELECT ?, recipient.user_id, ? FROM users AS recipient
        JOIN trusted_connections AS connection ON connection.connection_status = 'accepted'
          AND ((connection.user_low_id = ? AND connection.user_high_id = recipient.user_id)
            OR (connection.user_high_id = ? AND connection.user_low_id = recipient.user_id))
        JOIN trusted_connection_preferences AS permission
          ON permission.connection_id = connection.connection_id
          AND permission.recipient_user_id = recipient.user_id AND permission.receive_safe_journeys = 1
        WHERE recipient.user_id = ? AND recipient.account_status = 'active'
      `).bind(journeyId, now, userId, userId, recipientUserId));
    }
    statements.push(env.DB.prepare(`
      INSERT INTO safe_journey_events (
        event_id, event_key, journey_id, actor_user_id, event_type,
        expected_return_at, client_occurred_at, created_at
      ) VALUES (?, ?, ?, ?, 'started', ?, ?, ?)
    `).bind(crypto.randomUUID(), `journey-started:${journeyId}`, journeyId, userId, dueAt, startedAt, now));
    statements.push(env.DB.prepare(`
      INSERT INTO notification_events (
        event_id, event_key, user_id, category, delivery_status, created_at,
        updated_at, related_resource_id
      ) SELECT lower(hex(randomblob(16))), 'journey-started:' || journey.journey_id || ':' || recipient.recipient_user_id,
        recipient.recipient_user_id, 'journey_started', 'prepared', ?, ?, journey.journey_id
      FROM safe_journeys AS journey
      JOIN safe_journey_recipients AS recipient ON recipient.journey_id = journey.journey_id
      JOIN users AS user ON user.user_id = recipient.recipient_user_id AND user.account_status = 'active'
      LEFT JOIN notification_preferences AS preference ON preference.user_id = user.user_id
      WHERE journey.journey_id = ? AND COALESCE(preference.safe_journeys_enabled, 1) = 1
      ON CONFLICT (event_key) DO NOTHING
    `).bind(now, now, journeyId));
    const results = await env.DB.batch(statements);
    if (results[0]?.meta?.changes !== 1
      || results.slice(1, 1 + recipientUserIds.length).some((result) => result?.meta?.changes !== 1)) {
      return jsonResponse({ error: { code: "JOURNEY_NOT_STARTED", message: "The journey could not be started. Refresh your trusted people and try again." } }, 409);
    }
    return jsonResponse({
      journey: {
        journeyId,
        userId,
        username: session.user.username,
        status: "active",
        startedAt,
        expectedReturnAt: dueAt,
        overdueAt: null,
        completedAt: null,
        isOwner: true,
        recipientNames: [],
      },
      idempotentReplay: false,
      message: "Safe Journey started. Your selected trusted people can see the timer. Their device may not show an alert unless notifications are enabled.",
    }, 201);
  } catch (error) {
    return safeError(error);
  }
}

function summarizeJourney(row, isOwner, recipientNames) {
  return {
    journeyId: row.journey_id,
    userId: row.user_id,
    username: row.username,
    status: row.status,
    startedAt: row.started_at,
    expectedReturnAt: row.expected_return_at,
    overdueAt: row.overdue_at,
    completedAt: row.completed_at,
    completionAttemptedAt: row.completion_attempted_at,
    isOwner,
    recipientNames,
  };
}
