import { requestJson, showMessage } from "./auth-client.js";
import { cacheOfflineProfile, deleteOfflineRecord, getOfflineProfile, getOfflineRecord, listOfflineRecords, putOfflineRecord } from "./offline-store.js";
import { SOS_COUNTDOWN_MS, getRemainingSOSCountdownSeconds } from "./sos-countdown.js";

const recipientFieldset = document.querySelector("#trusted-recipient-fieldset");
const recipientList = document.querySelector("#sos-recipient-list");
const recipientEmpty = document.querySelector("#sos-recipient-empty");
const startButton = document.querySelector("#start-countdown");
const retryButton = document.querySelector("#retry-alert");
const cancelButton = document.querySelector("#cancel-countdown");
const countdownPanel = document.querySelector("#sos-countdown-panel");
const countdownNumber = document.querySelector("#sos-countdown-number");
const message = document.querySelector("#sos-message");
const alertList = document.querySelector("#sos-alert-list");
const alertEmpty = document.querySelector("#sos-alert-empty");

const COUNTDOWN_MS = SOS_COUNTDOWN_MS;
let currentUser = null;
let countdownTimer;
let countdownEndsAt = 0;
let pendingSubmission = null;
let pollTimer;
let freshLocationPromise = Promise.resolve(null);
let activeAlertId;
let locationWatchId;
let lastLocationPostedAt = 0;

startButton.addEventListener("click", startCountdown);
cancelButton.addEventListener("click", cancelCountdown);
retryButton.addEventListener("click", submitPendingAlert);
document.querySelector("#refresh-alerts").addEventListener("click", loadAlerts);
alertList.addEventListener("click", handleAlertAction);
window.addEventListener("kg:session", (event) => {
  if (!event.detail?.userId || event.detail.userId === currentUser?.userId) return;
  currentUser = event.detail;
  void initializeOnline();
});
window.addEventListener("kg:offline", () => { currentUser = getOfflineProfile(); void initializeOffline(); });
window.addEventListener("online", () => { if (currentUser) void synchronizePending(); });
window.addEventListener("offline", () => { stopLiveLocation(false); currentUser = getOfflineProfile(); void initializeOffline(); });
window.addEventListener("pagehide", () => stopLiveLocation(false));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { clearTimeout(pollTimer); stopLiveLocation(false); }
  else if (currentUser && navigator.onLine) { void loadAlerts(); schedulePoll(); }
});

void initializeSession();

