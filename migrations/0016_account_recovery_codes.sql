-- Recovery codes are random one-time credentials. Store only their SHA-256 hashes.
CREATE TABLE account_recovery_codes (
  recovery_code_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  code_hash BLOB NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX account_recovery_codes_by_user
  ON account_recovery_codes (user_id, used_at);
