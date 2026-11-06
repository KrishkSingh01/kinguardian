import { RequestError } from "./http.js";

const MINUTE = 60_000;
const MAX_SCHEDULE_AHEAD = 366 * 24 * 60 * MINUTE;

export function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function parseLocalParts(localDate, localTime) {
  if (typeof localDate !== "string" || typeof localTime !== "string") return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(localDate);
  const timeMatch = /^(\d{2}):(\d{2})$/u.exec(localTime);
  if (!dateMatch || !timeMatch) return null;
  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const parts = {
    year: Number(yearText), month: Number(monthText), day: Number(dayText),
    hour: Number(hourText), minute: Number(minuteText),
  };
  if (parts.year < 2000 || parts.year > 9999 || parts.month < 1 || parts.month > 12
    || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59) return null;
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() !== parts.month - 1
    || check.getUTCDate() !== parts.day) return null;
  return parts;
}

function partsInZone(instant, formatter) {
  const values = Object.fromEntries(formatter.formatToParts(new Date(instant))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}

function matches(left, right) {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute;
}

function localTimeToUtc(parts, timeZone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  } catch {
    throw new RequestError(400, "INVALID_TIME_ZONE", "Choose a valid time zone, such as Europe/London.");
  }

  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsets = new Set();
  for (const sample of [localAsUtc - 36 * 60 * MINUTE, localAsUtc, localAsUtc + 36 * 60 * MINUTE]) {
    const inZone = partsInZone(sample, formatter);
    offsets.add(Date.UTC(inZone.year, inZone.month - 1, inZone.day, inZone.hour, inZone.minute) - sample);
  }

  const candidates = [...offsets]
    .map((offset) => localAsUtc - offset)
    .filter((instant) => matches(partsInZone(instant, formatter), parts))
    .sort((left, right) => left - right);
  if (candidates.length === 0) {
    throw new RequestError(400, "NONEXISTENT_LOCAL_TIME", "That local time does not exist because the clocks move forward. Choose another time.");
  }
  // If clocks move back and a local time occurs twice, use its first occurrence.
  return candidates[0];
}

function formatLocalDateTime(instant, timeZone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  } catch {
    throw new RequestError(400, "INVALID_TIME_ZONE", "Choose a valid time zone, such as Asia/Kolkata.");
  }
  const parts = partsInZone(instant, formatter);
  return {
    localDate: String(parts.year).padStart(4, "0") + "-" + String(parts.month).padStart(2, "0") + "-" + String(parts.day).padStart(2, "0"),
    localTime: String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0"),
  };
}

function addLocalDays(localDate, count) {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + count));
  return String(date.getUTCFullYear()).padStart(4, "0") + "-"
    + String(date.getUTCMonth() + 1).padStart(2, "0") + "-"
    + String(date.getUTCDate()).padStart(2, "0");
}

function resolveDailyLocalTime(localDate, localTime, timeZone) {
  const [hour, minute] = localTime.split(":").map(Number);
  const candidateAt = (advance) => {
    const wallClock = new Date(Date.UTC(Number(localDate.slice(0, 4)), Number(localDate.slice(5, 7)) - 1,
      Number(localDate.slice(8, 10)), hour, minute + advance));
    const date = String(wallClock.getUTCFullYear()).padStart(4, "0") + "-"
      + String(wallClock.getUTCMonth() + 1).padStart(2, "0") + "-"
      + String(wallClock.getUTCDate()).padStart(2, "0");
    const time = String(wallClock.getUTCHours()).padStart(2, "0") + ":"
      + String(wallClock.getUTCMinutes()).padStart(2, "0");
    const parts = parseLocalParts(date, time);
    return { scheduledFor: localTimeToUtc(parts, timeZone), localDate: date, localTime: time };
  };
  try {
    return candidateAt(0);
  } catch (error) {
    if (error.code !== "NONEXISTENT_LOCAL_TIME") throw error;
  }
  let lower = 0;
  let upper = 180;
  let result;
  try {
    result = candidateAt(upper);
  } catch (error) {
    if (error.code !== "NONEXISTENT_LOCAL_TIME") throw error;
    throw new RequestError(400, "NONEXISTENT_LOCAL_TIME", "That daily time could not be found on this date. Choose another time.");
  }
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    try {
      result = candidateAt(middle);
      upper = middle;
    } catch (error) {
      if (error.code !== "NONEXISTENT_LOCAL_TIME") throw error;
      lower = middle;
    }
  }
  return result;
}

