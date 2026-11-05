PRAGMA foreign_keys = ON;

CREATE TABLE sos_alerts (
  alert_id TEXT PRIMARY KEY,
  client_alert_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  test_mode INTEGER NOT NULL DEFAULT 0 CHECK (test_mode IN (0, 1)),
  alert_status TEXT NOT NULL DEFAULT 'accepted_by_server'
    CHECK (alert_status IN ('accepted_by_server', 'notification_attempted', 'recipient_acknowledged', 'resolved', 'closed')),
  created_at INTEGER NOT NULL,
  client_created_at INTEGER,
  sender_timezone TEXT NOT NULL,
  location_ciphertext BLOB,
  location_iv BLOB CHECK (location_iv IS NULL OR length(location_iv) = 12),
  location_key_version INTEGER CHECK (location_key_version IS NULL OR location_key_version > 0),
  location_updated_at INTEGER,
  resolved_at INTEGER,
  closed_at INTEGER,
  UNIQUE (sender_user_id, client_alert_id),
  CHECK (
    (location_ciphertext IS NULL AND location_iv IS NULL)
    OR (location_ciphertext IS NOT NULL AND location_iv IS NOT NULL)
  )
);

CREATE INDEX sos_alerts_by_sender_time ON sos_alerts (sender_user_id, created_at DESC);
CREATE INDEX sos_alerts_pending ON sos_alerts (alert_status, created_at)
  WHERE alert_status NOT IN ('resolved', 'closed');

CREATE TABLE sos_alert_recipients (
  alert_recipient_id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES sos_alerts(alert_id) ON DELETE CASCADE,
  recipient_user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  external_contact_id TEXT REFERENCES external_contacts(contact_id) ON DELETE CASCADE,
  recipient_status TEXT NOT NULL DEFAULT 'selected'
    CHECK (recipient_status IN ('selected', 'prepared', 'notification_attempted', 'acknowledged', 'resolved', 'failed', 'unknown')),
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  CHECK ((recipient_user_id IS NULL) <> (external_contact_id IS NULL)),
  UNIQUE (alert_id, recipient_user_id),
  UNIQUE (alert_id, external_contact_id)
);

CREATE INDEX sos_recipients_by_user ON sos_alert_recipients (recipient_user_id, recipient_status);

CREATE TABLE sos_acknowledgements (
  acknowledgement_id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES sos_alerts(alert_id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  acknowledged_at INTEGER NOT NULL,
  UNIQUE (alert_id, recipient_user_id)
);
