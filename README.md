# KinGuardian

**Your safety. Your trusted circle.**

KinGuardian is a free website/PWA and a separate React Native app source for Android and iOS. The website uses Cloudflare Pages, Pages Functions, Workers, and D1. No paid service or automatic SMS/email provider is configured.

> **Please read:** KinGuardian is not an emergency service. It does not call emergency services. SOS and push alerts are best effort and have not been verified in a live production test. In immediate danger, call your local emergency number directly.

## What the current source includes

- Public username-and-password registration, sign-in, password change, and one-time recovery codes. Email and phone verification are not set up. Cloudflare Turnstile is required for sign-in and registration; if its two Cloudflare values are missing, those actions fail closed until the site owner configures them. See [TURNSTILE_SETUP.md](TURNSTILE_SETUP.md).
- Trusted-person requests by username. Both people must accept, and each recipient chooses which SOS, Safe Journey, and location notices they allow.
- A 10-second cancelable SOS countdown. KinGuardian saves the SOS in D1 and may prepare in-app and Web Push notices for selected trusted members. Push needs Worker configuration, a device subscription, and browser permission; acceptance by a push service does not prove a person saw the alert.
- Safe Journey timers with an expected return time, a password check to complete or extend while online, and an offline return note that is checked after reconnecting.
- Opt-in location sharing with expiry. Location points are encrypted before they reach D1, but the KinGuardian server can decrypt them for permitted recipients. This is **not end-to-end encryption**. Updates stop when the page is hidden or closed.
- An interactive OpenFreeMap/OpenStreetMap map, with 3D buildings where map data supports them. Map tiles need internet and the map provider can see the area your browser requests.
- A static emergency information page. India’s nationwide number 112 is included; the site does not guess numbers for other countries.
- A small offline app shell and browser-local encrypted snapshots. Offline SOS records wait on the device until they can sync. Offline use does not notify anyone.
- A separate native app in `mobile/` for accounts, trusted people, consent settings, SOS, test alerts, Safe Journeys, history, and foreground maps. It shares the website API. A debug APK has been built for 32-bit and 64-bit ARM Android phones; it has not yet been installed or tested on a physical phone. There is no iOS build.

The old daily check-in feature is no longer in the public app. Its database history and migration files are kept so existing data is not deleted. Legacy owner and vault routes are excluded from the published build.

## Current project status

The user reports the site is hosted at [kinguardian.pages.dev](https://kinguardian.pages.dev/). These local changes have not been deployed. The latest remote D1 migration list, live account flows, real push delivery, and website visuals have not been checked here. Check all pending migrations and back up D1 before deploying code that depends on them.

The debug APK is at `outputs/KinGuardian-Android-debug-2026-11-07.apk`. It is signed with Android's debug key for testing and sideloading; it is not a Play Store release. Android API 24 and later is declared supported, including Android 10 and 14. A physical-device run is still needed. The APK and `outputs/` folder are excluded from GitHub.

## Requirements and local checks

Node.js `26.13.0` and npm are already installed on the user's computer. Open a new PowerShell window in this folder, then run:

```powershell
node --version
npm --version
npm ci
npm test
npm run check:release
```

The current Node suite checks migrations and SQL, authentication helpers, encryption helpers, static accessibility, and UI behavior. It does not replace tests against the live Cloudflare services or a visual browser review.

To check the native app source, run these commands from `mobile/`:

```powershell
npm ci
npm run typecheck
npm test
```

To run a local Pages preview:

```powershell
npm run dev
```

Open the local URL Wrangler prints. The local database is separate from production. To sign in locally, create an ignored `.dev.vars` file and set `AUTH_RATE_LIMIT_SECRET` to a strong random value. Never upload `.dev.vars`, `.env`, a D1 export, or Wrangler state to GitHub.

## Build and GitHub upload

Cloudflare Pages should build from the repository root with:

| Setting | Value |
| --- | --- |
| Framework | None / Other |
| Root directory | Leave the path blank |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `26.13.0` |
| `KG_RELEASE_TYPE` | `production` for production builds; `preview` for previews |

Keep `functions/` and `migrations/` at the repository root. Upload the source files, not `node_modules/`, local secrets, private database exports, or APK/signing files. See [RELEASE_SECURITY.md](RELEASE_SECURITY.md) for the full exclude list and [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for the safe order.

## Database changes

The project now contains 22 numbered migrations. Migration `0022_mobile_sessions.sql` adds hashed, rotating refresh tokens for native sessions. The remote database state is unknown. From this project folder, use Wrangler to list pending migrations and make a private D1 backup before applying. Wrangler applies every migration still pending in this folder, in order. Do not deploy code that depends on a migration until that migration is applied.

See [DATABASE_GUIDE.md](DATABASE_GUIDE.md). No production migration or deployment was run by this update.

## Free service limits and known gaps

- There is no automated SMS, email, WhatsApp, or emergency-service calling provider. Browser Web Push is the only automated notice channel in the current design, and it remains best effort.
- Native push delivery is not configured. The app does not claim that a notification was delivered.
- The native app requests foreground location only after the user taps the map control. Background tracking and offline map downloads are not enabled.
- You report that Turnstile is already configured in Cloudflare. The live status could not be verified here. This source requires both the Production variable `TURNSTILE_SITE_KEY` and encrypted secret `TURNSTILE_SECRET_KEY`; it blocks sign-in and registration if either is missing.
- This project stays on free Cloudflare services. Free quotas can delay or reject work.
- No visual browser QA, authenticated production API test, live push receipt test, independent security audit, or physical Android device test has been completed here. The debug APK does build and its signature and Android version metadata were checked.
- `npm audit` could not reach `registry.npmjs.org` in this environment, so current package advisory status could not be checked.
- The Python test scripts were not run because a Python interpreter is not installed in this environment.

See [PROJECT_STATUS.md](PROJECT_STATUS.md), [SECURITY.md](SECURITY.md), [MOBILE_CONVERSION_PLAN.md](MOBILE_CONVERSION_PLAN.md), and [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) before sharing the site or app with real users.
