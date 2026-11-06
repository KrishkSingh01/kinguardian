# KinGuardian deployment status and next steps

The Git-connected Cloudflare Pages project `kinguardian` is deployed at [https://kinguardian.pages.dev/](https://kinguardian.pages.dev/) from the `main` branch. Cloudflare reported a successful deployment after the Root directory field was left blank. The build uses `npm run build` and `dist`.

The D1 database `kinguardian-db` exists. Its UUID is `941f2062-5aad-4e68-ae81-fc1b4fb9d7cb`, and the GitHub Wrangler files now use that UUID. This local project folder is an export without `.git` metadata, so edits made here do not automatically update GitHub. The live D1 migration state and production secrets still need to be checked in the Cloudflare account. The deployed page has not received a visual browser check because the computer-use safety check blocked navigation to it.

## 1. Finish local verification first

Node.js 26.13.0 is already installed. Open a new PowerShell window in the project folder so `node`, `npm`, and `npx` are available. Do not reinstall Node.js. These are the local checks:

```powershell
node --version
npm --version
npx --version
npm ci
npm test
npm audit --audit-level=high
npm run check:release
npx wrangler d1 migrations apply kinguardian-db --local
npm run dev
```

The Node.js test suite and release check are run after code changes. All sixteen migrations are included in local schema checks. Start the local preview with `npm run dev`, then open its address in a regular browser; visual QA has not been completed. Wrangler may show placeholder `Request.cf` values in local mode.

For local sign-in, add a strong `AUTH_RATE_LIMIT_SECRET` to the ignored root `.dev.vars`. Owner setup is disabled in the published app. To test push locally, generate VAPID keys with `npm run generate:vapid`, put the public key in root `.dev.vars`, and put the public key, private key, and contact subject in `worker/.dev.vars`. Keep private values on your machine.

## 2. Keep the local folder and GitHub in sync

The GitHub repository already exists and is connected to Cloudflare Pages. This workspace copy has no `.git` metadata and Git is unavailable in the Codex shell, so changes made here are not pushed to GitHub. Before using any locally edited files, compare them with the GitHub version and upload only the intended source and documentation files. Keep `.dev.vars`, `.env`, `node_modules`, `.wrangler`, `dist`, databases, backups, APKs, and signing keys out of Git. See [RELEASE_SECURITY.md](RELEASE_SECURITY.md) for the exclude list.

## 3. Check the remote D1 database

The remote database already exists. Do not create another one. Both Wrangler files should use the UUID shown above and binding `DB`. To check the remote migration list from your own PowerShell:

```powershell
npx wrangler login
npx wrangler d1 migrations list kinguardian-db --remote
```

The list command is read-only. At the last recorded check, production D1 migrations `0001`–`0014` were applied and `0015_cloudflare_password_iterations.sql` was pending. Apply `0015` before any account is created; its guard stops if users exist. Apply `0016_account_recovery_codes.sql` before deploying registration and password recovery. Migration `0016` only adds a table and can be applied after users exist.

The Pages config includes `pages_build_output_dir`, so Wrangler reads that file for the Pages configuration. Both local Wrangler files now match the D1 UUID used in GitHub. See [Cloudflare Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

Back up production D1 before the pending production migration:

```powershell
npx wrangler d1 migrations list kinguardian-db --remote
```

Apply the pending migration before the Pages code deployment:

```powershell
npx wrangler d1 migrations apply kinguardian-db --remote
```

At the last recorded check, production D1 had migrations `0001`–`0014` applied and migration `0015_cloudflare_password_iterations.sql` pending. It safely refuses to run if the `users` table is non-empty. Apply `0015` before creating an account, then apply `0016_account_recovery_codes.sql` before deploying the matching Pages Functions code.

## 4. Configure secrets and bindings

Use only the intended Cloudflare account. Do not put secret values in source files, this guide, Git, or chat.

Pages needs the `DB` binding and these values:

- `AUTH_RATE_LIMIT_SECRET` — independent secret with at least 32 characters.
- `VAPID_PUBLIC_KEY` — the public key matching the scheduled Worker's VAPID pair.
- Optional Turnstile: `TURNSTILE_SITE_KEY` as a public variable and `TURNSTILE_SECRET_KEY` as an encrypted secret. Both are required to enable the free login and registration bot check. See [TURNSTILE_SETUP.md](TURNSTILE_SETUP.md). The bot check remains off when both are absent and fails closed if only one is set.

The Worker needs the same `DB` binding and:

- `VAPID_PUBLIC_KEY` — the same public key configured for Pages.
- `VAPID_PRIVATE_KEY` — private secret; never expose it to the browser.
- `VAPID_SUBJECT` — a real operator contact such as `mailto:you@example.com`.

The Pages bindings are described in `wrangler.toml`; the scheduled Worker binding and Cron schedule are in `worker/wrangler.toml`. Confirm both point to the same production D1 UUID. Add secret values before deploying code that relies on them. Cloudflare documents [Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/) and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

For the existing Pages project, the simplest way to add secrets is Cloudflare **Workers & Pages > kinguardian > Settings > Variables and Secrets**. Select **Production**, add the secret, choose **Encrypt**, and save. If you use Wrangler instead, these commands prompt for secret values without placing them in command history:

```powershell
npx wrangler pages secret put AUTH_RATE_LIMIT_SECRET --project-name kinguardian
npx wrangler pages secret put VAPID_PUBLIC_KEY --project-name kinguardian
```

The VAPID public key may instead be configured as a non-secret Pages variable. The private key must never be configured on Pages.

## 5. Connect Pages to GitHub

The Pages project is already connected to the GitHub repository `KrishkSingh01/kinguardian` on `main`. Keep these settings in the existing project:

| Setting | Value |
| --- | --- |
| Framework preset | None / Other |
| Root directory | Leave the Path field empty (Cloudflare uses the repository root) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | `26.13.0` |
| `KG_RELEASE_TYPE` | `production` for production; `preview` for preview branches |

The build keeps `functions/` at the repository root, where Pages discovers Functions; only browser assets are written to `dist/`. The Pages Wrangler config includes `pages_build_output_dir`. Keep its D1 binding and compatibility settings aligned with the existing Cloudflare project. See [Cloudflare build settings](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [Wrangler Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

The scheduled Worker is a separate project and is not deployed as part of Pages. Its D1 UUID is set in the source config, but its deployment and VAPID secrets have not been verified here. `wrangler secret put` immediately publishes a new Worker version, so review the Worker settings and get production authorization before publishing it. The push path remains inactive until all three values are present and valid:

```powershell
npm run deploy:checkins
npx wrangler secret put VAPID_PUBLIC_KEY --config worker/wrangler.toml
npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml
npx wrangler secret put VAPID_SUBJECT --config worker/wrangler.toml
```

The Worker runs every minute and attempts at most one device push per tick. The push path records provider acceptance, not proof of display or receipt.

## 6. Verify a deployment safely

After an authorized deployment, verify the app shell, registration page, recovery page, and Pages Function health. New members create their own accounts and save their recovery codes. Owner setup and owner administration are disabled in this build.

Use the notification test action to validate a deliberately subscribed test device. Do not use a real SOS as a deployment test. Confirm the UI says “provider accepted” only after a push service returns success; it cannot confirm a device displayed a notification. Do not enter real emergency or sensitive personal information until the security and browser review is complete.

## Current status

- Cloudflare reported that the Pages project deployed successfully to `https://kinguardian.pages.dev/`. The previous failure was caused by entering `repository root` as a folder name; leaving the Root directory Path blank fixed the build.
- GitHub has the real D1 UUID in both Wrangler files. This local export has now been updated to match.
- `npm test`: 32 passed, 0 failed. `npm run check:release`: passed with 45 SHA-256-checked public assets. The build used `development` locally; Cloudflare's project form had `KG_RELEASE_TYPE=production`.
- Current npm advisory status could not be checked because this environment could not resolve `registry.npmjs.org`. Python-only test scripts could not run because Python is not installed in the available shell.
- Production migration notes in this document are historical and may be stale. Read the remote migration list before any database action; this code update itself does not add a migration. The scheduled Worker, VAPID push, and authenticated API flows remain unverified. No APK exists or has been signed.
- Visual verification of the public site remains incomplete because the computer-use safety restriction prevented browser automation.

## Manual production update

This UI and route update does not include a database migration. Before changing production D1, check its current migration list and create a backup. Do not apply historical migrations based only on this guide.

If you choose to publish the reviewed build, run the build and release checks first. These commands build the static files; they do not migrate D1 or deploy the site.

```powershell
Set-Location 'C:\Users\krish\Downloads\KinGuardian\kinguardian-source-0.1.0\kinguardian'
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
$env:KG_RELEASE_TYPE = 'production'
npm.cmd ci
npm.cmd test
npm.cmd run check:release
```

Wrangler must already be logged into the intended Cloudflare account. Keep any exported database backup and secret values outside the project and GitHub repository.

These commands do not publish the site or change the remote database. After you upload the reviewed files to the connected GitHub repository, Cloudflare Pages can build and publish them using its existing settings.

The Pages build excludes legacy owner setup/admin routes and screens. It preserves old owner-related database records and migrations; no database cleanup is needed for this UI change.
