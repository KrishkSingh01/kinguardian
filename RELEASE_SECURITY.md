# KinGuardian release safety

This source produces a static website/PWA, Cloudflare Pages Functions, and a separate React Native app source under `mobile/`. A debug-signed Android APK is available locally under `outputs/`; it is not a Play Store release. There is no iOS app build.

## Build and verify

From the project root in PowerShell:

```powershell
npm ci
npm test
$env:KG_RELEASE_TYPE = 'production'
npm run check:release
```

The build cleans and recreates `dist/`, bundles browser modules, writes `dist/release-manifest.json`, checks SHA-256 hashes, looks for known secret patterns, and confirms that each Service Worker cache path exists in the public build. The checksum manifest is not a digital signature: a person who can change both an asset and the manifest can make them agree.

Current checks: root `npm test` passed with 76 tests; `mobile/npm run typecheck` passed; `mobile/npm test` passed with 6 checks. The Android debug build succeeded for 32-bit and 64-bit ARM. `apksigner` verified its debug signature and `aapt` confirmed Android API 24 minimum and API 36 target. ADB reported no attached device, so phone install and operation remain untested. The full web release build, visual browser check, and live Cloudflare API check were not performed in this update. A prior `npm audit` could not reach `registry.npmjs.org`, so current package advisory status is unknown.

## Keep these files out of GitHub

The root `.gitignore` already excludes the main generated and private files. Before uploading, make sure these stay out of the repository:

- `.dev.vars`, any `.dev.vars.*` file except the provided example, `.env`, and any real `.env.*` file.
- Passwords, Cloudflare API tokens, VAPID private keys, setup secrets, recovery codes, and any other secret, even if saved under a different filename.
- `node_modules/`, `.wrangler/`, `dist/`, `work/`, `outputs/`, `coverage/`, and `.cache/`.
- Database files (`*.db`, `*.sqlite`, `*.sqlite3`), D1 exports/backups, logs, temporary files, and files whose names contain `backup`.
- APK/AAB files and signing files (`*.jks`, `*.keystore`, `*.p12`, `*.pfx`, `*.pem`, `*.key`, `*.ppk`, `*.mobileprovision`).
- Android/Gradle generated build folders.

The `*.example` secret templates contain placeholders only. Keep them only if they still contain placeholders. Check the GitHub upload list before committing; `.gitignore` is a safety net, not proof that no secret was staged.

## Android and iOS status

The React Native source is under `mobile/`. The local debug APK is `outputs/KinGuardian-Android-debug-2026-11-07.apk`; it is debug-signed for testing and sideloading, not a production or Play Store release. Its APK is excluded from GitHub. The phone install and startup still need testing. Android local builds need Android Studio, Android SDK Platform 37 and build tools, platform tools, and a compatible JDK. iOS builds need macOS and Xcode. Native push credentials are not configured. Do not rename a website ZIP or build output to `.apk`, and do not install an APK from an unknown source.

## Production safety

- Check current production D1 migrations and make a private backup before applying missing migrations. See [DATABASE_GUIDE.md](DATABASE_GUIDE.md).
- The source includes migration `0022_mobile_sessions.sql`. Before publishing native auth code, check the remote migration list from this project folder and apply all intended pending migrations in order. Keep the backup outside the project.
- Do not deploy a Pages build that expects a schema migration that is not yet applied.
- Do not clear tables to resolve a migration or deployment issue. Stop and preserve the backup if Wrangler reports an unexpected error.
- Confirm the correct Pages project, D1 binding, production environment, and secret configuration before publishing.
- Never use a real emergency as a test. Use test accounts and non-sensitive information.

## Current limits

KinGuardian has no automated SMS, email, WhatsApp, or emergency-service integration. Web Push is best effort. SOS and location behavior still require a real authenticated test on the deployed site. Location is encrypted at rest, not end-to-end. Offline data may be stale and cannot notify trusted people until it syncs.
