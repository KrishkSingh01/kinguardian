const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const load = (relative) => import(pathToFileURL(path.join(root, relative)));

function migratedD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(path.join(root, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(path.join(root, "migrations", file), "utf8"));
  }
  return {
    sqlite,
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        let values = [];
        const bound = {
          bind(...args) { values = args; return bound; },
          async first() { return statement.get(...values) || null; },
          async all() { return { results: statement.all(...values) }; },
          async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
        };
        return bound;
      },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}

test("mobile refresh credentials are opaque, hashed, and have one bounded family lifetime", async () => {
  const { createMobileRefreshCredential, MOBILE_REFRESH_LIFETIME_MS } = await load("functions/_shared/mobile-auth.js");
  const now = Date.UTC(2026, 10, 7);
  const credential = await createMobileRefreshCredential(new Uint8Array(32).fill(4), now, "family-test");
  assert.match(credential.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(credential.tokenHash.byteLength, 32);
  assert.notEqual(Buffer.from(credential.tokenHash).toString("base64url"), credential.token);
  assert.equal(credential.familyId, "family-test");
  assert.equal(credential.expiresAt, now + MOBILE_REFRESH_LIFETIME_MS);
});

test("native auth returns bearer payloads without browser cookies", async () => {
  const { authResponseHeaders, mobileAuthPayload } = await load("functions/_shared/mobile-auth.js");
  const session = { token: "access-token", csrfToken: "csrf-token", expiresAt: 1234 };
  const refresh = { token: "refresh-token", expiresAt: 5678 };
  const nativeRequest = new Request("https://kinguardian.pages.dev/api/auth/login", {
    headers: { "x-kg-client": "native" },
  });
  assert.deepEqual(mobileAuthPayload(nativeRequest, session, refresh), {
    accessToken: "access-token", accessExpiresAt: 1234,
    refreshToken: "refresh-token", refreshExpiresAt: 5678,
  });
  assert.deepEqual(authResponseHeaders(nativeRequest, session), {});

  const webRequest = new Request("https://kinguardian.pages.dev/api/auth/login");
  assert.deepEqual(mobileAuthPayload(webRequest, session, null), { csrfToken: "csrf-token" });
  assert.equal(authResponseHeaders(webRequest, session)["Set-Cookie"].length, 2);
});

test("native bearer sessions can write without browser CSRF while cookie writes still need it", async () => {
  const { createSessionCredentials } = await load("functions/_shared/auth.js");
  const { requireSession } = await load("functions/_shared/auth.js");
  const now = Date.now();
  const credentials = await createSessionCredentials(now);
  const row = {
    session_token_hash: credentials.tokenHash,
    csrf_token_hash: credentials.csrfHash,
    expires_at: credentials.expiresAt,
    last_seen_at: now,
    user_id: "user-1", username: "test-user", role: "member",
    account_status: "active", must_change_password: 0,
  };
  const env = { DB: { prepare() { return { bind() { return this; }, async first() { return row; } }; } } };
  const native = await requireSession({
    request: new Request("https://kinguardian.pages.dev/api/connections/request", {
      method: "POST", headers: { "x-kg-client": "native", Authorization: `Bearer ${credentials.token}` },
    }), env,
  }, { write: true });
  assert.equal(native.mode, "native");
  assert.equal(native.user.username, "test-user");

  const browser = await requireSession({
    request: new Request("https://kinguardian.pages.dev/api/connections/request", {
      method: "POST", headers: { Cookie: `__Host-kg_session=${credentials.token}`, Origin: "https://kinguardian.pages.dev" },
    }), env,
  }, { write: true });
  assert.equal(browser.response.status, 403);
});

test("native requests pass the origin gate only with the explicit app marker", async () => {
  const { requireSameOrigin } = await load("functions/_shared/http.js");
  assert.equal(requireSameOrigin(new Request("https://kinguardian.pages.dev/api/auth/login", {
    method: "POST", headers: { "x-kg-client": "native" },
  })), true);
  assert.equal(requireSameOrigin(new Request("https://kinguardian.pages.dev/api/auth/login", { method: "POST" })), false);
  assert.equal(requireSameOrigin(new Request("https://kinguardian.pages.dev/api/auth/login", {
    method: "POST", headers: { Origin: "https://kinguardian.pages.dev" },
  })), true);
});

test("native refresh rotates one-use tokens and replay revokes the whole family", async () => {
  const { createSessionCredentials } = await load("functions/_shared/auth.js");
  const { createMobileRefreshCredential } = await load("functions/_shared/mobile-auth.js");
  const { onRequestPost } = await load("functions/api/auth/refresh.js");
  const database = migratedD1();
  const now = Date.now();
  const userId = "mobile-user";
  const session = await createSessionCredentials(now);
  const refresh = await createMobileRefreshCredential(session.tokenHash, now, "test-family");
  database.sqlite.prepare(`INSERT INTO users (user_id, username, role, password_hash, password_salt, must_change_password, created_at, updated_at)
    VALUES (?, ?, 'member', ?, ?, 0, ?, ?)`).run(userId, "mobile-test", Buffer.from("hash"), Buffer.from("salt"), now, now);
  database.sqlite.prepare(`INSERT INTO sessions (session_token_hash, csrf_token_hash, user_id, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(session.tokenHash, session.csrfHash, userId, now, session.expiresAt, now);
  database.sqlite.prepare(`INSERT INTO mobile_refresh_tokens (refresh_token_hash, family_id, user_id, session_token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(refresh.tokenHash, refresh.familyId, userId, session.tokenHash, now, refresh.expiresAt);

  const env = { DB: database.DB, AUTH_RATE_LIMIT_SECRET: "test-secret-".repeat(4) };
  const request = (refreshToken) => new Request("https://kinguardian.pages.dev/api/auth/refresh", {
    method: "POST", headers: { "x-kg-client": "native", "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const first = await onRequestPost({ request: request(refresh.token), env });
  assert.equal(first.status, 200);
  const next = await first.json();
  assert.match(next.accessToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(next.refreshToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(next.refreshToken, refresh.token);
  assert.equal(database.sqlite.prepare("SELECT revoked_at FROM sessions WHERE session_token_hash = ?").get(session.tokenHash).revoked_at !== null, true);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL").get(userId).count, 1);

  const replay = await onRequestPost({ request: request(refresh.token), env });
  assert.equal(replay.status, 401);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL").get(userId).count, 0);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM mobile_refresh_tokens WHERE family_id = ? AND revoked_at IS NULL").get("test-family").count, 0);
  database.sqlite.close();
});
