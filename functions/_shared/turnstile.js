const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 5000;

export function getTurnstileConfiguration(env) {
  const siteKey = typeof env.TURNSTILE_SITE_KEY === "string" ? env.TURNSTILE_SITE_KEY.trim() : "";
  const secretKey = typeof env.TURNSTILE_SECRET_KEY === "string" ? env.TURNSTILE_SECRET_KEY.trim() : "";

  if (!siteKey && !secretKey) return { mode: "off", siteKey: null };
  if (siteKey && secretKey) return { mode: "enabled", siteKey };
  return { mode: "misconfigured", siteKey: null };
}

export async function verifyTurnstile({ env, request, token, expectedAction, fetchImpl = fetch }) {
  const configuration = getTurnstileConfiguration(env);
  if (configuration.mode === "off") return { ok: true, required: false };
  if (configuration.mode === "misconfigured") return { ok: false, unavailable: true };
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, unavailable: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const requestUrl = new URL(request.url);
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY.trim(),
        response: token,
        remoteip: request.headers.get("cf-connecting-ip") || undefined,
        idempotency_key: crypto.randomUUID(),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, unavailable: true };

    const result = await response.json();
    const hostname = typeof result.hostname === "string" ? result.hostname.toLowerCase() : "";
    const action = typeof result.action === "string" ? result.action : "";
    return {
      ok: result.success === true
        && hostname === requestUrl.hostname.toLowerCase()
        && action === expectedAction,
      unavailable: false,
    };
  } catch {
    return { ok: false, unavailable: true };
  } finally {
    clearTimeout(timeout);
  }
}

export function turnstileFailureResponse(result, jsonResponse) {
  if (result.ok) return null;
  if (result.unavailable) {
    return jsonResponse({ error: { code: "BOT_CHECK_UNAVAILABLE", message: "The account security check is temporarily unavailable. Please try again shortly." } }, 503);
  }
  return jsonResponse({ error: { code: "BOT_CHECK_FAILED", message: "Complete the security check and try again." } }, 403);
}
