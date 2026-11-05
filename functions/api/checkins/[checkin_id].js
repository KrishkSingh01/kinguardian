import { requireSession } from "../../_shared/auth.js";
import { isUuid, parseCheckinSchedule } from "../../_shared/checkins.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const checkinId = context.params.checkin_id;
    if (!isUuid(checkinId)) {
      return jsonResponse({ error: { code: "CHECKIN_NOT_FOUND", message: "That check-in is not available to this account." } }, 404);
    }
    const body = await readJsonRequest(context.request, 8192);
    const DB = context.env.DB;
    const now = Date.now();

    if (body.action === "safe") {
      const results = await DB.batch([
        DB.prepare(`UPDATE safety_checkins SET status = 'safe', safe_at = ?, updated_at = ?
          WHERE checkin_id = ? AND user_id = ? AND status IN ('pending', 'overdue')`)
          .bind(now, now, checkinId, session.user.user_id),
        DB.prepare(`DELETE FROM notification_events
          WHERE checkin_id = ? AND delivery_status = 'prepared'
            AND category IN ('checkin_reminder', 'missed_checkin') AND changes() = 1`)
          .bind(checkinId),
      ]);
      if (results[0]?.meta?.changes === 1) return jsonResponse({ checkinId, status: "safe", safeAt: now });
      const current = await DB.prepare(
        "SELECT status FROM safety_checkins WHERE checkin_id = ? AND user_id = ?",
      ).bind(checkinId, session.user.user_id).first();
      if (!current) return jsonResponse({ error: { code: "CHECKIN_NOT_FOUND", message: "That check-in is not available to this account." } }, 404);
      if (current.status === "safe") return jsonResponse({ checkinId, status: "safe", repeated: true });
      return jsonResponse({ error: { code: "CHECKIN_CANNOT_BE_CONFIRMED", message: "This check-in can no longer be marked safe." } }, 409);
    }

    if (body.action === "cancel") {
      const results = await DB.batch([
        DB.prepare(`UPDATE safety_checkins SET status = 'cancelled', cancelled_at = ?, updated_at = ?
          WHERE checkin_id = ? AND user_id = ? AND status = 'pending'`)
          .bind(now, now, checkinId, session.user.user_id),
        DB.prepare(`DELETE FROM notification_events
          WHERE checkin_id = ? AND delivery_status = 'prepared'
            AND category = 'checkin_reminder' AND changes() = 1`)
          .bind(checkinId),
      ]);
      if (results[0]?.meta?.changes === 1) return jsonResponse({ checkinId, status: "cancelled", cancelledAt: now });
      const current = await DB.prepare(
        "SELECT status FROM safety_checkins WHERE checkin_id = ? AND user_id = ?",
      ).bind(checkinId, session.user.user_id).first();
      if (!current) return jsonResponse({ error: { code: "CHECKIN_NOT_FOUND", message: "That check-in is not available to this account." } }, 404);
      if (current.status === "cancelled") return jsonResponse({ checkinId, status: "cancelled", repeated: true });
      return jsonResponse({ error: { code: "CHECKIN_CANNOT_BE_CANCELLED", message: "Only a pending check-in can be cancelled." } }, 409);
    }

    if (body.action === "edit") {
      const schedule = parseCheckinSchedule(body, now);
      const results = await DB.batch([
        DB.prepare(`UPDATE safety_checkins SET local_date = ?, local_time = ?, timezone = ?,
            scheduled_for_utc = ?, grace_minutes = ?, reminder_at_utc = ?, updated_at = ?
          WHERE checkin_id = ? AND user_id = ? AND status = 'pending' AND scheduled_for_utc > ?
            AND NOT EXISTS (
              SELECT 1 FROM safety_checkin_recipients AS r
              WHERE r.checkin_id = safety_checkins.checkin_id AND NOT EXISTS (
                SELECT 1 FROM users AS recipient
                JOIN trusted_connections AS c ON c.connection_status = 'accepted'
                  AND ((c.user_low_id = safety_checkins.user_id AND c.user_high_id = recipient.user_id)
                    OR (c.user_high_id = safety_checkins.user_id AND c.user_low_id = recipient.user_id))
                JOIN trusted_connection_preferences AS p
                  ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
                  AND p.receive_missed_checkin = 1
                WHERE recipient.user_id = r.recipient_user_id AND recipient.account_status = 'active'
              )
            )`)
          .bind(schedule.localDate, schedule.localTime, schedule.timeZone, schedule.scheduledFor,
            schedule.graceMinutes, schedule.reminderAt, now, checkinId, session.user.user_id, now),
        DB.prepare(`DELETE FROM notification_events
          WHERE checkin_id = ? AND category = 'checkin_reminder'
            AND delivery_status = 'prepared' AND changes() = 1`)
          .bind(checkinId),
      ]);
      if (results[0]?.meta?.changes !== 1) {
        const current = await DB.prepare(
          "SELECT status FROM safety_checkins WHERE checkin_id = ? AND user_id = ?",
        ).bind(checkinId, session.user.user_id).first();
        if (!current) return jsonResponse({ error: { code: "CHECKIN_NOT_FOUND", message: "That check-in is not available to this account." } }, 404);
        return jsonResponse({ error: { code: "CHECKIN_CANNOT_BE_EDITED", message: "This check-in has started, is no longer pending, or a recipient's consent changed. Create a new check-in instead." } }, 409);
      }
      return jsonResponse({ checkinId, status: "pending", updatedAt: now });
    }

    return jsonResponse({ error: { code: "INVALID_CHECKIN_ACTION", message: "Choose a supported check-in action." } }, 400);
  } catch (error) {
    return safeError(error);
  }
}
