import { requestJson, showMessage } from "./auth-client.js";
import { cacheOfflineProfile, getOfflineProfile, getOfflineRecord, putOfflineRecord } from "./offline-store.js";
import "./map-experience.js";

const recipientList = document.querySelector("#location-recipient-list");
const recipientEmpty = document.querySelector("#location-recipient-empty");
const startButton = document.querySelector("#start-location-share");
const locationMessage = document.querySelector("#location-message");
const ownShareList = document.querySelector("#own-share-list");
const ownShareEmpty = document.querySelector("#own-share-empty");
const incomingShareList = document.querySelector("#incoming-share-list");
const incomingShareEmpty = document.querySelector("#incoming-share-empty");
const coordinateReadout = document.querySelector("#location-coordinate-readout");
const ownMapLink = document.querySelector("#owner-map-link");
const UPDATE_INTERVAL_MS = 60_000;
const REFRESH_INTERVAL_MS = 30_000;
const POSITION_OPTIONS = { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 };

let signedInUser;
let trustedRecipients = [];
let ownShares = [];
let currentShareId;
let currentRecipients = [];
let updateTimer;
let refreshTimer;
let isPublishing = false;

startButton.addEventListener("click", startLocationShare);
document.querySelector("#refresh-location").addEventListener("click", loadLocationShares);
ownShareList.addEventListener("click", handleOwnShareAction);
incomingShareList.addEventListener("click", handleIncomingShareAction);
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("pagehide", stopPositionUpdates);
window.addEventListener("kinguardian:location-found", (event) => { void saveLastKnownPoint(event.detail); });
window.addEventListener("online", async () => {
  if (!signedInUser) return;
  await Promise.all([loadLocationShares(), loadSOSLocations()]);
  startPositionUpdates();
  scheduleRefresh();
});
window.addEventListener("offline", () => showMessage(locationMessage, "You are offline. New shares cannot reach trusted people; cached locations are marked with their saved time.", "pending"));
void initialize();

async function initialize() {
  try {
    const { user } = await requestJson("/api/auth/me");
    signedInUser = user;
    if (user.mustChangePassword) { location.replace("change-password.html"); return; }
    cacheOfflineProfile(user);
    showWorkspace();
    await loadRecipients();
    await loadLocationShares();
    await loadSOSLocations();
    await showCachedPoint();
    if (navigator.onLine) { startPositionUpdates(); scheduleRefresh(); }
  } catch (error) {
    if (error.status === 401) { location.replace("login.html"); return; }
    signedInUser = getOfflineProfile();
    if (!signedInUser) {
      showMessage(locationMessage, "Sign in on this device once to use location sharing. In immediate danger, call your local emergency service.");
      return;
    }
    showWorkspace();
    startButton.disabled = true;
    await renderCachedPeople();
    await renderCachedLocationShares();
    await showCachedPoint();
    await showCachedSOSLocations();
    showMessage(locationMessage, "Offline mode. Saved locations are shown with their saved time. Sharing starts again only after you reconnect.", "pending");
  }
}

function showWorkspace() {
  document.querySelector("#location-workspace").hidden = false;
}

async function loadRecipients() {
  const { connections } = await requestJson("/api/connections");
  trustedRecipients = (connections || []).filter((connection) => connection.receiveLocation === true);
  await putOfflineRecord(signedInUser.userId, "connections", connections || []).catch(() => undefined);
  renderRecipients(trustedRecipients);
}

async function renderCachedPeople() {
  const connections = await getOfflineRecord(signedInUser.userId, "connections").catch(() => []);
  trustedRecipients = (connections || []).filter((connection) => connection.receiveLocation === true);
  renderRecipients(trustedRecipients);
}

function renderRecipients(recipients) {
  recipientList.replaceChildren();
  recipientEmpty.hidden = recipients.length > 0;
  for (const recipient of recipients) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "location-recipient";
    checkbox.value = recipient.userId;
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = `@${recipient.username}`;
    const note = document.createElement("small");
    note.textContent = "Has allowed you to share your location";
    copy.append(name, note);
    label.append(checkbox, copy);
    item.append(label);
    recipientList.append(item);
  }
}

function selectedRecipients() {
  const selected = new Set([...recipientList.querySelectorAll('input[name="location-recipient"]:checked')]
    .map((checkbox) => checkbox.value));
  return trustedRecipients.filter((recipient) => selected.has(recipient.userId));
}

function readDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(new Error("Location needs a secure website and browser location support."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, POSITION_OPTIONS);
  });
}

async function startLocationShare() {
  if (!navigator.onLine || !signedInUser) {
    showMessage(locationMessage, "Reconnect and sign in before starting a share. No one has been notified while offline.");
    return;
  }
  const recipients = selectedRecipients();
  if (!recipients.length) { showMessage(locationMessage, "Choose at least one trusted person who has allowed your location."); return; }
  if (ownShares.some((share) => share.status === "active")) { showMessage(locationMessage, "Stop your existing share before starting another."); return; }
  startButton.disabled = true;
  try {
    showMessage(locationMessage, "Waiting for your browser’s location permission. Your point will be encrypted before it is saved.", "busy");
    const position = await readDevicePosition();
    const { share } = await requestJson("/api/location-shares", {
      method: "POST",
      body: { recipientUserIds: recipients.map((recipient) => recipient.userId), expiresInMinutes: Number(document.querySelector("#location-expiry").value) },
    });
    currentShareId = share.shareId;
    currentRecipients = recipients;
    await publishPosition(position);
    showMessage(locationMessage, "Location sharing is on for your selected trusted people. Updates pause if this page is hidden or closed.", "success");
    await loadLocationShares();
    await loadSOSLocations();
    startPositionUpdates();
  } catch (error) {
    if (currentShareId) await requestJson(`/api/location-shares/${encodeURIComponent(currentShareId)}/stop`, { method: "POST", body: {} }).catch(() => undefined);
    currentShareId = undefined;
    currentRecipients = [];
    showMessage(locationMessage, locationErrorMessage(error));
    await loadLocationShares().catch(() => undefined);
  } finally { startButton.disabled = false; }
}

