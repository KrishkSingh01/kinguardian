# KinGuardian manual deployment guide

This folder is a local source copy. It is not connected to GitHub, so changes here do not update GitHub automatically. The user reports that Cloudflare Pages project `kinguardian` is connected to `KrishkSingh01/kinguardian` on `main` and serves `https://kinguardian.pages.dev/`.

The changes in this folder have not been deployed. A public Turnstile status check and a read-only Wrangler migration check were attempted, but network restrictions prevented reaching Cloudflare. The live site configuration and database migration list remain unverified.

## Before uploading the code

1. Review the files in this folder and keep the `.gitignore` rules.
2. Check the current D1 migration list and make a private backup using [DATABASE_GUIDE.md](DATABASE_GUIDE.md).
3. Confirm every required migration is applied before publishing the matching Functions code. The current source includes migrations through `0022_mobile_sessions.sql`. From the project root, `wrangler d1 migrations list kinguardian-db --remote` shows what is still pending. `wrangler d1 migrations apply kinguardian-db --remote` applies all pending files from this checkout in order, so check the list and keep a private backup first.
4. Upload the intended source to the existing GitHub repository. Do not upload local secrets, dependency folders, backups, Wrangler state, or generated files. See [RELEASE_SECURITY.md](RELEASE_SECURITY.md).
5. Wait for the GitHub commit to finish before checking Cloudflare Pages.

## Cloudflare Pages build settings

In the existing `kinguardian` Pages project, keep the repository root path empty and use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | None / Other |
| Root directory | Blank |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `26.13.0` |
| `KG_RELEASE_TYPE` | `production` for production; `preview` for branch previews |

Keep `functions/` at the repository root. The build writes browser files to `dist/`; it does not copy server routes into `dist/`.

## Cloudflare settings the app needs

In Cloudflare **Workers & Pages > kinguardian > Settings**, check the **Production** environment:

- D1 binding named `DB` points to the existing `kinguardian-db` database.
- `AUTH_RATE_LIMIT_SECRET` is configured as an encrypted secret with at least 32 characters. It is also used to derive the at-rest location encryption key. Changing it without re-encrypting stored locations will make older encrypted points unreadable.
- `VAPID_PUBLIC_KEY` is present as a Pages variable if you want Web Push to be available.
- Required free Turnstile: you report that it is already configured. Confirm the Production variable `TURNSTILE_SITE_KEY` and encrypted secret `TURNSTILE_SECRET_KEY` are present. If either is missing or the check is unavailable, sign-in and registration fail closed. See [TURNSTILE_SETUP.md](TURNSTILE_SETUP.md).

The scheduled Worker is separate from Pages. A screenshot showed a scheduled Worker existed, but its deployed code and VAPID settings were not verified here. For Web Push, the Worker needs the same `DB` and VAPID public key, plus encrypted `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` secrets. Do not put the private key in Pages, GitHub, or browser code. Worker secret changes can publish a new Worker version; review before changing them.

## Run checks before asking Cloudflare to publish

From the project root in PowerShell:

```powershell
npm ci
npm test
$env:KG_RELEASE_TYPE = 'production'
npm run check:release
```

The command builds and checks static output. It does not publish the site or change D1. `npm test` passed in this workspace. `npm audit` could not reach the npm advisory service here, so dependency advisory status is unknown.

When you upload the reviewed source to GitHub, Cloudflare Pages should start a build. Check the build log and confirm it succeeds. Do not use a real emergency for testing.

## Safe post-deployment checks

Use a test account and non-sensitive data. Check the landing page, registration, sign-in, recovery codes, trusted-person consent, Safe Journey, notification settings, and location sharing. Test Web Push only with a test device and after reading its status. A `provider_accepted` result is not proof that a person saw the notification.

Visual browser testing, authenticated production API testing, live push, and location permissions were not completed in this workspace. The app does not send SMS, email, or WhatsApp automatically and does not call emergency services.

## Rollback and data protection

If Pages reports a build problem, fix the source or restore a reviewed Git commit; do not clear D1. If a migration reports an error, stop and preserve the backup. A database restore can overwrite newer user data and must be an intentional decision. Never put the D1 export in GitHub.
