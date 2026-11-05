PRAGMA foreign_keys = ON;

-- Contact details are AES-GCM ciphertext created in the browser. The encrypted
-- payload contains name, relationship, phone/email/WhatsApp, and method settings.
CREATE TABLE external_contacts (
  contact_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 999),
  details_ciphertext BLOB NOT NULL,
  details_iv BLOB NOT NULL CHECK (length(details_iv) = 12),
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX external_contacts_by_owner_priority
  ON external_contacts (owner_user_id, deleted_at, priority);
