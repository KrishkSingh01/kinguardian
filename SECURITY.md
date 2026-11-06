# KinGuardian security and privacy notes

KinGuardian is a prototype, not an emergency service or a security-certified product. Do not rely on it for urgent help. Call your local emergency service directly.

## What the app protects

- Passwords are stored as PBKDF2-HMAC-SHA-256 hashes with random salts and 100,000 rounds. This is the Cloudflare Workers limit used by this project; it is lower than the former 600,000-round setting.
- Session and CSRF tokens are random. The database stores their hashes. Session cookies use HTTPS-only, `HttpOnly`, `Secure`, and `SameSite=Strict` attributes. State-changing routes check same-origin/CSRF protections and use prepared SQL statements.
- Public registration creates a normal `member` account only. Login and registration require Cloudflare Turnstile verification; if its site key or encrypted secret is missing or Siteverify fails, both actions stop. A user gets ten one-time password recovery codes. Only the code hashes are stored. There is no email or phone verification, MFA, or email recovery.
- Trusted-person relationships require both people to accept. Each recipient separately chooses whether to receive SOS, Safe Journey, and location updates.
- Location points are encrypted with AES-GCM before being stored in D1. The encryption key is derived with HKDF from `AUTH_RATE_LIMIT_SECRET`. The server can decrypt the point for a currently permitted recipient, so this is encryption at rest and is **not end-to-end encryption**. Changing `AUTH_RATE_LIMIT_SECRET` without decrypting and re-encrypting existing location data can make old points unreadable.
- Active location shares have an expiry and are stopped or removed when consent is revoked. The browser only requests GPS after a user action. Location updates pause while the page is hidden or closed; background tracking is not supported.
- SOS points use the same at-rest encryption. Only the sender and selected members with an accepted relationship and current SOS permission can retrieve the point. A recipient who revokes consent loses access through the API.
- Offline snapshots are encrypted in IndexedDB with a key created for that browser profile. They are read-only and may be out of date. This does not protect against malware, a compromised browser, or someone controlling the same user profile.
- Push messages use generic text, not coordinates or incident details. D1 stores subscription endpoints and keys so the Worker can contact push services. `provider_accepted` means only that a push service accepted a request; it does not prove that a device displayed it.
- The Service Worker caches public static assets only. It bypasses `/api/` responses.

## Data and third-party services

The app stores account names, password hashes, sessions, trusted relationships and consent, SOS records, Safe Journey timers, notification events, and encrypted location points. Cloudflare also processes service metadata to run the site. Do not enter sensitive personal or emergency information until production behavior has been independently reviewed.

The interactive map loads tiles from OpenFreeMap/OpenStreetMap. The map provider can see which map area the browser requests. Opening an external OpenStreetMap link sends the selected coordinates to that provider. The map requires internet; map tiles are not saved for offline use.

KinGuardian has no automatic SMS, email, WhatsApp, or emergency-service integration. No messaging provider is configured. Web Push is best effort and depends on VAPID configuration, a working scheduled Worker, a supported device, and the user's browser permission.

## Important limitations

- A compromised browser or hosting account can serve changed JavaScript. The hosting operator controls the app code and can access server-side encryption keys.
- At-rest encryption does not hide relationships, timing, selected recipients, or network metadata.
- Users can screenshot or copy information shown to them. Revoking access cannot erase information a recipient already saw.
- Offline SOS and Safe Journey actions are stored locally and do not notify anyone until the device reconnects and authenticates. A device clock can be wrong; an offline timestamp is the device's report, not proof.
- Registration does not verify email or phone and does not offer MFA. Recovery codes are bearer secrets. If all recovery codes are lost and the password is forgotten, the account cannot currently be recovered.
- Free service quotas, network failures, browser settings, OS behavior, and push provider behavior may delay or prevent alerts.
- No independent penetration test, production integration test, visual browser test, or real push delivery test has been completed for this source update.

## Secrets and safe operation

Never upload `.dev.vars`, `.env`, VAPID private keys, D1 exports, Wrangler state, database files, APK signing keys, or passwords. Keep backups outside the project and restrict access. Use a strong, random `AUTH_RATE_LIMIT_SECRET` and keep it stable while encrypted location records depend on it. Review [DATABASE_GUIDE.md](DATABASE_GUIDE.md) before applying migrations. Production backups and restores can affect private user data.

Owner setup/admin routes, old private vault screens, and old daily check-in APIs are excluded from the public Pages build/routes. Their schema and legacy source are preserved where needed for migration history and data safety.
