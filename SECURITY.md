# KinGuardian security and privacy

This document describes the current prototype and the intended privacy boundaries. It is not a security certification. KinGuardian must not be relied on for emergency response until the relevant features are implemented and independently reviewed.

## Current state

- Authentication routes use prepared D1 statements, random session tokens, hashed session tokens at rest, secure cookie attributes, same-origin checks, CSRF tokens for state-changing requests, account status checks, and expiring sessions.
- Account passwords are stored as PBKDF2-HMAC-SHA-256 hashes with random salts and a 100,000-iteration work factor, the maximum accepted by Cloudflare Workers. This is below the project's former 600,000-iteration setting and is a security trade-off required by the hosting runtime. Passwords are never stored as plaintext. Password reset and owner bootstrap credentials are returned once and require a change at next sign-in.
- One partial unique index permits exactly one owner account. There is no public registration route.
- Owner APIs return account identity and status metadata. They do not return password hashes, session tokens, contact ciphertext, or private keys. Owner actions are minimally audited.
- External contact details are encrypted in the browser with AES-256-GCM before the Pages Function receives them. D1 stores only ciphertext, the 96-bit IV, version, priority, and timestamps. A separate user passphrase derives a key with PBKDF2-HMAC-SHA-256 at 600,000 iterations and wraps a random 256-bit data key. The unwrapped key exists only in the contacts page's memory and is not sent to the server.
- Location sharing requests geolocation only after a direct user action on a secure page. Each location update is encrypted in the browser for each selected recipient using ECDH P-256, HKDF-SHA-256, and AES-256-GCM. Recipient private keys are encrypted with the user's vault data key. D1 stores one ciphertext per recipient; it can still see account IDs, selected recipients, update timestamps, and expiry. Sharing stops when the owner revokes it, a recipient opts out, or the 15–60 minute expiry elapses. Location reads pause when the page is hidden or closed; background tracking is not promised. Private profiles, incident notes, and personal safety notes are not implemented.
- Rate-limit identifiers are keyed hashes in D1. The key must be supplied as `AUTH_RATE_LIMIT_SECRET`; bootstrap additionally requires `OWNER_BOOTSTRAP_SECRET`. Neither belongs in source control or browser code.
- Trusted-circle invitations use 32 random bytes, store only the SHA-256 token hash, expire after 24 hours, and are redeemed once. Accepted connections begin with SOS and missed-check-in preferences disabled for both users. Each user controls what they receive.
- SOS alert records are accessible only to the sender and selected KinGuardian recipients. Test-mode records have no recipients. No notification is attempted. Manual SMS, email, and official WhatsApp click-to-chat links are generated locally after the user unlocks their contact vault; no provider API or message-delivery claim is configured.
- Location sharing starts only with the sender's browser permission, an explicit recipient selection, and each recipient's separate default-off consent. A member needs an encrypted vault key to decrypt a location share. Stopping or withdrawing consent removes the current ciphertext from D1; a scheduled Worker removes expired location ciphertext. Opening OpenStreetMap is a separate user action that sends the selected coordinates to that service.
- Static assets may be cached by the service worker. `/api/*` requests bypass that cache. The app fails closed when it cannot confirm a signed-in session.

## Threat model

The design aims to reduce harm from:

- A guessed, leaked, or reused password, through password hashing, rate limiting, one-time temporary credentials, and expiring sessions.
- A stolen database dump, through hashed authentication/session tokens and browser-side authenticated encryption for external-contact details.
- Cross-site request attempts, through same-origin validation, `SameSite=Strict` cookies, and CSRF token checks.
- Accidental access by the account owner, by limiting owner routes to account/status management and keeping encryption keys outside owner-visible records.
- Accidental data collection, by avoiding third-party resources and keeping the preview's SOS action non-sending.

