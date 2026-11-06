# KinGuardian

**Your safety. Your trusted circle.**

KinGuardian is a public, zero-budget prototype for people who choose to form a trusted circle. It is a responsive Progressive Web App built with HTML, custom CSS, vanilla JavaScript, Cloudflare Pages Functions, Cloudflare Workers, and D1.

**Budget rule:** KinGuardian must not require paid plans, API credits, SMS, WhatsApp, email, or a custom domain. Read [ZERO_BUDGET_SCOPE.md](ZERO_BUDGET_SCOPE.md) for the free services, limits, and features that cannot honestly be promised without a free delivery provider.

> **Prototype status:** The site is deployed at [kinguardian.pages.dev](https://kinguardian.pages.dev/), but visual browser checks and authenticated API flows have not been completed. Production migration status in earlier notes is stale and must be checked before any database operation. Owner setup and owner-only routes are disabled in this build; legacy source and database records are preserved. Push still needs an active Cron Worker, VAPID keys, and each member’s explicit browser permission; end-to-end push has not been tested. Until real push requests are provider-accepted, SOS does not notify contacts; never rely on this prototype for emergencies.

## What is in the project

- A public responsive landing page, a separate signed-in dashboard, system/light/dark themes, keyboard-friendly navigation, and static offline assets.
- An emerald and forest-green interface with a high-contrast red SOS entry point, plus a network-status panel that records up to twenty browser-reported changes locally only when the signed-in user enables it.
- Pages Functions for public member registration, sign-in, session checks, sign-out, password changes, and recovery codes. Legacy owner setup and owner APIs are excluded from deployed routes.
- Anyone can create a regular member account with a username and password. Members manage their own passwords with one-time recovery codes. Device pairing requires approval from an already-signed-in device.
- A private contact screen with browser-side encrypted storage and international phone-number parsing.
- A free, static emergency-information page with India’s verified nationwide 112 number. Other countries are labeled as not verified; the app does not guess emergency numbers or place calls itself.
- Manual, user-reviewed SMS, email, and WhatsApp composer links from encrypted contacts. KinGuardian does not send or confirm these messages.
- Time-limited location sharing encrypted separately for opted-in KinGuardian members. Browser location is requested only after a user click; the page pauses location reads when hidden and expires shares within 15–60 minutes.
- Daily check-in schedules plus one-time check-ins, with local-time and daylight-saving handling. Missed-check-in alerts depend on the scheduled Worker, consent, push setup, and device support.
- Seventeen numbered D1 migrations, including consent, encrypted-payload, account setup, device pairing, location, daily check-in, notification, and communication-status tables.
- A current implementation and deployment checklist in [PROJECT_STATUS.md](PROJECT_STATUS.md).
- Static checks and an in-memory SQLite migration check.
- A separate scheduled Worker configuration for location expiry, server-side check-in/reminder processing, consent rechecks, and encrypted Web Push attempts.

Notification events use idempotency keys and per-device retry records. The Worker sends generic, encrypted push content and reports only “provider accepted”; this does not prove a device displayed a notification. The Free-plan Cron path processes at most two due daily schedules and sends at most one device request per minute to keep CPU use bounded.

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

`npm run dev` starts the local Pages preview at `http://127.0.0.1:8788`. Open that address in a browser. The preview keeps Wrangler logs and local database state under the ignored `work/local-preview-runtime/` folder; it does not use production D1 or deploy anything. Authenticated APIs need local D1 migrations and local secret bindings. Wrangler may show placeholder `Request.cf` values in local mode; this does not describe the deployed Cloudflare environment. Visual browser QA is still incomplete because browser control is disabled in this workspace.

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

## Database setup

Read [DATABASE_GUIDE.md](DATABASE_GUIDE.md) before changing the database. The existing database is `kinguardian-db`, with binding `DB` and UUID `941f2062-5aad-4e68-ae81-fc1b4fb9d7cb`. Both Wrangler configs use this UUID. Local D1 remains separate from the remote database.

All seventeen migrations are included in local checks. Production migration status must be checked in Cloudflare before applying anything. Migration `0017_daily_checkin_schedules.sql` is additive and preserves existing rows; follow the migration order in `DATABASE_GUIDE.md` before deploying this source update.

## Accounts and password recovery

Public member registration is available from the sign-in page. People choose their own username and password; they do not need an email or phone number. New accounts receive ten one-time recovery codes; the database stores only code hashes. Password recovery uses one code and signs out other sessions. The old owner bootstrap, management pages, owner APIs, and owner-issued password setup routes are excluded from the published build. Their source and migration tables remain in the repository to preserve history and data; ordinary users cannot receive administrative permissions.

Members can replace their recovery codes from Settings after confirming their current password. If someone loses every code and forgets their password, the account cannot currently be recovered. Trusted-circle invitations are single-use and expire after 24 hours. These flows have Node-level schema, SQL, and source checks; they still need live authenticated browser verification.

Sign-in uses a secure cookie that persists across normal browser restarts for up to 14 days, unless you sign out or the session is revoked. Self-registration has no email or phone verification. Optional Cloudflare Turnstile checks are implemented for sign-in and registration, but remain off until the site key and encrypted secret are configured in Cloudflare. Server-side rate limits remain active. Recovery codes are shown once and cannot be restored; keep them privately or replace them while signed in. See [TURNSTILE_SETUP.md](TURNSTILE_SETUP.md) for the free setup steps.

## Privacy, communications, and emergency use

SOS alerts are recorded on the server. When VAPID is configured, an active Worker and recipient subscription exist, the recipient has opted in, and the relationship still permits alerts, the Worker can send a generic encrypted Web Push request. The UI reports push-service acceptance rather than device delivery. External contacts can be reached only through a user-reviewed manual composer. KinGuardian does not automatically send or confirm SMS, email, or WhatsApp messages. Location coordinates are encrypted for each selected KinGuardian member; the server still sees the participants and timing. Coordinates are sent to OpenStreetMap only after the user clicks its map link. Background location and emergency-services integrations are not connected. The emergency page is an informational directory, not an emergency dispatch service.

Read [SECURITY.md](SECURITY.md) for what the prototype currently protects, its encryption plan, and known limitations. Do not rely on the prototype for emergency response.

## Deployment

The user reports that the production site is hosted on Cloudflare Pages at `https://kinguardian.pages.dev`, using D1 database `kinguardian-db`. A screenshot confirms migration `0017_daily_checkin_schedules.sql` is applied and the scheduled Worker is deployed. The updated Pages source still needs to be uploaded to GitHub. See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) and [PROJECT_STATUS.md](PROJECT_STATUS.md).

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for Git-connected Cloudflare Pages setup and [RELEASE_SECURITY.md](RELEASE_SECURITY.md) for the M15 release process, security checks, Android status, and the manual steps still required. These guides do not create resources or change production.

