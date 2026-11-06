PRAGMA foreign_keys = ON;

-- Safe Journeys replace daily check-ins in the new app. Old check-in data stays
-- intact so existing history is not destroyed.
CREATE TABLE safe_journeys (
  journey_id TEXT PRIMARY KEY,
  client_journey_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'overdue', 'completed')),
  started_at INTEGER NOT NULL,
  expected_return_at INTEGER NOT NULL,
  overdue_at INTEGER,
  completed_at INTEGER,
  completion_attempted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, client_journey_id),
  CHECK (expected_return_at > started_at),
  CHECK ((status = 'active' AND overdue_at IS NULL AND completed_at IS NULL)
      OR (status = 'overdue' AND overdue_at IS NOT NULL AND completed_at IS NULL)
      OR (status = 'completed' AND completed_at IS NOT NULL))
);

CREATE UNIQUE INDEX safe_journeys_one_open_per_user
  ON safe_journeys(user_id) WHERE status IN ('active', 'overdue');
CREATE INDEX safe_journeys_due
  ON safe_journeys(status, expected_return_at, journey_id);
CREATE INDEX safe_journeys_by_user_time
  ON safe_journeys(user_id, started_at DESC);

CREATE TABLE safe_journey_recipients (
  journey_id TEXT NOT NULL REFERENCES safe_journeys(journey_id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (journey_id, recipient_user_id)
);

CREATE INDEX safe_journey_recipients_by_user
  ON safe_journey_recipients(recipient_user_id, journey_id);

CREATE TABLE safe_journey_events (
  event_id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  journey_id TEXT NOT NULL REFERENCES safe_journeys(journey_id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'extended', 'overdue', 'completed')),
  previous_expected_at INTEGER,
  expected_return_at INTEGER,
  client_occurred_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX safe_journey_events_by_journey
  ON safe_journey_events(journey_id, created_at DESC);

-- Expand the existing push event types without losing notification or delivery
-- history, and add a read marker for the in-app notification centre.
ALTER TABLE notification_events RENAME TO notification_events_before_journeys;
ALTER TABLE notification_deliveries RENAME TO notification_deliveries_before_journeys;

CREATE TABLE notification_events (
  event_id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  checkin_id TEXT REFERENCES safety_checkins(checkin_id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'sos', 'invitation', 'checkin_reminder', 'missed_checkin',
    'acknowledgement', 'account_security', 'test',
    'journey_started', 'journey_extended', 'journey_completed', 'journey_overdue'
  )),
  delivery_status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (delivery_status IN ('prepared', 'attempted', 'provider_accepted', 'delivery_confirmed', 'failed', 'unknown')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  related_resource_id TEXT,
  fanout_at INTEGER,
  read_at INTEGER,
  CHECK (category <> 'missed_checkin' OR checkin_id IS NOT NULL)
);

INSERT INTO notification_events (
  event_id, event_key, user_id, checkin_id, category, delivery_status,
  created_at, updated_at, related_resource_id, fanout_at, read_at
)
SELECT event_id, event_key, user_id, checkin_id, category, delivery_status,
       created_at, updated_at, related_resource_id, fanout_at, NULL
FROM notification_events_before_journeys;

CREATE TABLE notification_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES notification_events(event_id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(subscription_id) ON DELETE CASCADE,
  delivery_status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (delivery_status IN ('prepared', 'attempted', 'provider_accepted', 'failed', 'unknown', 'suppressed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  claim_expires_at INTEGER,
  attempted_at INTEGER,
  provider_accepted_at INTEGER,
  last_error_category TEXT
    CHECK (last_error_category IS NULL OR last_error_category IN ('retryable', 'permanent', 'configuration')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (event_id, subscription_id)
);

INSERT INTO notification_deliveries (
  delivery_id, event_id, subscription_id, delivery_status, attempt_count,
  next_attempt_at, claim_expires_at, attempted_at, provider_accepted_at,
  last_error_category, created_at, updated_at
)
SELECT delivery_id, event_id, subscription_id, delivery_status, attempt_count,
       next_attempt_at, claim_expires_at, attempted_at, provider_accepted_at,
       last_error_category, created_at, updated_at
FROM notification_deliveries_before_journeys;

DROP TABLE notification_deliveries_before_journeys;
DROP TABLE notification_events_before_journeys;

CREATE INDEX notification_events_by_user_time ON notification_events (user_id, created_at DESC);
CREATE INDEX notification_events_by_status ON notification_events (delivery_status, created_at);
CREATE INDEX notification_deliveries_due
  ON notification_deliveries (delivery_status, next_attempt_at, created_at);
CREATE INDEX notification_deliveries_by_event
  ON notification_deliveries (event_id, delivery_status);

ALTER TABLE notification_preferences
  ADD COLUMN safe_journeys_enabled INTEGER NOT NULL DEFAULT 1 CHECK (safe_journeys_enabled IN (0, 1));
