# Check KinGuardian's Turnstile setup

You told me you already added Turnstile in Cloudflare. You do not need to create another widget. KinGuardian needs both values from that widget:

- `TURNSTILE_SITE_KEY` as a Production variable.
- `TURNSTILE_SECRET_KEY` as an encrypted Production secret.

The secret must stay in Cloudflare. Do not put either value in GitHub or send it in chat. Login and registration stop safely if either value is missing or Cloudflare's check is unavailable.

## 1. Check the public status

Open this address in your browser:

`https://kinguardian.pages.dev/api/auth/turnstile-config`

When the live Production settings are ready, the response has `mode` set to `enabled`. It also shows the site key, which is public; do not copy it into chat. This workspace could not reach that address, so I could not verify your live status.

If the response has `mode` set to `misconfigured`, sign-in and registration are blocked. In Cloudflare, open **Workers & Pages** → **kinguardian** → **Settings** → **Variables and Secrets** → **Production**. Check that both names above exist there, that the secret is encrypted, and that the values come from the same Turnstile widget for `kinguardian.pages.dev`.

## 2. Check the pages

After the status says enabled, open the sign-in and registration pages. The security check should appear. If it does not, check that the widget allows the exact hostname `kinguardian.pages.dev` and that its action matches the page.

## Local development

Do not put your production secret in this folder or in GitHub. Local testing needs separate Turnstile test values in the ignored `.dev.vars` file and a widget/test hostname supported by Cloudflare. Never put test values on the live site.
