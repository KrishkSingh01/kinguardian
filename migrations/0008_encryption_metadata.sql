PRAGMA foreign_keys = ON;

-- The wrapped data key is encrypted in the browser with a user-held passphrase.
-- The unwrapped key is never sent to D1 or stored in a Worker secret.
CREATE TABLE encryption_metadata (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  wrapping_algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM'
    CHECK (wrapping_algorithm = 'AES-256-GCM'),
  kdf_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-HMAC-SHA-256'
    CHECK (kdf_algorithm = 'PBKDF2-HMAC-SHA-256'),
  kdf_iterations INTEGER NOT NULL CHECK (kdf_iterations >= 600000),
  kdf_salt BLOB NOT NULL CHECK (length(kdf_salt) >= 16),
  wrapped_key BLOB NOT NULL,
  wrapping_iv BLOB NOT NULL CHECK (length(wrapping_iv) = 12),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_private_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  profile_ciphertext BLOB NOT NULL,
  profile_iv BLOB NOT NULL CHECK (length(profile_iv) = 12),
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE recovery_codes (
  recovery_code_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  code_hash BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  UNIQUE (user_id, code_hash)
);
