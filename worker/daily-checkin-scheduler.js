import { nextDailyCheckinSchedule } from "../functions/_shared/checkins.js";

const MAX_DAILY_SCHEDULES_PER_TICK = 2;
const REMINDER_LEAD_MS = 10 * 60_000;

export async function scheduleDueDailyCheckins(DB, now) {
  const due = await DB.prepare(`
    SELECT user_id, local_time, timezone, grace_minutes, reminder_enabled,
           next_local_date, next_local_time, next_checkin_at_utc
    FROM daily_checkin_settings
    WHERE enabled = 1 AND next_checkin_at_utc <= ?
    ORDER BY next_checkin_at_utc, user_id
    LIMIT ?
  `).bind(now, MAX_DAILY_SCHEDULES_PER_TICK).all();

  for (const setting of due.results || []) {
    let next;
    try {
      next = nextDailyCheckinSchedule(setting.next_local_date, setting.local_time, setting.timezone);
    } catch {
      await DB.prepare(`
        UPDATE daily_checkin_settings
        SET enabled = 0, next_local_date = NULL, next_local_time = NULL,
            next_checkin_at_utc = NULL, updated_at = ?
        WHERE user_id = ? AND next_checkin_at_utc = ?
      `).bind(now, setting.user_id, setting.next_checkin_at_utc).run();
      continue;
    }

    const checkinId = crypto.randomUUID();
    const idempotencyKey = "daily:" + setting.next_local_date;
    const reminderAt = setting.reminder_enabled === 1
      ? setting.next_checkin_at_utc - REMINDER_LEAD_MS
      : null;
    await DB.batch([
      DB.prepare(`
        INSERT INTO safety_checkins (
          checkin_id, user_id, status, local_date, local_time, timezone,
          scheduled_for_utc, grace_minutes, reminder_at_utc, created_at, updated_at, idempotency_key
        )
        SELECT ?, setting.user_id, 'pending', ?, ?, setting.timezone, ?, setting.grace_minutes,
               ?, ?, ?, ?
        FROM daily_checkin_settings AS setting
        WHERE setting.user_id = ? AND setting.enabled = 1
          AND setting.next_local_date = ? AND setting.next_checkin_at_utc = ?
        ON CONFLICT (user_id, idempotency_key) DO NOTHING
      `).bind(checkinId, setting.next_local_date, setting.next_local_time,
        setting.next_checkin_at_utc, reminderAt, now, now, idempotencyKey,
        setting.user_id, setting.next_local_date, setting.next_checkin_at_utc),
      DB.prepare(`
        INSERT OR IGNORE INTO safety_checkin_recipients (checkin_id, recipient_user_id)
        SELECT checkin.checkin_id, recipient.user_id
        FROM daily_checkin_settings AS setting
        JOIN daily_checkin_recipients AS configured ON configured.user_id = setting.user_id
        JOIN users AS recipient ON recipient.user_id = configured.recipient_user_id
          AND recipient.account_status = 'active'
        JOIN safety_checkins AS checkin ON checkin.user_id = setting.user_id
          AND checkin.idempotency_key = ?
        JOIN trusted_connections AS connection ON connection.connection_status = 'accepted'
          AND ((connection.user_low_id = setting.user_id AND connection.user_high_id = recipient.user_id)
            OR (connection.user_high_id = setting.user_id AND connection.user_low_id = recipient.user_id))
        JOIN trusted_connection_preferences AS preference
          ON preference.connection_id = connection.connection_id
          AND preference.recipient_user_id = recipient.user_id
          AND preference.receive_missed_checkin = 1
        WHERE setting.user_id = ? AND setting.enabled = 1
          AND setting.next_local_date = ? AND setting.next_checkin_at_utc = ?
      `).bind(idempotencyKey, setting.user_id, setting.next_local_date, setting.next_checkin_at_utc),
      DB.prepare(`
        UPDATE daily_checkin_settings
        SET next_local_date = ?, next_local_time = ?, next_checkin_at_utc = ?, updated_at = ?
        WHERE user_id = ? AND enabled = 1 AND next_local_date = ? AND next_checkin_at_utc = ?
      `).bind(next.localDate, next.localTime, next.scheduledFor, now,
        setting.user_id, setting.next_local_date, setting.next_checkin_at_utc),
    ]);
  }
}
