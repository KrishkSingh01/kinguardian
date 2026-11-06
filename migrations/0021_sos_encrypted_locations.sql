PRAGMA foreign_keys = ON;

-- The original SOS schema already contains the encrypted payload and IV.
-- Add only the point timestamp needed by the live-location update path.
ALTER TABLE sos_alerts ADD COLUMN location_time INTEGER;

CREATE TRIGGER sos_location_point_valid_insert
BEFORE INSERT ON sos_alerts
WHEN NEW.location_time IS NOT NULL AND (
  typeof(NEW.location_time) <> 'integer' OR NEW.location_time <= 0
  OR NEW.location_ciphertext IS NULL OR length(NEW.location_ciphertext) NOT BETWEEN 17 AND 4096
  OR NEW.location_iv IS NULL OR length(NEW.location_iv) <> 12
)
BEGIN
  SELECT RAISE(ABORT, 'SOS location point is invalid');
END;

CREATE TRIGGER sos_location_point_valid_update
BEFORE UPDATE OF location_time, location_ciphertext, location_iv ON sos_alerts
WHEN NEW.location_time IS NOT NULL AND (
  typeof(NEW.location_time) <> 'integer' OR NEW.location_time <= 0
  OR NEW.location_ciphertext IS NULL OR length(NEW.location_ciphertext) NOT BETWEEN 17 AND 4096
  OR NEW.location_iv IS NULL OR length(NEW.location_iv) <> 12
)
BEGIN
  SELECT RAISE(ABORT, 'SOS location point is invalid');
END;
