# KinGuardian release safety

This source produces a static website/PWA and Cloudflare Pages Functions. It does not produce an Android APK.

## Build and verify

From the project root in PowerShell:

```powershell
npm ci
npm test
$env:KG_RELEASE_TYPE = 'production'
npm run check:release
```

The build cleans and recreates `dist/`, bundles browser modules, writes `dist/release-manifest.json`, checks SHA-256 hashes, looks for known secret patterns, and confirms that each Service Worker cache path exists in the public build. The checksum manifest is not a digital signature: a person who can change both an asset and the manifest can make them agree.

Current local result for this source: `npm test` passed with 70 tests. `npm run check:release` passed in production mode with 50 public assets. `npm audit --audit-level=high` could not reach `registry.npmjs.org`, so current package advisory status is unknown. Python tests were not run because no Python interpreter is installed. Browser visual checks were not performed because Codex Work settings disable local browser use; loopback requests to `127.0.0.1` were also blocked by the sandbox.

## Keep these files out of GitHub

The root `.gitignore` already excludes the main generated and private files. Before uploading, make sure these stay out of the repository:

- `.dev.vars`, any `.dev.vars.*` file except the provided example, `.env`, and any real `.env.*` file.
- Passwords, Cloudflare API tokens, VAPID private keys, setup secrets, recovery codes, and any other secret, even if saved under a different filename.
- `node_modules/`, `.wrangler/`, `dist/`, `work/`, `outputs/`, `coverage/`, and `.cache/`.
- Database files (`*.db`, `*.sqlite`, `*.sqlite3`), D1 exports/backups, logs, temporary files, and files whose names contain `backup`.
- APK/AAB files and signing files (`*.jks`, `*.keystore`, `*.p12`, `*.pfx`, `*.pem`, `*.key`, `*.ppk`, `*.mobileprovision`).
- Android/Gradle generated build folders.

The `*.example` secret templates contain placeholders only. Keep them only if they still contain placeholders. Check the GitHub upload list before committing; `.gitignore` is a safety net, not proof that no secret was staged.

## Android status

There is no Capacitor or Android project, app ID, manifest, APK, signing key, or Play Store package here. The current deliverable is a website/PWA. Do not rename the website ZIP or build output to `.apk`, and do not install an APK from an unknown source. Android packaging and signing remain future work.

## Production safety

- Check current production D1 migrations and make a private backup before applying missing migrations. See [DATABASE_GUIDE.md](DATABASE_GUIDE.md).
- Do not deploy a Pages build that expects a schema migration that is not yet applied.
- Do not clear tables to resolve a migration or deployment issue. Stop and preserve the backup if Wrangler reports an unexpected error.
- Confirm the correct Pages project, D1 binding, production environment, and secret configuration before publishing.
- Never use a real emergency as a test. Use test accounts and non-sensitive information.

## Current limits

KinGuardian has no automated SMS, email, WhatsApp, or emergency-service integration. Web Push is best effort. SOS and location behavior still require a real authenticated test on the deployed site. Location is encrypted at rest, not end-to-end. Offline data may be stale and cannot notify trusted people until it syncs.
