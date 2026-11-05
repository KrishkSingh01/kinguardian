# KinGuardian

**Your safety. Your trusted circle.**

KinGuardian is a private, zero-budget prototype for a trusted group. It is a responsive Progressive Web App built with HTML, custom CSS, vanilla JavaScript, Cloudflare Pages Functions, Cloudflare Workers, and D1.

> **Prototype status:** Authentication, owner-managed accounts, encrypted external contacts, short-lived QR invitations, member password setup links, approved device pairing, server-recorded SOS alerts, manual SMS/email/WhatsApp composers, encrypted consent-based location shares, scheduled check-ins, notification preferences, and a VAPID Web Push pipeline are implemented in source. Push still needs locally generated keys, an active Cron Worker, and each member’s explicit browser permission; end-to-end push has not been tested here. Browser visual QA remains incomplete because the local preview could not be opened in the Codex browser. Until a real push request is provider-accepted, SOS does not notify contacts; never rely on this prototype for emergencies.

## What is in the project

- A responsive app shell with system, light, and dark themes, keyboard-friendly navigation, and static offline assets.
- Pages Functions for one-time owner setup, sign-in, session checks, sign-out, password changes, and owner-managed member accounts.
- Member passwords are chosen through a short-lived, revocable, single-use setup link; the owner receives no plaintext member password. Device pairing requires explicit approval from an already-signed-in device and grants only a normal eight-hour session.
- An owner account screen and a private contact screen with browser-side encrypted storage and international phone-number parsing.
- Manual, user-reviewed SMS, email, and WhatsApp composer links from encrypted contacts. KinGuardian does not send or confirm these messages.
- Time-limited location sharing encrypted separately for opted-in KinGuardian members. Browser location is requested only after a user click; the page pauses location reads when hidden and expires shares within 15–60 minutes.
- Fourteen numbered D1 migrations, including consent, encrypted-payload, account setup, device pairing, location, check-in, notification, and communication-status tables.
- Static checks and an in-memory SQLite migration check.
- A separate scheduled Worker configuration for location expiry, server-side check-in/reminder processing, consent rechecks, and encrypted Web Push attempts.

Notification events use idempotency keys and per-device retry records. The Worker sends generic, encrypted push content and reports only “provider accepted”; this does not prove a device displayed a notification. The Free-plan Cron path sends at most one device request per minute to keep CPU use bounded.

## Requirements