The design does **not** protect against a compromised device/browser, malware, a malicious or compromised Cloudflare account, a maliciously modified deployed frontend, a vulnerable dependency or browser, traffic analysis, screenshots, recipient disclosure, or denial of service. Hosting operators can change the JavaScript delivered to users. Client-side encryption cannot make a compromised endpoint trustworthy. Location sharing uses a long-lived per-account ECDH key; key rotation, recovery, and forward secrecy are not implemented. A stolen unlocked device can expose decrypted coordinates. Losing the private vault passphrase can make private contacts and the location-sharing key unreadable.

## Data collected and stored

The current authentication flow stores usernames, account role/status, password hash and salt, session/CSRF token hashes, timestamps, rate-limit bucket hashes, and minimal owner audit events. It also sets a random session cookie and a CSRF cookie in the browser. Cloudflare may separately process request metadata such as IP address for platform operation; the app does not store raw client IP values in its rate-limit table.

Web Push stores each active device's HTTPS endpoint, P-256 public key, authentication secret, account owner, and limited timestamps in D1. An endpoint is a bearer-style capability, so it is not returned from account APIs and is deleted when a user removes a device. Device display state is not available from the push protocol.

The schema includes tables for encrypted contacts, location, notifications, check-ins, and communication attempts. Encrypted contacts, recipient-specific encrypted location envelopes, check-in scheduling, server-side overdue processing, category preferences, subscription storage, and the Web Push send path are implemented in source. The Worker rechecks account status, category settings, and (where relevant) trusted-circle consent before each send. It sends only a category and random event identifier; the Service Worker selects generic text, and no location or incident text is included. Push payloads use RFC 8291 encryption and RFC 8292 VAPID authentication through `@block65/webcrypto-web-push` 2.0.0. Only a push-service 2xx response is recorded as `provider_accepted`; browsers do not provide a reliable device-display receipt here.

Push endpoints are capability URLs and subscription keys are sensitive. KinGuardian stores them in D1 so the Worker can address and encrypt the request. They are never returned by an API. The subscription API accepts HTTPS endpoints only from an explicit FCM, Apple, Mozilla, and Windows Push host allowlist, validates the P-256 public key and 16-byte authentication secret, and caps each account at five active devices. The VAPID private key must exist only as a Worker secret or ignored local secret file. The account owner controls deployed code and infrastructure, so D1/hosting operators can access stored push endpoints and subscription keys.

The Web Push pipeline has not been exercised against real browser push services in this workspace. The Cron Worker is capped at one outgoing device request per minute to stay conservative with the Cloudflare Workers Free plan's 10 ms CPU budget. Push is best effort and may be delayed, rejected, or unavailable due to browser, OS, network, quota, or free-plan limits.

## Encryption and key recovery plan

External contacts currently use AES-256-GCM in the browser, with a fresh 96-bit IV per record and a per-user data-encryption key. The data key is wrapped using a key derived from a separate user-held encryption passphrase via PBKDF2-HMAC-SHA-256 and a random salt. The unwrapped key remains in browser memory and is never uploaded, placed in a QR code, or stored in a Worker secret. The normal account password and private-data passphrase serve different purposes.

There is no recovery mechanism, key rotation, or passphrase rotation flow. If a user loses this passphrase, encrypted contact details and the private location-sharing key may be permanently unreadable. A passphrase change must not be done by deleting and recreating the vault because existing records would still use the old key. Do not describe the data as owner-proof or fully end-to-end protected: hosting operators can alter the code delivered to clients, and the device may be compromised.

## Who can see what