export function parseDailyCheckinSchedule(body, now = Date.now()) {
  if (typeof body.localTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(body.localTime)) {
    throw new RequestError(400, "INVALID_CHECKIN_TIME", "Enter a valid daily check-in time.");
  }
  if (typeof body.timeZone !== "string" || body.timeZone.length < 1 || body.timeZone.length > 100) {
    throw new RequestError(400, "INVALID_TIME_ZONE", "Choose a valid time zone, such as Asia/Kolkata.");
  }
  if (!Number.isInteger(body.graceMinutes) || body.graceMinutes < 0 || body.graceMinutes > 240) {
    throw new RequestError(400, "INVALID_GRACE_PERIOD", "Choose a grace period from 0 to 240 minutes.");
  }
  if (typeof body.reminderEnabled !== "boolean" || typeof body.enabled !== "boolean") {
    throw new RequestError(400, "INVALID_DAILY_CHECKIN", "Choose whether daily check-ins and reminders are enabled.");
  }

  const today = formatLocalDateTime(now, body.timeZone).localDate;
  let next = resolveDailyLocalTime(today, body.localTime, body.timeZone);
  if (next.scheduledFor <= now + MINUTE) {
    next = resolveDailyLocalTime(addLocalDays(today, 1), body.localTime, body.timeZone);
  }
  return {
    enabled: body.enabled,
    localTime: body.localTime,
    timeZone: body.timeZone,
    graceMinutes: body.graceMinutes,
    reminderEnabled: body.reminderEnabled,
    nextLocalDate: body.enabled ? next.localDate : null,
    nextLocalTime: body.enabled ? next.localTime : null,
    nextCheckinAt: body.enabled ? next.scheduledFor : null,
  };
}

export function nextDailyCheckinSchedule(localDate, localTime, timeZone) {
  const parts = parseLocalParts(localDate, localTime);
  if (!parts || typeof timeZone !== "string" || timeZone.length < 1 || timeZone.length > 100
    || typeof localTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(localTime)) {
    throw new RequestError(400, "INVALID_DAILY_CHECKIN", "The saved daily schedule needs to be updated before it can run.");
  }
  return resolveDailyLocalTime(addLocalDays(localDate, 1), localTime, timeZone);
}

export function parseCheckinSchedule(body, now = Date.now(), { allowPast = false } = {}) {
  const parts = parseLocalParts(body.localDate, body.localTime);
  if (!parts) throw new RequestError(400, "INVALID_CHECKIN_TIME", "Enter a valid local date and time.");
  if (typeof body.timeZone !== "string" || body.timeZone.length < 1 || body.timeZone.length > 100) {
    throw new RequestError(400, "INVALID_TIME_ZONE", "Choose a valid time zone, such as Europe/London.");
  }
  const scheduledFor = localTimeToUtc(parts, body.timeZone);
  if ((!allowPast && scheduledFor <= now + MINUTE) || scheduledFor > now + MAX_SCHEDULE_AHEAD) {
    throw new RequestError(400, "CHECKIN_OUT_OF_RANGE", "Choose a time at least one minute from now and within the next year.");
  }
  if (!Number.isInteger(body.graceMinutes) || body.graceMinutes < 0 || body.graceMinutes > 240) {
    throw new RequestError(400, "INVALID_GRACE_PERIOD", "Choose a grace period from 0 to 240 minutes.");
  }
  if (typeof body.reminderEnabled !== "boolean") {
    throw new RequestError(400, "INVALID_REMINDER", "Choose whether to receive a check-in reminder.");
  }
  return {
    localDate: body.localDate,
    localTime: body.localTime,
    timeZone: body.timeZone,
    scheduledFor,
    graceMinutes: body.graceMinutes,
    reminderEnabled: body.reminderEnabled,
    reminderAt: body.reminderEnabled ? Math.max(now, scheduledFor - 10 * MINUTE) : null,
  };
}

export function validateRecipientIds(recipientUserIds) {
  if (!Array.isArray(recipientUserIds) || recipientUserIds.length < 1 || recipientUserIds.length > 20
    || recipientUserIds.some((id) => !isUuid(id)) || new Set(recipientUserIds).size !== recipientUserIds.length) {
    throw new RequestError(400, "INVALID_CHECKIN_RECIPIENTS", "Choose one to twenty opted-in KinGuardian members.");
  }
  return recipientUserIds;
}

export async function findEligibleRecipients(DB, senderUserId, recipientUserIds) {
  validateRecipientIds(recipientUserIds);
  const placeholders = recipientUserIds.map(() => "?").join(", ");
  const result = await DB.prepare(`
    SELECT recipient.user_id
    FROM users AS recipient
    JOIN trusted_connections AS c ON c.connection_status = 'accepted'
      AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
        OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
    JOIN trusted_connection_preferences AS p
      ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
      AND p.receive_missed_checkin = 1
    WHERE recipient.account_status = 'active' AND recipient.user_id IN (${placeholders})
  `).bind(senderUserId, senderUserId, ...recipientUserIds).all();
  const eligible = new Set((result.results || []).map((row) => row.user_id));
  if (eligible.size !== recipientUserIds.length || recipientUserIds.some((id) => !eligible.has(id))) {
    throw new RequestError(403, "CHECKIN_RECIPIENT_NOT_ALLOWED", "A selected member is inactive or has not opted in to missed check-in notices.");
  }
  return recipientUserIds;
}
