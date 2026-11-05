# KinGuardian release security

**Current release:** KinGuardian `0.1.0`, web/PWA source and preview build only. This repository does not contain a Capacitor project, Android application ID, APK, app-signing key, or Play Store package. No APK has been built, signed, installed, or scanned. The Pages site has not been deployed, and its HTTPS behavior has not been tested on a public URL.

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

- Cloudflare Pages provides the HTTPS hosting endpoint. Before public use, confirm that HTTP redirects to HTTPS; for a custom domain, enable **Always Use HTTPS** in Cloudflare after its certificate is active.
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

The workspace currently has no `.git` repository and Git is not available in the Codex shell. `.gitignore` excludes local secrets, databases, logs, backups, installed packages, generated builds, Android build folders, APKs/AABs, and signing keystores. `.dev.vars.example` and `worker/.dev.vars.example` contain placeholders only. Review the GitHub Desktop file list before the first commit and confirm none of the ignored/local files are staged.

Use GitHub Desktop with a GitHub account. A private repository is the safer starting visibility; change visibility only after a deliberate review. GitHub’s instructions for [creating and publishing a repository](https://docs.github.com/en/desktop/overview/creating-your-first-repository-using-github-desktop) describe the local repository and **Keep this code private** option.

## Cloudflare Pages and D1 release configuration

The project is custom HTML/CSS/vanilla JavaScript with an esbuild build step, not a named framework preset. For a Git-connected Cloudflare Pages project, use:

| Setting | Value |
| --- | --- |
| Framework preset | None / Other |
| Root directory | Repository root (leave blank/default) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | `26.13.0` (also recorded in `.node-version`) |
| `KG_RELEASE_TYPE` | `production` for production builds; `preview` for branch previews |

Cloudflare Pages Git integration cannot later be converted to Direct Upload, so choose the Git integration deliberately. The root `functions/` directory must remain outside `dist/` so Pages can build the API routes.

Create the remote D1 database with the exact name `kinguardian-db`. Replace the all-zero `database_id` in both `wrangler.toml` and `worker/wrangler.toml` with the returned UUID. Keep the binding name exactly `DB`. The Pages Wrangler file contains `pages_build_output_dir`, so after opting into that configuration, treat the Wrangler file as the source of truth and keep dashboard settings consistent; do not overwrite it with a downloaded config without reviewing the diff.

Configure secrets through Cloudflare’s secret settings, never in GitHub or TOML:

- Pages: `OWNER_BOOTSTRAP_SECRET`, `AUTH_RATE_LIMIT_SECRET`, and the public `VAPID_PUBLIC_KEY` variable.
- Scheduled Worker: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- Pages D1 binding: `DB` → `kinguardian-db`.
- Scheduled Worker D1 binding: `DB` → the same `kinguardian-db`.

Create the D1 database and add the binding in Cloudflare’s **Workers & Pages** and **D1 SQL database** areas, then redeploy for the binding to take effect. Review both environments and keep production secrets separate from preview secrets. Never place the VAPID private key in Pages, GitHub variables, or browser assets.

Do not apply production migrations or publish a production deployment until you have reviewed the migration files, verified a backup, confirmed the intended account/project/database, and explicitly authorized the production change. The current 14 migrations have only been applied to the local emulator.

References: [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [build settings](https://developers.cloudflare.com/pages/configuration/build-configuration/), [D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/), and [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

## Verification status

- Node.js `26.13.0` and npm are installed for the current workspace.
- `npm test`: 32 passed, 0 failed.
- `npm audit --audit-level=high`: 0 vulnerabilities reported for the locked npm dependency tree.
- `npm run check:release`: passed for KinGuardian `0.1.0` (`development`); all 45 public assets matched their recorded SHA-256 checksums. The build output did not include server source, known credential patterns, or prohibited private/executable file types.
- Source inspection found no dynamic code evaluation (`eval`, `new Function`), HTML string injection APIs (`innerHTML`, `outerHTML`, `insertAdjacentHTML`), remote script tags, file-upload inputs, or iframes in the reviewed app source. This is a scoped source check, not a penetration test.
- No APK, Android permissions, or signing keys exist in the project, so APK signature, installation, update, and Play Protect checks are not applicable yet.
- The local D1 emulator has migrations `0001`–`0014`. No production D1, secrets, Pages project, custom domain, HTTPS redirect, GitHub repository, or deployment has been configured.
- Browser visual review and authenticated browser integration remain pending. The local preview is not a public HTTPS test; PWA installation and update behavior have not been tested in a browser.

## MY NEXT STEPS

1. **Install GitHub Desktop and Git for Windows.** Sign into your GitHub account in GitHub Desktop. Git is not available in this Codex shell, and the project folder `C:\Users\krish\Documents\Codex\2026-11-05\files-pasted-by-the-user-kin` has no `.git` metadata yet. Node.js is already installed; do not reinstall it.
2. **Initialize and inspect the local repository.** Open PowerShell in the project folder and run `git init`. In GitHub Desktop select **File > Add Local Repository**, choose this project folder, and inspect **Changes**. Confirm `.dev.vars`, `.env`, `node_modules`, `.wrangler`, `dist`, `work`, databases, backups, APKs, and signing files are not listed. Commit the reviewed source locally.
3. **Publish to GitHub.** In GitHub Desktop click **Publish repository**, use repository name `kinguardian`, select **Keep this code private**, and click **Publish Repository**. Do not switch it to public until you have reviewed what public source exposure means.
4. **Connect Cloudflare Pages.** In the Cloudflare dashboard open **Workers & Pages > Create application > Pages > Connect to Git**. Authorize GitHub, select `kinguardian`, and choose the intended production branch (for example, `main`). Git integration is the selected path; Cloudflare does not let a Git-integrated Pages project later switch to Direct Upload.
5. **Enter the Pages build settings.** Choose **None / Other** as the framework preset, leave the root directory at the repository root, set build command to `npm run build`, build output directory to `dist`, and set `NODE_VERSION=26.13.0`. Set `KG_RELEASE_TYPE=production` for production builds; configure branch previews as `preview`. Review the `wrangler.toml` configuration before the first production deploy.
6. **Create the database.** In Cloudflare open **D1 SQL database > Create database**, enter `kinguardian-db`, and create it. Copy the returned database UUID into both Wrangler files by replacing only the all-zero `database_id`. Keep both binding names as `DB`.
7. **Configure bindings and secrets.** Add the Pages `DB` binding to `kinguardian-db`. Add Pages secrets `OWNER_BOOTSTRAP_SECRET` and `AUTH_RATE_LIMIT_SECRET`; use separate random values of at least 32 characters. Set `VAPID_PUBLIC_KEY` as a Pages variable. For `kinguardian-checkin-cron`, bind the same D1 database as `DB` and configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` as Worker secrets. Keep the private key only on the Worker.
8. **Review and migrate production D1.** Before running any `--remote` command, compare all fourteen numbered migrations, confirm the database UUID, and export a backup. Production migration/deployment is not authorized by this guide; get explicit approval before applying migrations or publishing the site.
9. **Verify HTTPS and the website after authorized deployment.** Open the HTTPS `*.pages.dev` URL, check that HTTP redirects to HTTPS, inspect the browser certificate and console, and review the public pages on phone and desktop sizes. For a custom domain, wait for certificate issuance, then enable Cloudflare **Always Use HTTPS**. Test account creation, pairing, session revocation, PWA install/update, and offline-safe screens with non-sensitive test data before inviting anyone.
10. **Only after a native app exists, test Android.** Install Android Studio and SDK Build Tools, choose a stable available application ID, build a signed release, verify it with `apksigner`, and generate a SHA-256 checksum with `Get-FileHash`. Scan and test on a spare supported device. Keep the signing key and passwords outside the repository. Distribute only through an official channel, and never ask users to disable Play Protect.
