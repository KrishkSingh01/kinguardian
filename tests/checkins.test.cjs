const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "functions", "_shared", "checkins.js"), "utf8")
  .replace(/^import\s+[\s\S]*?;\s*/gmu, "")
  .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gu, "")
  + "\nglobalThis.checkinFunctions = { parseCheckinSchedule, parseDailyCheckinSchedule, nextDailyCheckinSchedule, validateRecipientIds, findEligibleRecipients };";

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function loadCheckinHelpers() {
  const context = { RequestError, Intl, Date, Set, Object, Number, Math, Array, Error };
  new vm.Script(source, { filename: "functions/_shared/checkins.js" }).runInNewContext(context);
  return context.checkinFunctions;
}

const now = Date.parse("2026-01-01T00:00:00.000Z");

test("check-in times convert from international time zones", () => {
  const { parseCheckinSchedule } = loadCheckinHelpers();
  const result = parseCheckinSchedule({
    localDate: "2026-11-06", localTime: "12:00", timeZone: "Asia/Kolkata",
    graceMinutes: 10, reminderEnabled: true,
  }, now);
  assert.equal(new Date(result.scheduledFor).toISOString(), "2026-11-06T06:30:00.000Z");
  assert.equal(result.reminderAt, result.scheduledFor - 10 * 60_000);
});

test("daylight-saving gaps are rejected and repeated times use their first occurrence", () => {
  const { parseCheckinSchedule } = loadCheckinHelpers();
  assert.throws(() => parseCheckinSchedule({
    localDate: "2026-03-29", localTime: "01:30", timeZone: "Europe/London",
    graceMinutes: 10, reminderEnabled: false,
  }, now), (error) => error.code === "NONEXISTENT_LOCAL_TIME");
  const repeated = parseCheckinSchedule({
    localDate: "2026-10-25", localTime: "01:30", timeZone: "Europe/London",
    graceMinutes: 10, reminderEnabled: false,
  }, now);
  assert.equal(new Date(repeated.scheduledFor).toISOString(), "2026-10-25T00:30:00.000Z");
});

test("check-in schedule validates its time zone, date, range, and grace period", () => {
  const { parseCheckinSchedule } = loadCheckinHelpers();
  const base = {
    localDate: "2026-11-06", localTime: "12:00", timeZone: "Asia/Kolkata",
    graceMinutes: 10, reminderEnabled: false,
  };
  assert.throws(() => parseCheckinSchedule({ ...base, timeZone: "Mars/Olympus" }, now),
    (error) => error.code === "INVALID_TIME_ZONE");
  assert.throws(() => parseCheckinSchedule({ ...base, localDate: "2026-02-30" }, now),
    (error) => error.code === "INVALID_CHECKIN_TIME");
  assert.throws(() => parseCheckinSchedule({ ...base, graceMinutes: 241 }, now),
    (error) => error.code === "INVALID_GRACE_PERIOD");
  assert.throws(() => parseCheckinSchedule(base, Date.parse("2026-11-06T06:30:00.000Z")),
    (error) => error.code === "CHECKIN_OUT_OF_RANGE");
});

test("daily check-ins use the selected time zone and always choose a future occurrence", () => {
  const { parseDailyCheckinSchedule } = loadCheckinHelpers();
  const result = parseDailyCheckinSchedule({
    enabled: true, localTime: "20:00", timeZone: "Asia/Kolkata",
    graceMinutes: 10, reminderEnabled: true,
  }, Date.parse("2026-11-06T04:00:00.000Z"));
  assert.equal(result.nextLocalDate, "2026-11-06");
  assert.equal(new Date(result.nextCheckinAt).toISOString(), "2026-11-06T14:30:00.000Z");
  const afterToday = parseDailyCheckinSchedule({
    enabled: true, localTime: "20:00", timeZone: "Asia/Kolkata",
    graceMinutes: 10, reminderEnabled: false,
  }, Date.parse("2026-11-06T15:00:00.000Z"));
  assert.equal(afterToday.nextLocalDate, "2026-11-07");
  assert.equal(new Date(afterToday.nextCheckinAt).toISOString(), "2026-11-07T14:30:00.000Z");
});

test("daily schedules handle daylight-saving gaps and repeated local times", () => {
  const { parseDailyCheckinSchedule, nextDailyCheckinSchedule } = loadCheckinHelpers();
  const gap = parseDailyCheckinSchedule({
    enabled: true, localTime: "01:30", timeZone: "Europe/London",
    graceMinutes: 10, reminderEnabled: false,
  }, Date.parse("2026-03-29T00:00:00.000Z"));
  assert.equal(gap.nextLocalTime, "02:00");
  assert.equal(new Date(gap.nextCheckinAt).toISOString(), "2026-03-29T01:00:00.000Z");

  const repeated = nextDailyCheckinSchedule("2026-10-24", "01:30", "Europe/London");
  assert.equal(repeated.localDate, "2026-10-25");
  assert.equal(new Date(repeated.scheduledFor).toISOString(), "2026-10-25T00:30:00.000Z");
});

test("only UUID recipients with current missed-check-in consent are eligible", async () => {
  const { validateRecipientIds, findEligibleRecipients } = loadCheckinHelpers();
  const sender = "00000000-0000-4000-8000-000000000001";
  const recipient = "00000000-0000-4000-8000-000000000002";
  assert.deepEqual(validateRecipientIds([recipient]), [recipient]);
  assert.throws(() => validateRecipientIds(["not-a-uuid"]),
    (error) => error.code === "INVALID_CHECKIN_RECIPIENTS");

  let sql = "";
  let values = [];
  const database = {
    prepare(statement) {
      sql = statement;
      return {
        bind(...bound) {
          values = bound;
          return { all: async () => ({ results: [{ user_id: recipient }] }) };
        },
      };
    },
  };
  assert.deepEqual(await findEligibleRecipients(database, sender, [recipient]), [recipient]);
  assert.match(sql, /receive_missed_checkin = 1/u);
  assert.deepEqual(values, [sender, sender, recipient]);
  database.prepare = (statement) => ({
    bind() { return { all: async () => ({ results: [] }) }; },
  });
  await assert.rejects(findEligibleRecipients(database, sender, [recipient]),
    (error) => error.code === "CHECKIN_RECIPIENT_NOT_ALLOWED");
});
