"""Lightweight checks for security boundaries and documented preview status."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    auth_files = sorted((ROOT / "functions" / "api" / "auth").glob("*.js"))
    owner_files = sorted((ROOT / "functions" / "api" / "owner").rglob("*.js"))
    if not auth_files or not owner_files:
        raise AssertionError("Authentication or owner API files are missing")

    for route in owner_files:
        source = route.read_text(encoding="utf-8")
        if "requireOwner" not in source:
            raise AssertionError(f"Owner route lacks owner authorization: {route.relative_to(ROOT)}")
        if re.search(r"\b(?:exec|raw)\s*\(\s*`", source, re.IGNORECASE):
            raise AssertionError(f"Possible interpolated raw SQL in {route.relative_to(ROOT)}")
    owner_list = (ROOT / "functions" / "api" / "owner" / "users" / "index.js").read_text(encoding="utf-8")
    get_handler = owner_list.split("export async function onRequestPost", 1)[0]
    if "SELECT user_id, username, role, account_status" not in get_handler:
        raise AssertionError("Owner account list must include role while excluding authentication material")
    for fragment in ("password_hash", "password_salt", "details_ciphertext", "location_ciphertext"):
        if fragment in get_handler:
            raise AssertionError(f"Owner account listing exposes a sensitive field: {fragment}")
    if "temporaryPassword" in owner_list or "newTemporaryCredential" in owner_list:
        raise AssertionError("Owner account creation must not return a member password")
    setup_password = (ROOT / "functions" / "api" / "auth" / "setup-password.js").read_text(encoding="utf-8")
    for required in ("requirePost", "sha256(body.token)", "validatePassword", "redeemed_at IS NULL", "changes() = 1"):
        if required not in setup_password:
            raise AssertionError(f"One-time account setup lacks {required}")
    if "account_setup_tokens" not in owner_list or "token_hash" not in owner_list or "setupUrl.hash = setupToken" not in owner_list:
        raise AssertionError("Owner-created member accounts must use hash-only, fragment-delivered setup tokens")

    pairing_root = ROOT / "functions" / "api" / "device-pairing"
    pairing_routes = {route.stem: route.read_text(encoding="utf-8") for route in pairing_root.glob("*.js")}
    if set(pairing_routes) != {"index", "status", "approve", "reject", "cancel", "redeem"}:
        raise AssertionError("Device pairing must support create, inspect, approve, reject, cancel, and redeem")
    for name, source in pairing_routes.items():
        if "requirePost" not in source or "token_hash" not in source or "expires_at" not in source:
            raise AssertionError(f"Device pairing {name} must use a same-origin POST and a time-limited token hash")
    for name in ("approve", "reject"):
        if "requireSession(context, { write: true })" not in pairing_routes[name]:
            raise AssertionError(f"Only a signed-in, CSRF-protected device may {name} a pairing request")
    for required in ("approved_at IS NOT NULL", "redeemed_at IS NULL", "createSession", "sessionCookies"):
        if required not in pairing_routes["redeem"]:
            raise AssertionError(f"Device pairing must not create a session without {required}")
    if "AUTH_RATE_LIMIT_SECRET" not in pairing_routes["index"] or "randomToken(32)" not in pairing_routes["index"]:
        raise AssertionError("Device pairing requests must use an unpredictable token and configured rate limit")
    for fragment in ("history.replaceState", "makeQrDataUrl", "pairing/redeem", "started this request", "window.location.replace"):
        if fragment not in (ROOT / "js" / "pair-device.js").read_text(encoding="utf-8"):
            raise AssertionError(f"Device pairing UI is missing the required boundary: {fragment}")

    for route in auth_files:
        source = route.read_text(encoding="utf-8")
        if re.search(r"\b(?:exec|raw)\s*\(\s*`", source, re.IGNORECASE):
            raise AssertionError(f"Possible interpolated raw SQL in {route.relative_to(ROOT)}")

    contact_files = sorted((ROOT / "functions" / "api" / "contacts").glob("*.js"))
    if len(contact_files) != 2:
        raise AssertionError("Expected contact list/create and contact update/delete routes")
    for route in contact_files:
        source = route.read_text(encoding="utf-8")
        if "requireSession" not in source or "owner_user_id = ?" not in source:
            raise AssertionError(f"Contact route must authenticate and scope data to its owner: {route.name}")
    contact_item_route = (ROOT / "functions" / "api" / "contacts" / "[contact_id].js").read_text(encoding="utf-8")
    if "randomblob(length(details_ciphertext))" not in contact_item_route or "deleted_at IS NULL" not in contact_item_route:
        raise AssertionError("Deleting a contact must overwrite active ciphertext without cascading history rows")
    vault_route = (ROOT / "functions" / "api" / "vault" / "index.js").read_text(encoding="utf-8")
    if "requireSession" not in vault_route or "kdf_salt" not in vault_route:
        raise AssertionError("Encryption vault route is missing authentication or encrypted metadata handling")

    invitation_route = (ROOT / "functions" / "api" / "invitations" / "index.js").read_text(encoding="utf-8")
    invitation_accept = (ROOT / "functions" / "api" / "invitations" / "accept.js").read_text(encoding="utf-8")
    if "randomToken(32)" not in invitation_route or "token_hash" not in invitation_route:
        raise AssertionError("Invitation creation must use random tokens and store only their hashes")
    for fragment in ("sha256(body.token)", "redeemed_at IS NULL", "expires_at > ?", "changes() = 1"):
        if fragment not in invitation_accept:
            raise AssertionError(f"Invitation acceptance lacks a single-use safety check: {fragment}")
    connection_list = (ROOT / "functions" / "api" / "connections" / "index.js").read_text(encoding="utf-8")
    if "requireSession" not in connection_list or "user_low_id = ? OR c.user_high_id = ?" not in connection_list:
        raise AssertionError("Trusted connections must be visible only to their participants")

    sos_root = ROOT / "functions" / "api" / "sos"
    sos_create = (sos_root / "index.js").read_text(encoding="utf-8")
    if "requireSession(context, { write: true })" not in sos_create:
        raise AssertionError("SOS creation must require a protected, authenticated session")
    for fragment in ("TEST_MODE_RECIPIENTS_BLOCKED", "RECIPIENT_NOT_ALLOWED", "receive_sos = 1", "notificationAttempted: false"):
        if fragment not in sos_create:
            raise AssertionError(f"SOS creation is missing safety boundary: {fragment}")
    acknowledge = (sos_root / "[alert_id]" / "acknowledge.js").read_text(encoding="utf-8")
    if "r.recipient_user_id = ?" not in acknowledge or "requireSession(context, { write: true })" not in acknowledge:
        raise AssertionError("Only the selected recipient may acknowledge an SOS alert")
    for operation in ("resolve", "close"):
        source = (sos_root / "[alert_id]" / f"{operation}.js").read_text(encoding="utf-8")
        if "sender_user_id = ?" not in source or "requireSession(context, { write: true })" not in source:
            raise AssertionError(f"Only the sender may {operation} an SOS alert")

    communication = (ROOT / "js" / "communication.js").read_text(encoding="utf-8")
    for required in ('"sms"', '"email"', '"whatsapp"', "wa.me/", "mailto:", "sms:", '"not_configured"'):
        if required not in communication:
            raise AssertionError(f"Manual communication support is missing {required}")
    if "fetch(" in communication or "provider_accepted" in communication or "delivery_confirmed" in communication:
        raise AssertionError("Manual composers must not simulate automated provider delivery")
    contacts_ui = (ROOT / "js" / "contacts.js").read_text(encoding="utf-8")
    for required in ("prepareCommunication", "aria-disabled", "Composer launch requested", "cannot confirm"):
        if required not in contacts_ui:
            raise AssertionError(f"Communication UI is missing its truthful handoff behavior: {required}")

    identity_route = (ROOT / "functions" / "api" / "vault" / "identity.js").read_text(encoding="utf-8")
    if "requireSession" not in identity_route or "user_id = ?" not in identity_route or "private_key_ciphertext" not in identity_route:
        raise AssertionError("Location-sharing private keys must be authenticated, account-scoped, and stored encrypted")
    preference_route = (ROOT / "functions" / "api" / "connections" / "[connection_id].js").read_text(encoding="utf-8")
    for fragment in ("body.receiveLocation", "receive_location = ?", "DELETE FROM encrypted_location_envelopes"):
        if fragment not in preference_route:
            raise AssertionError(f"Location-consent revocation is missing: {fragment}")
    location_root = ROOT / "functions" / "api" / "location-shares"
    location_routes = sorted(location_root.rglob("*.js"))
    if len(location_routes) != 4:
        raise AssertionError("Expected create/list, update, owner-stop, and recipient-leave location routes")
    location_create = (location_root / "index.js").read_text(encoding="utf-8")
    location_update = (location_root / "[share_id]" / "update.js").read_text(encoding="utf-8")
    location_stop = (location_root / "[share_id]" / "stop.js").read_text(encoding="utf-8")
    location_leave = (location_root / "[share_id]" / "leave.js").read_text(encoding="utf-8")
    for fragment in ("requireSession", "receive_location = 1", "user_sharing_keys", "expiresInMinutes"):
        if fragment not in location_create:
            raise AssertionError(f"Location-share creation is missing consent, key, or expiry check: {fragment}")
    for fragment in ("requireSession", "sender_public_key", "location_ciphertext", "receive_location = 1"):
        if fragment not in location_update:
            raise AssertionError(f"Location updates are missing encryption or consent enforcement: {fragment}")
    if "owner_user_id = ?" not in location_stop or "changes() = 1" not in location_stop:
        raise AssertionError("Only the share owner may stop a location share and remove its ciphertext")
    if "recipient_user_id = ?" not in location_leave or "changes() = 1" not in location_leave:
        raise AssertionError("A recipient may only remove their own location share")
    location_ui = (ROOT / "js" / "location.js").read_text(encoding="utf-8")
    for fragment in ("navigator.geolocation.getCurrentPosition", "window.isSecureContext", "encryptLocationForRecipient", "document.hidden", "openstreetmap.org"):
        if fragment not in location_ui:
            raise AssertionError(f"Location UI is missing its browser permission/privacy boundary: {fragment}")
    expiry_worker = (ROOT / "worker" / "scheduled-checkins.js").read_text(encoding="utf-8")
    if "export default" not in expiry_worker or "encrypted_location_envelopes" not in expiry_worker or "expires_at <= ?" not in expiry_worker:
        raise AssertionError("The scheduled Worker must expire location shares and delete old ciphertext")

    checkin_index = (ROOT / "functions" / "api" / "checkins" / "index.js").read_text(encoding="utf-8")
    checkin_item = (ROOT / "functions" / "api" / "checkins" / "[checkin_id].js").read_text(encoding="utf-8")
    for required in ("requireSession", "findEligibleRecipients", "idempotencyKey", "scheduled_for_utc"):
        if required not in checkin_index:
            raise AssertionError(f"Check-in creation/listing is missing {required}")
    for required in ("requireSession", "user_id = ?", "status IN ('pending', 'overdue')", "status = 'pending'"):
        if required not in checkin_item:
            raise AssertionError(f"Check-in actions are missing ownership or state enforcement: {required}")
    for required in ("status = 'overdue'", "receive_missed_checkin = 1", "ON CONFLICT (event_key) DO NOTHING", "checkin_reminder"):
        if required not in expiry_worker:
            raise AssertionError(f"Scheduled check-in processing is missing {required}")

    notification_root = ROOT / "functions" / "api" / "notifications"
    notification_index = (notification_root / "index.js").read_text(encoding="utf-8")
    preferences = (notification_root / "preferences.js").read_text(encoding="utf-8")
    subscriptions = (notification_root / "subscriptions.js").read_text(encoding="utf-8")
    notification_test = (notification_root / "test.js").read_text(encoding="utf-8")
    notification_routes = sorted(notification_root.glob("*.js"))
    if len(notification_routes) != 5:
        raise AssertionError("Expected notification settings, events, preferences, test, and subscription routes")
    for source in (preferences, subscriptions, notification_test):
        if "requireSession" not in source or "requirePost" not in source:
            raise AssertionError("Notification writes must require an authenticated, CSRF-protected session")
    for required in ("NOTIFICATION_CATEGORIES", "VAPID_PUBLIC_KEY", "activeDeviceCount"):
        if required not in notification_index:
            raise AssertionError(f"Notification settings are missing {required}")
    for required in ("validPushEndpoint", "validPushKeys", "disabled_at IS NULL", "< 5", "endpoint_hash", "user_id = excluded.user_id"):
        if required not in subscriptions:
            raise AssertionError(f"Push subscription storage is missing {required}")
    if "endpoint" in (notification_root / "events.js").read_text(encoding="utf-8"):
        raise AssertionError("Notification history must not expose push endpoints")
    push_worker = (ROOT / "worker" / "push-delivery.js").read_text(encoding="utf-8")
    for required in ("eventStillEligible", "receive_sos = 1", "receive_missed_checkin = 1", "MAX_ATTEMPTS = 5", "redirect: \"manual\"", "provider_accepted", "processPushQueue"):
        if required not in push_worker:
            raise AssertionError(f"Scheduled push delivery is missing {required}")
    service_worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
    for required in ("addEventListener(\"push\"", "addEventListener(\"notificationclick\"", "PUSH_COPY", "data: { path: \"/\" }"):
        if required not in service_worker:
            raise AssertionError(f"Service Worker push handling is missing {required}")
    if "location" in push_worker.lower() or "coordinates" in push_worker.lower():
        raise AssertionError("Push payload processing must not include private location details")
    notification_ui = (ROOT / "js" / "notifications.js").read_text(encoding="utf-8")
    if "Notification.requestPermission()" not in notification_ui or "enableButton.addEventListener(\"click\"" not in notification_ui:
        raise AssertionError("The browser notification permission prompt must follow the user's explicit button click")

    cookie_source = (ROOT / "functions" / "_shared" / "auth.js").read_text(encoding="utf-8")
    for required in ("HttpOnly", "Secure", "SameSite=Strict", "__Host-kg_session"):
        if required not in cookie_source:
            raise AssertionError(f"Session cookie is missing {required}")

    headers = (ROOT / "_headers").read_text(encoding="utf-8")
    for required in ("Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "frame-ancestors 'none'"):
        if required not in headers:
            raise AssertionError(f"Missing response security header: {required}")

    service_worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
    if 'url.pathname.startsWith("/api/")' not in service_worker:
        raise AssertionError("The service worker must bypass API requests")

    print(f"PASS: {len(auth_files)} auth routes, {len(owner_files)} owner routes, {len(contact_files)} contact routes, 4 SOS routes, 4 location routes, {len(notification_routes)} notification routes, explicit permission prompts, consent-checked scheduled events, encrypted location consent/revocation, and manual SMS/email/WhatsApp boundaries checked.")


if __name__ == "__main__":
    main()
