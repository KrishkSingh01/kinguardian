PRAGMA foreign_keys = ON;

-- Receiving location is opt-in and starts disabled for existing connections.
ALTER TABLE trusted_connection_preferences
  ADD COLUMN receive_location INTEGER NOT NULL DEFAULT 0 CHECK (receive_location IN (0, 1));

-- Public keys are shared only with accepted connections. Private keys remain
-- encrypted by the user's browser vault before they are stored in D1.
CREATE TABLE user_sharing_keys (
  user_id TEXT PRIMARY KEY REFERENCES encryption_metadata(user_id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  algorithm TEXT NOT NULL CHECK (algorithm = 'ECDH-P256-HKDF-SHA256-AES256-GCM'),
  public_key BLOB NOT NULL CHECK (length(public_key) = 65),
  private_key_ciphertext BLOB NOT NULL CHECK (length(private_key_ciphertext) BETWEEN 64 AND 512),
  private_key_iv BLOB NOT NULL CHECK (length(private_key_iv) = 12),
  created_at INTEGER NOT NULL
);

CREATE TABLE encrypted_location_envelopes (
  share_id TEXT NOT NULL REFERENCES location_shares(share_id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  sender_public_key BLOB NOT NULL CHECK (length(sender_public_key) = 65),
  hkdf_salt BLOB NOT NULL CHECK (length(hkdf_salt) = 32),
  location_ciphertext BLOB NOT NULL CHECK (length(location_ciphertext) BETWEEN 17 AND 4096),
  location_iv BLOB NOT NULL CHECK (length(location_iv) = 12),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, recipient_user_id)
);

CREATE INDEX location_envelopes_by_recipient
  ON encrypted_location_envelopes (recipient_user_id, updated_at DESC);
