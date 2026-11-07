# KinGuardian

**Your safety. Your trusted circle.**

KinGuardian is a free website and installable Progressive Web App (PWA) prototype. It uses Cloudflare Pages, Pages Functions, Workers, and D1. There is no paid service or automatic SMS/email provider in the project.

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

The old daily check-in feature is no longer in the public app. Its database history and migration files are kept so existing data is not deleted. Legacy owner and vault routes are excluded from the published build.

## Current project status

The user reports the site is hosted at [kinguardian.pages.dev](https://kinguardian.pages.dev/). The files in this folder have not been deployed from this workspace. The latest remote database migration list, live account flows, real push delivery, and website visuals have not been checked here. Migrations `0018`–`0021` need to be checked against the live D1 list before deploying this source.

The source is a PWA, not an Android app. There is no APK or Android signing key in this folder.

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

The project now contains 21 numbered migrations. Migration `0017` was shown as applied in the user's 6 November 2026 screenshot. The current production state after that screenshot is unknown. Check it with Wrangler and make a private backup before any production migration. The new Safe Journey and location changes depend on migrations `0018` through `0021`; do not publish matching server code until the live database has all required migrations.

See [DATABASE_GUIDE.md](DATABASE_GUIDE.md). No production migration or deployment was run by this update.

## Free service limits and known gaps

- There is no automated SMS, email, WhatsApp, or emergency-service calling provider. Browser Web Push is the only automated notice channel in the current design, and it remains best effort.
- You report that Turnstile is already configured in Cloudflare. The live status could not be verified here. This source requires both the Production variable `TURNSTILE_SITE_KEY` and encrypted secret `TURNSTILE_SECRET_KEY`; it blocks sign-in and registration if either is missing.
- This project stays on free Cloudflare services. Free quotas can delay or reject work.
- No visual browser QA, authenticated production API test, live push receipt test, independent security audit, or Android build has been completed here.
- `npm audit --audit-level=high` could not reach `registry.npmjs.org` in this environment, so the current advisory status is unknown.
- The Python test scripts were not run because a Python interpreter is not installed in this environment.

See [PROJECT_STATUS.md](PROJECT_STATUS.md), [SECURITY.md](SECURITY.md), and [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) before sharing the site with real users.
