import { isRateLimited, recordFailure } from "../../_shared/rate-limit.js";
import { sha256 } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const { env, request } = context;
    const body = await readJsonRequest(request, 1024);
    if (typeof env.AUTH_RATE_LIMIT_SECRET !== "string" || env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "PAIRING_NOT_CONFIGURED", message: "Device pairing is temporarily unavailable." } }, 503);
    }
    const now = Date.now();
    const address = request.headers.get("cf-connecting-ip") || "local";
    const bucket = `pairing:status:${address}`;
    if (await isRateLimited(env, bucket, now)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Wait before checking another pairing code." } }, 429);
    }
    await recordFailure(env, bucket, 250, now);
    if (typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) {
      return unavailable();
    }

    const record = await env.DB.prepare(`
      SELECT approved_at, redeemed_at, revoked_at
      FROM device_pairing_requests WHERE token_hash = ? AND expires_at > ?
    `).bind(await sha256(body.token), now).first();
    if (!record) return unavailable();
    if (record.revoked_at) return jsonResponse({ status: "revoked" });
    if (record.redeemed_at) return jsonResponse({ status: "paired" });
    return jsonResponse({ status: record.approved_at ? "approved" : "pending" });
  } catch (error) {
    return safeError(error);
  }
}

function unavailable() {
  return jsonResponse({ error: { code: "PAIRING_UNAVAILABLE", message: "This pairing request is invalid, expired, revoked, or already used." } }, 404);
}
