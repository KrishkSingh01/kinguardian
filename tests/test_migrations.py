"""Run the D1 SQLite migrations in an isolated, in-memory database."""

from pathlib import Path
import sqlite3


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


def expect_integrity_error(connection: sqlite3.Connection, sql: str, values: tuple) -> None:
    try:
        connection.execute(sql, values)
    except sqlite3.IntegrityError:
        return
    raise AssertionError("Expected a schema constraint to reject this record")


def verify_password_iteration_migration_guard() -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    migration_paths = sorted(MIGRATIONS.glob("*.sql"))
    for migration_path in migration_paths:
        if migration_path.name != "0015_cloudflare_password_iterations.sql":
            connection.executescript(migration_path.read_text(encoding="utf-8"))

    connection.execute(
        """INSERT INTO users (
             user_id, username, role, password_hash, password_salt,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("protected-user", "owner", "owner", b"hash", b"salt", 1, 1),
    )
    connection.execute(
        """INSERT INTO sessions (
             session_token_hash, csrf_token_hash, user_id,
             created_at, expires_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?)""",
        (b"session", b"csrf", "protected-user", 1, 2, 1),
    )
    connection.commit()

    guarded_migration = MIGRATIONS / "0015_cloudflare_password_iterations.sql"
    try:
        connection.executescript(guarded_migration.read_text(encoding="utf-8"))
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Migration 0015 must stop when users exist")

    assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1


def main() -> None:
    verify_password_iteration_migration_guard()
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")

    for migration_path in sorted(MIGRATIONS.glob("*.sql")):
        connection.executescript(migration_path.read_text(encoding="utf-8"))

    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    expected = {
        "users", "owner_bootstrap", "sessions", "auth_rate_limits",
        "owner_audit_events", "trusted_connections",
        "trusted_connection_preferences", "invitations", "external_contacts",
        "sos_alerts", "sos_alert_recipients", "sos_acknowledgements",
        "location_shares", "location_share_recipients", "encrypted_location_data",
        "safety_checkin_recipients", "user_private_profiles",
        "safety_checkins", "push_subscriptions", "notification_preferences",
        "notification_events", "notification_deliveries", "encryption_metadata", "recovery_codes",
        "communication_attempts", "user_sharing_keys", "encrypted_location_envelopes",
        "account_setup_tokens", "device_pairing_requests",
        "account_recovery_codes",
        "daily_checkin_settings", "daily_checkin_recipients",
    }
    missing = expected - tables
    if missing:
        raise AssertionError(f"Missing tables: {sorted(missing)}")

    password_iterations_column = next(
        row for row in connection.execute("PRAGMA table_info(users)")
        if row[1] == "password_iterations"
    )
    if password_iterations_column[4] != "100000":
        raise AssertionError("The account password work-factor default must be 100,000")
    expect_integrity_error(
        connection,
        """INSERT INTO users (
             user_id, username, role, password_iterations, password_hash,
             password_salt, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        ("above-cap", "above-cap", "member", 600000, b"hash", b"salt", 1, 1),
    )

    connection.execute(
        """INSERT INTO users (
             user_id, username, role, password_hash, password_salt,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("user-a", "owner", "owner", b"hash", b"salt", 1, 1),
    )
    expect_integrity_error(
        connection,
        """INSERT INTO users (
             user_id, username, role, password_hash, password_salt,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("user-b", "owner-two", "owner", b"hash", b"salt", 2, 2),
    )
    connection.execute(
        """INSERT INTO users (
             user_id, username, role, password_hash, password_salt,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("user-b", "member", "member", b"hash", b"salt", 2, 2),
    )
    connection.execute(
        """INSERT INTO users (
             user_id, username, role, password_hash, password_salt,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("user-c", "member-two", "member", b"hash", b"salt", 2, 2),
    )

    connection.execute(
        """INSERT INTO account_setup_tokens (
             token_id, token_hash, user_id, issuer_user_id, purpose, created_at, expires_at
           ) VALUES (?, ?, ?, ?, 'account_activation', ?, ?)""",
        ("setup-a", b"setup-token-hash-a", "user-b", "user-a", 3, 1000),
    )
    expect_integrity_error(
        connection,
        """INSERT INTO account_setup_tokens (
             token_id, token_hash, user_id, issuer_user_id, purpose, created_at, expires_at
           ) VALUES (?, ?, ?, ?, 'account_activation', ?, ?)""",
        ("setup-b", b"setup-token-hash-b", "user-b", "user-a", 4, 1000),
    )
    connection.execute(
        "UPDATE account_setup_tokens SET revoked_at = ? WHERE token_id = ?",
        (5, "setup-a"),
    )
    connection.execute(
        """INSERT INTO account_setup_tokens (
             token_id, token_hash, user_id, issuer_user_id, purpose, created_at, expires_at
           ) VALUES (?, ?, ?, ?, 'account_activation', ?, ?)""",
        ("setup-b", b"setup-token-hash-b", "user-b", "user-a", 6, 1000),
    )
    connection.execute(
        """INSERT INTO device_pairing_requests (
             pairing_id, token_hash, created_at, expires_at
           ) VALUES (?, ?, ?, ?)""",
        ("pair-a", b"pair-token-hash-a", 3, 600),
    )
    expect_integrity_error(
        connection,
        """INSERT INTO device_pairing_requests (
             pairing_id, token_hash, approved_at, created_at, expires_at
           ) VALUES (?, ?, ?, ?, ?)""",
        ("pair-b", b"pair-token-hash-b", 4, 3, 600),
    )
    approval = connection.execute(
        """UPDATE device_pairing_requests SET approved_user_id = ?, approved_at = ?
           WHERE pairing_id = ? AND approved_user_id IS NULL AND redeemed_at IS NULL AND revoked_at IS NULL""",
        ("user-a", 5, "pair-a"),
    )
    if approval.rowcount != 1:
        raise AssertionError("A pending device request should approve exactly once")
    replayed_approval = connection.execute(
        """UPDATE device_pairing_requests SET approved_user_id = ?, approved_at = ?
           WHERE pairing_id = ? AND approved_user_id IS NULL AND redeemed_at IS NULL AND revoked_at IS NULL""",
        ("user-b", 6, "pair-a"),
    )
    if replayed_approval.rowcount != 0:
        raise AssertionError("An approved device request must not be approved a second time")
    pairing_redeemed = connection.execute(
        """UPDATE device_pairing_requests SET redeemed_at = ?
           WHERE pairing_id = ? AND approved_user_id IS NOT NULL AND approved_at IS NOT NULL
             AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?""",
        (7, "pair-a", 7),
    )
    pairing_replay = connection.execute(
        """UPDATE device_pairing_requests SET redeemed_at = ?
           WHERE pairing_id = ? AND approved_user_id IS NOT NULL AND approved_at IS NOT NULL
             AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?""",
        (8, "pair-a", 8),
    )
    if pairing_redeemed.rowcount != 1 or pairing_replay.rowcount != 0:
        raise AssertionError("A device pairing token must create at most one session")

    connection.execute(
        """INSERT INTO trusted_connections (
             connection_id, user_low_id, user_high_id, requested_by_user_id, created_at
           ) VALUES (?, ?, ?, ?, ?)""",
        ("connection-a", "user-a", "user-b", "user-a", 3),
    )

    # A single-use invitation must create a connection only when its
    # conditional redemption update changed exactly one row.
    connection.execute(
        """INSERT INTO invitations (
             invitation_id, token_hash, issuer_user_id, invitation_type, created_at, expires_at
           ) VALUES (?, ?, ?, 'trusted_connection', ?, ?)""",
        ("invitation-a", b"token-hash-a", "user-a", 4, 10_000),
    )
    update = connection.execute(
        """UPDATE invitations SET redeemed_at = ?, target_user_id = ?
           WHERE invitation_id = ? AND issuer_user_id = ? AND redeemed_at IS NULL
             AND revoked_at IS NULL AND target_user_id IS NULL AND expires_at > ?
             AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')
             AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND account_status = 'active')""",
        (5, "user-b", "invitation-a", "user-a", 5, "user-b", "user-a"),
    )
    if update.rowcount != 1:
        raise AssertionError("A fresh invitation should redeem exactly once")
    connection.execute(
        """INSERT INTO trusted_connections (
             connection_id, user_low_id, user_high_id, connection_status,
             requested_by_user_id, created_at, accepted_at
           ) SELECT ?, ?, ?, 'accepted', ?, ?, ? WHERE changes() = 1
           ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET
             connection_status = 'accepted', requested_by_user_id = excluded.requested_by_user_id,
             created_at = excluded.created_at, accepted_at = excluded.accepted_at, ended_at = NULL""",
        ("connection-new", "user-a", "user-b", "user-a", 5, 5),
    )
    for recipient_id in ("user-a", "user-b"):
        connection.execute(
            """INSERT INTO trusted_connection_preferences (
                 connection_id, recipient_user_id, receive_sos, receive_missed_checkin, updated_at
               ) SELECT c.connection_id, ?, 0, 0, ? FROM trusted_connections AS c
                 WHERE c.user_low_id = ? AND c.user_high_id = ? AND c.connection_status = 'accepted'
               ON CONFLICT (connection_id, recipient_user_id) DO UPDATE SET
                 receive_sos = 0, receive_missed_checkin = 0, updated_at = excluded.updated_at""",
            (recipient_id, 5, "user-a", "user-b"),
        )
    accepted_preferences = connection.execute(
        "SELECT receive_sos, receive_missed_checkin, receive_location FROM trusted_connection_preferences ORDER BY recipient_user_id"
    ).fetchall()
    if accepted_preferences != [(0, 0, 0), (0, 0, 0)]:
        raise AssertionError("New trusted connections must start with all alert and location preferences disabled")

    # Test alerts have no recipients. A real alert recipient is valid only when
    # the member has an accepted connection and has opted in to SOS alerts.
    connection.execute(
        "UPDATE trusted_connection_preferences SET receive_sos = 1, receive_location = 1 WHERE recipient_user_id = 'user-b'"
    )
    connection.execute(
        """INSERT INTO sos_alerts (
             alert_id, client_alert_id, sender_user_id, test_mode, sender_timezone, created_at
           ) VALUES (?, ?, ?, 1, ?, ?)""",
        ("test-alert", "client-test-alert", "user-a", "Etc/UTC", 5),
    )
    if connection.execute(
        "SELECT 1 FROM sos_alert_recipients WHERE alert_id = 'test-alert'"
    ).fetchone():
        raise AssertionError("Test alerts must not have recipients")

    connection.execute(
        """INSERT INTO sos_alerts (
             alert_id, client_alert_id, sender_user_id, sender_timezone, created_at
           ) VALUES (?, ?, ?, ?, ?)""",
        ("live-alert", "client-live-alert", "user-a", "Etc/UTC", 6),
    )
    eligible = connection.execute(
        """SELECT 1 FROM trusted_connections AS c
           JOIN trusted_connection_preferences AS p
             ON p.connection_id = c.connection_id AND p.recipient_user_id = ?
           WHERE c.connection_status = 'accepted' AND p.receive_sos = 1
             AND c.user_low_id = ? AND c.user_high_id = ?""",
        ("user-b", "user-a", "user-b"),
    ).fetchone()
    if not eligible:
        raise AssertionError("An opted-in trusted member should be selectable for a real SOS alert")
    connection.execute(
        """INSERT INTO sos_alert_recipients (
             alert_recipient_id, alert_id, recipient_user_id, created_at
           ) VALUES (?, ?, ?, ?)""",
        ("live-alert-recipient", "live-alert", "user-b", 6),
    )
    acknowledgement = connection.execute(
        """UPDATE sos_alert_recipients SET recipient_status = 'acknowledged', acknowledged_at = ?
           WHERE alert_id = ? AND recipient_user_id = ? AND recipient_status <> 'acknowledged'""",
        (7, "live-alert", "user-b"),
    )
    if acknowledgement.rowcount != 1:
        raise AssertionError("The selected recipient must be able to acknowledge the alert")
    connection.execute(
        """INSERT OR IGNORE INTO sos_acknowledgements (
             acknowledgement_id, alert_id, recipient_user_id, acknowledged_at
           ) SELECT ?, ?, ?, ? WHERE changes() = 1""",
        ("live-acknowledgement", "live-alert", "user-b", 7),
    )
    if connection.execute(
        "SELECT COUNT(*) FROM sos_acknowledgements WHERE alert_id = 'live-alert'"
    ).fetchone()[0] != 1:
        raise AssertionError("A recipient acknowledgement must be recorded once")
    second_ack = connection.execute(
        """UPDATE sos_alert_recipients SET recipient_status = 'acknowledged', acknowledged_at = ?
           WHERE alert_id = ? AND recipient_user_id = ? AND recipient_status <> 'acknowledged'""",
        (8, "live-alert", "user-b"),
    )
    if second_ack.rowcount != 0:
        raise AssertionError("Duplicate acknowledgement must not mutate the recipient record")
    connection.execute(
        "UPDATE sos_alerts SET alert_status = 'recipient_acknowledged' WHERE alert_id = ?",
        ("live-alert",),
    )
    connection.execute(
        """UPDATE sos_alerts SET alert_status = 'resolved', resolved_at = ?
           WHERE alert_id = ? AND sender_user_id = ? AND alert_status = 'recipient_acknowledged'""",
        (9, "live-alert", "user-a"),
    )
    connection.execute(
        """UPDATE sos_alerts SET alert_status = 'closed', closed_at = ?
           WHERE alert_id = ? AND sender_user_id = ? AND alert_status = 'resolved'""",
        (10, "live-alert", "user-a"),
    )
    if connection.execute(
        "SELECT alert_status FROM sos_alerts WHERE alert_id = 'live-alert'"
    ).fetchone()[0] != "closed":
        raise AssertionError("Sender resolution and closure must follow the expected status transitions")

    connection.execute(
        """INSERT INTO encryption_metadata (
             user_id, key_version, kdf_iterations, kdf_salt, wrapped_key, wrapping_iv, created_at, updated_at
           ) VALUES (?, 1, 600000, ?, ?, ?, ?, ?)""",
        ("user-a", b"s" * 16, b"w" * 48, b"123456789012", 1, 1),
    )
    connection.execute(
        """INSERT INTO user_sharing_keys (
             user_id, key_version, algorithm, public_key, private_key_ciphertext, private_key_iv, created_at
           ) VALUES (?, 1, 'ECDH-P256-HKDF-SHA256-AES256-GCM', ?, ?, ?, ?)""",
        ("user-a", b"p" * 65, b"c" * 64, b"123456789012", 2),
    )
    connection.execute(
        """INSERT INTO location_shares (
             share_id, owner_user_id, share_status, started_at, expires_at
           ) VALUES (?, ?, 'active', ?, ?)""",
        ("location-share-a", "user-a", 2, 1000),
    )
    connection.execute(
        """INSERT INTO location_share_recipients (share_id, recipient_user_id, added_at)
           VALUES (?, ?, ?)""",
        ("location-share-a", "user-b", 2),
    )
    connection.execute(
        """INSERT INTO encrypted_location_envelopes (
             share_id, recipient_user_id, sender_public_key, hkdf_salt,
             location_ciphertext, location_iv, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("location-share-a", "user-b", b"e" * 65, b"h" * 32, b"x" * 17, b"123456789012", 3),
    )
    location_consent = connection.execute(
        """SELECT p.receive_location FROM trusted_connection_preferences AS p
           JOIN trusted_connections AS c ON c.connection_id = p.connection_id
           WHERE p.recipient_user_id = 'user-b' AND c.user_low_id = 'user-a'
             AND c.user_high_id = 'user-b' AND c.connection_status = 'accepted'"""
    ).fetchone()[0]
    if location_consent != 1 or connection.execute(
        "SELECT COUNT(*) FROM encrypted_location_envelopes WHERE share_id = 'location-share-a'"
    ).fetchone()[0] != 1:
        raise AssertionError("Location ciphertext should be stored only for an opted-in, accepted recipient")

    # Revoking location consent removes the latest envelope immediately and
    # hides the share even though its metadata can remain for the sender.
    connection.execute(
        "UPDATE trusted_connection_preferences SET receive_location = 0 WHERE recipient_user_id = 'user-b'"
    )
    connection.execute(
        """DELETE FROM encrypted_location_envelopes
           WHERE recipient_user_id = ? AND share_id IN (
             SELECT r.share_id FROM location_share_recipients AS r
             JOIN location_shares AS s ON s.share_id = r.share_id
             JOIN trusted_connections AS c ON c.connection_status = 'accepted'
             WHERE r.recipient_user_id = ? AND s.owner_user_id = 'user-a'
           )""",
        ("user-b", "user-b"),
    )
    if connection.execute(
        "SELECT COUNT(*) FROM encrypted_location_envelopes WHERE share_id = 'location-share-a'"
    ).fetchone()[0] != 0:
        raise AssertionError("Withdrawing location consent must remove the encrypted location envelope")
    if connection.execute(
        """SELECT COUNT(*) FROM location_share_recipients AS r
           JOIN location_shares AS s ON s.share_id = r.share_id
           JOIN trusted_connection_preferences AS p ON p.recipient_user_id = r.recipient_user_id
           WHERE r.share_id = 'location-share-a' AND p.receive_location = 1"""
    ).fetchone()[0] != 0:
        raise AssertionError("A recipient with withdrawn consent must not see a location share")

    # Owner-only stop uses the changed-row check before clearing ciphertext.
    connection.execute(
        """INSERT INTO location_shares (share_id, owner_user_id, share_status, started_at, expires_at)
           VALUES (?, ?, 'active', ?, ?)""",
        ("location-share-stop", "user-a", 3, 1000),
    )
    connection.execute(
        """INSERT INTO location_share_recipients (share_id, recipient_user_id, added_at)
           VALUES (?, ?, ?)""",
        ("location-share-stop", "user-b", 3),
    )
    connection.execute(
        """INSERT INTO encrypted_location_envelopes (
             share_id, recipient_user_id, sender_public_key, hkdf_salt,
             location_ciphertext, location_iv, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("location-share-stop", "user-b", b"e" * 65, b"h" * 32, b"x" * 17, b"123456789012", 4),
    )
    unauthorized_stop = connection.execute(
        """UPDATE location_shares SET share_status = 'stopped', stopped_at = ?
           WHERE share_id = ? AND owner_user_id = ? AND share_status = 'active' AND expires_at > ?""",
        (5, "location-share-stop", "user-b", 5),
    )
    connection.execute(
        "DELETE FROM encrypted_location_envelopes WHERE share_id = ? AND changes() = 1",
        ("location-share-stop",),
    )
    if unauthorized_stop.rowcount != 0 or connection.execute(
        "SELECT COUNT(*) FROM encrypted_location_envelopes WHERE share_id = 'location-share-stop'"
    ).fetchone()[0] != 1:
        raise AssertionError("A non-owner must not stop a location share or delete its ciphertext")
    connection.execute(
        """UPDATE location_shares SET share_status = 'stopped', stopped_at = ?
           WHERE share_id = ? AND owner_user_id = ? AND share_status = 'active' AND expires_at > ?""",
        (6, "location-share-stop", "user-a", 6),
    )
    connection.execute(
        "DELETE FROM encrypted_location_envelopes WHERE share_id = ? AND changes() = 1",
        ("location-share-stop",),
    )
    if connection.execute(
        "SELECT COUNT(*) FROM encrypted_location_envelopes WHERE share_id = 'location-share-stop'"
    ).fetchone()[0] != 0:
        raise AssertionError("The share owner must be able to stop sharing and clear current ciphertext")

    # Expired shares are idempotently marked and their location ciphertext is deleted.
    connection.execute(
        """INSERT INTO location_shares (share_id, owner_user_id, share_status, started_at, expires_at)
           VALUES (?, ?, 'active', ?, ?)""",
        ("location-share-expired", "user-a", 1, 2),
    )
    connection.execute(
        """INSERT INTO encrypted_location_envelopes (
             share_id, recipient_user_id, sender_public_key, hkdf_salt,
             location_ciphertext, location_iv, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("location-share-expired", "user-b", b"e" * 65, b"h" * 32, b"x" * 17, b"123456789012", 1),
    )
    connection.execute(
        """UPDATE location_shares SET share_status = 'expired', stopped_at = ?
           WHERE share_status = 'active' AND expires_at <= ?""",
        (3, 3),
    )
    connection.execute(
        """DELETE FROM encrypted_location_envelopes WHERE share_id IN (
             SELECT share_id FROM location_shares WHERE share_status = 'expired'
           )"""
    )
    if connection.execute(
        "SELECT share_status FROM location_shares WHERE share_id = 'location-share-expired'"
    ).fetchone()[0] != "expired" or connection.execute(
        "SELECT COUNT(*) FROM encrypted_location_envelopes WHERE share_id = 'location-share-expired'"
    ).fetchone()[0] != 0:
        raise AssertionError("Expired location shares must no longer serve encrypted coordinates")

    replay = connection.execute(
        """UPDATE invitations SET redeemed_at = ?, target_user_id = ?
           WHERE invitation_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?""",
        (6, "user-c", "invitation-a", 6),
    )
    if replay.rowcount != 0:
        raise AssertionError("A redeemed invitation must not be accepted a second time")
    connection.execute(
        """INSERT INTO trusted_connections (
             connection_id, user_low_id, user_high_id, connection_status,
             requested_by_user_id, created_at, accepted_at
           ) SELECT ?, ?, ?, 'accepted', ?, ?, ? WHERE changes() = 1
           ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET
             connection_status = 'accepted', requested_by_user_id = excluded.requested_by_user_id,
             created_at = excluded.created_at, accepted_at = excluded.accepted_at, ended_at = NULL""",
        ("connection-replay", "user-a", "user-c", "user-a", 6, 6),
    )
    if connection.execute(
        "SELECT 1 FROM trusted_connections WHERE user_low_id = 'user-a' AND user_high_id = 'user-c'"
    ).fetchone():
        raise AssertionError("A replayed invitation must not create another connection")
    connection.execute(
        """INSERT INTO external_contacts (
             contact_id, owner_user_id, details_ciphertext, details_iv, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)""",
        ("contact-a", "user-a", b"ciphertext", b"123456789012", 4, 4),
    )
    connection.execute(
        """INSERT INTO sos_alerts (
             alert_id, client_alert_id, sender_user_id, sender_timezone, created_at
           ) VALUES (?, ?, ?, ?, ?)""",
        ("alert-a", "client-alert-a", "user-a", "Etc/UTC", 5),
    )
    connection.execute(
        """INSERT INTO sos_alert_recipients (
             alert_recipient_id, alert_id, external_contact_id, created_at
           ) VALUES (?, ?, ?, ?)""",
        ("alert-recipient-a", "alert-a", "contact-a", 5),
    )
    old_contact_ciphertext = connection.execute(
        "SELECT details_ciphertext FROM external_contacts WHERE contact_id = 'contact-a'"
    ).fetchone()[0]
    connection.execute(
        """UPDATE external_contacts SET details_ciphertext = randomblob(length(details_ciphertext)),
             details_iv = randomblob(12), deleted_at = ?, updated_at = ?
           WHERE contact_id = ? AND deleted_at IS NULL""",
        (6, 6, "contact-a"),
    )
    new_contact_ciphertext = connection.execute(
        "SELECT details_ciphertext FROM external_contacts WHERE contact_id = 'contact-a'"
    ).fetchone()[0]
    remaining_recipient = connection.execute(
        "SELECT alert_recipient_id FROM sos_alert_recipients WHERE external_contact_id = 'contact-a'"
    ).fetchone()
    if new_contact_ciphertext == old_contact_ciphertext or not remaining_recipient:
        raise AssertionError("Removing a contact must overwrite its current ciphertext while retaining history references")

    expect_integrity_error(
        connection,
        """INSERT INTO safety_checkins (
             checkin_id, user_id, local_date, local_time, timezone,
             scheduled_for_utc, grace_minutes, created_at, updated_at, idempotency_key
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("bad-checkin", "user-a", "2026-11-05", "12:00", "Etc/UTC", 10, 999, 1, 1, "bad"),
    )

    connection.execute(
        """INSERT INTO safety_checkins (
             checkin_id, user_id, local_date, local_time, timezone,
             scheduled_for_utc, grace_minutes, created_at, updated_at, idempotency_key
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("checkin-a", "user-a", "2026-11-05", "12:00", "Etc/UTC", 10, 10, 1, 1, "client-checkin-a"),
    )
    connection.execute(
        """INSERT INTO notification_events (
             event_id, event_key, user_id, checkin_id, category, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("event-a", "missed:checkin-a", "user-a", "checkin-a", "missed_checkin", 6, 6),
    )
    expect_integrity_error(
        connection,
        """INSERT INTO notification_events (
             event_id, event_key, user_id, checkin_id, category, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("event-b", "missed:checkin-a", "user-a", "checkin-a", "missed_checkin", 7, 7),
    )

    # Creation retries use the per-owner idempotency key and conditionally add
    # recipients only when the first insert created the check-in.
    connection.execute(
        "UPDATE trusted_connection_preferences SET receive_missed_checkin = 1 WHERE recipient_user_id = 'user-b'"
    )
    create_checkin_sql = """INSERT INTO safety_checkins (
        checkin_id, user_id, local_date, local_time, timezone, scheduled_for_utc,
        grace_minutes, created_at, updated_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, idempotency_key) DO NOTHING"""
    add_recipient_sql = """INSERT INTO safety_checkin_recipients (checkin_id, recipient_user_id)
      SELECT ?, recipient.user_id FROM users AS recipient
      WHERE recipient.user_id = ? AND recipient.account_status = 'active' AND changes() = 1
        AND EXISTS (
          SELECT 1 FROM trusted_connections AS c
          JOIN trusted_connection_preferences AS p
            ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
            AND p.receive_missed_checkin = 1
          WHERE c.connection_status = 'accepted'
            AND ((c.user_low_id = 'user-a' AND c.user_high_id = recipient.user_id)
              OR (c.user_high_id = 'user-a' AND c.user_low_id = recipient.user_id))
        )"""
    create_values = ("checkin-idempotent", "user-a", "2026-11-06", "12:00", "Etc/UTC", 200_000, 10, 1, 1, "idempotent-key")
    connection.execute(create_checkin_sql, create_values)
    connection.execute(add_recipient_sql, ("checkin-idempotent", "user-b"))
    connection.execute(create_checkin_sql, ("retry-id", *create_values[1:]))
    connection.execute(add_recipient_sql, ("retry-id", "user-b"))
    if connection.execute(
        "SELECT COUNT(*) FROM safety_checkins WHERE user_id = 'user-a' AND idempotency_key = 'idempotent-key'"
    ).fetchone()[0] != 1 or connection.execute(
        "SELECT COUNT(*) FROM safety_checkin_recipients WHERE checkin_id = 'checkin-idempotent'"
    ).fetchone()[0] != 1:
        raise AssertionError("A check-in retry must not create a duplicate or lose its selected recipient")

    edit_checkin_sql = """UPDATE safety_checkins SET local_date = ?, local_time = ?, timezone = ?,
        scheduled_for_utc = ?, grace_minutes = ?, reminder_at_utc = ?, updated_at = ?
      WHERE checkin_id = ? AND user_id = ? AND status = 'pending' AND scheduled_for_utc > ?
        AND NOT EXISTS (
          SELECT 1 FROM safety_checkin_recipients AS r
          WHERE r.checkin_id = safety_checkins.checkin_id AND NOT EXISTS (
            SELECT 1 FROM users AS recipient
            JOIN trusted_connections AS c ON c.connection_status = 'accepted'
              AND ((c.user_low_id = safety_checkins.user_id AND c.user_high_id = recipient.user_id)
                OR (c.user_high_id = safety_checkins.user_id AND c.user_low_id = recipient.user_id))
            JOIN trusted_connection_preferences AS p
              ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
              AND p.receive_missed_checkin = 1
            WHERE recipient.user_id = r.recipient_user_id AND recipient.account_status = 'active'
          )
        )"""
    edit_values = ("2026-11-07", "13:00", "Etc/UTC", 300_000, 15, 250_000, 2,
                   "checkin-idempotent", "user-a", 100)
    if connection.execute(edit_checkin_sql, edit_values).rowcount != 1:
        raise AssertionError("The check-in owner should be able to edit a pending future check-in")
    connection.execute(
        "UPDATE trusted_connection_preferences SET receive_missed_checkin = 0 WHERE recipient_user_id = 'user-b'"
    )
    rejected_edit_values = ("2026-11-08", "14:00", "Etc/UTC", 400_000, 15, 350_000, 3,
                            "checkin-idempotent", "user-a", 100)
    if connection.execute(edit_checkin_sql, rejected_edit_values).rowcount != 0:
        raise AssertionError("An edit must not retain a recipient after their consent is withdrawn")
    if connection.execute(
        """UPDATE safety_checkins SET status = 'safe', safe_at = ?, updated_at = ?
           WHERE checkin_id = ? AND user_id = ? AND status IN ('pending', 'overdue')""",
        (4, 4, "checkin-idempotent", "user-b"),
    ).rowcount != 0:
        raise AssertionError("A different member must not mark another user's check-in safe")
    if connection.execute(
        """UPDATE safety_checkins SET status = 'safe', safe_at = ?, updated_at = ?
           WHERE checkin_id = ? AND user_id = ? AND status IN ('pending', 'overdue')""",
        (4, 4, "checkin-idempotent", "user-a"),
    ).rowcount != 1:
        raise AssertionError("The check-in owner should be able to confirm they are safe")
    if connection.execute(
        """UPDATE safety_checkins SET status = 'cancelled', cancelled_at = ?, updated_at = ?
           WHERE checkin_id = ? AND user_id = ? AND status = 'pending'""",
        (5, 5, "checkin-idempotent", "user-a"),
    ).rowcount != 0:
        raise AssertionError("A safe check-in must not be cancelled afterward")

    # The scheduled worker decides overdue status on the server, queues one
    # reminder for the owner, and creates one missed event per opted-in member.
    connection.execute(
        "UPDATE trusted_connection_preferences SET receive_missed_checkin = 1 WHERE recipient_user_id = 'user-b'"
    )
    connection.execute(
        """INSERT INTO safety_checkins (
             checkin_id, user_id, local_date, local_time, timezone, scheduled_for_utc,
             grace_minutes, reminder_at_utc, created_at, updated_at, idempotency_key
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("checkin-due", "user-a", "2026-11-05", "12:00", "Etc/UTC", 1_000, 1, 500, 1, 1, "due-key"),
    )
    connection.execute(
        """INSERT INTO safety_checkin_recipients (checkin_id, recipient_user_id)
           VALUES (?, ?)""",
        ("checkin-due", "user-b"),
    )
    connection.execute(
        """INSERT INTO safety_checkins (
             checkin_id, user_id, local_date, local_time, timezone, scheduled_for_utc,
             grace_minutes, reminder_at_utc, created_at, updated_at, idempotency_key
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("checkin-reminder", "user-a", "2026-11-06", "12:00", "Etc/UTC", 1_000_000, 10, 500, 1, 1, "reminder-key"),
    )
    worker_now = 61_000
    connection.execute(
        """UPDATE safety_checkins SET status = 'overdue', overdue_at = ?, updated_at = ?
           WHERE status = 'pending' AND scheduled_for_utc + grace_minutes * 60_000 <= ?""",
        (worker_now, worker_now, worker_now),
    )
    connection.execute(
        """INSERT INTO notification_events (
             event_id, event_key, user_id, checkin_id, category, delivery_status, created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))), 'checkin-reminder:' || s.checkin_id,
             s.user_id, s.checkin_id, 'checkin_reminder', 'prepared', ?, ?
           FROM safety_checkins AS s
           LEFT JOIN notification_preferences AS preference ON preference.user_id = s.user_id
           WHERE s.status = 'pending' AND s.reminder_at_utc IS NOT NULL AND s.reminder_at_utc <= ?
             AND COALESCE(preference.checkin_reminders_enabled, 1) = 1
           ON CONFLICT (event_key) DO NOTHING""",
        (worker_now, worker_now, worker_now),
    )
    connection.execute(
        """INSERT INTO notification_events (
             event_id, event_key, user_id, checkin_id, category, delivery_status, created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))),
             'missed-checkin:' || s.checkin_id || ':' || recipient.user_id,
             recipient.user_id, s.checkin_id, 'missed_checkin', 'prepared', ?, ?
           FROM safety_checkins AS s
           JOIN safety_checkin_recipients AS r ON r.checkin_id = s.checkin_id
           JOIN users AS recipient ON recipient.user_id = r.recipient_user_id
             AND recipient.account_status = 'active'
           JOIN trusted_connections AS c ON c.connection_status = 'accepted'
             AND ((c.user_low_id = s.user_id AND c.user_high_id = recipient.user_id)
               OR (c.user_high_id = s.user_id AND c.user_low_id = recipient.user_id))
           JOIN trusted_connection_preferences AS connection_preference
             ON connection_preference.connection_id = c.connection_id
             AND connection_preference.recipient_user_id = recipient.user_id
             AND connection_preference.receive_missed_checkin = 1
           LEFT JOIN notification_preferences AS notification_preference
             ON notification_preference.user_id = recipient.user_id
           WHERE s.status = 'overdue'
             AND COALESCE(notification_preference.missed_checkins_enabled, 1) = 1
           ON CONFLICT (event_key) DO NOTHING""",
        (worker_now, worker_now),
    )
    if connection.execute(
        "SELECT status FROM safety_checkins WHERE checkin_id = 'checkin-due'"
    ).fetchone()[0] != "overdue":
        raise AssertionError("The server worker must decide when the grace period expires")
    if connection.execute(
        "SELECT COUNT(*) FROM notification_events WHERE event_key = 'missed-checkin:checkin-due:user-b'"
    ).fetchone()[0] != 1:
        raise AssertionError("An opted-in recipient should receive one queued missed-check-in event")
    if connection.execute(
        "SELECT COUNT(*) FROM notification_events WHERE event_key = 'checkin-reminder:checkin-reminder'"
    ).fetchone()[0] != 1:
        raise AssertionError("A due reminder should be queued once while its check-in remains pending")
    connection.execute(
        "UPDATE trusted_connection_preferences SET receive_missed_checkin = 0 WHERE recipient_user_id = 'user-b'"
    )
    connection.execute(
        """INSERT INTO safety_checkins (
             checkin_id, user_id, local_date, local_time, timezone, scheduled_for_utc,
             grace_minutes, created_at, updated_at, idempotency_key
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("checkin-optout", "user-a", "2026-11-05", "12:00", "Etc/UTC", 1_000, 0, 1, 1, "optout-key"),
    )
    connection.execute(
        """INSERT INTO safety_checkin_recipients (checkin_id, recipient_user_id)
           VALUES (?, ?)""",
        ("checkin-optout", "user-b"),
    )
    connection.execute(
        """UPDATE safety_checkins SET status = 'overdue', overdue_at = ?, updated_at = ?
           WHERE status = 'pending' AND scheduled_for_utc + grace_minutes * 60_000 <= ?""",
        (worker_now, worker_now, worker_now),
    )
    connection.execute(
        """INSERT INTO notification_events (
             event_id, event_key, user_id, checkin_id, category, delivery_status, created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))),
             'missed-checkin:' || s.checkin_id || ':' || recipient.user_id,
             recipient.user_id, s.checkin_id, 'missed_checkin', 'prepared', ?, ?
           FROM safety_checkins AS s
           JOIN safety_checkin_recipients AS r ON r.checkin_id = s.checkin_id
           JOIN users AS recipient ON recipient.user_id = r.recipient_user_id
             AND recipient.account_status = 'active'
           JOIN trusted_connections AS c ON c.connection_status = 'accepted'
             AND ((c.user_low_id = s.user_id AND c.user_high_id = recipient.user_id)
               OR (c.user_high_id = s.user_id AND c.user_low_id = recipient.user_id))
           JOIN trusted_connection_preferences AS connection_preference
             ON connection_preference.connection_id = c.connection_id
             AND connection_preference.recipient_user_id = recipient.user_id
             AND connection_preference.receive_missed_checkin = 1
           WHERE s.status = 'overdue'
           ON CONFLICT (event_key) DO NOTHING""",
        (worker_now, worker_now),
    )
    if connection.execute(
        "SELECT COUNT(*) FROM notification_events WHERE checkin_id = 'checkin-optout'"
    ).fetchone()[0] != 0:
        raise AssertionError("A member who opted out must not get a missed-check-in event")

    connection.execute(
        """INSERT INTO push_subscriptions (
             subscription_id, user_id, endpoint, endpoint_hash, p256dh_key, auth_secret, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("device-c", "user-c", "https://fcm.googleapis.com/push/fake", b"h" * 32,
         b"\x04" + b"p" * 64, b"a" * 16, worker_now),
    )
    connection.execute(
        """INSERT INTO notification_events (
             event_id, event_key, user_id, category, delivery_status, created_at, updated_at,
             related_resource_id, fanout_at
           ) VALUES (?, ?, ?, 'test', 'prepared', ?, ?, NULL, ?)""",
        ("push-event-c", "test:push-event-c", "user-c", worker_now, worker_now, worker_now),
    )
    connection.execute(
        """INSERT INTO notification_deliveries (
             delivery_id, event_id, subscription_id, delivery_status, attempt_count, created_at, updated_at
           ) VALUES (?, ?, ?, 'prepared', 0, ?, ?)""",
        ("delivery-c", "push-event-c", "device-c", worker_now, worker_now),
    )
    expect_integrity_error(
        connection,
        """INSERT INTO notification_deliveries (
             delivery_id, event_id, subscription_id, delivery_status, attempt_count, created_at, updated_at
           ) VALUES (?, ?, ?, 'prepared', 0, ?, ?)""",
        ("delivery-duplicate", "push-event-c", "device-c", worker_now, worker_now),
    )
    expect_integrity_error(
        connection,
        """INSERT INTO notification_deliveries (
             delivery_id, event_id, subscription_id, delivery_status, attempt_count, created_at, updated_at
           ) VALUES (?, ?, ?, 'delivery_confirmed', 0, ?, ?)""",
        ("delivery-invalid", "push-event-c", "device-c", worker_now, worker_now),
    )
    expect_integrity_error(
        connection,
        """INSERT INTO notification_deliveries (
             delivery_id, event_id, subscription_id, delivery_status, attempt_count, created_at, updated_at
           ) VALUES (?, ?, ?, 'prepared', 6, ?, ?)""",
        ("delivery-too-many", "push-event-c", "device-c", worker_now, worker_now),
    )
    connection.execute(
        "UPDATE notification_deliveries SET delivery_status = 'provider_accepted', provider_accepted_at = ? WHERE delivery_id = ?",
        (worker_now, "delivery-c"),
    )
    connection.execute("DELETE FROM push_subscriptions WHERE subscription_id = 'device-c'")
    if connection.execute(
        "SELECT COUNT(*) FROM notification_deliveries WHERE delivery_id = 'delivery-c'"
    ).fetchone()[0] != 0:
        raise AssertionError("Removing a device must remove its endpoint-specific delivery record")

    violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise AssertionError(f"Foreign key violations: {violations}")

    print(
        f"PASS: {len(list(MIGRATIONS.glob('*.sql')))} migrations applied; "
        f"{len(expected)} expected tables present; owner, encrypted-contact, "
        "contact-redaction, invitation replay protection, SOS test isolation and acknowledgement, "
        "default-off preferences, encrypted location envelopes, consent revocation, owner-only stop, expiry cleanup, check-in constraints, grace processing, reminder idempotency, device-limited push delivery records, idempotency, retry limits, and truthful provider-acceptance states verified."
    )


if __name__ == "__main__":
    main()