async function initializeSession() {
  if (!navigator.onLine) {
    currentUser = getOfflineProfile();
    await initializeOffline();
    return;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const { user } = await requestJson("/api/auth/me", { signal: controller.signal });
    if (!user?.userId) throw new Error("KinGuardian could not verify your sign-in. Refresh the page or sign in again.");
    if (user.mustChangePassword) {
      location.replace("change-password.html");
      return;
    }
    currentUser = user;
    await initializeOnline();
  } catch (error) {
    if (error.status === 401) {
      location.replace("login.html");
      return;
    }
    if (error.code === "PASSWORD_CHANGE_REQUIRED") {
      location.replace("change-password.html");
      return;
    }
    if (!navigator.onLine) {
      currentUser = getOfflineProfile();
      await initializeOffline();
      return;
    }
    startButton.disabled = true;
    showMessage(message, error.name === "AbortError"
      ? "KinGuardian did not respond while checking your sign-in. Refresh the page and try again."
      : error.message || "KinGuardian could not verify your sign-in. Refresh the page or sign in again.");
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function initializeOnline() {
  if (!currentUser?.userId) return;
  cacheOfflineProfile(currentUser);
  startButton.disabled = false;
  try {
    await loadRecipients();
    await synchronizePending();
    await loadAlerts();
    schedulePoll();
  } catch (error) {
    showMessage(message, error.message || "SOS is unavailable until your trusted people load.");
  }
}

async function initializeOffline() {
  if (!currentUser?.userId) {
    showMessage(message, "Sign in on this device once to prepare offline SOS. In immediate danger, call your local emergency service.");
    return;
  }
  const connections = await getOfflineRecord(currentUser.userId, "connections").catch(() => []);
  renderRecipients(connections || []);
  startButton.disabled = false;
  const queued = await listOfflineRecords(currentUser.userId, "sos:").catch(() => []);
  const savedAlerts = await getOfflineRecord(currentUser.userId, "sos:history").catch(() => []);
  const alertNodes = [...(savedAlerts || []).map((alert) => renderAlert(alert, true)), ...queued.map((record) => renderLocalAlert(record.value))];
  alertEmpty.hidden = alertNodes.length > 0;
  alertList.replaceChildren(...alertNodes);
  showMessage(message, "Offline mode. An SOS will be saved on this device; nobody is notified until it can sync.", "pending");
}

async function loadRecipients() {
  const { connections } = await requestJson("/api/connections");
  renderRecipients(connections || []);
}

function renderRecipients(connections) {
  recipientList.replaceChildren();
  const eligible = connections.filter((connection) => connection.receiveSos === true);
  recipientEmpty.hidden = eligible.length > 0;
  for (const connection of eligible) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "sos-recipient";
    checkbox.value = connection.userId;
    checkbox.dataset.username = connection.username;
    const copy = document.createElement("span");
    copy.textContent = `@${connection.username}`;
    label.append(checkbox, copy);
    item.append(label);
    recipientList.append(item);
  }
  recipientFieldset.disabled = eligible.length === 0;
}

function selectedRecipientIds() {
  return [...recipientList.querySelectorAll('input[name="sos-recipient"]:checked')].map((input) => input.value);
}

function startCountdown() {
  if (!currentUser) currentUser = getOfflineProfile();
  if (!currentUser?.userId) {
    showMessage(message, "Sign in once on this device before sending or saving an SOS.");
    return;
  }
  pendingSubmission = {
    clientAlertId: crypto.randomUUID(),
    testMode: false,
    trustedUserIds: selectedRecipientIds(),
    externalContactIds: [],
    senderTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
    activatedAt: null,
    location: null,
  };
  freshLocationPromise = readFreshPosition();
  countdownEndsAt = Date.now() + COUNTDOWN_MS;
  countdownPanel.hidden = false;
  startButton.hidden = true;
  retryButton.hidden = true;
  recipientFieldset.disabled = true;
  showMessage(message, "SOS countdown started. Cancel within 10 seconds if this was a mistake.", "busy");
  tickCountdown();
  countdownTimer = window.setInterval(tickCountdown, 100);
}

function tickCountdown() {
  const left = getRemainingSOSCountdownSeconds(countdownEndsAt, Date.now());
  countdownNumber.textContent = String(left);
  if (left === 0 && pendingSubmission) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
    countdownPanel.hidden = true;
    const submission = pendingSubmission;
    submission.activatedAt = Date.now();
    void attachCachedLocation(submission).then(() => submitPendingAlert());
  }
}

async function attachCachedLocation(submission) {
  if (!currentUser?.userId) return;
  const cached = await getOfflineRecord(currentUser.userId, "location:last-known").catch(() => null);
  if (isValidLocalPoint(cached)) submission.location = cached;
}

function readFreshPosition() {
  if (!window.isSecureContext || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (position) => resolve(normalizePosition(position)),
    () => resolve(null),
    { enableHighAccuracy: false, maximumAge: 15_000, timeout: 12_000 },
  ));
}

function normalizePosition(position) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0,
    capturedAt: Number.isFinite(position.timestamp) ? Math.trunc(position.timestamp) : Date.now(),
    source: "browser location",
  };
}

function isValidLocalPoint(point) {
  return Boolean(point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
    && Number.isFinite(point.accuracy) && Number.isSafeInteger(point.capturedAt)
    && point.capturedAt <= Date.now() + 60_000
    && point.capturedAt >= Date.now() - 7 * 24 * 60 * 60_000);
}

function cancelCountdown() {
  if (!pendingSubmission || pendingSubmission.activatedAt) return;
  clearInterval(countdownTimer);
  countdownTimer = undefined;
  pendingSubmission = null;
  countdownPanel.hidden = true;
  startButton.hidden = false;
  startButton.disabled = false;
  recipientFieldset.disabled = false;
  showMessage(message, "SOS cancelled. No alert was saved or sent.", "success");
}