- Windows 11 x64 (or another supported development OS). Cloudflare currently supports Wrangler on Windows 11.
- **Node.js 26.13.0 LTS with npm** for Wrangler, the browser build, JavaScript tests, and local preview. On Windows x64, install the [official Node.js 26.13.0 LTS installer](https://nodejs.org/dist/v26.13.0/node-v26.13.0-x64.msi), keeping the options to install npm and add Node to PATH enabled. Close and reopen PowerShell, then check:

  ```powershell
  node --version
  npm --version
  npx --version
  ```

- A Cloudflare account for creating a remote D1 database or deploying. Do not create an account just to inspect the local code. Cloudflare credentials are not included in this repository.
- Python 3 is optional; it runs the included static and SQLite migration checks without Node.

The Node.js installer itself is free. No paid APIs or communication providers are configured.

## Run locally

In PowerShell, open this project folder and run:

```powershell
npm ci
npm test
npm audit --audit-level=high
npm run check:release
```

`npm ci` installs the exact versions in `package-lock.json`. Use `npm install` when intentionally changing dependencies, then review the updated lockfile and audit results.
`npm run check:release` makes a clean browser build and checks its public-file allowlist, SHA-256 manifest, exact dependency pins, and known credential patterns.

For the static HTML/JavaScript preview:

```powershell
npm run dev
```

Wrangler normally prints a local address. Open that address in a browser. The app shell can load, but authenticated APIs need local secret bindings. In this workspace the preview is running at `http://127.0.0.1:8788`, all fourteen migrations are applied to local D1, and Wrangler reports no pending migrations. Browser visual QA remains incomplete because the Codex browser safety check refused the preview. The shell also blocks direct loopback HTTP requests, so page responses were not checked from PowerShell. Open the address manually in a regular browser to review it. Wrangler currently falls back to a placeholder `Request.cf` object because this environment cannot resolve `workers.cloudflare.com`.

The Node test suite includes migration, account-security SQL, static accessibility, and frontend checks. Additional dependency-free Python checks are available if Python 3 is installed:

```powershell
python tests\test_static_site.py
python tests\test_migrations.py
python tests\test_security.py
python tests\test_account_security_sql.py
python tests\test_notification_sql.py
python tests\test_accessibility.py
```

## Set up Web Push

After Node.js is installed, generate your own VAPID pair locally:

```powershell
npm run generate:vapid
```

The command prints a public key, private key, and placeholder contact. Replace the placeholder with an email address you control. For local Pages preview, place `VAPID_PUBLIC_KEY` in the root `.dev.vars`. For the scheduled Worker, place all three values in `worker/.dev.vars`. These files are ignored by Git. Do not paste the private key into Pages variables, source files, or chat.

For a Cloudflare deployment, configure the same public key as a Pages variable and as a Worker secret. Configure the private key and contact subject only as Worker secrets. The Worker requires all three values; without them it leaves queued events unsent. Apply migrations locally before trying the feature:

```powershell
npx wrangler d1 migrations apply kinguardian-db --local
```

Each member must sign in, read the settings explanation, and press **Enable on this device** to receive the browser permission prompt. On iPhone and iPad, Web Push requires iOS/iPadOS 16.4 or later and a Home Screen web app; the prompt must follow direct user interaction. [Apple Web Push requirements](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)

## Configure local D1

Read [DATABASE_GUIDE.md](DATABASE_GUIDE.md) before creating or changing a database. The exact required database is `kinguardian-db`, with binding `DB`. The committed Wrangler configs use a local-only placeholder D1 UUID. You can test locally without a Cloudflare account; only remote creation/deployment requires replacing it with the UUID returned by Cloudflare.

Apply schema changes locally before considering any remote database. Remote migrations, backups, secrets, and production deployment require an authorized Cloudflare account operator; none have been performed from this project workspace.

## Accounts and first owner

There is no public registration and no hardcoded password. An authorized operator must configure `OWNER_BOOTSTRAP_SECRET` and `AUTH_RATE_LIMIT_SECRET` as local or Cloudflare secrets. Visit `setup.html` over the configured local or deployed HTTPS origin, enter the one-time bootstrap secret, and save the generated temporary owner password. It is shown once and must be changed at first sign-in. The bootstrap process creates exactly one owner account; it cannot be repeated afterward.

The owner can create, list, disable/reactivate, reset, and revoke sessions for member accounts from the authenticated owner screen. New members choose their own password from a 24-hour one-time setup link. Password resets use a one-hour setup link. Trusted-circle invitations are single-use, expire after 24 hours, and can be shared by downloadable QR or manual code. Device pairing expires after 10 minutes, requires an authenticated device to approve, and can be cancelled or rejected. These flows have Node-level schema, SQL, and source checks; they have not been exercised end to end in a signed-in browser session.

## Privacy, communications, and emergency use

SOS alerts are recorded on the server. When VAPID is configured, an active Worker and recipient subscription exist, the recipient has opted in, and the relationship still permits alerts, the Worker can send a generic encrypted Web Push request. The UI reports push-service acceptance rather than device delivery. External contacts can be reached only through a user-reviewed manual composer. KinGuardian does not automatically send or confirm SMS, email, or WhatsApp messages. Location coordinates are encrypted for each selected KinGuardian member; the server still sees the participants and timing. Coordinates are sent to OpenStreetMap only after the user clicks its map link. Background location and emergency-services integrations are not connected.

Read [SECURITY.md](SECURITY.md) for what the prototype currently protects, its encryption plan, and known limitations. Never enter real emergency or sensitive personal information into a feature marked as preview.

## Deployment

The intended hosting target is Cloudflare Pages with Pages Functions under `/api/*`, D1 binding `DB`, and a separate scheduled Worker for check-ins. The Pages and Cron Worker configs are intentionally separate. No production resources, secrets, migrations, domains, or deployments have been configured. Deployment instructions remain gated on a real D1 UUID, Cloudflare credentials, secret configuration, and an explicit production authorization.

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for Git-connected Cloudflare Pages setup and [RELEASE_SECURITY.md](RELEASE_SECURITY.md) for the M15 release process, security checks, Android status, and the manual steps still required. These guides do not create resources or change production.

## Project map

```text
  index.html, login.html, setup.html, change-password.html, account-setup.html, pair-device.html,
  contacts.html, invite.html, sos.html, location.html
css/                   Design tokens, layout, components, responsive and auth styles
js/                    App shell, authentication, check-ins, contacts, alerts, and message composers
functions/api/         Cloudflare Pages API routes
functions/_shared/     Shared authentication, crypto, validation and response helpers
migrations/            Numbered, additive D1 SQL migrations
worker/                Separate scheduled Worker configuration
tests/                 Structural, migration, browser-state and crypto checks
assets/                Local icons and static assets
```

## Known limitations

- Node.js 26.13.0, npm 11.20.0, and Wrangler 4.158.0 are installed for this workspace. The 32 JavaScript tests pass; `npm run check:release` builds version 0.1.0 and verifies 45 public asset checksums; `npm audit --audit-level=high` reports zero vulnerabilities; and all fourteen migrations are applied to local D1 with none pending. Browser-based visual QA is still pending because the Codex browser safety check prevented opening the local preview. The Codex shell retains its pre-install PATH, so commands in this workspace prepend `C:\Program Files\nodejs` explicitly.
- The design prototype has not received a browser-based visual QA pass.
- Authentication APIs have not been exercised in a signed-in browser session or against production Cloudflare D1/Pages. The shell blocked direct loopback requests, and no local `.dev.vars` secrets are configured.
- External contact details and location-sharing private keys use client-side encryption under a user-held passphrase. Location updates use ECDH P-256 and HKDF per recipient; D1 stores ciphertext but can see account IDs, recipient choices, and timestamps. Key rotation, recovery, forward secrecy, and independent cryptographic review are not implemented. Phone numbers are parsed with the maintained `libphonenumber-js` package and stored in E.164 form; numbers and email addresses are not ownership-verified. Manual composer URLs hand text to the chosen app only after user action; the app cannot verify whether it opened, sent, or delivered the message. The prototype has no passphrase recovery; losing it can make contact details unreadable. Web Push configuration, real browser subscriptions, and provider acceptance have not been exercised here. The free Cron handler sends one device request per minute due to its 10 ms CPU limit; queues can be delayed for groups with many devices or events. QR flows and device pairing have source-level and local schema checks, but authenticated browser integration has not been exercised. Check-in time conversion uses the Worker's IANA timezone database and chooses the first occurrence when a daylight-saving transition repeats a local time.
- Push, geolocation, PWA installation, background work, and secure cookies vary by browser and operating system. See the relevant feature documentation when implemented.

