PRAGMA foreign_keys = ON;

-- Version the encrypted contact envelope. Its client-side JSON stores optional
-- phone, email, and WhatsApp methods independently; phone values use E.164.
ALTER TABLE external_contacts
  ADD COLUMN payload_format INTEGER NOT NULL DEFAULT 1 CHECK (payload_format >= 1);

CREATE INDEX external_contacts_by_payload
  ON external_contacts (owner_user_id, payload_format, updated_at DESC);
