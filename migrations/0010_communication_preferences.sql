PRAGMA foreign_keys = ON;

CREATE TABLE communication_attempts (
  attempt_id TEXT PRIMARY KEY,
  alert_recipient_id TEXT NOT NULL REFERENCES sos_alert_recipients(alert_recipient_id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('sms', 'email', 'whatsapp', 'web_push')),
  status TEXT NOT NULL CHECK (status IN (
    'not_configured', 'prepared', 'composer_opened', 'provider_accepted',
    'delivery_confirmed', 'failed', 'unknown'
  )),
  attempted_at INTEGER NOT NULL,
  status_updated_at INTEGER NOT NULL,
  provider_reference_hash BLOB
);

CREATE INDEX communication_attempts_by_recipient
  ON communication_attempts (alert_recipient_id, attempted_at DESC);
