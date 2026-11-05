-- Workers supports at most 100,000 PBKDF2 iterations per derivation.
-- Stop rather than delete any existing accounts if this migration is run late.
CREATE TABLE IF NOT EXISTS __kg_0015_users_empty_guard (
  users_must_be_empty INTEGER NOT NULL CHECK (users_must_be_empty = 0)
);

INSERT INTO __kg_0015_users_empty_guard (users_must_be_empty)
SELECT CASE WHEN EXISTS (SELECT 1 FROM users) THEN 1 ELSE 0 END;

DROP TABLE __kg_0015_users_empty_guard;

DROP INDEX one_owner_account;
DROP TABLE users;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'disabled')),
  password_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-HMAC-SHA-256'
    CHECK (password_algorithm = 'PBKDF2-HMAC-SHA-256'),
  password_iterations INTEGER NOT NULL DEFAULT 100000
    CHECK (password_iterations = 100000),
  password_hash BLOB NOT NULL,
  password_salt BLOB NOT NULL,
  password_changed_at INTEGER,
  must_change_password INTEGER NOT NULL DEFAULT 1
    CHECK (must_change_password IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE UNIQUE INDEX one_owner_account
  ON users (role)
  WHERE role = 'owner';
