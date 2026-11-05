import { processPushQueue } from "./push-delivery.js";

async function processScheduledWork(DB, now) {
  await DB.batch([
    DB.prepare(`UPDATE location_shares SET share_status = 'expired', stopped_at = ?
      WHERE share_status = 'active' AND expires_at <= ?`).bind(now, now),
    DB.prepare(`DELETE FROM encrypted_location_envelopes WHERE share_id IN (
      SELECT share_id FROM location_shares WHERE share_status = 'expired'
    )`),
    DB.prepare(`UPDATE safety_checkins
      SET status = 'overdue', overdue_at = ?, updated_at = ?
      WHERE status = 'pending'
        AND scheduled_for_utc + grace_minutes * 60_000 <= ?`).bind(now, now, now),
    DB.prepare(`INSERT INTO notification_events (
        event_id, event_key, user_id, checkin_id, category, delivery_status, created_at, updated_at
      )
      SELECT lower(hex(randomblob(16))), 'checkin-reminder:' || s.checkin_id,
        s.user_id, s.checkin_id, 'checkin_reminder', 'prepared', ?, ?
      FROM safety_checkins AS s
      LEFT JOIN notification_preferences AS preference ON preference.user_id = s.user_id
      WHERE s.status = 'pending' AND s.reminder_at_utc IS NOT NULL AND s.reminder_at_utc <= ?
        AND COALESCE(preference.checkin_reminders_enabled, 1) = 1
      ON CONFLICT (event_key) DO NOTHING`).bind(now, now, now),
    DB.prepare(`INSERT INTO notification_events (
        event_id, event_key, user_id, checkin_id, category, delivery_status, created_at, updated_at
      )
      SELECT lower(hex(randomblob(16))),
        'missed-checkin:' || s.checkin_id || ':' || recipient.user_id,
        recipient.user_id, s.checkin_id, 'missed_checkin', 'prepared', ?, ?
      FROM safety_checkins AS s
      JOIN safety_checkin_recipients AS r ON r.checkin_id = s.checkin_id
      JOIN users AS recipient ON recipient.user_id = r.recipient_user_id
        AND recipient.account_status = 'active'
      JOIN trusted_connections AS c ON c.connection_status = 'accepted'
        AND ((c.user_low_id = s.user_id AND c.user_high_id = recipient.user_id)
          OR (c.user_high_id = s.user_id AND c.user_low_id = recipient.user_id))
      JOIN trusted_connection_preferences AS connection_preference
        ON connection_preference.connection_id = c.connection_id
        AND connection_preference.recipient_user_id = recipient.user_id
        AND connection_preference.receive_missed_checkin = 1
      LEFT JOIN notification_preferences AS notification_preference
        ON notification_preference.user_id = recipient.user_id
      WHERE s.status = 'overdue'
        AND COALESCE(notification_preference.missed_checkins_enabled, 1) = 1
      ON CONFLICT (event_key) DO NOTHING`).bind(now, now),
  ]);
}

export default {
  async scheduled(_event, env, context) {
    context.waitUntil((async () => {
      const now = Date.now();
      await processScheduledWork(env.DB, now);
      await processPushQueue(env, now);
    })());
  },
};

