const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

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

test("all numbered migrations include constrained setup and pairing tables", () => {
  const db = migratedDatabase();
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name));
  assert.ok(tables.has("account_setup_tokens"));
  assert.ok(tables.has("device_pairing_requests"));
  for (const table of ["account_setup_tokens", "device_pairing_requests"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
    assert.ok(columns.includes("token_hash"), `${table} must store token hashes`);
    assert.ok(!columns.includes("token"), `${table} must not store plaintext tokens`);
  }
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'index' AND name = 'one_open_account_setup_token_per_purpose'").get().count,
    1,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table'").get().count, 30);
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
