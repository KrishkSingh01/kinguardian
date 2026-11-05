PRAGMA foreign_keys = ON;

CREATE TABLE safety_checkins (
  checkin_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'safe', 'cancelled', 'overdue')),
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  scheduled_for_utc INTEGER NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 240),
  reminder_at_utc INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  safe_at INTEGER,
  cancelled_at INTEGER,
  overdue_at INTEGER,
  idempotency_key TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX safety_checkins_due
  ON safety_checkins (status, scheduled_for_utc, grace_minutes)
  WHERE status = 'pending';
CREATE INDEX safety_checkins_by_user ON safety_checkins (user_id, scheduled_for_utc DESC);

CREATE TABLE safety_checkin_recipients (
  recipient_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkin_id TEXT NOT NULL REFERENCES safety_checkins(checkin_id) ON DELETE CASCADE,
  recipient_user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  external_contact_id TEXT REFERENCES external_contacts(contact_id) ON DELETE CASCADE,
  CHECK ((recipient_user_id IS NULL) <> (external_contact_id IS NULL))
);

CREATE INDEX checkin_recipients_by_user ON safety_checkin_recipients (recipient_user_id);
CREATE UNIQUE INDEX one_user_recipient_per_checkin
  ON safety_checkin_recipients (checkin_id, recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;
CREATE UNIQUE INDEX one_external_recipient_per_checkin
  ON safety_checkin_recipients (checkin_id, external_contact_id)
  WHERE external_contact_id IS NOT NULL;
