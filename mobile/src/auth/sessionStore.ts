import * as SecureStore from "expo-secure-store";
import type { MobileSession } from "../api/models";

const SESSION_KEY = "kg.mobile.session.v1";

function isSession(value: unknown): value is MobileSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<MobileSession>;
  return typeof session.accessToken === "string"
    && typeof session.refreshToken === "string"
    && Number.isSafeInteger(session.accessExpiresAt)
    && Number.isSafeInteger(session.refreshExpiresAt)
    && Boolean(session.user && typeof session.user.userId === "string" && typeof session.user.username === "string");
}

export async function readSession(): Promise<MobileSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isSession(parsed)) return parsed;
  } catch { /* Clear malformed secure data and require sign-in again. */ }
  await clearSession();
  return null;
}

export async function saveSession(session: MobileSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
