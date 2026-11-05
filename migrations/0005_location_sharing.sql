PRAGMA foreign_keys = ON;

CREATE TABLE location_shares (
  share_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  share_status TEXT NOT NULL DEFAULT 'active'
    CHECK (share_status IN ('active', 'stopped', 'expired')),
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  stopped_at INTEGER,
  CHECK (expires_at > started_at)
);

CREATE INDEX location_shares_expiry ON location_shares (share_status, expires_at);
CREATE INDEX location_shares_by_owner ON location_shares (owner_user_id, share_status);

CREATE TABLE location_share_recipients (
  share_id TEXT NOT NULL REFERENCES location_shares(share_id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, recipient_user_id)
);

CREATE TABLE encrypted_location_data (
  share_id TEXT PRIMARY KEY REFERENCES location_shares(share_id) ON DELETE CASCADE,
  location_ciphertext BLOB NOT NULL,
  location_iv BLOB NOT NULL CHECK (length(location_iv) = 12),
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  updated_at INTEGER NOT NULL
);
