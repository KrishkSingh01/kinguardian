PRAGMA foreign_keys = ON;

-- Owners share a single-use setup link instead of seeing a member's password.
CREATE TABLE account_setup_tokens (
  token_id TEXT PRIMARY KEY,
  token_hash BLOB NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  issuer_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('account_activation', 'password_reset')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  revoked_at INTEGER,
  CHECK (expires_at > created_at)
);

CREATE INDEX account_setup_tokens_by_user_expiry
  ON account_setup_tokens (user_id, expires_at DESC);

CREATE UNIQUE INDEX one_open_account_setup_token_per_purpose
  ON account_setup_tokens (user_id, purpose)
  WHERE redeemed_at IS NULL AND revoked_at IS NULL;
