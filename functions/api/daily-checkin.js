import { requireSession } from "../_shared/auth.js";
import { findEligibleRecipients, parseDailyCheckinSchedule, validateRecipientIds } from "../_shared/checkins.js";
import { jsonResponse, readJsonRequest, requirePost, safeError, RequestError } from "../_shared/http.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const setting = await context.env.DB.prepare(`
      SELECT enabled, local_time, timezone, grace_minutes, reminder_enabled,
             next_local_date, next_local_time, next_checkin_at_utc, updated_at
      FROM daily_checkin_settings WHERE user_id = ?
    `).bind(session.user.user_id).first();
    if (!setting) return jsonResponse({ dailyCheckin: null });
    const recipients = await context.env.DB.prepare(
      "SELECT recipient_user_id FROM daily_checkin_recipients WHERE user_id = ? ORDER BY recipient_user_id",
    ).bind(session.user.user_id).all();
    return jsonResponse({
      dailyCheckin: {
        enabled: setting.enabled === 1,
        localTime: setting.local_time,
        timeZone: setting.timezone,
        graceMinutes: setting.grace_minutes,
        reminderEnabled: setting.reminder_enabled === 1,
        nextLocalDate: setting.next_local_date,
        nextLocalTime: setting.next_local_time,
        nextCheckinAt: setting.next_checkin_at_utc,
        updatedAt: setting.updated_at,
        recipientUserIds: (recipients.results || []).map((row) => row.recipient_user_id),
      },
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
    if (typeof body.enabled !== "boolean") {
      throw new RequestError(400, "INVALID_DAILY_CHECKIN", "Choose whether daily check-ins are enabled.");
    }
    const schedule = parseDailyCheckinSchedule(body);
    const recipientUserIds = body.enabled
      ? validateRecipientIds(body.recipientUserIds)
      : [];
    if (body.enabled) await findEligibleRecipients(context.env.DB, session.user.user_id, recipientUserIds);

    const now = Date.now();
    const DB = context.env.DB;
    const statements = [DB.prepare(`
      INSERT INTO daily_checkin_settings (
        user_id, enabled, local_time, timezone, grace_minutes, reminder_enabled,
        next_local_date, next_local_time, next_checkin_at_utc, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        enabled = excluded.enabled,
        local_time = excluded.local_time,
        timezone = excluded.timezone,
        grace_minutes = excluded.grace_minutes,
        reminder_enabled = excluded.reminder_enabled,
        next_local_date = excluded.next_local_date,
        next_local_time = excluded.next_local_time,
        next_checkin_at_utc = excluded.next_checkin_at_utc,
        updated_at = excluded.updated_at
    `).bind(session.user.user_id, schedule.enabled ? 1 : 0, schedule.localTime, schedule.timeZone,
      schedule.graceMinutes, schedule.reminderEnabled ? 1 : 0,
      schedule.nextLocalDate, schedule.nextLocalTime, schedule.nextCheckinAt, now),
    DB.prepare("DELETE FROM daily_checkin_recipients WHERE user_id = ?").bind(session.user.user_id)];

    for (const recipientUserId of recipientUserIds) {
      statements.push(DB.prepare(`
        INSERT INTO daily_checkin_recipients (user_id, recipient_user_id, created_at)
        SELECT ?, recipient.user_id, ?
        FROM users AS recipient
        WHERE recipient.user_id = ? AND recipient.account_status = 'active'
          AND EXISTS (
            SELECT 1 FROM trusted_connections AS c
            JOIN trusted_connection_preferences AS p
              ON p.connection_id = c.connection_id
              AND p.recipient_user_id = recipient.user_id AND p.receive_missed_checkin = 1
            WHERE c.connection_status = 'accepted'
              AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
                OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
          )
      `).bind(session.user.user_id, now, recipientUserId, session.user.user_id, session.user.user_id));
    }
    const results = await DB.batch(statements);
    const insertedRecipientCount = results.slice(2).filter((result) => result?.meta?.changes === 1).length;
    if (body.enabled && insertedRecipientCount !== recipientUserIds.length) {
      await DB.batch([
        DB.prepare(`UPDATE daily_checkin_settings
          SET enabled = 0, next_local_date = NULL, next_local_time = NULL, next_checkin_at_utc = NULL, updated_at = ?
          WHERE user_id = ?`).bind(now, session.user.user_id),
        DB.prepare("DELETE FROM daily_checkin_recipients WHERE user_id = ?").bind(session.user.user_id),
      ]);
      throw new RequestError(409, "CHECKIN_RECIPIENT_CHANGED", "A member's consent changed. The daily schedule was paused. Refresh your trusted circle and try again.");
    }
    return jsonResponse({ dailyCheckin: { ...schedule, recipientUserIds } });
  } catch (error) {
    return safeError(error);
  }
}
