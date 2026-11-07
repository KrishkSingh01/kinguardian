import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

export type QueuedSos = {
  clientAlertId: string;
  testMode: boolean;
  trustedUserIds: string[];
  externalContactIds: string[];
  senderTimezone: string;
  activatedAt: number;
  location?: { latitude: number; longitude: number; accuracy: number; capturedAt: number };
};

const DATABASE_NAME = "kg-private-v1.db";
const KEY_NAME = "kg.mobile.sqlcipher.key.v1";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openPrivateDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    let key = await SecureStore.getItemAsync(KEY_NAME, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    if (!key) {
      const bytes = await Crypto.getRandomBytesAsync(32);
      key = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
      await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    }
    if (!/^[0-9a-f]{64}$/u.test(key)) throw new Error("Private storage key is not valid.");
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    const cipher = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version;");
    if (!cipher?.cipher_version) {
      await db.closeAsync();
      throw new Error("Encrypted private storage is not available in this app build. Nothing was saved on this phone.");
    }
    await db.execAsync(`
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS queued_sos (
        client_alert_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    return db;
  })().catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export async function saveQueuedSos(userId: string, payload: QueuedSos): Promise<void> {
  const db = await openPrivateDatabase();
  await db.runAsync(
    "INSERT INTO queued_sos (client_alert_id, user_id, payload_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_alert_id) DO UPDATE SET payload_json = excluded.payload_json WHERE user_id = excluded.user_id",
    payload.clientAlertId, userId, JSON.stringify(payload), Date.now(),
  );
}

export async function readQueuedSos(userId: string): Promise<QueuedSos[]> {
  const db = await openPrivateDatabase();
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM queued_sos WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", userId,
  );
  const items: QueuedSos[] = [];
  for (const row of rows) {
    try {
      const value: unknown = JSON.parse(row.payload_json);
      if (isQueuedSos(value)) items.push(value);
    } catch { /* Ignore a damaged local draft; it must never be sent as an alert. */ }
  }
  return items;
}

export async function deleteQueuedSos(userId: string, clientAlertId: string): Promise<void> {
  const db = await openPrivateDatabase();
  await db.runAsync("DELETE FROM queued_sos WHERE client_alert_id = ? AND user_id = ?", clientAlertId, userId);
}

export async function deleteAllQueuedSos(userId: string): Promise<void> {
  const db = await openPrivateDatabase();
  await db.runAsync("DELETE FROM queued_sos WHERE user_id = ?", userId);
}

function isQueuedSos(value: unknown): value is QueuedSos {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<QueuedSos>;
  return typeof item.clientAlertId === "string" && typeof item.testMode === "boolean"
    && Array.isArray(item.trustedUserIds) && Array.isArray(item.externalContactIds)
    && typeof item.senderTimezone === "string" && Number.isSafeInteger(item.activatedAt);
}
