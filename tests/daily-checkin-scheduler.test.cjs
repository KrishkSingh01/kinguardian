const assert = require("node:assert/strict");
const test = require("node:test");

test("scheduled daily check-ins advance by local calendar day and use idempotent event keys", async () => {
  const { scheduleDueDailyCheckins } = await import("../worker/daily-checkin-scheduler.js");
  const captured = [];
  const setting = {
    user_id: "member-a", local_time: "20:00", timezone: "Asia/Kolkata",
    grace_minutes: 10, reminder_enabled: 1, next_local_date: "2026-11-06",
    next_local_time: "20:00", next_checkin_at_utc: Date.parse("2026-11-06T14:30:00.000Z"),
  };
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            all: async () => ({ results: sql.includes("FROM daily_checkin_settings") ? [setting] : [] }),
            run: async () => ({ meta: { changes: 1 } }),
            sql,
            values,
          };
        },
      };
    },
    async batch(statements) { captured.push(...statements); return statements.map(() => ({ meta: { changes: 1 } })); },
  };
  const now = Date.parse("2026-11-06T14:31:00.000Z");
  await scheduleDueDailyCheckins(DB, now);
  assert.equal(captured.length, 3);
  assert.match(captured[0].sql, /ON CONFLICT \(user_id, idempotency_key\) DO NOTHING/u);
  assert.deepEqual(captured[0].values.slice(1, 5), [
    "2026-11-06", "20:00", setting.next_checkin_at_utc, setting.next_checkin_at_utc - 10 * 60_000,
  ]);
  assert.match(captured[1].sql, /receive_missed_checkin = 1/u);
  assert.match(captured[1].sql, /INSERT OR IGNORE/u);
  assert.deepEqual(captured[2].values.slice(0, 3), [
    "2026-11-07", "20:00", Date.parse("2026-11-07T14:30:00.000Z"),
  ]);
  assert.match(captured[2].sql, /next_checkin_at_utc = \?/u);
});

test("a corrupted time zone pauses a daily plan instead of retrying it every minute", async () => {
  const { scheduleDueDailyCheckins } = await import("../worker/daily-checkin-scheduler.js");
  let paused = false;
  const DB = {
    prepare(sql) {
      return {
        bind() {
          return {
            all: async () => ({ results: sql.includes("FROM daily_checkin_settings") ? [{
              user_id: "member-b", local_time: "20:00", timezone: "invalid/zone",
              next_local_date: "2026-11-06", next_checkin_at_utc: 1,
            }] : [] }),
            run: async () => { paused = sql.includes("SET enabled = 0"); return { meta: { changes: 1 } }; },
          };
        },
      };
    },
    async batch() { throw new Error("No schedule should be created for an invalid zone"); },
  };
  await scheduleDueDailyCheckins(DB, 2);
  assert.equal(paused, true);
});
