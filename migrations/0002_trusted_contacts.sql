PRAGMA foreign_keys = ON;

CREATE TABLE trusted_connections (
  connection_id TEXT PRIMARY KEY,
  user_low_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_high_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  connection_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (connection_status IN ('pending', 'accepted', 'rejected', 'removed')),
  requested_by_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  ended_at INTEGER,
  CHECK (user_low_id < user_high_id),
  CHECK (requested_by_user_id IN (user_low_id, user_high_id)),
  UNIQUE (user_low_id, user_high_id)
);

CREATE INDEX trusted_connections_by_low_user
  ON trusted_connections (user_low_id, connection_status);
CREATE INDEX trusted_connections_by_high_user
  ON trusted_connections (user_high_id, connection_status);

-- Each member chooses separately which events they wish to receive from the other.
CREATE TABLE trusted_connection_preferences (
  connection_id TEXT NOT NULL REFERENCES trusted_connections(connection_id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  receive_sos INTEGER NOT NULL DEFAULT 1 CHECK (receive_sos IN (0, 1)),
  receive_missed_checkin INTEGER NOT NULL DEFAULT 1 CHECK (receive_missed_checkin IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, recipient_user_id)
);

-- Token values appear only in invitation links/QR codes. D1 stores only a hash.
CREATE TABLE invitations (
  invitation_id TEXT PRIMARY KEY,
  token_hash BLOB NOT NULL UNIQUE,
  issuer_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  target_user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  invitation_type TEXT NOT NULL CHECK (invitation_type IN ('trusted_connection', 'device_pairing')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  revoked_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (target_user_id IS NULL OR target_user_id <> issuer_user_id)
);

CREATE INDEX invitations_by_issuer ON invitations (issuer_user_id, expires_at);
CREATE INDEX invitations_by_target ON invitations (target_user_id, expires_at);
