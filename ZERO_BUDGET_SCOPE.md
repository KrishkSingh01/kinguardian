# KinGuardian zero-budget scope

KinGuardian should remain usable without buying a plan, domain, phone number, API credits, or paid software. Free services can change or become unavailable, so the app must show an honest error instead of silently upgrading or claiming that an action succeeded.

## Services used

- **Website and backend:** Cloudflare Pages, Pages Functions, Workers, and D1 on their free plans. Limits and terms can change; review Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/pricing/) before relying on a quota.
- **Bot checks:** Cloudflare Turnstile is required for login and registration and is checked on the server. Both a real public site key and secret must be in Cloudflare settings; until then, sign-in and registration fail closed. See [TURNSTILE_SETUP.md](TURNSTILE_SETUP.md).
- **Maps:** MapLibre GL JS is open-source map software. KinGuardian loads its pinned browser module from unpkg and map tiles from OpenFreeMap, based on OpenStreetMap data. OpenFreeMap currently says its public instance is free without request limits or an API key, but it offers no service-level guarantee. It may change its service or terms. Map tiles require internet and the provider can see the map area requested by a browser. See the [OpenFreeMap quick start](https://openfreemap.org/quick_start/) and [service information](https://openfreemap.org/).
- **Push alerts:** Browser Web Push has no SMS provider fee in this project. It still needs VAPID keys, a deployed scheduled Worker, a supported browser/device, and user permission. A push provider accepting a request does not prove that the person saw the alert.
- **Email:** Paused at the user's request. Do not depend on Resend or another email service.

## Features with no automated messaging provider

- **SMS, phone OTP, and WhatsApp:** No provider is configured. Do not claim that a message or verification code was sent. Do not use unofficial automation or a personal account to send messages.
- **Email recovery:** Not available. Users use their one-time recovery codes; losing all recovery codes and the password may mean the account cannot be recovered.
- **Emergency response:** KinGuardian does not call emergency services. SOS can be stored and in-app notices can be prepared for trusted people who opted in. Web Push is best effort. In immediate danger, call the local emergency number directly.
- **Emergency directory:** Keep the directory static and show only verified numbers. The current release includes India's nationwide 112 number; for locations without a verified number, the app must say so instead of guessing.

## Required behavior

- Never add a paid API or service as a required feature.
- Never auto-upgrade a Cloudflare plan or start a paid trial.
- Keep secrets in Cloudflare's encrypted settings or ignored local files, never in GitHub source.
- Show a clear unavailable/error state if a free service is missing, over quota, or not configured.
- Keep SOS available without map tiles, email setup, or location permission. If offline, say clearly that the SOS is saved on the device and nobody has been notified yet.
- Preserve old check-in database tables and migrations for data safety, but do not present daily check-ins as a current public feature. Safe Journey is the current journey workflow.
