# KinGuardian database guide

KinGuardian uses Cloudflare D1, which is SQLite-compatible. The required database name is `kinguardian-db`; the application binding is `DB`.

## Before using Wrangler

Install [Node.js 26.13.0 LTS for Windows x64](https://nodejs.org/dist/v26.13.0/node-v26.13.0-x64.msi) with npm. Reopen PowerShell after installation. From this project directory run:

```powershell
npm ci
```

Wrangler is a local development dependency in `package.json`.

## Configure local D1

The root Wrangler config includes a local-only all-zero D1 UUID and `preview_database_id = "DB"`. Cloudflare Pages uses this preview binding for local development. Local setup does not require creating a remote D1 database or signing in to Cloudflare. The first local Wrangler run creates its own local database state; apply migrations with `--local` only.

```powershell
npm run build
npx wrangler d1 migrations list kinguardian-db --local
npx wrangler d1 migrations apply kinguardian-db --local
npm run dev
```

Use `npm run dev` to start the Pages preview at `http://localhost:8788`. In this workspace the server reports ready at `http://127.0.0.1:8788`, all fourteen migrations are applied to local D1, and Wrangler reports no pending migrations. The local schema has 30 tables including Wrangler's migration metadata. Visual QA remains pending because the Codex browser refused the preview under its safety restrictions; the shell also blocks direct loopback HTTP requests. Open the address manually in a regular browser. Wrangler currently falls back to a placeholder `Request.cf` object because this environment cannot resolve `workers.cloudflare.com`.

The sign-in and one-time owner setup routes also need local secrets. In a regular PowerShell window, generate two different values:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
```

Create an ignored `.dev.vars` file in the project root and enter the first value after `OWNER_BOOTSTRAP_SECRET=` and the second after `AUTH_RATE_LIMIT_SECRET=`. Do not use example strings as credentials, and do not commit `.dev.vars`. These secrets are local-only; production secrets must be configured separately with Wrangler or in Cloudflare settings.

## Create and configure a remote database

Sign in to the Cloudflare account that will own the prototype, then run:

```powershell
npx wrangler d1 create kinguardian-db
```

This creates a remote D1 database and returns its UUID. Copy that UUID into the `database_id` field in both `wrangler.toml` and `worker/wrangler.toml`, replacing the local-only all-zero value. Keep `database_name = "kinguardian-db"`, `binding = "DB"`, and the Pages `preview_database_id = "DB"` unchanged. Do not copy credentials or the UUID into application JavaScript.

Database creation requires Cloudflare account access. No Cloudflare account, database, or binding has been created from this workspace.

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

Wrangler asks for confirmation interactively and records a backup after applying. This project has not applied remote migrations. [Cloudflare D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)

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

The fourteen migrations create the prototype tables and add the encrypted international-contact envelope, default-off location consent, encrypted account-sharing keys, recipient-specific encrypted location envelopes, per-device Web Push delivery state, hash-only account setup tokens, and short-lived device-pairing requests. Safety check-ins use `safety_checkins` and `safety_checkin_recipients`. The scheduled Worker marks overdue check-ins and creates idempotent events, then makes a bounded push attempt when VAPID and recipient consent are configured. A `provider_accepted` status is not a delivery receipt. All fourteen migrations have been applied to the local D1 emulator only; none have been applied remotely.

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
- **Invalid database ID:** copy the UUID returned by `wrangler d1 create` into both Wrangler files.
- **Binding not found:** the binding must be exactly `DB` in the Pages and scheduled Worker configurations.
- **No local data appears:** Wrangler’s local D1 database is separate from remote D1. Confirm you used `--local` consistently and did not change the configured database UUID.
- **Migrations are pending:** run `npx wrangler d1 migrations list kinguardian-db --local` and apply locally before testing.
- **Quota errors:** reduce full-table scans, add indexes, and review current D1 Free quotas. If a quota is exceeded, the Free plan can return query errors until its reset.
