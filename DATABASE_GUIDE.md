# KinGuardian database guide

KinGuardian uses Cloudflare D1, which is SQLite-compatible. The required database name is `kinguardian-db`; the application binding is `DB`.

## Before using Wrangler

Install [Node.js 26.13.0 LTS for Windows x64](https://nodejs.org/dist/v26.13.0/node-v26.13.0-x64.msi) with npm. Reopen PowerShell after installation. From this project directory run:

```powershell
npm ci
```

Wrangler is a local development dependency in `package.json`.

## Configure local D1

The Wrangler files point to the existing Cloudflare D1 database `kinguardian-db` (UUID `941f2062-5aad-4e68-ae81-fc1b4fb9d7cb`). Local Wrangler mode keeps its own separate database state; use `--local` for local development. Local setup does not change the remote database.

```powershell
npm run build
npx wrangler d1 migrations list kinguardian-db --local
npx wrangler d1 migrations apply kinguardian-db --local
npm run dev
```

Use `npm run dev` to start the Pages preview at `http://localhost:8788`. The local emulator can apply all seventeen migrations. Visual QA remains pending because the Codex browser safety check stopped before opening the preview. Wrangler may fall back to a placeholder `Request.cf` object in local mode.

Sign-in and rate limiting need one local secret. Owner setup is disabled and does not need a bootstrap secret. In PowerShell, generate a value:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
```

Create an ignored `.dev.vars` file in the project root and enter the value after `AUTH_RATE_LIMIT_SECRET=`. Do not use example strings as credentials, and do not commit `.dev.vars`. This secret is local-only; production secrets must be configured separately with Wrangler or in Cloudflare settings.

## Check the existing remote database

The remote database already exists as `kinguardian-db`. Both Wrangler files use its UUID and the application binding name `DB`. The Cloudflare Pages site is deployed at `https://kinguardian.pages.dev/`.

At the last recorded check, production D1 had migrations `0001`–`0014` applied and migration `0015_cloudflare_password_iterations.sql` pending. Apply all pending migrations before deploying registration or password recovery. Migration `0015` requires an empty `users` table; migration `0016_account_recovery_codes.sql` only adds a table and can be applied after accounts exist.

```powershell
npx wrangler login
npx wrangler d1 migrations list kinguardian-db --remote
```

The list command only checks migration status. Review the migration files and make a remote backup before running `npx wrangler d1 migrations apply kinguardian-db --remote`. Applying the schema to the live database changes production and should only be done after you confirm the correct account and database. Do not create another database with the same name.

The local database is stored by Wrangler under its local state directory. It is separate from the remote database. Cloudflare Pages Functions cannot use a remote D1 database through local preview, so continue to use local mode for development.

## Apply production migrations

First inspect the pending list:

```powershell
npx wrangler d1 migrations list kinguardian-db --remote
```

Only after reviewing the exact migration files and taking a backup should an authorized operator run:

```powershell
npx wrangler d1 migrations apply kinguardian-db --remote
```

Wrangler records migration history after applying. Back up production first. Apply migration `0015` before any account is created; apply migration `0016` before deploying registration and recovery-code pages. [Cloudflare D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)

## Owner and legacy setup data

The current public build does not provide an owner account or owner-only administration. Pages excludes `/api/owner/*`, `/api/auth/bootstrap`, `/api/auth/bootstrap-status`, and `/api/auth/setup-password`; the build also omits the old setup pages and scripts. Existing owner rows, audit data, migration files, and legacy route source are preserved. Do not delete or rewrite those records as part of this change. Ordinary registration still creates only `member` accounts.

If `OWNER_BOOTSTRAP_SECRET` remains configured in Cloudflare, this build does not use it. Removing it from Cloudflare is a separate production configuration change. Do not remove or rotate it unless you have confirmed no other deployed release still uses it.

## Inspect tables and data

List tables in the local database:

```powershell
npx wrangler d1 execute kinguardian-db --local --command "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name;"
```

Use `--remote` only when you intentionally need to inspect the remote database. Avoid selecting private contact, location, or encrypted payload values into terminal logs.

## Add a table or column

Create a new, numbered migration instead of changing a migration that may already have been applied:

```powershell
npx wrangler d1 migrations create kinguardian-db describe_the_change
```

Write the SQL in the new file, test it locally, and keep it additive and backward-compatible where possible. To add a column, use `ALTER TABLE ... ADD COLUMN ...` in the new migration, then validate existing and new rows. Do not use `DROP`, destructive rewrites, or data-clearing statements without an explicit data-loss review.

The first fourteen migrations create the prototype tables and add the encrypted international-contact envelope, default-off location consent, encrypted account-sharing keys, recipient-specific encrypted location envelopes, per-device Web Push delivery state, hash-only account setup tokens, and short-lived device-pairing requests. Migration `0015_cloudflare_password_iterations.sql` sets the account-password constraint to 100,000 PBKDF2 rounds, the Cloudflare Workers maximum. Migration `0016_account_recovery_codes.sql` adds a hash-only table for one-time password recovery codes. Migration `0017_daily_checkin_schedules.sql` adds one daily schedule and its selected member links per user; it does not rewrite existing check-ins or user data. Owner/bootstrap tables and tokens are legacy schema retained for compatibility; the public routes are disabled. Check the actual remote migration list before planning production changes; prior status notes may be stale. One-time and daily check-ins use `safety_checkins` and `safety_checkin_recipients`. The scheduled Worker creates one daily occurrence at a time, marks check-ins overdue, and creates idempotent events, then makes a bounded push attempt when VAPID and recipient consent are configured. A `provider_accepted` status is not a delivery receipt.

### Daily check-in release order

The source includes an additive migration and a Pages Function for daily settings. A screenshot from 6 November 2026 confirms that remote migration `0017` is applied and the scheduled Worker was deployed. Do not apply `0017` again. Before a future production database change, check the remote migration list and make a private backup using the steps above.

The remaining release step for this update is publishing the Pages files to GitHub. The scheduled Worker has already been deployed according to the user's screenshot. If a future migration list shows any unexpected pending migration, stop and review it before applying anything.

As checked on 2026-11-05, the Workers Free plan includes 5 million D1 rows read per day, 100,000 rows written per day, and 5 GB total D1 storage. Queries stop working after the daily read/write cap until 00:00 UTC; the free plan does not silently turn an overage into a paid upgrade. The Worker Cron CPU allowance is 10 ms per invocation, so this prototype sends at most one device push per minute. These limits can delay queued notifications. Check the current [D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) before relying on a production schedule.

## Backups and restoration

Export a remote database to a local SQL file before an intentional schema or data change:

```powershell
npx wrangler d1 export kinguardian-db --remote --output=./work/kinguardian-backup.sql
```

The export contains private user data. Keep it out of Git, restrict access, and delete it securely when it is no longer needed. `.gitignore` excludes backup files in `work/`.

D1 also provides Time Travel point-in-time recovery. Cloudflare currently lists a 7-day Time Travel period for the Workers Free plan. A restore changes the live database in place and can overwrite current rows and tables; it is a recovery operation, not a routine test. Inspect the target time, download an export first, and require explicit authorization before restoring. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 plan limits](https://developers.cloudflare.com/d1/platform/limits/)

## Safe database updates

1. Read the migration and confirm it does not drop or rewrite existing data.
2. Apply it to the local database and run `tests/test_migrations.py`.
3. Inspect the local schema and test affected application routes.
4. Export a remote backup and review the remote migration list.
5. Apply remotely only with explicit production authorization.
6. Check the migration list and operational health afterward.

## Troubleshooting

- **Wrangler is not found:** run `npm install` in the project folder and use `npx wrangler ...`.
- **Invalid database ID:** confirm that both Wrangler files use the existing UUID `941f2062-5aad-4e68-ae81-fc1b4fb9d7cb`.
- **Binding not found:** the binding must be exactly `DB` in the Pages and scheduled Worker configurations.
- **No local data appears:** Wrangler’s local D1 database is separate from remote D1. Confirm you used `--local` consistently and did not change the configured database UUID.
- **Migrations are pending:** run `npx wrangler d1 migrations list kinguardian-db --local` and apply locally before testing.
- **Quota errors:** reduce full-table scans, add indexes, and review current D1 Free quotas. If a quota is exceeded, the Free plan can return query errors until its reset.
