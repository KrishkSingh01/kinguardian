import { isRateLimited, recordAttempt } from "../../_shared/rate-limit.js";
import { randomToken, sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

// Keep unapproved device requests brief, even when the page is left open.
const PAIRING_LIFETIME_MS = 10 * 60 * 1000;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const { env, request } = context;
    await readJsonRequest(request, 1024);
    if (typeof env.AUTH_RATE_LIMIT_SECRET !== "string" || env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "PAIRING_NOT_CONFIGURED", message: "Device pairing is temporarily unavailable." } }, 503);
    }

    const clientAddress = request.headers.get("cf-connecting-ip") || "local";
    const bucket = `pairing:create:${clientAddress}`;
    if (await isRateLimited(env, bucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Wait before creating another pairing request." } }, 429);
    }
    const now = Date.now();
    await recordAttempt(env, bucket, 6, now);

    const token = randomToken(32);
    const tokenHash = await sha256(token);
    const pairingId = crypto.randomUUID();
    const expiresAt = now + PAIRING_LIFETIME_MS;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM device_pairing_requests WHERE expires_at <= ?").bind(now),
      env.DB.prepare(`
        INSERT INTO device_pairing_requests (pairing_id, token_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).bind(pairingId, tokenHash, now, expiresAt),
    ]);
    const pairingUrl = new URL("pair-device.html", new URL(request.url).origin);
    pairingUrl.hash = token;
    return jsonResponse({ pairingUrl: pairingUrl.href, expiresAt });
  } catch (error) {
    return safeError(error);
  }
}
