PRAGMA foreign_keys = ON;

CREATE TABLE daily_checkin_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  local_time TEXT NOT NULL CHECK (local_time GLOB '[01][0-9]:[0-5][0-9]' OR local_time GLOB '2[0-3]:[0-5][0-9]'),
  timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 100),
  grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 240),
  reminder_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminder_enabled IN (0, 1)),
  next_local_date TEXT,
  next_local_time TEXT,
  next_checkin_at_utc INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK ((enabled = 0 AND next_local_date IS NULL AND next_local_time IS NULL AND next_checkin_at_utc IS NULL)
      OR (enabled = 1 AND next_local_date IS NOT NULL AND next_local_time IS NOT NULL AND next_checkin_at_utc IS NOT NULL))
);

CREATE INDEX daily_checkin_due
  ON daily_checkin_settings (next_checkin_at_utc, user_id)
  WHERE enabled = 1;

CREATE TABLE daily_checkin_recipients (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, recipient_user_id),
  CHECK (user_id <> recipient_user_id)
);

CREATE INDEX daily_checkin_recipients_by_recipient
  ON daily_checkin_recipients (recipient_user_id, user_id);
