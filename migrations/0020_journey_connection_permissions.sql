PRAGMA foreign_keys = ON;

ALTER TABLE trusted_connection_preferences
  ADD COLUMN receive_safe_journeys INTEGER NOT NULL DEFAULT 0
  CHECK (receive_safe_journeys IN (0, 1));
