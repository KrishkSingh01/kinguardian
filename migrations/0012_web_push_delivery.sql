PRAGMA foreign_keys = ON;

-- These fields track push fan-out without storing notification text or location.
ALTER TABLE notification_events ADD COLUMN related_resource_id TEXT;
ALTER TABLE notification_events ADD COLUMN fanout_at INTEGER;

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

CREATE INDEX notification_deliveries_due
  ON notification_deliveries (delivery_status, next_attempt_at, created_at);
CREATE INDEX notification_deliveries_by_event
  ON notification_deliveries (event_id, delivery_status);
