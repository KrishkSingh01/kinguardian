const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");

function makeDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const filename of readdirSync(path.join(root, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(path.join(root, "migrations", filename), "utf8"));
  }

  return {
    sqlite,
    DB: {
      prepare(sql) {
        let values = [];
        return {
          sql,
          get values() { return values; },
          bind(...boundValues) { values = boundValues; return this; },
          async all() { return { results: sqlite.prepare(sql).all(...values) }; },
          async first() { return sqlite.prepare(sql).get(...values) || null; },
          async run() {
            const result = sqlite.prepare(sql).run(...values);
            return { meta: { changes: Number(result.changes) } };
          },
        };
      },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((statement) => {
            const result = sqlite.prepare(statement.sql).run(...statement.values);
            return { meta: { changes: Number(result.changes) } };
          });
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

function addUser(sqlite, userId, username) {
  sqlite.prepare(`INSERT INTO users (
    user_id, username, role, password_hash, password_salt, created_at, updated_at
  ) VALUES (?, ?, 'member', X'01', X'02', 1, 1)`).run(userId, username);
}

test("overdue Safe Journeys notify only consenting connected people and do not duplicate", async () => {
  const { sqlite, DB } = makeDatabase();
  try {
    for (const [id, username] of [["user-a", "a"], ["user-b", "b"], ["user-c", "c"], ["user-d", "d"]]) {
      addUser(sqlite, id, username);
    }
    for (const [id, recipient, mayReceive] of [["connection-b", "user-b", 1], ["connection-c", "user-c", 0]]) {
      sqlite.prepare(`INSERT INTO trusted_connections (
        connection_id, user_low_id, user_high_id, connection_status, requested_by_user_id, created_at
      ) VALUES (?, 'user-a', ?, 'accepted', 'user-a', 1)`).run(id, recipient);
      sqlite.prepare(`INSERT INTO trusted_connection_preferences (
        connection_id, recipient_user_id, receive_sos, receive_missed_checkin,
        receive_safe_journeys, updated_at
      ) VALUES (?, ?, 1, 0, ?, 1)`).run(id, recipient, mayReceive);
    }
    sqlite.prepare(`INSERT INTO safe_journeys (
      journey_id, client_journey_id, user_id, status, started_at, expected_return_at, created_at, updated_at
    ) VALUES ('journey-due', 'client-due', 'user-a', 'active', 100, 200, 100, 100),
             ('journey-future', 'client-future', 'user-d', 'active', 100, 500, 100, 100)`).run();
    sqlite.prepare(`INSERT INTO safe_journey_recipients (journey_id, recipient_user_id, created_at)
      VALUES ('journey-due', 'user-b', 100), ('journey-due', 'user-c', 100)`).run();

    const { markDueJourneysOverdue } = await import(pathToFileURL(path.join(root, "worker", "safe-journey-scheduler.js")));
    assert.equal(await markDueJourneysOverdue(DB, 250), 1);
    assert.equal(await markDueJourneysOverdue(DB, 260), 0);

    assert.equal(sqlite.prepare("SELECT status FROM safe_journeys WHERE journey_id = 'journey-due'").get().status, "overdue");
    assert.equal(sqlite.prepare("SELECT status FROM safe_journeys WHERE journey_id = 'journey-future'").get().status, "active");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM safe_journey_events WHERE event_key = 'journey-overdue:journey-due'").get().count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM notification_events WHERE category = 'journey_overdue'").get().count, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM notification_events WHERE user_id = 'user-b'").get().count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM notification_events WHERE user_id = 'user-c'").get().count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM notification_events WHERE user_id = 'user-a'").get().count, 1);
  } finally {
    sqlite.close();
  }
});
