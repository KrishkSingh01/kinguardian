# KinGuardian project status

Updated 7 November 2026. This describes the local project source. It does not claim the current files are live on Cloudflare.

## Completed locally

- The website/PWA has public member registration, sign-in and recovery, trusted people and consent controls, cancelable SOS, Safe Journeys, encrypted-at-rest location sharing, emergency information, and best-effort web push.
- The separate Expo/React Native app uses the same account and API. It includes sign-in, registration and recovery, trusted people, SOS and test alert, Safe Journeys, history, foreground map, and settings.
- Recent website and Android changes improve trusted-person request/reply visibility, map retry/error handling, Turnstile loading in the app, local notification settings and test alerts, and the SOS repeat reminder.
- Native sessions use bearer tokens and one-use refresh-token rotation. Native offline SOS data fails closed if SQLCipher is unavailable and waits for the person to retry; it does not claim delivery.
- Added Android CMake path shortening so native builds can complete on Windows.
- Built a debug-signed APK for 32-bit and 64-bit ARM phones. It declares minimum Android API 24 (Android 7), so Android 10 and 14 are within its declared range. The file is in `outputs/KinGuardian-Android-debug-2026-11-07.apk` and is ignored by GitHub rules.

## Checks completed

- Root `npm test`: 76 passed, 0 failed.
- In `mobile/`, `npm test`: 6 passed, 0 failed.
- In `mobile/`, `npm run typecheck`: passed.
- The Android Gradle debug build completed successfully for `armeabi-v7a` and `arm64-v8a` using Android Studio's bundled JDK.
- `apksigner` verified the APK's v2 signature; `aapt` confirmed package `dev.kinguardian.app`, minimum API 24, target API 36, and both ARM architectures.
- The APK is debug-signed for testing and sideloading; it is not a Play Store release build.

## Not verified yet

- No visual browser review was possible: the computer-control tool failed to start because its kernel files were missing. No claim of visual verification is made.
- ADB reports no connected Android device. The APK has not been installed or exercised on a physical phone, so the earlier “KinGuardian keeps stopping” report is not confirmed fixed on-device.
- No live authenticated Pages/API flow, live push receipt, real emergency, independent security audit, or production deployment was performed. Do not test SOS with a real emergency.
- No iOS build is available on this Windows computer; that requires macOS and Xcode.
- Remote D1 migration state is unknown. This source includes `0022_mobile_sessions.sql`; confirm that migration is applied before deploying the matching native-auth code.
- Native push delivery is not configured. Local notification permission and test alert only test notifications on the device; remote Android push requires Firebase/FCM configuration. No credentials are included.
- Email, SMS, and WhatsApp automation are not configured. KinGuardian is not an emergency service.
- Location is encrypted at rest, not end-to-end encrypted. The server can decrypt it when consent rules allow. The map uses public tiles and only reads foreground location after a user action.
- A current npm advisory scan could not be completed earlier because the npm registry was unreachable; dependency advisories remain unverified.

## Manual steps still needed

1. Install the APK on the phone and confirm whether it opens without crashing. A USB installation was not possible because ADB currently lists no connected device. You can also copy the APK to the phone and open it there; Android may ask you to allow installs from that file app.
2. Before deploying code that depends on migration `0022_mobile_sessions.sql`, run `wrangler d1 migrations list kinguardian-db --remote` from this project folder. If that migration is pending, keep a private D1 backup and apply the intended migration first. Never clear database tables to fix a migration.
3. Upload reviewed source files to GitHub and let Cloudflare Pages deploy. Do not upload `outputs/`, APKs, secrets, D1 backups, or signing keys. The existing `.gitignore` excludes `outputs/` and `*.apk`.
4. Configure a free Firebase project only if you want remote Android push. Keep Firebase private configuration out of GitHub. Native push is currently not connected.

The site is reported to be hosted at [kinguardian.pages.dev](https://kinguardian.pages.dev/). No deployment or remote database change was made in this update.

See [README.md](README.md), [mobile/README.md](mobile/README.md), [DATABASE_GUIDE.md](DATABASE_GUIDE.md), [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md), and [RELEASE_SECURITY.md](RELEASE_SECURITY.md).
