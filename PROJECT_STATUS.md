# KinGuardian project status

Checked on 6 November 2026. This records what is in the source folder and what still needs a real service or account action.

## Implemented in the source

- Public landing page, member registration, sign-in, password change, and password reset with one-time recovery codes.
- Responsive member dashboard, light/dark/device themes, reduced-motion rules, keyboard labels, and an installable website shell.
- Trusted-member invitations, encrypted external contact records, consent controls, QR invitations, and opt-in location sharing.
- One-time safety check-ins and daily check-in schedules with saved time zone, daylight-saving handling, grace period, opt-in push reminder, and selected trusted recipients.
- Cancelable SOS countdowns and server-side SOS records.
- Browser-based online/offline history and a verified India 112 emergency page.
- Public Pages routes do not expose the legacy owner setup or owner administration. Old database rows and source are preserved.
- Free Cloudflare Pages, Functions, D1, Cron Worker, and Web Push architecture; no paid messaging provider is required by the code.

## Important limits

- SOS is stored by the server. KinGuardian does not automatically contact a trusted person or emergency service.
- Push is optional and is not delivery-confirmed. It requires VAPID keys, a deployed Cron Worker, browser permission, and a supported device.
- The daily check-in database migration and scheduled Worker are now deployed. The updated Pages source still needs to be uploaded to GitHub so the daily setup screen and API are published.
- SMS verification and SMS password reset need an SMS provider. Automated SMS and WhatsApp are not enabled.
- Email automation is paused at the user's request.
- The location screen uses a map link; there is no 3D map provider configured.
- Only India's nationwide 112 number is verified in the emergency directory. KinGuardian does not guess numbers for other regions.
- The current app is a website/PWA. The project has no Android Gradle or Capacitor app, and no APK has been built or signed.
- Mobile network signal strength is not available to the website. The network panel records only what the browser can report.

## This source update

This folder contains migration 0017_daily_checkin_schedules.sql, its authenticated API, scheduled Worker support, daily setup controls, a corrected emergency-call route, and a website-install helper. The user's screenshot confirms that migration 0017 is applied remotely, the scheduled Worker is deployed with its one-minute Cron, and a D1 export completed successfully. The Pages source changes still need to be uploaded to GitHub. This source folder has no Git metadata, so edits here do not reach GitHub automatically.

Before publishing the new source:

1. Upload the reviewed Pages source and tests to GitHub so Cloudflare Pages can build them.
2. Keep the database backup outside GitHub.
3. Configure VAPID and test push on a device before relying on notifications.

See DATABASE_GUIDE.md and DEPLOYMENT_GUIDE.md for commands and safeguards.

## Checks completed here

- npm test: 65 passed, 0 failed.
- npm run check:release: passed; 54 public assets received SHA-256 checksums and private/server files stayed out of the Pages output.
- Cloudflare Pages Functions build: compiled successfully.
- Scheduled Worker Wrangler dry run: compiled successfully without publishing.
- No live browser visual check, real push delivery test, or APK build was performed. The screenshot shows the database migration and Cron Worker deployment completed.
