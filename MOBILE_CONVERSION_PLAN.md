# KinGuardian Mobile App Status

## What is in the source

`mobile/` is a separate Expo and React Native TypeScript app. It uses the same KinGuardian account and API as the website. The website build remains at the project root.

Implemented screens and behavior:

- Username and password registration, sign-in, and account recovery with the website's required Turnstile verification.
- Secure access-token storage, rotating native refresh tokens, sign-out, and a forced password-change screen when required by the account.
- Trusted people and their SOS, Safe Journey, and location consent choices.
- A visible connectivity warning when the phone has no network connection.
- SOS with a 10-second cancel window, recipient selection based on consent, a test-alert path, and a safe offline queue that requires encrypted SQLite.
- Safe Journey creation and completion, alert history, and a map that asks before reading foreground location.
- Native-style navigation and settings that explain the features that are not configured.

The API returns no browser cookies to the native client. Native access uses an explicit app marker and bearer token. Website cookie and CSRF protections remain in place for browser requests. Refresh tokens are hashed in D1 and rotated once; replay revokes their token family.

## Checks performed

- Root website/backend tests: 76 passed.
- Mobile TypeScript check: passed.
- Mobile safety-contract tests: 6 passed.
- The refresh-token rotation and replay behavior is covered by a backend test using an in-memory SQLite database.
- Android debug APK built successfully for `armeabi-v7a` and `arm64-v8a`. `apksigner` verified its v2 debug signature, and `aapt` confirmed package `dev.kinguardian.app`, minimum API 24, and target API 36.
- No live Cloudflare deployment, production API, live D1 state, browser visual review, physical-device behavior, or remote push receipt was checked. ADB listed no connected devices.

## Manual migration and deployment order

Migration `0022_mobile_sessions.sql` is in this project folder. It has **not** been applied to the remote database by this work. Before deploying the matching Pages Functions code:

1. Open PowerShell in this project folder.
2. Run `npx wrangler d1 migrations list kinguardian-db --remote` and inspect all pending names.
3. Keep a private D1 backup outside the project and GitHub.
4. If the pending list is expected, run `npx wrangler d1 migrations apply kinguardian-db --remote` and confirm the prompt. Wrangler applies every pending migration from this folder, in order.
5. Run the list command again and confirm the intended migrations are marked applied.
6. Upload the reviewed source and allow Cloudflare Pages to deploy. Do not deploy app code that needs a migration before D1 has it.

The project has migrations `0001` through `0022`; the live database's current state is unknown. The old Codex Documents copy may not contain migration `0022`; use the original project folder that contains `mobile/` and this migration.

## What still needs your computer or account

- **Android APK:** A debug-signed APK is at `outputs/KinGuardian-Android-debug-2026-11-07.apk`. It supports the declared Android API 24+ range and includes 32-bit and 64-bit ARM builds. It is for testing/sideloading, not Play Store release. The device must still be installed and exercised; ADB currently lists no device. The Windows build uses Android Studio's installed SDK and bundled JDK. CMake native output is shortened for Windows path limits.
- **iOS:** Building or installing an iOS app requires a Mac with Xcode. This Windows computer cannot produce an iOS app locally.
- **Push:** Native push delivery is not configured. Android requires a user-owned Firebase/FCM project and credentials. Apple push requires Apple credentials and a compatible build. No credentials are included or invented.
- **Turnstile:** The user reports the Cloudflare keys have been added. Their current production configuration has not been verified. The app loads the public site key from the website and sends the challenge result back for server verification.
- **Map:** The map shows OpenStreetMap raster tiles with attribution and an identifying request header. The public tile service is best-effort and may limit traffic; the app does not pre-download tiles.
- **Location:** Only foreground, user-triggered location is enabled. There is no background tracking or location upload from the map screen.
- **Dependency scan:** `npm audit` could not contact the npm registry during this check, so current advisories could not be verified. Earlier SDK 58 audit output showed moderate advisories in Expo-pinned build-tool packages; no force-upgrade was applied because that could break Expo compatibility.

## Local development commands

From PowerShell, enter `mobile/`, then run:

```powershell
npm ci
npm run typecheck
npm test
npm run android
```

`npm run android` needs the Android tools above and a connected Android phone or emulator. Native MapLibre, SQLCipher, and notifications need a development build; Expo Go alone cannot test these native modules.

Keep D1 backups, `.env` files, Firebase service-account files, APNs keys, signing keys, and generated Android/iOS folders out of GitHub. See [RELEASE_SECURITY.md](RELEASE_SECURITY.md).
