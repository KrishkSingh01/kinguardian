import { clearRateLimit, isRateLimited, recordFailure } from "../../_shared/rate-limit.js";
import { createSession, sessionCookies } from "../../_shared/auth.js";
import { constantTimeEqual, derivePasswordHash, normalizeUsername, PASSWORD_ITERATIONS } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const USER_LIMIT = 5;
const ADDRESS_LIMIT = 20;

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const { request, env } = context;
    if (!env.AUTH_RATE_LIMIT_SECRET || env.AUTH_RATE_LIMIT_SECRET.length < 32) {
      return jsonResponse({ error: { code: "AUTH_NOT_CONFIGURED", message: "Sign-in is temporarily unavailable." } }, 503);
    }
    const body = await readJsonRequest(request, 4096);
    const username = normalizeUsername(body.username);
    if (!username || typeof body.password !== "string" || new TextEncoder().encode(body.password).byteLength > 256) {
      return jsonResponse({ error: { code: "INVALID_CREDENTIALS", message: "The username or password is incorrect." } }, 401);
    }

    const clientAddress = request.headers.get("cf-connecting-ip") || "local";
    const userBucket = `login:user:${username}`;
    const addressBucket = `login:address:${clientAddress}`;
    if (await isRateLimited(env, userBucket) || await isRateLimited(env, addressBucket)) {
      return jsonResponse({ error: { code: "RATE_LIMITED", message: "Wait before trying to sign in again." } }, 429);
    }

    const user = await env.DB.prepare(`
      SELECT user_id, username, role, account_status, password_algorithm,
             password_iterations, password_hash, password_salt, must_change_password
      FROM users WHERE username = ?
    `).bind(username).first();

    const salt = user ? new Uint8Array(user.password_salt) : new Uint8Array(16).fill(0x4b);
    const iterations = user?.password_iterations || PASSWORD_ITERATIONS;
    const hash = await derivePasswordHash(body.password, salt, iterations);
    const correct = Boolean(user
      && user.account_status === "active"
      && user.password_algorithm === "PBKDF2-HMAC-SHA-256"
      && constantTimeEqual(hash, user.password_hash));

    if (!correct) {
      await Promise.all([
        recordFailure(env, userBucket, USER_LIMIT),
        recordFailure(env, addressBucket, ADDRESS_LIMIT),
      ]);
      return jsonResponse({ error: { code: "INVALID_CREDENTIALS", message: "The username or password is incorrect." } }, 401);
    }

    await Promise.all([clearRateLimit(env, userBucket), clearRateLimit(env, addressBucket)]);
    const session = await createSession(env, user.user_id);
    return jsonResponse({
      user: {
        userId: user.user_id,
        username: user.username,
        role: user.role,
        mustChangePassword: Boolean(user.must_change_password),
      },
      csrfToken: session.csrfToken,
    }, 200, { "Set-Cookie": sessionCookies(session.token, session.csrfToken) });
  } catch (error) {
    return safeError(error);
  }
}
