const MAX_JOURNEYS_PER_TICK = 50;

export async function markDueJourneysOverdue(DB, now = Date.now()) {
  const due = await DB.prepare(`SELECT journey_id, user_id, expected_return_at
    FROM safe_journeys WHERE status = 'active' AND expected_return_at <= ?
    ORDER BY expected_return_at, journey_id LIMIT ?`).bind(now, MAX_JOURNEYS_PER_TICK).all();
  let changed = 0;

  for (const journey of due.results || []) {
    // D1 runs a batch as a transaction. The state change and its event records
    // therefore commit together, so a failed notification insert cannot leave
    // an overdue journey with no retryable alert event.
    const results = await DB.batch([
      DB.prepare(`UPDATE safe_journeys SET status = 'overdue', overdue_at = ?, updated_at = ?
        WHERE journey_id = ? AND status = 'active' AND expected_return_at <= ?`)
        .bind(now, now, journey.journey_id, now),
      DB.prepare(`INSERT INTO safe_journey_events (
        event_id, event_key, journey_id, actor_user_id, event_type,
        expected_return_at, created_at
      ) SELECT lower(hex(randomblob(16))), ?, ?, ?, 'overdue', ?, ?
      FROM safe_journeys AS journey
      WHERE journey.journey_id = ? AND journey.status = 'overdue' AND journey.overdue_at = ?
        AND changes() = 1
      ON CONFLICT (event_key) DO NOTHING`)
        .bind(`journey-overdue:${journey.journey_id}`, journey.journey_id, journey.user_id,
          journey.expected_return_at, now, journey.journey_id, now),
      DB.prepare(`INSERT INTO notification_events (
        event_id, event_key, user_id, category, delivery_status,
        created_at, updated_at, related_resource_id
      ) SELECT lower(hex(randomblob(16))), 'journey-overdue:' || journey.journey_id || ':' || recipient.recipient_user_id,
        recipient.recipient_user_id, 'journey_overdue', 'prepared', ?, ?, journey.journey_id
      FROM safe_journeys AS journey
      JOIN safe_journey_events AS overdue_event ON overdue_event.journey_id = journey.journey_id
        AND overdue_event.event_key = 'journey-overdue:' || journey.journey_id
      JOIN safe_journey_recipients AS recipient ON recipient.journey_id = journey.journey_id
      JOIN users AS target ON target.user_id = recipient.recipient_user_id AND target.account_status = 'active'
      JOIN trusted_connections AS connection ON connection.connection_status = 'accepted'
        AND ((connection.user_low_id = journey.user_id AND connection.user_high_id = target.user_id)
          OR (connection.user_high_id = journey.user_id AND connection.user_low_id = target.user_id))
      JOIN trusted_connection_preferences AS permission ON permission.connection_id = connection.connection_id
        AND permission.recipient_user_id = target.user_id AND permission.receive_safe_journeys = 1
      LEFT JOIN notification_preferences AS preference ON preference.user_id = target.user_id
      WHERE journey.journey_id = ? AND journey.status = 'overdue'
        AND COALESCE(preference.safe_journeys_enabled, 1) = 1
      ON CONFLICT (event_key) DO NOTHING`).bind(now, now, journey.journey_id),
      DB.prepare(`INSERT INTO notification_events (
        event_id, event_key, user_id, category, delivery_status,
        created_at, updated_at, related_resource_id
      ) SELECT lower(hex(randomblob(16))), 'journey-overdue-owner:' || journey.journey_id,
        journey.user_id, 'journey_overdue', 'prepared', ?, ?, journey.journey_id
      FROM safe_journeys AS journey
      LEFT JOIN notification_preferences AS preference ON preference.user_id = journey.user_id
      WHERE journey.journey_id = ? AND journey.status = 'overdue'
        AND EXISTS (SELECT 1 FROM safe_journey_events AS overdue_event
          WHERE overdue_event.journey_id = journey.journey_id
            AND overdue_event.event_key = 'journey-overdue:' || journey.journey_id)
        AND COALESCE(preference.safe_journeys_enabled, 1) = 1
      ON CONFLICT (event_key) DO NOTHING`).bind(now, now, journey.journey_id),
    ]);
    if (results[0]?.meta?.changes === 1) changed += 1;
  }
  return changed;
}
