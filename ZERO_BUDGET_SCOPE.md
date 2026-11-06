# KinGuardian zero-budget scope

This project must remain usable without buying a plan, domain, API credits, phone number, or paid software. Free services have limits; when a limit is reached, KinGuardian must show that the feature is unavailable instead of silently upgrading or claiming success.

## Keep using

- **Website:** Cloudflare Pages at `https://kinguardian.pages.dev`. No custom domain is required.
- **Backend and database:** Cloudflare Pages Functions, Workers, and D1 on their free plans. Keep within current free quotas and expect requests to fail safely if a quota is reached.
- **Bot checks:** Cloudflare Turnstile is integrated for login and registration with server-side Siteverify, action, and hostname checks. It still needs a real site key and secret configured in Cloudflare before the check turns on. Until then, only the existing rate limits protect those forms. See [TURNSTILE_SETUP.md](TURNSTILE_SETUP.md).
- **Push notifications:** Browser Web Push and the existing Cloudflare Worker can be used without an SMS provider. It requires VAPID keys, user permission on each device, an active scheduled Worker, and successful acceptance by a push service. Acceptance does not prove the phone displayed the notification.
- **Daily check-ins:** KinGuardian stores the daily time and time zone in D1, and the scheduled Worker creates each occurrence. Missed-check-in alerts still require the Worker, VAPID configuration, the recipient's consent, and a supported device. A queued push is not confirmed delivery.
- **Open-source code:** Keep the existing vanilla JavaScript, custom CSS, and pinned open-source packages. Do not add a paid framework, hosted auth service, or paid map SDK.
- **Email:** Paused at the user's request. Do not configure or depend on Resend for now.

## Do not promise as a free automated service

- **Phone OTP by SMS:** A short trial is not a permanent free SMS service. Do not mark a phone as verified or claim an OTP was sent unless a real provider confirms it. Until a genuinely no-cost provider is available, keep the existing username/password and recovery-code path; explain that phone verification and SMS password recovery are unavailable.
- **Automated SMS and WhatsApp:** Do not send through unofficial automation or a personal account. Existing user-opened SMS/WhatsApp composer links may remain, with a clear note that the user chooses whether to send and their carrier or data plan may charge them.
- **3D maps:** Do not use a demo tile server or an API that requires a payment method without checking its production terms first. Keep location permission user-controlled and use the existing OpenStreetMap link for now. A genuine hosted 3D map needs a verified, sustainable free tile/terrain source before it can be enabled.
- **Emergency delivery:** An SOS saved in D1, queued for push, or accepted by a push provider is not proof that a contact received it. Keep delivery wording precise and provide local emergency calling separately.
- **Emergency directory:** Keep the directory static and free. Only show numbers verified from official sources; this release includes India's nationwide 112 number. For other countries, show that KinGuardian has no verified number instead of guessing. Adding a reliable global directory remains future work.

## Current free-plan limits to watch

As checked on 2026-11-06, Cloudflare documents Workers Free at 100,000 requests per day and 10 ms CPU time per invocation. D1 Free documents 5 million rows read per day, 100,000 rows written per day, and 5 GB total storage. These limits can change; check Cloudflare's current [Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before relying on them. Reaching a limit can make a feature unavailable until the quota resets.

## Required behavior

- Never add a chargeable API or service as a required dependency.
- Never ask the app to upgrade a plan automatically.
- Keep secrets in Cloudflare's encrypted settings or ignored local files, never in GitHub source.
- Show a clear unavailable/error state when a free service is missing, over quota, or not configured.
- Keep emergencies independent of a map, email setup, or location permission.
