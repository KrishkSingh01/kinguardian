# KinGuardian database guide

This guide is for the existing Cloudflare D1 database named `kinguardian-db`. Do not create a second database. The binding name is `DB`. The UUID in the current source is `941f2062-5aad-4e68-ae81-fc1b4fb9d7cb`.

The user's screenshot showed migration `0017_daily_checkin_schedules.sql` applied on 6 November 2026. A read-only Wrangler list was attempted from this workspace, but Cloudflare could not be reached because of a connection/proxy restriction. The current remote list is still unknown. Always use Wrangler's live list before a production change.

## 1. Open PowerShell in the project folder

Use a new PowerShell window. If PowerShell blocks `npx.ps1`, call the `.cmd` program directly:

```powershell
Set-Location 'C:\Users\krish\Downloads\kinguardian-source-0.1.0\kinguardian'
& 'C:\Program Files\nodejs\npx.cmd' wrangler d1 migrations list kinguardian-db --remote
```

Replace the folder above with the actual folder where you saved the source. This command only lists migrations; it does not change the database.

## 2. Make a private backup

The backup contains private account, alert, and location data. Keep it outside the project and GitHub.

```powershell
$backupPath = Join-Path $env:USERPROFILE 'Downloads\kinguardian-d1-backup-before-update.sql'
& 'C:\Program Files\nodejs\npx.cmd' wrangler d1 export kinguardian-db --remote --output $backupPath
```

Do not share or upload this file. Use a new filename for each backup so you do not overwrite an older one.

## 3. Review migration order

This source contains migrations `0001` through `0022`:

- `0018_safe_journeys.sql` creates Safe Journey tables and rebuilds notification tables while copying their existing rows. It preserves the old check-in tables and data.
- `0019_encrypted_location_points.sql` adds encrypted location point storage.
- `0020_journey_connection_permissions.sql` adds a default-off Safe Journey consent setting.
- `0021_sos_encrypted_locations.sql` adds an SOS location timestamp and validation triggers. Existing encrypted payload columns were created in `0004`.
- `0022_mobile_sessions.sql` adds storage for hashed, one-use native refresh tokens with a bounded token-family lifetime.

These migrations are numbered and must apply in order. The source update did not apply any remote migration. After the backup, check the Wrangler migration list again. If a migration is pending, confirm which exact files are pending and that this is the right Cloudflare account and database before applying.

To apply the pending migration files from the project root:

```powershell
& 'C:\Program Files\nodejs\npx.cmd' wrangler d1 migrations apply kinguardian-db --remote
```

This changes production. Wrangler may ask you to confirm. Do not accept if the account, database, or migration list looks wrong. Do not use `d1 execute` to replay migration SQL by hand.

After applying, check again:

```powershell
& 'C:\Program Files\nodejs\npx.cmd' wrangler d1 migrations list kinguardian-db --remote
```

Only deploy Pages code that expects migrations after confirming the schema is ready. If the command reports an error, stop and keep the backup; do not retry blindly.

## Local checks

Node's test suite applies all migrations to a temporary in-memory SQLite database. It does not connect to Cloudflare D1.

```powershell
npm test
npm run check:release
```

For a separate local D1 database, run `npx.cmd wrangler d1 migrations apply kinguardian-db --local`. Local D1 is separate from production.

## Data safety

- Do not delete D1 tables or clear user records to fix a failed migration.
- Do not restore a backup over production unless you intentionally choose to replace current data and have confirmed the target time and backup. A restore can overwrite newer changes.
- A D1 export is private data. Keep it outside Git, `dist/`, and any public file-sharing folder.
- The project keeps old check-in schema/history for compatibility. The public site no longer exposes the old check-in feature.
- Location ciphertext can only be decrypted with the same `AUTH_RATE_LIMIT_SECRET` used when it was encrypted. Rotating that secret without first decrypting and re-encrypting saved locations will make those saved points unreadable. Never put the secret in GitHub or chat.
