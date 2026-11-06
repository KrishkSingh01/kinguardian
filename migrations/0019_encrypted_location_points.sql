-- Keep the most recent few points for an active location share.
-- Coordinates are AES-GCM encrypted by the Worker before they reach D1.
CREATE TABLE IF NOT EXISTS location_share_points (
  share_id TEXT NOT NULL,
  location_time INTEGER NOT NULL CHECK (location_time > 0),
  encrypted_point BLOB NOT NULL CHECK (length(encrypted_point) BETWEEN 17 AND 4096),
  iv BLOB NOT NULL CHECK (length(iv) = 12),
  updated_at INTEGER NOT NULL CHECK (updated_at > 0),
  PRIMARY KEY (share_id, location_time),
  FOREIGN KEY (share_id) REFERENCES location_shares(share_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_location_points_share_time
  ON location_share_points(share_id, location_time DESC);
