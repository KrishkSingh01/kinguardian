# KinGuardian Mobile

A native Android and iOS app built with React Native, Expo, and TypeScript. This app uses the existing KinGuardian API at `https://kinguardian.pages.dev`; it does not create another account system or database.

## Development prerequisites

- Node.js 22 or newer (the web project pins Node 26.13.0).
- For Android local builds: Android Studio, Android SDK Platform 37, Build-Tools, Platform-Tools/ADB, and a supported JDK. The debug APK in the project `outputs/` folder was built successfully with Android Studio's bundled JDK.
- For iOS builds: macOS with Xcode. iOS builds cannot be produced on Windows.

## Commands

Run from this `mobile` folder:

```powershell
npm ci
npm start
npm run typecheck
npm test
```

To build and run on Android after Android Studio, Android SDK Platform 37/build tools, platform tools, and a compatible JDK are installed, run `npm run android`. A connected Android phone with USB debugging or an Android emulator is needed. A development build is required for native MapLibre and SQLCipher; Expo Go does not include these native modules. A debug APK has been built with minimum Android API 24 and ARM 32-bit/64-bit support, but the phone is not connected to ADB yet, so physical install and startup are still unverified. This Windows computer cannot build iOS; that needs macOS with Xcode.

## Install the provided test APK

The file is `../outputs/KinGuardian-Android-debug-2026-11-07.apk`.

1. Copy the APK to the Android phone with a USB cable, or download it directly on that phone.
2. On the phone, open **Files** or **Downloads**, tap the APK, and choose **Install**.
3. If Android blocks it, open **Settings** from that message and allow installs from **Files** (or the app you used to download it). Return to the APK and tap **Install** again. You can turn that permission off afterward.
4. Open KinGuardian and try it with a test account and non-sensitive information.

This is a debug test build. Android may not install it over another KinGuardian build if that earlier app was signed with a different key. Do not uninstall an existing app if it contains data you need; ask for help first.

## Safety notes

- Authentication tokens must stay in SecureStore; never put passwords or tokens in AsyncStorage or source code.
- The offline SQLite database must report a SQLCipher version before any private data is written. If encryption is missing, the app must fail closed.
- Only foreground location after a user action is enabled. Background tracking is not implemented.
- The map uses OpenStreetMap public tiles with attribution and does not download map regions. This free service is best-effort and may limit traffic.
- Native push delivery is not configured. A permission prompt alone does not mean an alert was delivered.
- The in-app notification test creates a local notification only. Remote Android delivery needs Firebase/FCM configuration; do not treat the local test as proof of push delivery.
- Real push delivery needs configured Android FCM credentials and Apple APNs credentials. A visible device permission alone does not mean a push was delivered.
- Do not commit `.env`, `.env.local`, Firebase service account JSON, APNs `.p8` keys, Android signing keys, database exports, or generated build output.

See `../MOBILE_CONVERSION_PLAN.md` for the staged implementation and prerequisites.
