const DATABASE_NAME = "kinguardian-offline-v1";
const STORE_VERSION = 1;
const PROFILE_KEY = "kinguardian-offline-profile";
let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
      reject(new Error("This browser cannot save encrypted offline data."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, STORE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("keys")) database.createObjectStore("keys", { keyPath: "userId" });
      if (!database.objectStoreNames.contains("records")) database.createObjectStore("records", { keyPath: ["userId", "recordId"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage could not be opened."));
  });
  return databasePromise;
}

async function getDeviceKey(userId, create = false) {
  const database = await openDatabase();
  const read = database.transaction("keys", "readonly").objectStore("keys").get(userId);
  const existing = await requestValue(read);
  if (existing?.key) return existing.key;
  if (!create) return null;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await requestValue(database.transaction("keys", "readwrite").objectStore("keys").put({ userId, key, createdAt: Date.now() }));
  return key;
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage could not be read."));
  });
}

function encodeRecord(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}

export async function putOfflineRecord(userId, recordId, value) {
  if (!userId || !recordId) throw new Error("The offline record is not linked to this account.");
  const key = await getDeviceKey(userId, true);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encodeRecord(value));
  const database = await openDatabase();
  await requestValue(database.transaction("records", "readwrite").objectStore("records").put({
    userId,
    recordId,
    iv,
    ciphertext,
    updatedAt: Date.now(),
  }));
}

export async function getOfflineRecord(userId, recordId) {
  const database = await openDatabase();
  const stored = await requestValue(database.transaction("records", "readonly").objectStore("records").get([userId, recordId]));
  if (!stored) return null;
  const key = await getDeviceKey(userId);
  if (!key) return null;
  try {
    const cleartext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: stored.iv }, key, stored.ciphertext);
    return JSON.parse(new TextDecoder().decode(cleartext));
  } catch {
    return null;
  }
}

export async function listOfflineRecords(userId, prefix = "") {
  const database = await openDatabase();
  const all = await requestValue(database.transaction("records", "readonly").objectStore("records").getAll());
  const matching = all.filter((row) => row.userId === userId && row.recordId.startsWith(prefix));
  const records = [];
  for (const row of matching) {
    const value = await getOfflineRecord(userId, row.recordId);
    if (value !== null) records.push({ recordId: row.recordId, value, updatedAt: row.updatedAt });
  }
  return records;
}

export async function deleteOfflineRecord(userId, recordId) {
  const database = await openDatabase();
  await requestValue(database.transaction("records", "readwrite").objectStore("records").delete([userId, recordId]));
}

export function cacheOfflineProfile(user) {
  if (!user || typeof user.userId !== "string" || typeof user.username !== "string") return;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ userId: user.userId, username: user.username })); } catch { /* Offline entry is unavailable when browser storage is blocked. */ }
}

export function getOfflineProfile() {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    return value && typeof value.userId === "string" && typeof value.username === "string" ? value : null;
  } catch { return null; }
}
