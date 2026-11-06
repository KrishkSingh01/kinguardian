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

For local owner setup, add strong, unique `OWNER_BOOTSTRAP_SECRET` and `AUTH_RATE_LIMIT_SECRET` values to the ignored root `.dev.vars`. To test push locally, generate VAPID keys with `npm run generate:vapid`, put the public key in root `.dev.vars`, and put the public key, private key, and contact subject in `worker/.dev.vars`. Keep private values on your machine.

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

- `OWNER_BOOTSTRAP_SECRET` — secret with at least 32 characters, used once to create the owner.
- `AUTH_RATE_LIMIT_SECRET` — independent secret with at least 32 characters.
- `VAPID_PUBLIC_KEY` — the public key matching the scheduled Worker's VAPID pair.

The Worker needs the same `DB` binding and:

- `VAPID_PUBLIC_KEY` — the same public key configured for Pages.
- `VAPID_PRIVATE_KEY` — private secret; never expose it to the browser.
- `VAPID_SUBJECT` — a real operator contact such as `mailto:you@example.com`.

The Pages bindings are described in `wrangler.toml`; the scheduled Worker binding and Cron schedule are in `worker/wrangler.toml`. Confirm both point to the same production D1 UUID. Add secret values before deploying code that relies on them. Cloudflare documents [Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/) and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

For the existing Pages project, the simplest way to add secrets is Cloudflare **Workers & Pages > kinguardian > Settings > Variables and Secrets**. Select **Production**, add the secret, choose **Encrypt**, and save. If you use Wrangler instead, these commands prompt for secret values without placing them in command history:

```powershell
npx wrangler pages secret put OWNER_BOOTSTRAP_SECRET --project-name kinguardian
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

After the database migrations and an authorized deployment, verify the public app shell, registration page, recovery page, and Pages Function health. Create the owner once, save the temporary password and recovery codes privately, and change the password at first sign-in. Members can then register themselves and save their own recovery codes. The owner test panel can run read-only service checks and create a safe test SOS; it does not notify contacts.

Use the notification test action to validate a deliberately subscribed test device. Do not use a real SOS as a deployment test. Confirm the UI says “provider accepted” only after a push service returns success; it cannot confirm a device displayed a notification. Do not enter real emergency or sensitive personal information until the security and browser review is complete.

## Current status

- Cloudflare reported that the Pages project deployed successfully to `https://kinguardian.pages.dev/`. The previous failure was caused by entering `repository root` as a folder name; leaving the Root directory Path blank fixed the build.
- GitHub has the real D1 UUID in both Wrangler files. This local export has now been updated to match.
- `npm test`: 32 passed, 0 failed. `npm run check:release`: passed with 45 SHA-256-checked public assets. The build used `development` locally; Cloudflare's project form had `KG_RELEASE_TYPE=production`.
- Current npm advisory status could not be checked because this environment could not resolve `registry.npmjs.org`. Python-only test scripts could not run because Python is not installed in the available shell.
- At the last recorded check, production D1 migrations `0001`–`0014` were applied and `0015_cloudflare_password_iterations.sql` was pending. Apply `0015` before creating any account, then apply `0016_account_recovery_codes.sql` before deploying this update. Owner setup was not complete at that check.
- The bootstrap and rate-limit secrets are configured well enough for the status endpoint to report setup available; their values were not read. Owner setup remains unused. The scheduled Worker, VAPID push, and authenticated API flows remain unverified. No APK exists or has been signed.
- Visual verification of the public site remains incomplete because the computer-use safety restriction prevented browser automation.

## Manual production update

At the last recorded check, production D1 had migrations `0001`–`0014` applied and migration `0015_cloudflare_password_iterations.sql` pending. Migration `0015` refuses to run if any user exists. Back up D1 outside the project folder before applying it. Apply migration `0016_account_recovery_codes.sql` after `0015`.

In PowerShell, run these commands from the main project folder. They apply pending database migrations, build and check the production files, then publish the Pages project. Do not create the owner until all steps succeed.

```powershell
Set-Location 'C:\Users\krish\Downloads\KinGuardian\kinguardian-source-0.1.0\kinguardian'
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
npx.cmd wrangler d1 migrations list kinguardian-db --remote
npx.cmd wrangler d1 migrations apply kinguardian-db --remote
$env:KG_RELEASE_TYPE = 'production'
npm.cmd ci
npm.cmd test
npm.cmd run check:release
npx.cmd wrangler pages deploy dist --project-name kinguardian --branch main
```

Wrangler must already be logged into the intended Cloudflare account. Keep any exported database backup and secret values outside the project and GitHub repository.

This Wrangler command publishes from this folder but does not update GitHub. Before a later GitHub-triggered deployment, also commit the changed source files and migration to the connected repository, or GitHub can publish the older code again.

To create the first owner after confirming migrations, binding, and secrets, follow **Create the first owner** in [DATABASE_GUIDE.md](DATABASE_GUIDE.md). The owner ID is generated automatically; the sign-in username is `owner`.