async function submitPendingAlert() {
  if (!pendingSubmission?.activatedAt) return;
  startButton.disabled = true;
  retryButton.disabled = true;
  if (!navigator.onLine) {
    await queueLocally();
    return;
  }
  showMessage(message, "Saving your SOS and preparing trusted-person alerts…", "busy");
  try {
    const submission = pendingSubmission;
    const result = await requestJson("/api/sos", { method: "POST", body: submission });
    activeAlertId = result.alert?.alertId;
    pendingSubmission = null;
    retryButton.hidden = true;
    startButton.hidden = false;
    startButton.disabled = false;
    recipientFieldset.disabled = false;
    showMessage(message, result.message || "SOS status saved by KinGuardian.", "success");
    void freshLocationPromise.then((point) => saveLivePoint(point, activeAlertId));
    startLiveLocation(activeAlertId);
    await loadAlerts();
  } catch (error) {
    if (!error.status || !navigator.onLine) {
      await queueLocally();
      return;
    }
    showMessage(message, error.message || "KinGuardian could not save this SOS. Use your local emergency number if you need urgent help.");
    retryButton.hidden = false;
    retryButton.disabled = false;
    retryButton.textContent = "Retry SOS save";
    startButton.hidden = true;
  }
}

async function queueLocally() {
  try {
    const submission = pendingSubmission;
    await putOfflineRecord(currentUser.userId, `sos:${submission.clientAlertId}`, submission);
    pendingSubmission = null;
    countdownPanel.hidden = true;
    startButton.hidden = false;
    startButton.disabled = false;
    recipientFieldset.disabled = false;
    retryButton.hidden = true;
    showMessage(message, "SOS saved on this device. Nobody has been notified yet. KinGuardian will retry after you reconnect and sign in.", "pending");
    void freshLocationPromise.then(async (point) => {
      if (!isValidLocalPoint(point)) return;
      submission.location = point;
      await putOfflineRecord(currentUser.userId, `sos:${submission.clientAlertId}`, submission).catch(() => undefined);
      await putOfflineRecord(currentUser.userId, "location:last-known", point).catch(() => undefined);
    });
    await initializeOffline();
  } catch {
    showMessage(message, "The SOS could not be saved offline. Call your local emergency service directly.");
    retryButton.hidden = false;
    retryButton.disabled = false;
  }
}

async function synchronizePending() {
  if (!currentUser || !navigator.onLine) return;
  const events = await listOfflineRecords(currentUser.userId, "sos:").catch(() => []);
  for (const event of events.sort((a, b) => a.value.activatedAt - b.value.activatedAt)) {
    try {
      const result = await requestJson("/api/sos", { method: "POST", body: event.value });
      await deleteOfflineRecord(currentUser.userId, event.recordId);
      if (result.alert?.alertId) {
        activeAlertId = result.alert.alertId;
        void freshLocationPromise.then((point) => saveLivePoint(point, activeAlertId));
        startLiveLocation(activeAlertId);
      }
    } catch (error) {
      if (error.status === 401) return;
      showMessage(message, error.message || "A saved SOS could not sync. It remains saved on this device.");
      return;
    }
  }
  await loadAlerts();
}

async function loadAlerts() {
  if (!navigator.onLine || !currentUser) return;
  try {
    const { alerts } = await requestJson("/api/sos");
    await putOfflineRecord(currentUser.userId, "sos:history", alerts || []).catch(() => undefined);
    alertEmpty.hidden = alerts.length > 0;
    alertList.replaceChildren(...alerts.map(renderAlert));
    const active = alerts.find((alert) => alert.isSender && !["resolved", "closed"].includes(alert.status));
    if (active) { activeAlertId = active.alertId; startLiveLocation(activeAlertId); }
    else stopLiveLocation();
  } catch (error) {
    showMessage(message, error.message || "Alert history could not be loaded.");
  }
}

function renderLocalAlert(alert) {
  const item = document.createElement("li");
  item.className = "sos-alert-card";
  const title = document.createElement("strong");
  title.textContent = "Saved on this device · waiting for internet";
  const time = document.createElement("p");
  time.textContent = `SOS time: ${formatTime(alert.activatedAt)}`;
  item.append(title, time);
  return item;
}

