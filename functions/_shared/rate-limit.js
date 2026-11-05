import { hmacSha256 } from "./crypto.js";

const WINDOW_MS = 15 * 60 * 1000;

export async function rateLimitBucketHash(env, bucketName) {
  return hmacSha256(env.AUTH_RATE_LIMIT_SECRET, bucketName);
}

export async function isRateLimited(env, bucketName, now = Date.now()) {
  const bucketHash = await rateLimitBucketHash(env, bucketName);
  const row = await env.DB.prepare(
    "SELECT blocked_until FROM auth_rate_limits WHERE bucket_hash = ?",
  ).bind(bucketHash).first();
  return Boolean(row?.blocked_until && row.blocked_until > now);
}

export async function recordFailure(env, bucketName, maximumAttempts, now = Date.now()) {
  const bucketHash = await rateLimitBucketHash(env, bucketName);
  const cutoff = now - WINDOW_MS;
  const blockedUntil = now + WINDOW_MS;
  await env.DB.prepare(`
    INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempt_count, blocked_until)
    VALUES (?, ?, 1, NULL)
    ON CONFLICT (bucket_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN auth_rate_limits.window_started_at <= ? THEN excluded.window_started_at
        ELSE auth_rate_limits.window_started_at
      END,
      attempt_count = CASE
        WHEN auth_rate_limits.window_started_at <= ? THEN 1
        ELSE auth_rate_limits.attempt_count + 1
      END,
      blocked_until = CASE
        WHEN auth_rate_limits.window_started_at <= ? THEN NULL
        WHEN auth_rate_limits.blocked_until > ? THEN auth_rate_limits.blocked_until
        WHEN auth_rate_limits.attempt_count + 1 >= ? THEN ?
        ELSE NULL
      END
  `).bind(bucketHash, now, cutoff, cutoff, cutoff, now, maximumAttempts, blockedUntil).run();
}

// Some public one-time flows also need a request-volume limit, even when the
// request succeeds. The storage logic is shared with failed-login limits.
export async function recordAttempt(env, bucketName, maximumAttempts, now = Date.now()) {
  return recordFailure(env, bucketName, maximumAttempts, now);
}

export async function clearRateLimit(env, bucketName) {
  const bucketHash = await rateLimitBucketHash(env, bucketName);
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE bucket_hash = ?").bind(bucketHash).run();
}
