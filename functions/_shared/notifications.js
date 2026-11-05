import { fromBase64Url } from "./crypto.js";

export const NOTIFICATION_CATEGORIES = Object.freeze({
  sos: "sos_enabled",
  invitations: "invitations_enabled",
  checkinReminders: "checkin_reminders_enabled",
  missedCheckins: "missed_checkins_enabled",
  acknowledgements: "acknowledgements_enabled",
  accountSecurity: "account_security_enabled",
});

export function usableVapidPublicKey(value) {
  return fromBase64Url(value, { minimumBytes: 65, maximumBytes: 65 })?.[0] === 4
    ? value
    : "";
}

export function validPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password
      || endpoint.port && endpoint.port !== "443" || endpoint.hash) return false;
    const host = endpoint.hostname.toLowerCase();
    return host === "fcm.googleapis.com"
      || host === "web.push.apple.com"
      || /(?:^|\.)push\.services\.mozilla\.com$/u.test(host)
      || /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/u.test(host);
  } catch {
    return false;
  }
}

export async function validPushKeys(p256dhText, authText) {
  const p256dh = fromBase64Url(p256dhText, { minimumBytes: 65, maximumBytes: 65 });
  const auth = fromBase64Url(authText, { minimumBytes: 16, maximumBytes: 16 });
  if (!p256dh || p256dh[0] !== 4 || !auth) return null;
  try {
    await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
    return { p256dh, auth };
  } catch {
    return null;
  }
}
