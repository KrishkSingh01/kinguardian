const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");

function migratedDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(path.join(root, "migrations")).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(path.join(root, "migrations", name), "utf8"));
  }
  const DB = {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        first() { return sqlite.prepare(sql).get(...values) || null; },
        all() { return { results: sqlite.prepare(sql).all(...values) }; },
        run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes } }; },
      };
      return statement;
    },
  };
  return { sqlite, DB };
}

function addUser(sqlite, id, username) {
  sqlite.prepare(`INSERT INTO users (user_id, username, role, password_hash, password_salt, must_change_password, created_at, updated_at)
    VALUES (?, ?, 'member', ?, ?, 0, 1, 1)`).run(id, username, Buffer.from("hash"), Buffer.from("salt"));
}

async function getConnections(DB, userId) {
  const { createSession } = await import(pathToFileURL(path.join(root, "functions", "_shared", "auth.js")));
  const { onRequestGet } = await import(pathToFileURL(path.join(root, "functions", "api", "connections", "index.js")));
  const session = await createSession({ DB }, userId);
  const request = new Request("https://kinguardian.pages.dev/api/connections", {
    headers: { cookie: `__Host-kg_session=${session.token}` },
  });
  return onRequestGet({ request, env: { DB } });
}

test("connections API keeps incoming, outgoing, accepted, and replied requests visible", async () => {
  const { sqlite, DB } = migratedDatabase();
  try {
    addUser(sqlite, "member-a", "alpha");
    addUser(sqlite, "member-b", "bravo");
    addUser(sqlite, "member-c", "charlie");
    addUser(sqlite, "member-d", "delta");
    sqlite.prepare(`INSERT INTO trusted_connections
      (connection_id, user_low_id, user_high_id, connection_status, requested_by_user_id, created_at)
      VALUES ('incoming-a', 'member-a', 'member-b', 'pending', 'member-b', 100)`).run();
    sqlite.prepare(`INSERT INTO trusted_connections
      (connection_id, user_low_id, user_high_id, connection_status, requested_by_user_id, created_at, accepted_at)
      VALUES ('accepted-a', 'member-a', 'member-c', 'accepted', 'member-a', 200, 300)`).run();
    sqlite.prepare(`INSERT INTO trusted_connections
      (connection_id, user_low_id, user_high_id, connection_status, requested_by_user_id, created_at, ended_at)
      VALUES ('declined-a', 'member-a', 'member-d', 'rejected', 'member-a', 150, 250)`).run();

    const alphaResponse = await getConnections(DB, "member-a");
    assert.equal(alphaResponse.status, 200);
    const alpha = await alphaResponse.json();
    assert.deepEqual(alpha.requests.map((item) => item.username), ["bravo"]);
    assert.deepEqual(alpha.sentRequests, []);
    assert.deepEqual(alpha.connections.map((item) => item.username), ["charlie"]);
    assert.deepEqual(alpha.recentReplies.map(({ username, status }) => ({ username, status })), [
      { username: "charlie", status: "accepted" },
      { username: "delta", status: "rejected" },
    ]);

    const bravoResponse = await getConnections(DB, "member-b");
    const bravo = await bravoResponse.json();
    assert.deepEqual(bravo.requests, []);
    assert.deepEqual(bravo.sentRequests.map((item) => item.username), ["alpha"]);
  } finally {
    sqlite.close();
  }
});
