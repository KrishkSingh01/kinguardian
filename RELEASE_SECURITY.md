# KinGuardian release security

**Current release:** KinGuardian `0.1.0`, web/PWA. Cloudflare reported the Pages deployment succeeded at [kinguardian.pages.dev](https://kinguardian.pages.dev/); visual and authenticated browser checks remain incomplete. This repository does not contain a Capacitor project, Android application ID, APK, app-signing key, or Play Store package. No APK has been built, signed, installed, or scanned.

## Build and verify the web release

Use Node.js `26.13.0` (the version in `.node-version`) and npm from the project root:

```powershell
npm ci
npm test
npm audit --audit-level=high
$env:KG_RELEASE_TYPE = "preview"
npm run check:release
```

For an authorized production build, set `KG_RELEASE_TYPE` to `production` in the Pages **production build environment**. Keep preview builds set to `preview`. Local builds default to `development`. The build removes and recreates the generated `dist/` directory, bundles the browser modules, and writes `dist/release-manifest.json` with the package version, build time, release type, and SHA-256 hash of every other public asset.

The static output is allow-listed: HTML pages, CSS, browser JavaScript, the PWA manifest, service worker, headers/routes files, local icons, and the checksum manifest. `functions/` stays at the repository root where Cloudflare Pages expects it; server routes, Worker source, tests, tools, local state, secrets, and installed dependencies are not copied into `dist/`. Do not manually copy those directories into a public release.

Run `node tools/verify-release.mjs` after a build to confirm the asset hashes, output paths, exact dependency pins, and known secret patterns. The manifest is an integrity aid, **not a digital signature**: if an attacker can replace both a file and the manifest, the hash alone does not prove who published it. Preserve the Git commit and Cloudflare deployment identity alongside any release record.

To calculate a checksum for a file you separately distribute:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\path\to\the\file
```

Share the checksum through a channel users can independently trust. Never publish `.dev.vars`, `.env`, signing files, local databases, user data, Wrangler state, `node_modules/`, or a local backup.

## Android APK status and future signing procedure

Android packaging is not implemented. There is no `android/` project, Capacitor dependency, package/application ID, manifest permission list, debug APK, release APK, or signing identity to inspect. The current deliverable is a PWA. **Do not describe it as an APK or claim it has passed Play Protect.**

If native packaging is later approved and implemented:

1. Install Android Studio and its Android SDK/Build Tools. Decide and check availability of a permanent application ID before publishing the first build; changing it later creates a different Android app.
2. Keep debug builds separate from release builds. Use Android Studio’s **Build > Generate Signed Bundle / APK** flow to create a release artifact, and request only permissions supported by a documented feature.
3. Prefer Play App Signing for Play Store distribution. Store any upload keystore outside this project, keep its passwords in a password manager, and make a separate encrypted backup. Never put keystore files, passwords, or signing environment values in GitHub, source, screenshots, or build logs. Losing a self-managed app-signing key can prevent compatible updates.
4. Verify a signed APK with Android SDK Build Tools’ `apksigner`:

   ```powershell
   apksigner verify --verbose --print-certs .\app-release.apk
   Get-FileHash -Algorithm SHA256 -LiteralPath .\app-release.apk
   ```

   Record the package ID, version, signer certificate fingerprint, build date, release type, and checksum. Keep the APK and its verification record outside the source tree.
5. Scan the final artifact with Windows Security and test installation/update on a supported Android device. Do not disable Play Protect. If Play Protect warns, preserve the exact warning and APK checksum, inspect the build and dependencies, fix any genuine issue, and use Google Play Console’s official appeal path only if evidence supports a false positive.
6. Distribute through Google Play or another official, authenticated channel. Keep the package ID and signer compatible for updates; never silently install an APK or ask users to bypass Android protections.

References: [Android app signing](https://developer.android.com/studio/publish/app-signing), [`apksigner`](https://developer.android.com/tools/apksigner), and [Google Play app verification appeals](https://support.google.com/googleplay/android-developer/answer/2992033).

## PWA updates and browser security

- The Pages `*.pages.dev` URL is the hosted HTTPS endpoint. Its browser behavior has not been visually verified. For a custom domain, enable **Always Use HTTPS** in Cloudflare after its certificate is active.
- `_headers` sets a same-origin Content Security Policy, blocks framing and MIME sniffing, limits browser permissions, and sets a no-referrer policy. Keep third-party script origins out of the policy unless they are reviewed and necessary.
- The versioned Service Worker caches only the approved static shell. It bypasses `/api/` responses and removes only older caches with KinGuardian’s own cache prefix. It does not clear IndexedDB or private browser data during updates.
- Increment `CACHE_NAME` in `service-worker.js` when static behavior changes. Review the cache list whenever adding a page or asset; never add API responses, credentials, private contact data, or location data.
- There is no file upload endpoint or user-upload feature in this release. If one is introduced, validate content and size on the server, use generated safe filenames, and store uploads outside the public static root.
- Browser installability and update behavior still need testing in supported browsers. Do not claim universal PWA, push, background-work, or offline SOS support.

References: [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Pages Functions root directory](https://developers.cloudflare.com/pages/functions/get-started/), [Cloudflare Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/), and [service worker source](service-worker.js).

## Dependency and source checks

The project includes an npm lockfile and exact dependency versions. `npm audit --audit-level=high` checks published npm advisories; it is not malware scanning or an independent security review. `npm run check:release` checks the public output inventory, hashes, prohibited private/executable file types, exact dependency pins, and common credential patterns. The workspace also has source-level authentication, SQL, Service Worker, and static-site tests. These checks do not replace antivirus, a penetration test, or manual review of a new dependency.

Only the browser build is copied to `dist/`. Wrangler and `workerd` are development/runtime tooling and remain under ignored `node_modules/`; neither is packaged into the website. Review dependency changes, lockfile changes, external URLs, permissions, and release files before every public release.

## GitHub repository preparation

The GitHub repository already exists. This exported workspace folder has no `.git` metadata and Git is not available in the Codex shell, so edits here do not update GitHub automatically. `.gitignore` excludes local secrets, databases, logs, backups, installed packages, generated builds, Android build folders, APKs/AABs, and signing keystores. `.dev.vars.example` and `worker/.dev.vars.example` contain placeholders only. Compare local changes with GitHub before uploading them, and do not publish `.dev.vars`, `.env`, databases, backups, APKs, or signing keys.

## Cloudflare Pages and D1 release configuration

The project is custom HTML/CSS/vanilla JavaScript with an esbuild build step, not a named framework preset. For a Git-connected Cloudflare Pages project, use:

| Setting | Value |
| --- | --- |
| Framework preset | None / Other |
| Root directory | Leave the Path field empty (Cloudflare uses the repository root) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | `26.13.0` (also recorded in `.node-version`) |
| `KG_RELEASE_TYPE` | `production` for production builds; `preview` for branch previews |

Cloudflare Pages Git integration cannot later be converted to Direct Upload, so choose the Git integration deliberately. The root `functions/` directory must remain outside `dist/` so Pages can build the API routes.

The remote D1 database already exists as `kinguardian-db`. Both Wrangler files should use UUID `941f2062-5aad-4e68-ae81-fc1b4fb9d7cb` and binding name `DB`. The Pages Wrangler file contains `pages_build_output_dir`; keep dashboard settings and the Wrangler file aligned.

Configure secrets through Cloudflare’s secret settings, never in GitHub or TOML:

- Pages: `OWNER_BOOTSTRAP_SECRET`, `AUTH_RATE_LIMIT_SECRET`, and the public `VAPID_PUBLIC_KEY` variable.
- Scheduled Worker: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- Pages D1 binding: `DB` → `kinguardian-db`.
- Scheduled Worker D1 binding: `DB` → the same `kinguardian-db`.

Confirm the Pages `DB` binding points to this database. Check the production environment and keep production secrets separate from preview secrets. Never place the VAPID private key in Pages, GitHub variables, or browser assets.

Before applying production migrations, review all migration files, confirm the intended account/project/database, and make a backup. Production D1 migrations `0001`–`0014` are applied; `0015_cloudflare_password_iterations.sql` is pending. A read-only count found zero user rows, and owner setup remains unused. The Cloudflare Pages deployment exists; the matching password-hash code has not yet been manually deployed.

References: [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [build settings](https://developers.cloudflare.com/pages/configuration/build-configuration/), [D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/), and [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

## Verification status

- Node.js `26.13.0` and npm are installed for the current workspace.
- `npm test`: 32 passed, 0 failed.
- `npm audit --audit-level=high` could not reach `registry.npmjs.org` in this environment, so current dependency advisory status was not verified.
- `npm run check:release`: passed for KinGuardian `0.1.0` (`development`); all 45 public assets matched their recorded SHA-256 checksums. The build output did not include server source, known credential patterns, or prohibited private/executable file types.
- Source inspection found no dynamic code evaluation (`eval`, `new Function`), HTML string injection APIs (`innerHTML`, `outerHTML`, `insertAdjacentHTML`), remote script tags, file-upload inputs, or iframes in the reviewed app source. This is a scoped source check, not a penetration test.
- No APK, Android permissions, or signing keys exist in the project, so APK signature, installation, update, and Play Protect checks are not applicable yet.
- The local D1 emulator can apply migrations `0001`–`0015`. The remote D1 database and Pages deployment exist; remote migrations `0001`–`0014` are applied and `0015` is pending.
- The site has not received a visual or authenticated browser check; PWA install/update and public HTTPS behavior remain unverified.

## Remaining steps

1. Back up production D1, then apply `0015_cloudflare_password_iterations.sql` with `npx wrangler d1 migrations apply kinguardian-db --remote`. The migration aborts if `users` has any rows.
2. Build and manually deploy the updated Pages Functions code. Keep the existing production `DB` binding and secrets in Cloudflare.
3. Open `/api/auth/bootstrap-status`. When `setupAvailable` is `true`, follow [the owner setup steps](DATABASE_GUIDE.md#create-the-first-owner). The internal owner ID is generated automatically; username is `owner`.
4. Visually inspect the public site and test authenticated flows with non-sensitive test data before inviting anyone. Do not use a real SOS as a test.
5. The scheduled Worker, VAPID push, and Android APK are not ready for use. Review their setup separately before relying on them.
