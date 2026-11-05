PRAGMA foreign_keys = ON;

CREATE TABLE push_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  endpoint_hash BLOB NOT NULL UNIQUE,
  p256dh_key BLOB NOT NULL,
  auth_secret BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  last_success_at INTEGER,
  disabled_at INTEGER
);

CREATE INDEX push_subscriptions_by_user ON push_subscriptions (user_id, disabled_at);

CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  sos_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sos_enabled IN (0, 1)),
  invitations_enabled INTEGER NOT NULL DEFAULT 1 CHECK (invitations_enabled IN (0, 1)),
  checkin_reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (checkin_reminders_enabled IN (0, 1)),
  missed_checkins_enabled INTEGER NOT NULL DEFAULT 1 CHECK (missed_checkins_enabled IN (0, 1)),
  acknowledgements_enabled INTEGER NOT NULL DEFAULT 1 CHECK (acknowledgements_enabled IN (0, 1)),
  account_security_enabled INTEGER NOT NULL DEFAULT 1 CHECK (account_security_enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

-- event_key is a deterministic idempotency key, so retries cannot create
-- duplicate missed-check-in notifications.
CREATE TABLE notification_events (
  event_id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  checkin_id TEXT REFERENCES safety_checkins(checkin_id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'sos', 'invitation', 'checkin_reminder', 'missed_checkin',
    'acknowledgement', 'account_security', 'test'
  )),
  delivery_status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (delivery_status IN ('prepared', 'attempted', 'provider_accepted', 'delivery_confirmed', 'failed', 'unknown')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (category <> 'missed_checkin' OR checkin_id IS NOT NULL)
);

CREATE INDEX notification_events_by_user_time ON notification_events (user_id, created_at DESC);
CREATE INDEX notification_events_by_status ON notification_events (delivery_status, created_at);