function locationErrorMessage(error) {
  if (error.code === 1) return "Location permission was denied. Allow it in browser settings if you want to try again. No location was shared.";
  if (error.code === 2) return "Your device could not find a location. Try again when location is available.";
  if (error.code === 3) return "Finding your location took too long. Try again.";
  return error.message || "Location sharing could not be started.";
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

async function publishPosition(position) {
  if (!currentShareId || document.hidden || !navigator.onLine) return;
  const point = normalizePosition(position);
  await saveLastKnownPoint(point);
  const result = await requestJson(`/api/location-shares/${encodeURIComponent(currentShareId)}/update`, {
    method: "POST", body: point,
  });
  showOwnLocation(point);
  if (result.updated === false) showMessage(locationMessage, "The server already has a newer location. The older point was ignored.", "pending");
  return result.updatedAt;
}

async function saveLastKnownPoint(point) {
  if (!signedInUser?.userId || !point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
  const previous = await getOfflineRecord(signedInUser.userId, "location:last-known").catch(() => null);
  if (previous?.capturedAt > point.capturedAt) return;
  await putOfflineRecord(signedInUser.userId, "location:last-known", point).catch(() => undefined);
  showOwnLocation(point);
}

async function showCachedPoint() {
  if (!signedInUser?.userId) return;
  const point = await getOfflineRecord(signedInUser.userId, "location:last-known").catch(() => null);
  if (point) showOwnLocation(point);
}

function showOwnLocation(point) {
  const stale = Date.now() - point.capturedAt > 5 * 60_000;
  const stamp = formatDate(point.capturedAt);
  coordinateReadout.textContent = `${stale ? "LAST KNOWN LOCATION" : "Your location"} · accuracy about ${Math.round(point.accuracy)} m · ${stamp}`;
  coordinateReadout.hidden = false;
  ownMapLink.href = openStreetMapUrl(point.latitude, point.longitude);
  ownMapLink.hidden = false;
  window.dispatchEvent(new CustomEvent("kinguardian:map-point", { detail: {
    id: "my-location", label: "My location", latitude: point.latitude, longitude: point.longitude, kind: "self", stale,
  } }));
}

function startPositionUpdates() {
  stopPositionUpdates();
  const active = ownShares.find((share) => share.status === "active");
  if (!active || document.hidden || !navigator.onLine) return;
  currentShareId = active.shareId;
  currentRecipients = trustedRecipients.filter((recipient) => active.recipients.some((saved) => saved.userId === recipient.userId));
  if (!currentRecipients.length) return;
  updateTimer = window.setInterval(async () => {
    if (!navigator.onLine || document.hidden || isPublishing) return;
    isPublishing = true;
    try {
      const position = await readDevicePosition();
      const updated = await publishPosition(position);
      if (updated) showMessage(locationMessage, "Your latest location was saved for the people you selected.", "success");
      await loadLocationShares();
    } catch (error) {
      showMessage(locationMessage, error.status === 409
        ? "Location sharing stopped or permission changed. Review the sharing status."
        : "The latest location could not be saved. KinGuardian will try again in one minute.", "pending");
    } finally { isPublishing = false; }
  }, UPDATE_INTERVAL_MS);
}

function stopPositionUpdates() { clearInterval(updateTimer); updateTimer = undefined; }
function handleVisibilityChange() {
  if (document.hidden) {
    stopPositionUpdates();
    if (currentShareId) showMessage(locationMessage, "Location updates are paused while this page is hidden. The last point remains until you stop sharing or it expires.", "pending");
  } else {
    if (navigator.onLine) void Promise.all([loadLocationShares(), loadSOSLocations()]).then(startPositionUpdates);
    else void Promise.all([renderCachedLocationShares(), showCachedSOSLocations(), showCachedPoint()]);
    scheduleRefresh();
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!navigator.onLine || document.hidden) return;
  refreshTimer = window.setTimeout(async () => {
    await Promise.all([loadLocationShares(), loadSOSLocations()]);
    scheduleRefresh();
  }, REFRESH_INTERVAL_MS);
}

async function loadSOSLocations() {
  if (!navigator.onLine || !signedInUser) return;
  try {
    const { alerts } = await requestJson("/api/sos");
    await putOfflineRecord(signedInUser.userId, "sos:history", alerts || []).catch(() => undefined);
    renderSOSLocations(alerts || [], false);
  } catch (error) {
    if (error.status === 401) location.replace("login.html");
  }
}

async function showCachedSOSLocations() {
  const alerts = signedInUser?.userId
    ? await getOfflineRecord(signedInUser.userId, "sos:history").catch(() => [])
    : [];
  renderSOSLocations(alerts || [], true);
}

function renderSOSLocations(alerts, cached) {
    const points = alerts.filter((alert) => alert.location && !["resolved", "closed"].includes(alert.status));
    for (const alert of points) {
      const point = alert.location;
      window.dispatchEvent(new CustomEvent("kinguardian:map-point", { detail: {
        id: `sos:${alert.alertId}`,
        label: `SOS @${alert.senderUsername}`,
        latitude: point.latitude,
        longitude: point.longitude,
        kind: "trusted",
        stale: Date.now() - point.capturedAt > 5 * 60_000,
      } }));
    }
    const requestedAlertId = new URLSearchParams(location.search).get("sos");
    if (requestedAlertId) {
      const selected = points.find((alert) => alert.alertId === requestedAlertId);
      if (selected) {
        window.dispatchEvent(new CustomEvent("kinguardian:map-focus", { detail: {
          latitude: selected.location.latitude, longitude: selected.location.longitude,
        } }));
        showMessage(locationMessage, `${cached ? "Showing saved" : "Emergency map opened for"} @${selected.senderUsername}. Last point saved ${formatDate(selected.location.capturedAt)}${cached ? "; it may be out of date" : ""}.`, cached ? "pending" : "success");
      } else {
        showMessage(locationMessage, "This alert has no available location, may have ended, or is not shared with your account.");
      }
    }
}

async function loadLocationShares() {
  try {
    const result = await requestJson("/api/location-shares");
    if (signedInUser?.userId) await putOfflineRecord(signedInUser.userId, "location:shares", result).catch(() => undefined);
    renderLocationShares(result, false);
  } catch (error) {
    if (error.status === 401) location.replace("login.html");
    await renderCachedLocationShares();
    if (navigator.onLine) showMessage(locationMessage, error.message || "Location sharing status could not be refreshed.");
  }
}

async function renderCachedLocationShares() {
  const result = signedInUser?.userId
    ? await getOfflineRecord(signedInUser.userId, "location:shares").catch(() => null)
    : null;
  if (result) {
    renderLocationShares(result, true);
    showMessage(locationMessage, "Showing saved location-sharing status from this device. It may be out of date; changes need internet.", "pending");
  } else {
    ownShareList.replaceChildren();
    incomingShareList.replaceChildren();
    ownShareEmpty.hidden = false;
    incomingShareEmpty.hidden = false;
    startButton.disabled = true;
  }
}

function renderLocationShares(result, readOnly) {
    ownShares = result.ownShares || [];
    ownShareEmpty.hidden = ownShares.length > 0;
    ownShareList.replaceChildren(...ownShares.map((share) => renderOwnShare(share, readOnly)));
    const incoming = result.incomingShares || [];
    incomingShareEmpty.hidden = incoming.length > 0;
    incomingShareList.replaceChildren(...incoming.map((share) => renderIncomingShare(share, readOnly)));
    startButton.disabled = readOnly || ownShares.some((share) => share.status === "active");
}

function renderOwnShare(share, readOnly = false) {
  const item = document.createElement("li");
  item.className = "location-share-card";
  const title = document.createElement("strong");
  title.textContent = `Your share · ${share.status.replaceAll("_", " ")}`;
  const details = document.createElement("p");
  const recipients = share.recipients.map((recipient) => `@${recipient.username}`).join(", ") || "No remaining trusted people";
  details.textContent = `For ${recipients}. Expires ${formatDate(share.expiresAt)}${share.lastUpdatedAt ? ` · last saved ${formatDate(share.lastUpdatedAt)}` : " · waiting for first location"}${readOnly ? " · saved status; may be out of date" : ""}.`;
  item.append(title, details);
  if (share.status === "active") {
    const action = makeActionButton("Stop sharing", "stop", share.shareId);
    action.disabled = readOnly;
    item.append(action);
  }
  return item;
}

function renderIncomingShare(share, readOnly = false) {
  const item = document.createElement("li");
  item.className = "location-share-card";
  const title = document.createElement("strong");
  title.textContent = `Location from @${share.senderUsername}`;
  const details = document.createElement("p");
  const point = share.location;
  if (point) {
    const stale = Date.now() - point.capturedAt > 5 * 60_000;
    details.textContent = `${stale ? "LAST KNOWN LOCATION" : "Latest location"} · accuracy about ${Math.round(point.accuracy)} m · ${formatDate(point.capturedAt)}${stale ? " · updates may have stopped" : ""}${readOnly ? " · saved point; may be out of date" : ""}.`;
    if (stale) details.className = "location-status-stale";
    window.dispatchEvent(new CustomEvent("kinguardian:map-point", { detail: {
      id: share.shareId, label: share.senderUsername, latitude: point.latitude, longitude: point.longitude, kind: "trusted", stale,
    } }));
    const map = document.createElement("a");
    map.className = "button button-outline";
    map.href = openStreetMapUrl(point.latitude, point.longitude);
    map.target = "_blank"; map.rel = "noopener noreferrer"; map.referrerPolicy = "no-referrer";
    map.textContent = "Open point in OpenStreetMap";
    const action = makeActionButton("Stop receiving location", "leave", share.shareId);
    action.disabled = readOnly;
    item.append(title, details, map, action);
  } else {
    details.textContent = `This person has started sharing. Their first location has not arrived yet.${readOnly ? " Saved status may be out of date." : ""}`;
    const action = makeActionButton("Stop receiving location", "leave", share.shareId);
    action.disabled = readOnly;
    item.append(title, details, action);
  }
  return item;
}

function makeActionButton(label, operation, shareId) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "button button-outline";
  button.dataset.operation = operation; button.dataset.shareId = shareId; button.textContent = label;
  return button;
}

async function handleOwnShareAction(event) {
  const button = event.target.closest('button[data-operation="stop"]');
  if (!button || !window.confirm("Stop sharing your location now?")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/location-shares/${encodeURIComponent(button.dataset.shareId)}/stop`, { method: "POST", body: {} });
    if (button.dataset.shareId === currentShareId) { stopPositionUpdates(); currentShareId = undefined; currentRecipients = []; }
    showMessage(locationMessage, "Location sharing stopped and saved points were removed.", "success");
    await loadLocationShares();
  } catch (error) { showMessage(locationMessage, error.message || "The share could not be stopped. Reconnect and try again."); button.disabled = false; }
}

async function handleIncomingShareAction(event) {
  const button = event.target.closest('button[data-operation="leave"]');
  if (!button || !window.confirm("Stop receiving this person's location?")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/location-shares/${encodeURIComponent(button.dataset.shareId)}/leave`, { method: "POST", body: {} });
    showMessage(locationMessage, "You stopped receiving this location share.", "success");
    await loadLocationShares();
  } catch (error) { showMessage(locationMessage, error.message || "The location share could not be removed."); button.disabled = false; }
}

function openStreetMapUrl(latitude, longitude) {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}
function formatDate(value) { return new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(value); }
