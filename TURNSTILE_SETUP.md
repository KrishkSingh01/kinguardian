# Turn on free sign-in and sign-up bot checks

KinGuardian supports Cloudflare Turnstile on the sign-in and registration forms. The integration is **off until you add your own real keys**. While it is off, the existing server-side rate limits still run, but there is no CAPTCHA check. Cloudflare's free plan supports up to 20 widgets and unlimited challenges; check the current [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/) before relying on those limits.

## 1. Create a free Turnstile widget

1. Sign in to your Cloudflare dashboard.
2. Open **Turnstile** from the left menu. If it is nested, expand **Security** first.
3. Select **Add widget**.
4. Enter a name such as `KinGuardian sign-in`.
5. For **Hostnames**, enter exactly `kinguardian.pages.dev`. Do not add `https://`, a page path, or the Resend subdomain `send.kinguardian.dev`.
6. Choose **Managed** mode.
7. Select **Create**.
8. Copy the **Sitekey** and **Secret key**. Keep the secret private.

## 2. Add both values to the Pages project

1. In Cloudflare, open **Workers & Pages**.
2. Select the existing Pages project **kinguardian**.
3. Open **Settings** → **Variables and Secrets**.
4. Under **Production**, select **Add**.
5. Add the site key as a variable named `TURNSTILE_SITE_KEY`. The site key is public; it is okay for the browser to receive it.
6. Select **Save**.
7. Select **Add** again. Name the secret `TURNSTILE_SECRET_KEY`, paste the secret key, select **Encrypt**, then **Save**.
8. If you also use Preview deployments, add a separate widget hostname and set both values under **Preview** too.

Never put the secret key in GitHub, an HTML or JavaScript file, a screenshot, or a message. The app's public configuration endpoint returns only the site key; the secret is used only by Pages Functions.

## 3. Publish the updated project

Upload the updated project files to the connected GitHub repository and let Cloudflare Pages build them. The new Pages deployment must include the variables and secret above. This workspace update does not publish anything by itself.

## 4. Check that it is active

Open `https://kinguardian.pages.dev/api/auth/turnstile-config`. When both values are set, it should show `{"mode":"enabled","siteKey":"..."}`. The site key is public, so it is safe to see in that response. Then open the sign-in or registration page and confirm the Turnstile widget appears.

If the endpoint says `off`, one or both values are missing from the active Production environment. If it says `misconfigured`, only one of the two values is set. If a Turnstile request fails after it is enabled, sign-in and registration stop safely until the check works again.

## Local development

For local testing, put your own Turnstile values in the ignored root `.dev.vars` file. Do not use production secrets on a shared computer. Local verification requires a widget whose allowed hostname matches the local preview hostname; use Cloudflare's documented test keys only for local development and never configure test keys on the live site.

The server checks tokens with Cloudflare Siteverify and confirms the expected form action and request hostname. This server check is required: a browser widget alone does not protect the API. See Cloudflare's [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) and [CSP requirements](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
