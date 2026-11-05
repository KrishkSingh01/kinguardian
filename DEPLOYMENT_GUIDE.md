# KinGuardian deployment preflight

This guide prepares the M15 Git-connected Cloudflare Pages deployment. No GitHub repository, Cloudflare account integration, remote database, secrets, Pages project, scheduled Worker, or deployment has been created from this workspace.

## 1. Finish local verification first

Install [Node.js 26.13.0 LTS for Windows x64](https://nodejs.org/dist/v26.13.0/node-v26.13.0-x64.msi) with npm and PATH enabled, then reopen PowerShell in the project folder. Node.js is now installed in this workspace; its Node test suite, build, and local D1 migration checks have been run successfully here:

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

All 32 Node.js tests pass. `npm run check:release` builds version 0.1.0 and verifies 45 public asset checksums; `npm audit --audit-level=high` reports zero vulnerabilities. All fourteen migrations are applied to local D1 with none pending. The local preview is running at `http://127.0.0.1:8788`. Open the local address in a regular browser and review the pages at mobile, tablet, and desktop widths. Browser-based visual QA has not been performed because the Codex browser safety check refused to open the local preview. Direct loopback HTTP is blocked from the Codex shell. Wrangler also logs that it cannot resolve `workers.cloudflare.com` for `Request.cf` metadata and uses a placeholder in local mode.

For local owner setup, add strong, unique `OWNER_BOOTSTRAP_SECRET` and `AUTH_RATE_LIMIT_SECRET` values to the ignored root `.dev.vars`. To test push locally, generate VAPID keys with `npm run generate:vapid`, put the public key in root `.dev.vars`, and put the public key, private key, and contact subject in `worker/.dev.vars`. Keep private values on your machine.

## 2. Prepare the GitHub source repository

The source is prepared locally, but this folder currently has no `.git` metadata and Git is not available in the Codex shell. Install Git for Windows and GitHub Desktop, initialize a repository in this existing folder, inspect the staged file list against `.gitignore`, and publish it as private. Keep `.dev.vars`, `.env`, `node_modules`, `.wrangler`, `dist`, databases, backups, APKs, and signing keys out of Git. See [RELEASE_SECURITY.md](RELEASE_SECURITY.md) for the exact beginner steps. No repository has been created or published yet.

Use Git integration when creating the new Cloudflare Pages project. Cloudflare does not allow a Git-integrated project to switch later to Direct Upload, so verify the selected repository, branch, and account before creating the project. See [Cloudflare Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/).

## 3. Configure the remote D1 database

An operator with access to the intended Cloudflare account must sign in with Wrangler and create the required database:

```powershell
npx wrangler login
npx wrangler d1 create kinguardian-db
```

Copy the returned database UUID into `database_id` in both `wrangler.toml` and `worker/wrangler.toml`. Keep the database name `kinguardian-db` and binding name `DB`. Do not deploy while either config still contains the all-zero placeholder UUID.

The Pages config includes `pages_build_output_dir`, so Wrangler uses that file as the Pages deployment configuration. Review it against the intended production settings before publishing; it already has an explicit `2026-11-05` compatibility date and still contains the local placeholder D1 UUID until an authorized operator replaces it. See [Cloudflare Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

Review the remote migration list and the SQL files before any production migration:

```powershell
npx wrangler d1 migrations list kinguardian-db --remote
```

Export and verify a backup before applying schema changes to an existing production database. Applying migrations to production changes remote data and schema and requires explicit production authorization:

```powershell
npx wrangler d1 migrations apply kinguardian-db --remote
```

The current fourteen migrations passed the Node SQLite migration checks and were applied to the local D1 emulator only. They have not been applied to Cloudflare D1.

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

After creating the Pages project, Wrangler can prompt for each Pages secret value without placing it in the command history:

```powershell
npx wrangler pages secret put OWNER_BOOTSTRAP_SECRET --project-name kinguardian
npx wrangler pages secret put AUTH_RATE_LIMIT_SECRET --project-name kinguardian
npx wrangler pages secret put VAPID_PUBLIC_KEY --project-name kinguardian
```

The VAPID public key may instead be configured as a non-secret Pages variable. The private key must never be configured on Pages.

## 5. Connect Pages to GitHub

In Cloudflare, open **Workers & Pages > Create application > Pages > Connect to Git**. Authorize GitHub, select the private `kinguardian` repository, then choose the production branch. Use these project settings:

| Setting | Value |
| --- | --- |
| Framework preset | None / Other |
| Root directory | Repository root (default) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | `26.13.0` |
| `KG_RELEASE_TYPE` | `production` for production; `preview` for preview branches |

The build keeps `functions/` at the repository root, where Pages discovers Functions; only browser assets are written to `dist/`. The Pages Wrangler config includes `pages_build_output_dir`. Review its D1 binding and compatibility settings against the dashboard before the first deployment, and keep both configuration sources aligned. Do not click **Save and Deploy** until the intended account, repository, D1 UUID, bindings, and secrets have been reviewed and production deployment is explicitly authorized. See [Cloudflare build settings](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [Wrangler Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

The scheduled Worker is a separate project and is not deployed as part of Pages. After its D1 UUID is correct and its deployment is explicitly authorized, deploy it once before adding Worker secrets. `wrangler secret put` immediately publishes a new Worker version, so the push path remains inactive until all three values are present and valid:

```powershell
npm run deploy:checkins
npx wrangler secret put VAPID_PUBLIC_KEY --config worker/wrangler.toml
npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml
npx wrangler secret put VAPID_SUBJECT --config worker/wrangler.toml
```

The Worker runs every minute and attempts at most one device push per tick. The push path records provider acceptance, not proof of display or receipt.

## 6. Verify a deployment safely

After an authorized deployment, verify the public app shell and static assets, then check Pages Function health and owner bootstrap status without creating real member accounts until access is restricted. Create the owner once, save the temporary password securely, and change it at first sign-in. Configure member accounts manually through the owner interface.

Use the notification test action to validate a deliberately subscribed test device. Do not use a real SOS as a deployment test. Confirm the UI says “provider accepted” only after a push service returns success; it cannot confirm a device displayed a notification. Do not enter real emergency or sensitive personal information until the security and browser review is complete.

## Current M15 status

Local source, the release-security guide, exact Node build version, allow-listed PWA build, and checksum verifier are prepared. The 32-test Node suite passes, the release check verifies 45 assets, npm audit reports zero vulnerabilities, and migrations `0001`–`0014` have been applied to local D1 only. Git is unavailable in this Codex shell and the folder has no `.git` metadata, so the private GitHub repository still needs to be initialized and published by the user. A Cloudflare account operator must still connect GitHub, create the remote D1 database, configure secrets and bindings, review and apply production migrations, and explicitly authorize deployment. No APK exists or has been signed or scanned. Browser visual review and public HTTPS verification remain outstanding. No production resources, secrets, migrations, or deployments have been created or changed.
