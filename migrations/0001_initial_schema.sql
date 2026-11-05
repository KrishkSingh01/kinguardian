PRAGMA foreign_keys = ON;

-- Accounts contain authentication material only. Passwords are never stored.
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'disabled')),
  password_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-HMAC-SHA-256'
    CHECK (password_algorithm = 'PBKDF2-HMAC-SHA-256'),
  password_iterations INTEGER NOT NULL DEFAULT 600000
    CHECK (password_iterations BETWEEN 600000 AND 1200000),
  password_hash BLOB NOT NULL,
  password_salt BLOB NOT NULL,
  password_changed_at INTEGER,
  must_change_password INTEGER NOT NULL DEFAULT 1
    CHECK (must_change_password IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  disabled_at INTEGER
);

-- A partial unique index prevents a second owner account, even if the first
-- owner account is later disabled.
CREATE UNIQUE INDEX one_owner_account
  ON users (role)
  WHERE role = 'owner';

CREATE TABLE owner_bootstrap (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  consumed_at INTEGER,
  created_owner_user_id TEXT REFERENCES users(user_id) ON DELETE RESTRICT
);

INSERT INTO owner_bootstrap (singleton_id, consumed_at, created_owner_user_id)
VALUES (1, NULL, NULL);

-- The browser receives a random session token. Only its SHA-256 hash is stored.
CREATE TABLE sessions (
  session_token_hash BLOB PRIMARY KEY,
  csrf_token_hash BLOB NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_by_user_expiry ON sessions (user_id, expires_at);

-- Rate-limit buckets use a keyed hash of client and account identifiers, not raw IPs.
CREATE TABLE auth_rate_limits (
  bucket_hash BLOB PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  blocked_until INTEGER
);

CREATE TABLE owner_audit_events (
  event_id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'account_created', 'account_disabled', 'account_reactivated',
    'sessions_revoked', 'password_reset_issued', 'invitation_created',
    'invitation_revoked', 'owner_bootstrapped'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  occurred_at INTEGER NOT NULL
);

CREATE INDEX owner_audit_by_time ON owner_audit_events (occurred_at DESC);
