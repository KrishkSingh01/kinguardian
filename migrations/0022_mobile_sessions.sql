PRAGMA foreign_keys = ON;

-- A native app receives a short-lived session token plus one opaque,
-- single-use refresh token. Only refresh-token hashes are stored here.
CREATE TABLE mobile_refresh_tokens (
  refresh_token_hash BLOB PRIMARY KEY
    CHECK (typeof(refresh_token_hash) = 'blob' AND length(refresh_token_hash) = 32),
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_token_hash BLOB NOT NULL UNIQUE
    REFERENCES sessions(session_token_hash) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  replaced_by_hash BLOB,
  CHECK (expires_at > created_at),
  CHECK (replaced_by_hash IS NULL OR length(replaced_by_hash) = 32)
);

CREATE INDEX mobile_refresh_tokens_by_family ON mobile_refresh_tokens(family_id);
CREATE INDEX mobile_refresh_tokens_by_user_expiry ON mobile_refresh_tokens(user_id, expires_at);