function renderAlert(alert, readOnly = false) {
  const item = document.createElement("li");
  item.className = "sos-alert-card";
  const top = document.createElement("div");
  top.className = "sos-alert-top";
  const title = document.createElement("strong");
  title.textContent = alert.isSender ? "Your SOS alert" : `SOS · @${alert.senderUsername}`;
  const time = document.createElement("time");
  time.dateTime = new Date(alert.activatedAt || alert.createdAt).toISOString();
  time.textContent = formatTime(alert.activatedAt || alert.createdAt);
  top.append(title, time);
  const status = document.createElement("span");
  status.className = "sos-status-badge";
  status.textContent = alert.status.replaceAll("_", " ");
  item.append(top, status);
  if (alert.location) {
    const point = alert.location;
    const stale = Date.now() - point.capturedAt > 5 * 60_000;
    const locationText = document.createElement("p");
    locationText.textContent = `${stale ? "Last known location" : "Location"} · accuracy about ${Math.round(point.accuracy)} m · saved ${formatTime(point.capturedAt)}${stale ? " · updates may have stopped" : ""}.`;
    item.append(locationText);
    const mapLink = document.createElement("a");
    mapLink.className = "button button-outline";
    mapLink.href = `location.html?sos=${encodeURIComponent(alert.alertId)}`;
    mapLink.textContent = "Open Emergency Map";
    item.append(mapLink);
  }
  if (!readOnly && !alert.isSender && alert.recipientStatus !== "acknowledged" && !["resolved", "closed"].includes(alert.status)) item.append(makeActionButton("I saw this alert", "acknowledge", alert.alertId));
  if (!readOnly && alert.isSender && !["resolved", "closed"].includes(alert.status)) item.append(makeActionButton("Mark as resolved", "resolve", alert.alertId));
  return item;
}

function makeActionButton(label, operation, alertId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-outline";
  button.dataset.operation = operation;
  button.dataset.alertId = alertId;
  button.textContent = label;
  return button;
}

async function handleAlertAction(event) {
  const button = event.target.closest("button[data-operation]");
  if (!button) return;
  button.disabled = true;
  try {
    await requestJson(`/api/sos/${encodeURIComponent(button.dataset.alertId)}/${button.dataset.operation}`, { method: "POST", body: {} });
    if (button.dataset.operation === "resolve" && button.dataset.alertId === activeAlertId) stopLiveLocation();
    showMessage(message, button.dataset.operation === "acknowledge" ? "Your response was saved." : "The SOS is marked resolved.", "success");
    await loadAlerts();
  } catch (error) { showMessage(message, error.message || "This alert could not be updated."); button.disabled = false; }
}

function startLiveLocation(alertId) {
  if (!alertId || !navigator.onLine || document.hidden || !navigator.geolocation || locationWatchId !== undefined) return;
  locationWatchId = navigator.geolocation.watchPosition((position) => {
    if (Date.now() - lastLocationPostedAt < 60_000) return;
    lastLocationPostedAt = Date.now();
    void saveLivePoint(normalizePosition(position), alertId);
  }, () => {
    showMessage(message, "KinGuardian cannot get a fresh location right now. The last saved point may still be available.", "pending");
  }, { enableHighAccuracy: false, maximumAge: 15_000, timeout: 15_000 });
}

async function saveLivePoint(point, alertId) {
  if (!isValidLocalPoint(point) || !currentUser?.userId) return;
  await putOfflineRecord(currentUser.userId, "location:last-known", point).catch(() => undefined);
  if (!alertId || !navigator.onLine) return;
  try {
    await requestJson(`/api/sos/${encodeURIComponent(alertId)}/location`, { method: "POST", body: point });
    await loadAlerts();
  } catch (error) {
    if (error.status === 404 || error.status === 409) stopLiveLocation();
  }
}

function stopLiveLocation(clearAlert = true) {
  if (locationWatchId !== undefined && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId);
  locationWatchId = undefined;
  if (clearAlert) activeAlertId = undefined;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (currentUser && navigator.onLine && !document.hidden) pollTimer = window.setTimeout(async () => { await loadAlerts(); schedulePoll(); }, 30_000);
}
