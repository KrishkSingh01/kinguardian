import { requireSession } from "../../_shared/auth.js";
import { findEligibleRecipients, isUuid, parseCheckinSchedule, validateRecipientIds } from "../../_shared/checkins.js";
import { jsonResponse, readJsonRequest, requirePost, safeError, RequestError } from "../../_shared/http.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const rows = await context.env.DB.prepare(`
      SELECT s.checkin_id, s.status, s.local_date, s.local_time, s.timezone, s.idempotency_key,
             s.scheduled_for_utc, s.grace_minutes, s.reminder_at_utc,
             s.created_at, s.updated_at, s.safe_at, s.cancelled_at, s.overdue_at,
             r.recipient_user_id, recipient.username AS recipient_username
      FROM safety_checkins AS s
      LEFT JOIN safety_checkin_recipients AS r ON r.checkin_id = s.checkin_id
      LEFT JOIN users AS recipient ON recipient.user_id = r.recipient_user_id
      WHERE s.user_id = ?
      ORDER BY s.scheduled_for_utc DESC
      LIMIT 150
    `).bind(session.user.user_id).all();
    const checkins = new Map();
    for (const row of rows.results || []) {
      let item = checkins.get(row.checkin_id);
      if (!item) {
        item = {
          checkinId: row.checkin_id,
          isDaily: row.idempotency_key.startsWith("daily:"),
          status: row.status,
          localDate: row.local_date,
          localTime: row.local_time,
          timeZone: row.timezone,
          scheduledFor: row.scheduled_for_utc,
          graceMinutes: row.grace_minutes,
          reminderEnabled: row.reminder_at_utc !== null,
          reminderAt: row.reminder_at_utc,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          safeAt: row.safe_at,
          cancelledAt: row.cancelled_at,
          overdueAt: row.overdue_at,
          recipients: [],
        };
        checkins.set(row.checkin_id, item);
      }
      if (row.recipient_user_id) {
        item.recipients.push({ userId: row.recipient_user_id, username: row.recipient_username });
      }
    }
    return jsonResponse({ checkins: [...checkins.values()] });
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
    if (!isUuid(body.idempotencyKey)) {
      throw new RequestError(400, "INVALID_IDEMPOTENCY_KEY", "Refresh the form and try creating the check-in again.");
    }
    const now = Date.now();
    const schedule = parseCheckinSchedule(body, now, { allowPast: true });
    const recipientUserIds = validateRecipientIds(body.recipientUserIds);
    const existing = await context.env.DB.prepare(`
      SELECT checkin_id, status, local_date, local_time, timezone, scheduled_for_utc,
             grace_minutes, reminder_at_utc
      FROM safety_checkins WHERE user_id = ? AND idempotency_key = ?
    `).bind(session.user.user_id, body.idempotencyKey).first();
    if (existing) {
      const existingRecipients = await context.env.DB.prepare(
        "SELECT recipient_user_id FROM safety_checkin_recipients WHERE checkin_id = ?",
      ).bind(existing.checkin_id).all();
      const savedIds = (existingRecipients.results || []).map((row) => row.recipient_user_id).sort();
      const requestedIds = [...recipientUserIds].sort();
      const sameRequest = existing.local_date === schedule.localDate
        && existing.local_time === schedule.localTime && existing.timezone === schedule.timeZone
        && existing.scheduled_for_utc === schedule.scheduledFor
        && existing.grace_minutes === schedule.graceMinutes
        && (existing.reminder_at_utc !== null) === schedule.reminderEnabled
        && savedIds.length === requestedIds.length
        && savedIds.every((id, index) => id === requestedIds[index]);
      if (!sameRequest) {
        throw new RequestError(409, "IDEMPOTENCY_KEY_REUSED", "This form was already used for a different check-in. Refresh and try again.");
      }
      return jsonResponse({ checkinId: existing.checkin_id, status: existing.status, repeated: true });
    }
    if (schedule.scheduledFor <= now + 60_000) {
      throw new RequestError(400, "CHECKIN_OUT_OF_RANGE", "Choose a time at least one minute from now and within the next year.");
    }
    await findEligibleRecipients(context.env.DB, session.user.user_id, recipientUserIds);
    const checkinId = crypto.randomUUID();
    const statements = [context.env.DB.prepare(`
      INSERT INTO safety_checkins (
        checkin_id, user_id, status, local_date, local_time, timezone,
        scheduled_for_utc, grace_minutes, reminder_at_utc, created_at, updated_at, idempotency_key
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, idempotency_key) DO NOTHING
    `).bind(checkinId, session.user.user_id, schedule.localDate, schedule.localTime,
      schedule.timeZone, schedule.scheduledFor, schedule.graceMinutes, schedule.reminderAt,
      now, now, body.idempotencyKey)];

    for (const recipientUserId of recipientUserIds) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO safety_checkin_recipients (checkin_id, recipient_user_id)
        SELECT ?, recipient.user_id
        FROM users AS recipient
        WHERE recipient.user_id = ? AND recipient.account_status = 'active'
          AND changes() = 1
          AND EXISTS (
            SELECT 1 FROM trusted_connections AS c
            JOIN trusted_connection_preferences AS p
              ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
              AND p.receive_missed_checkin = 1
            WHERE c.connection_status = 'accepted'
              AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
                OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
          )
      `).bind(checkinId, recipientUserId, session.user.user_id, session.user.user_id));
    }
    const results = await context.env.DB.batch(statements);
    if (results[0]?.meta?.changes !== 1) {
      const existing = await context.env.DB.prepare(`
        SELECT checkin_id, status, local_date, local_time, timezone, scheduled_for_utc, grace_minutes,
               reminder_at_utc
        FROM safety_checkins WHERE user_id = ? AND idempotency_key = ?
      `).bind(session.user.user_id, body.idempotencyKey).first();
      if (!existing) throw new Error("The check-in could not be saved.");
      const existingRecipients = await context.env.DB.prepare(
        "SELECT recipient_user_id FROM safety_checkin_recipients WHERE checkin_id = ?",
      ).bind(existing.checkin_id).all();
      const savedIds = (existingRecipients.results || []).map((row) => row.recipient_user_id).sort();
      const requestedIds = [...recipientUserIds].sort();
      const sameRequest = existing.local_date === schedule.localDate
        && existing.local_time === schedule.localTime && existing.timezone === schedule.timeZone
        && existing.scheduled_for_utc === schedule.scheduledFor
        && existing.grace_minutes === schedule.graceMinutes
        && (existing.reminder_at_utc !== null) === schedule.reminderEnabled
        && savedIds.length === requestedIds.length
        && savedIds.every((id, index) => id === requestedIds[index]);
      if (!sameRequest) {
        throw new RequestError(409, "IDEMPOTENCY_KEY_REUSED", "This form was already used for a different check-in. Refresh and try again.");
      }
      return jsonResponse({ checkinId: existing.checkin_id, status: existing.status, repeated: true });
    }
    if (results.slice(1).filter((result) => result?.meta?.changes === 1).length !== recipientUserIds.length) {
      await context.env.DB.prepare("DELETE FROM safety_checkins WHERE checkin_id = ? AND user_id = ?")
        .bind(checkinId, session.user.user_id).run();
      return jsonResponse({ error: { code: "CHECKIN_RECIPIENT_CHANGED", message: "A member's consent changed. Refresh your trusted circle and try again." } }, 409);
    }
    return jsonResponse({ checkinId, status: "pending", repeated: false }, 201);
  } catch (error) {
    return safeError(error);
  }
}
