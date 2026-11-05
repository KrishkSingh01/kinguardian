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
  for (let sample = localAsUtc - 36 * 60 * MINUTE; sample <= localAsUtc + 36 * 60 * MINUTE; sample += 3 * 60 * MINUTE) {
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
