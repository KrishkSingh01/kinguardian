# KinGuardian project status

Updated 6 November 2026. This describes the files in this folder. It does not claim that the same code is live on Cloudflare.

## Completed in this source update

- Replaced the daily check-in user flow with Safe Journey timers. Old tables and data remain intact.
- Added a separate recipient choice for Safe Journey alerts. A person who declines this choice will not receive journey updates.
- Added encrypted D1 storage for current location-sharing points and SOS locations. Consent is checked when data is read or sent. Location data is encrypted at rest, but the Worker can decrypt it for a permitted recipient; this is not end-to-end encryption.
- Made SOS use a fixed 10-second cancelable countdown. SOS can still be saved if the user has no trusted recipients, but nobody else is notified in that case.
- Added live SOS location updates only while the SOS page is visible and open. The app cannot track in the background.
- Added local encrypted caches for saved trusted-person, notification, Safe Journey, SOS, and location-sharing status. Offline lists are read-only and may be out of date. An offline SOS stays on the device until a later sync.
- Updated the 3D map integration and public copy. External map tiles still require internet.
- Fixed map points arriving before MapLibre finishes loading: the newest location for each point is now queued safely, with a bounded queue.
- Made Turnstile required for both login and registration. Missing or incomplete Cloudflare keys now fail closed instead of silently disabling the bot check.
- Added migration constraints, location-crypto checks, and a release check that verifies every Service Worker cache path exists in `dist/`.
- Updated setup, database, and security documentation to match the current source.

## Checks completed in this workspace

- `npm test`: 70 passed, 0 failed.
- `$env:KG_RELEASE_TYPE = 'production'; npm run check:release`: passed; built KinGuardian `0.1.0` with 50 SHA-256-listed public assets and no detected secrets or private/server files in `dist/`.
- The Node tests applied all 21 numbered migrations to an in-memory SQLite database and compiled selected application SQL against that schema.
- The new encrypted location helper round-tripped encrypted data and rejected the wrong owner/share context.

## Not verified here

- `npm audit --audit-level=high` could not reach `registry.npmjs.org` (`ENOTFOUND`). Dependency advisory status is unknown.
- Python-only tests could not run; no Python interpreter is installed.
- The Pages website was not visually checked in a browser. Codex Work settings reported local browser use is disabled; I left the user's Brave tabs alone and did not bypass that restriction. A local Wrangler preview started, but sandbox permissions blocked requests to `127.0.0.1`.
- The authenticated Pages API, production D1, VAPID push delivery, map tiles, offline behavior on real devices, and PWA install/update behavior were not tested against live services.
- No independent security review, penetration test, Android package, or APK exists.

## Production status and actions

- The user reports that `https://kinguardian.pages.dev/` is deployed. This workspace is not connected to the GitHub repository and its changes have not been uploaded.
- A screenshot showed migration `0017_daily_checkin_schedules.sql` applied and the scheduled Worker deployed on 6 November 2026. A read-only Wrangler migration check was attempted, but Cloudflare could not be reached because of a connection/proxy restriction. The current remote migration list is unknown; no remote migration was run.
- Migrations `0018_safe_journeys.sql`, `0019_encrypted_location_points.sql`, `0020_journey_connection_permissions.sql`, and `0021_sos_encrypted_locations.sql` are in this source. Check the actual remote list and back up D1 before applying any missing migration. Do not apply by filename guess; Wrangler tracks the sequence.
- This update did not migrate the production database, publish Pages code, deploy the Worker, or change secrets.
- You report that Turnstile is already configured in Cloudflare. This workspace could not verify the live setting. The code requires Production variable `TURNSTILE_SITE_KEY` and encrypted secret `TURNSTILE_SECRET_KEY`; login and registration fail closed if either is missing. Check the status using [TURNSTILE_SETUP.md](TURNSTILE_SETUP.md), without sharing either value.
- Email automation was dropped by the user. No paid messaging provider or automated SMS provider is configured.

## Next actions for the project owner

1. Check that the existing Turnstile settings are in Cloudflare's Production environment and the public status endpoint says `mode: enabled`. Do not share the secret.
2. In PowerShell, check the current D1 migration list and make a private backup. Follow [DATABASE_GUIDE.md](DATABASE_GUIDE.md).
3. Apply missing migrations only after confirming the account and database are correct. Keep the backup outside the project and GitHub.
4. Upload the reviewed source to the existing GitHub repository. Keep the `.gitignore` exclusions and the list in [RELEASE_SECURITY.md](RELEASE_SECURITY.md).
5. Let Cloudflare Pages build from the repository root with `npm run build` and output folder `dist`.
6. Verify the deployed app using test accounts and non-sensitive data. Do not test with a real emergency.

## Important limits

KinGuardian is a prototype, not an emergency service. SOS and notifications are best-effort. No free automatic SMS delivery is configured. Offline data may be stale, and the browser cannot send an alert until it reconnects. The map and its tiles are online services. The app cannot reliably track a person in the background.
