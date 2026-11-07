# KinGuardian Mobile

A native Android and iOS app built with React Native, Expo, and TypeScript. This app uses the existing KinGuardian API at `https://kinguardian.pages.dev`; it does not create another account system or database.

## Development prerequisites

- Node.js 22 or newer (the web project pins Node 26.13.0).
- For Android local builds: Android Studio, Android SDK Platform 37, Build-Tools, Platform-Tools/ADB, and JDK 17 (recommended by React Native).
- For iOS builds: macOS with Xcode. iOS builds cannot be produced on Windows.

## Commands

Run from this `mobile` folder:

```powershell
npm ci
npm start
npm run typecheck
npm test
```

To run on Android after Android Studio, Android SDK Platform 36/build tools, platform tools, and a compatible JDK are installed, run `npm run android`. A connected Android phone with USB debugging or an Android emulator is needed. A development build is required for native MapLibre and SQLCipher; Expo Go does not include these native modules. This Windows computer cannot build iOS; that needs macOS with Xcode.

## Build an APK that works without Metro (Windows)

The `npm run android` development build expects Metro to be running. If that development APK is opened without Metro, Android shows an “Unable to load script” message. To make an installable APK with the JavaScript app included, first make sure Android Studio has installed the Android SDK and that `android/local.properties` points to it. You can copy `android/local.properties.example` to `android/local.properties` and edit the SDK path. Do not upload `local.properties` to GitHub.

Then run these commands from this `mobile` folder:

```powershell
npm ci
Set-Location .\android
.\gradlew.bat assembleRelease
```

Gradle creates two standalone APKs in `android\app\build\outputs\apk\release\`:

- `app-arm64-v8a-release.apk` for most recent Android phones.
- `app-armeabi-v7a-release.apk` for older 32-bit ARM phones.

These release APKs are for testing only. They use Android's local debug key by default. To update an already installed test APK, set `KINGUARDIAN_DEBUG_KEYSTORE` to the same private key file used by that APK before building. Keep that key outside the project folder and never upload it to GitHub. A permanent private signing key must be set up before public app store release.

## Safety notes

- Authentication tokens must stay in SecureStore; never put passwords or tokens in AsyncStorage or source code.
- The offline SQLite database must report a SQLCipher version before any private data is written. If encryption is missing, the app must fail closed.
- Only foreground location after a user action is enabled. Background tracking is not implemented.
- The map uses OpenStreetMap public tiles with attribution and does not download map regions. This free service is best-effort and may limit traffic.
- Native push delivery is not configured. A permission prompt alone does not mean an alert was delivered.
- Real push delivery needs configured Android FCM credentials and Apple APNs credentials. A visible device permission alone does not mean a push was delivered.
- Do not commit `.env`, `.env.local`, Firebase service account JSON, APNs `.p8` keys, Android signing keys, database exports, or generated build output.

See `../MOBILE_CONVERSION_PLAN.md` for the staged implementation and prerequisites.