- **User:** can view and manage their own external contacts after authentication and local key unlock. They can prepare and review a message, then explicitly ask a device app or WhatsApp to open a composer. Message text is included in the resulting URI/link and may be exposed to the selected app or service. No send or delivery receipt is available.
- **Trusted recipient:** can see the other member's account username and receive preferences. A selected member with location consent and a private vault key can decrypt the location ciphertext for that share. The member receives no external contact details.
- **External contact:** receives no message automatically. A user can prepare a message and explicitly open a composer; the external contact gets no KinGuardian session or access to a private account.
- **Owner:** can see usernames, roles/status, account lifecycle, and audited account actions. The current owner API does not provide a way to read plaintext private data, passwords, or encryption keys. It has no impersonation feature.
- **Hosting operator:** controls the deployed frontend and infrastructure and may be able to alter code or observe service metadata. The architecture cannot guarantee secrecy from a malicious operator.

SMS and ordinary email are not end-to-end encrypted by default. WhatsApp encryption does not protect a compromised device or information copied outside WhatsApp. The app must not equate opening a composer with sending or delivery.

## Sessions, secrets, and operations

Session cookies are intended for HTTPS and use `Secure`, `HttpOnly` (session token), `SameSite=Strict`, and the `__Host-` prefix. Use a separate high-entropy secret for each Worker environment. Configure secrets with Wrangler's secret commands or Cloudflare dashboard; never paste them into a tracked file, issue, log, or frontend source. Rotate secrets if exposed. Existing sessions and rate-limit buckets may need explicit invalidation when secrets change.

Owner bootstrap is a one-time operation. Use a high-entropy secret, keep the generated owner password private, change it at first login, then remove/rotate the bootstrap secret. For member accounts, the owner API creates an opaque inaccessible credential and stores only a salted PBKDF2 hash. The member receives a single-use 24-hour activation link and chooses their password; reset links expire after one hour, revoke the member's sessions, and can be revoked by the owner. The setup token is random, its SHA-256 hash alone is stored, and it is passed only in a URL fragment and removed from browser history before use. Password setup is rate-limited by client address. There is no multi-factor authentication, self-service recovery, or independent security monitoring yet.

Device pairing requests expire after 10 minutes. A 256-bit random token is passed in a URL fragment, stored only as a SHA-256 hash, and removed from browser history. A new device can receive a normal eight-hour session only after a signed-in device explicitly approves; approval, rejection, redemption, and cancellation are conditional one-time database updates. Approval requires a completed-password session and same-origin CSRF validation. Polling and creation are address-rate-limited. The new session row is created in the same D1 batch that consumes the pairing token. A pairing QR is a temporary bearer secret: anyone who obtains it can ask the account holder to approve that request, so approve only a request you personally started.

Review D1 migrations before applying them remotely. Export a backup before production schema/data changes. Database restoration can overwrite current records and requires an explicit recovery decision.

## Known limitations and security review needed

- No independent penetration test or production browser test has been performed.
- Production Pages and D1 exist. Remote migrations `0001`–`0014` are applied. Migration `0015_cloudflare_password_iterations.sql` must be applied before deploying the 100,000-iteration account-password change. A read-only production count found zero user rows, and owner setup remains unused. The scheduled Worker and full authenticated browser flows still need separate verification.
- Authentication, SOS, location, check-in, notification, and contact routes have received source-level and SQLite schema/behavior checks here, not integration tests against Cloudflare D1 or Pages Functions.
- Owner account-management screens, hash-only account setup and reset links, downloadable trusted-circle invitation QR codes, approved device pairing, external encrypted contacts, trusted-circle consent, server-recorded SOS alerts, manual communication composers, encrypted foreground-only location sharing, server-side check-in/grace processing, and Web Push source are implemented. The new account and pairing routes have source-level SQL and state-transition checks, but still require an authenticated browser integration pass. The Web Push code still needs VAPID configuration, explicit browser opt-in, and a real provider/browser run before it can be relied on.
- Password hashing performance has not been measured in Workers. Abuse protection depends on correctly configured secrets and Cloudflare's runtime protections.
- The current authentication design has no MFA or user self-service recovery.
- Offline mode contains static assets only; private responses are not cached. A cached static page is not evidence of a valid session.
- No automatic emergency-services integration exists. The app must never claim it contacted police, ambulance, or another service.

