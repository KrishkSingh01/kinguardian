const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const migrations = path.join(root, "migrations");

function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const filename of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(path.join(migrations, filename), "utf8"));
  }
  return db;
}

function addUser(db, id, username, role) {
  db.prepare(`
    INSERT INTO users (user_id, username, role, password_hash, password_salt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 1)
  `).run(id, username, role, Buffer.from("hash"), Buffer.from("salt"));
}

test("secure sessions persist across normal restarts with a bounded fourteen-day lifetime", async () => {
  const { createSessionCredentials, sessionCookies } = await import(pathToFileURL(path.join(root, "functions", "_shared", "auth.js")));
  const now = Date.UTC(2026, 10, 6);
  const credentials = await createSessionCredentials(now);
  const expectedDuration = 14 * 24 * 60 * 60 * 1000;
  assert.equal(credentials.expiresAt, now + expectedDuration);
  const cookies = sessionCookies(credentials.token, credentials.csrfToken);
  assert.ok(cookies.some((cookie) => cookie.includes("HttpOnly") && cookie.includes("Secure")
    && cookie.includes("SameSite=Strict") && cookie.includes("Max-Age=1209600")));
});

test("all numbered migrations include constrained setup and pairing tables", () => {
  const db = migratedDatabase();
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name));
  assert.ok(tables.has("account_setup_tokens"));
  assert.ok(tables.has("device_pairing_requests"));
  assert.ok(tables.has("account_recovery_codes"));
  for (const table of ["account_setup_tokens", "device_pairing_requests"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
    assert.ok(columns.includes("token_hash"), `${table} must store token hashes`);
    assert.ok(!columns.includes("token"), `${table} must not store plaintext tokens`);
  }
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'index' AND name = 'one_open_account_setup_token_per_purpose'").get().count,
    1,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table'").get().count, 33);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("daily check-in plans are private per user and store only consented member links", () => {
  const db = migratedDatabase();
  addUser(db, "daily-owner", "daily-owner", "member");
  addUser(db, "daily-contact", "daily-contact", "member");
  const columns = db.prepare("PRAGMA table_info(daily_checkin_settings)").all().map((column) => column.name);
  assert.ok(columns.includes("timezone"));
  assert.ok(columns.includes("next_checkin_at_utc"));
  db.prepare(`
    INSERT INTO daily_checkin_settings (
      user_id, enabled, local_time, timezone, grace_minutes, reminder_enabled,
      next_local_date, next_local_time, next_checkin_at_utc, updated_at
    ) VALUES (?, 1, '20:00', 'Asia/Kolkata', 10, 1, '2026-11-06', '20:00', 1000, 1)
  `).run("daily-owner");
  db.prepare("INSERT INTO daily_checkin_recipients (user_id, recipient_user_id, created_at) VALUES (?, ?, ?)")
    .run("daily-owner", "daily-contact", 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM daily_checkin_recipients WHERE user_id = ?").get("daily-owner").count, 1);
  assert.throws(() => db.prepare("INSERT INTO daily_checkin_recipients (user_id, recipient_user_id, created_at) VALUES (?, ?, ?)")
    .run("daily-owner", "daily-contact", 1));
  assert.throws(() => db.prepare("INSERT INTO daily_checkin_recipients (user_id, recipient_user_id, created_at) VALUES (?, ?, ?)")
    .run("daily-owner", "daily-owner", 1));
  assert.throws(() => db.prepare(`
    INSERT INTO daily_checkin_settings (
      user_id, enabled, local_time, timezone, grace_minutes, reminder_enabled, updated_at
    ) VALUES (?, 1, '25:00', 'Asia/Kolkata', 10, 1, 1)
  `).run("daily-contact"));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("recovery codes are hash-only, tied to accounts, and can be used once", () => {
  const db = migratedDatabase();
  addUser(db, "member-recovery", "member-recovery", "member");
  const columns = db.prepare("PRAGMA table_info(account_recovery_codes)").all().map((column) => column.name);
  assert.ok(columns.includes("code_hash"));
  assert.ok(!columns.includes("recovery_code"));
  db.prepare(`
    INSERT INTO account_recovery_codes (recovery_code_id, user_id, code_hash, created_at)
    VALUES ('recovery-a', 'member-recovery', ?, 1)
  `).run(Buffer.from("a recovery-code hash"));
  const consume = db.prepare(`
    UPDATE account_recovery_codes SET used_at = ?
    WHERE recovery_code_id = ? AND used_at IS NULL
  `);
  assert.equal(consume.run(2, "recovery-a").changes, 1);
  assert.equal(consume.run(3, "recovery-a").changes, 0);
  assert.throws(() => db.prepare(`
    INSERT INTO account_recovery_codes (recovery_code_id, user_id, code_hash, created_at)
    VALUES ('recovery-b', 'member-recovery', ?, 1)
  `).run(Buffer.from("a recovery-code hash")), /UNIQUE/iu);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("account setup and device pairing credentials redeem at most once", () => {
  const db = migratedDatabase();
  addUser(db, "owner-a", "owner", "owner");
  addUser(db, "member-a", "member", "member");
  db.prepare(`
    INSERT INTO account_setup_tokens (token_id, token_hash, user_id, issuer_user_id, purpose, created_at, expires_at)
    VALUES ('setup-a', ?, 'member-a', 'owner-a', 'account_activation', 1, 1000)
  `).run(Buffer.from("setup-hash"));

  const redeemSetup = db.prepare(`
    UPDATE account_setup_tokens SET redeemed_at = ?
    WHERE token_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
  `);
  const changePassword = db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 0
    WHERE user_id = ? AND changes() = 1
      AND EXISTS (SELECT 1 FROM account_setup_tokens WHERE token_id = ? AND redeemed_at = ?)
  `);
  assert.equal(redeemSetup.run(10, "setup-a", 10).changes, 1);
  assert.equal(changePassword.run(Buffer.from("new-hash"), "member-a", "setup-a", 10).changes, 1);
  assert.equal(redeemSetup.run(10, "setup-a", 10).changes, 0);
  assert.equal(changePassword.run(Buffer.from("replay-hash"), "member-a", "setup-a", 10).changes, 0);

  db.prepare(`
    INSERT INTO device_pairing_requests (pairing_id, token_hash, created_at, expires_at)
    VALUES ('pair-a', ?, 1, 600)
  `).run(Buffer.from("pair-hash"));
  const approve = db.prepare(`
    UPDATE device_pairing_requests SET approved_user_id = ?, approved_at = ?
    WHERE pairing_id = ? AND approved_user_id IS NULL AND approved_at IS NULL
      AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
  `);
  assert.equal(approve.run("member-a", 10, "pair-a", 10).changes, 1);
  assert.equal(approve.run("owner-a", 11, "pair-a", 11).changes, 0);
  const redeemPairing = db.prepare(`
    UPDATE device_pairing_requests SET redeemed_at = ?
    WHERE pairing_id = ? AND approved_user_id IS NOT NULL AND approved_at IS NOT NULL
      AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
  `);
  assert.equal(redeemPairing.run(12, "pair-a", 12).changes, 1);
  assert.equal(redeemPairing.run(13, "pair-a", 13).changes, 0);

  db.prepare(`
    INSERT INTO device_pairing_requests (pairing_id, token_hash, created_at, expires_at)
    VALUES ('pair-b', ?, 1, 600)
  `).run(Buffer.from("pair-hash-b"));
  const deniedRedemption = db.prepare(`
    UPDATE device_pairing_requests SET redeemed_at = ?
    WHERE pairing_id = ? AND approved_user_id IS NOT NULL AND approved_at IS NOT NULL
      AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
  `);
  const conditionalSession = db.prepare(`
    INSERT INTO sessions (session_token_hash, csrf_token_hash, user_id, created_at, expires_at, last_seen_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1
  `);
  assert.equal(deniedRedemption.run(20, "pair-b", 20).changes, 0);
  assert.equal(conditionalSession.run(Buffer.from("session"), Buffer.from("csrf"), "member-a", 20, 100, 20).changes, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 0);
  db.close();
});

test("owner and pairing route SQL compiles against all migrations", () => {
  const db = migratedDatabase();
  const sources = [
    path.join(root, "functions", "api", "owner", "users", "index.js"),
    path.join(root, "functions", "api", "owner", "users", "[user_id]", "reset.js"),
    path.join(root, "functions", "api", "owner", "users", "[user_id]", "status.js"),
    path.join(root, "functions", "api", "auth", "register.js"),
    path.join(root, "functions", "api", "auth", "recover.js"),
    path.join(root, "functions", "api", "auth", "recovery-codes.js"),
    path.join(root, "functions", "api", "auth", "bootstrap.js"),
    path.join(root, "functions", "api", "auth", "setup-password.js"),
    ...readdirSync(path.join(root, "functions", "api", "device-pairing"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => path.join(root, "functions", "api", "device-pairing", name)),
  ];
  const pattern = /\.prepare\(\s*`([\s\S]*?)`\s*\)/gu;
  let statements = 0;
  for (const filename of sources) {
    const source = readFileSync(filename, "utf8");
    for (const match of source.matchAll(pattern)) {
      assert.ok(!match[1].includes("${"), `SQL interpolation in ${path.relative(root, filename)}`);
      const sql = match[1].trim();
      db.prepare(`EXPLAIN ${sql}`).all(...Array((sql.match(/\?/gu) || []).length).fill(null));
      statements += 1;
    }
  }
  assert.ok(statements >= 20, `Only compiled ${statements} SQL statements`);
  db.close();
});

test("public registration always creates a normal member and does not reserve an admin username", () => {
  const registration = readFileSync(path.join(root, "functions", "api", "auth", "register.js"), "utf8");
  assert.ok(registration.includes("requirePost(context)"));
  assert.ok(registration.includes("normalizeUsername(body.username)"));
  assert.ok(registration.includes("validatePassword(body.password)"));
  assert.ok(!registration.includes("username === \"owner\""));
  assert.match(registration, /VALUES\s*\([\s\S]*?'member'[\s\S]*?\)/u);
  assert.ok(!registration.includes("body.role"), "registration must not accept a role from the browser");
  assert.ok(registration.includes("recordAttempt(env, addressBucket, ADDRESS_LIMIT)"));
  assert.ok(registration.includes("recordAttempt(env, usernameBucket, USERNAME_LIMIT)"));
  assert.ok(registration.includes("must_change_password, created_at, updated_at"));
  assert.ok(registration.includes("'PBKDF2-HMAC-SHA-256', ?, ?, ?, ?, 0, ?, ?"));
});

test("public registration ignores a requested owner role and starts a member session", async () => {
  const insertedUsers = [];
  const insertedSessions = [];
  const insertedRecoveryCodes = [];
  const env = {
    AUTH_RATE_LIMIT_SECRET: "test-only-rate-limit-secret-that-is-long-enough",
    DB: {
      prepare(sql) {
        return {
          sql,
          values: [],
          bind(...boundValues) { this.values = boundValues; return this; },
          async first() { return null; },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
      async batch(statements) {
        return statements.map((statement) => {
          if (/INSERT INTO users/iu.test(statement.sql)) insertedUsers.push(statement);
          if (/INSERT INTO sessions/iu.test(statement.sql)) insertedSessions.push(statement);
          if (/INSERT INTO account_recovery_codes/iu.test(statement.sql)) insertedRecoveryCodes.push(statement);
          return { meta: { changes: 1 } };
        });
      },
    },
  };
  const { onRequestPost } = await import(pathToFileURL(path.join(root, "functions/api/auth/register.js")));
  const request = new Request("https://kinguardian.test/api/auth/register", {
    method: "POST",
    headers: {
      origin: "https://kinguardian.test",
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.20",
    },
    body: JSON.stringify({ username: "owner", password: "a strong test passphrase", role: "owner" }),
  });
  const response = await onRequestPost({ request, env });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.user.username, "owner");
  assert.equal(body.user.role, "member");
  assert.equal(body.user.mustChangePassword, false);
  assert.equal(insertedUsers.length, 1);
  assert.match(insertedUsers[0].sql, /'member'/u);
  assert.equal(insertedUsers[0].values[1], "owner");
  assert.equal(insertedUsers[0].values[2], 100_000);
  assert.equal(insertedSessions.length, 1);
  assert.equal(insertedRecoveryCodes.length, 10);
  assert.equal(body.recoveryCodes.length, 10);
  for (const code of body.recoveryCodes) assert.match(code, /^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/u);
  assert.ok(!insertedRecoveryCodes.some((statement) => body.recoveryCodes.some((code) => statement.values.includes(code))));
  assert.ok(response.headers.get("set-cookie"));
  assert.ok(!JSON.stringify(body).includes("a strong test passphrase"));
});

test("recovery codes are random-looking, normalized, and hashed before storage", async () => {
  const recovery = await import(pathToFileURL(path.join(root, "functions/_shared/recovery-codes.js")));
  const { codes, records } = await recovery.createRecoveryCodeSet();
  assert.equal(codes.length, 10);
  assert.equal(records.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/u);
  assert.equal(records[0].codeHash.byteLength, 32);
  assert.deepEqual(
    await recovery.hashRecoveryCode(codes[0].toLowerCase()),
    await recovery.hashRecoveryCode(codes[0].replaceAll("-", "")),
  );
  assert.equal(await recovery.hashRecoveryCode("not a recovery code"), null);
});

test("password recovery consumes a code and revokes existing sessions and reset links", () => {
  const recovery = readFileSync(path.join(root, "functions", "api", "auth", "recover.js"), "utf8");
  assert.ok(recovery.includes("r.used_at IS NULL"));
  assert.ok(recovery.includes("SET used_at = ?"));
  assert.ok(recovery.includes("AND changes() = 1"));
  assert.ok(recovery.includes("UPDATE sessions SET revoked_at = ?"));
  assert.ok(recovery.includes("UPDATE account_setup_tokens SET revoked_at = ?"));
  assert.ok(recovery.includes("recovery:user:${username}"));
  const codeManager = readFileSync(path.join(root, "functions", "api", "auth", "recovery-codes.js"), "utf8");
  assert.ok(codeManager.includes("requireSession(context, { write: true })"));
  assert.ok(codeManager.includes("constantTimeEqual(candidate"));
  assert.ok(codeManager.includes("DELETE FROM account_recovery_codes WHERE user_id = ?"));
});

test("self-service recovery accepts a one-time code and revokes old access", async () => {
  const batchedSql = [];
  const env = {
    AUTH_RATE_LIMIT_SECRET: "test-only-rate-limit-secret-that-is-long-enough",
    DB: {
      prepare(sql) {
        let values = [];
        return {
          sql,
          bind(...boundValues) { values = boundValues; return this; },
          async first() {
            if (/SELECT u\.user_id/u.test(sql)) {
              return { user_id: "member-a", username: "member", recovery_code_id: "recovery-a" };
            }
            return null;
          },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
      async batch(statements) {
        batchedSql.push(...statements.map((statement) => statement.sql));
        return statements.map(() => ({ meta: { changes: 1 } }));
      },
    },
  };
  const { onRequestPost } = await import(pathToFileURL(path.join(root, "functions/api/auth/recover.js")));
  const request = new Request("https://kinguardian.test/api/auth/recover", {
    method: "POST",
    headers: {
      origin: "https://kinguardian.test",
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.21",
    },
    body: JSON.stringify({ username: "Member", recoveryCode: "A".repeat(32), password: "another strong new passphrase" }),
  });
  const response = await onRequestPost({ request, env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.recovered, true);
  assert.ok(batchedSql.some((sql) => /UPDATE account_recovery_codes SET used_at/u.test(sql)));
  assert.ok(batchedSql.some((sql) => /UPDATE sessions SET revoked_at/u.test(sql)));
  assert.ok(batchedSql.some((sql) => /UPDATE account_setup_tokens SET revoked_at/u.test(sql)));
  assert.ok(!JSON.stringify(body).includes("another strong new passphrase"));
});

test("relative API imports resolve to existing shared modules", () => {
  const apiRoot = path.join(root, "functions", "api");
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filename);
      } else if (entry.isFile() && filename.endsWith(".js")) {
        const source = readFileSync(filename, "utf8");
        for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/gu)) {
          const target = path.resolve(path.dirname(filename), match[1]);
          assert.ok(statSync(target, { throwIfNoEntry: false })?.isFile(), `${path.relative(root, filename)} imports missing ${match[1]}`);
        }
      }
    }
  };
  visit(apiRoot);
});

test("member passwords stay private and pairing requires existing-device approval", () => {
  const ownerRoutes = [
    path.join(root, "functions", "api", "owner", "users", "index.js"),
    path.join(root, "functions", "api", "owner", "users", "[user_id]", "reset.js"),
  ].map((filename) => readFileSync(filename, "utf8")).join("\n");
  assert.ok(!ownerRoutes.includes("temporaryPassword"));
  assert.ok(ownerRoutes.includes("newOpaqueCredential"));
  const approve = readFileSync(path.join(root, "functions", "api", "device-pairing", "approve.js"), "utf8");
  assert.ok(approve.includes("requireSession(context, { write: true })"));
  const redeem = readFileSync(path.join(root, "functions", "api", "device-pairing", "redeem.js"), "utf8");
  assert.ok(redeem.includes("approved_at IS NOT NULL"));
  assert.ok(redeem.includes("redeemed_at IS NULL"));
  const ownerApi = path.join(root, "functions", "api", "owner");
  const assertOwnerRoutes = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) assertOwnerRoutes(filename);
      else if (filename.endsWith(".js")) {
        assert.ok(readFileSync(filename, "utf8").includes("requireOwner"), `${path.relative(root, filename)} must require owner authorization`);
      }
    }
  };
  assertOwnerRoutes(ownerApi);
});
