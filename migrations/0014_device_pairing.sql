PRAGMA foreign_keys = ON;

-- A short-lived request is approved by a signed-in device before it can create a session.
CREATE TABLE device_pairing_requests (
  pairing_id TEXT PRIMARY KEY,
  token_hash BLOB NOT NULL UNIQUE,
  approved_user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  redeemed_at INTEGER,
  revoked_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK ((approved_user_id IS NULL AND approved_at IS NULL) OR
         (approved_user_id IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE INDEX device_pairing_requests_by_expiry
  ON device_pairing_requests (expires_at);