## Project map

```text
  index.html, dashboard.html, login.html, register.html, recover.html, change-password.html, pair-device.html,
  contacts.html, invite.html, sos.html, location.html, emergency.html, privacy.html
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

- Node.js 26.13.0, npm 11.20.0, and Wrangler 4.158.0 are installed for this workspace. Run the JavaScript tests and release checksum check after changes; all seventeen migrations are included in local schema checks. Production migration status must be checked before any database change. Browser visual QA has not been performed in this workspace. The Codex shell retains its pre-install PATH, so commands in this workspace prepend `C:\Program Files\nodejs` explicitly.
- The design prototype has not received a browser-based visual QA pass.
- Authentication APIs have not been exercised in a signed-in browser session or against production Cloudflare D1/Pages. The shell blocked direct loopback requests, and no local `.dev.vars` secrets are configured.
- External contact details and location-sharing private keys use client-side encryption under a user-held passphrase. Location updates use ECDH P-256 and HKDF per recipient; D1 stores ciphertext but can see account IDs, recipient choices, and timestamps. Key rotation, recovery, forward secrecy, and independent cryptographic review are not implemented. Phone numbers are parsed with the maintained `libphonenumber-js` package and stored in E.164 form; numbers and email addresses are not ownership-verified. Manual composer URLs hand text to the chosen app only after user action; the app cannot verify whether it opened, sent, or delivered the message. The prototype has no passphrase recovery; losing it can make contact details unreadable. Web Push configuration, real browser subscriptions, and provider acceptance have not been exercised here. The free Cron handler sends one device request per minute due to its 10 ms CPU limit; queues can be delayed for groups with many devices or events. QR flows and device pairing have source-level and local schema checks, but authenticated browser integration has not been exercised. Check-in time conversion uses the Worker's IANA timezone database and chooses the first occurrence when a daylight-saving transition repeats a local time.
- Push, geolocation, PWA installation, background work, and secure cookies vary by browser and operating system. See the relevant feature documentation when implemented.

