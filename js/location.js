import {
  createSharingIdentity,
  decryptLocationEnvelope,
  encryptLocationForRecipient,
  unlockSharingIdentity,
  unlockVault,
} from "./encryption.js";
import { requestJson, showMessage } from "./auth-client.js";

const vaultCard = document.querySelector("#location-vault-card");
const vaultForm = document.querySelector("#location-vault-form");
const vaultHeading = document.querySelector("#location-vault-heading");
const vaultCopy = document.querySelector("#location-vault-copy");
const vaultMessage = document.querySelector("#location-vault-message");
const vaultPassphrase = document.querySelector("#location-vault-passphrase");
const vaultUnlock = document.querySelector("#location-vault-unlock");
const workspace = document.querySelector("#location-workspace");
const recipientList = document.querySelector("#location-recipient-list");
const recipientEmpty = document.querySelector("#location-recipient-empty");
const startButton = document.querySelector("#start-location-share");
const locationMessage = document.querySelector("#location-message");
const ownShareList = document.querySelector("#own-share-list");
const ownShareEmpty = document.querySelector("#own-share-empty");
const incomingShareList = document.querySelector("#incoming-share-list");
const incomingShareEmpty = document.querySelector("#incoming-share-empty");
const coordinateReadout = document.querySelector("#location-coordinate-readout");
const ownerMapLink = document.querySelector("#owner-map-link");

const UPDATE_INTERVAL_MS = 60_000;
const STALE_AFTER_MS = 5 * 60_000;
const PRIVATE_KEY_IDLE_MS = 15 * 60_000;
const POSITION_OPTIONS = { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 };

let signedInUser;
let vaultMetadata;
let sharingIdentity;
let trustedRecipients = [];
let currentShareId;
let currentRecipients = [];
let updateTimer;
let idleLockTimer;
let ownShares = [];
let locationPausedForConsentChange = false;
let isPublishing = false;

startButton.addEventListener("click", startLocationShare);
document.querySelector("#refresh-location").addEventListener("click", loadLocationShares);
ownShareList.addEventListener("click", handleOwnShareAction);
incomingShareList.addEventListener("click", handleIncomingShareAction);
vaultForm.addEventListener("submit", unlockLocationVault);
window.addEventListener("pointerdown", resetPrivateKeyTimer);
window.addEventListener("keydown", resetPrivateKeyTimer);
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("pagehide", () => {
  stopPositionUpdates();
  sharingIdentity = undefined;
  vaultMetadata = undefined;
  clearTimeout(idleLockTimer);
  coordinateReadout.hidden = true;
  ownerMapLink.hidden = true;
});
void initialize();

async function initialize() {
  try {
    const { user } = await requestJson("/api/auth/me");
    signedInUser = user;
    if (user.mustChangePassword) {
      location.replace("change-password.html");
      return;
    }
    const response = await requestJson("/api/vault");
    vaultMetadata = response.vault;
    if (!vaultMetadata) {
      vaultHeading.textContent = "Create your private vault first";
      vaultCopy.textContent = "The private vault encrypts contact details and holds the account's encrypted location-sharing key. Create it before starting location sharing.";
      showMessage(vaultMessage, "No encrypted private vault exists for this account yet.");
      return;
    }
    vaultHeading.textContent = "Unlock your private location key";
    vaultCopy.textContent = "Enter the separate passphrase for your encrypted contacts vault. This unlocks the location-sharing key only in this browser. No location is requested until you choose members and press Start.";
    vaultForm.hidden = false;
  } catch (error) {
    vaultHeading.textContent = "Private location sharing is unavailable";
    showMessage(vaultMessage, error.status === 401
      ? "Your sign-in has expired. Sign in again before opening private location sharing."
      : error.message || "KinGuardian could not check your private vault.");
    if (error.status === 401) location.replace("login.html");
    if (error.code === "PASSWORD_CHANGE_REQUIRED") location.replace("change-password.html");
  }
}

async function unlockLocationVault(event) {
  event.preventDefault();
  vaultUnlock.disabled = true;
  showMessage(vaultMessage, "Unlocking your private location key…", "busy");
  try {
    const dataKey = await unlockVault(vaultPassphrase.value, signedInUser.userId, vaultMetadata);
    vaultPassphrase.value = "";
    let { identity } = await requestJson("/api/vault/identity");
    if (!identity) {
      const created = await createSharingIdentity(dataKey, signedInUser.userId);
      try {
        await requestJson("/api/vault/identity", { method: "POST", body: created.record });
        identity = created.record;
      } catch (error) {
        if (error.code !== "SHARING_KEY_EXISTS") throw error;
        ({ identity } = await requestJson("/api/vault/identity"));
      }
    }
    sharingIdentity = await unlockSharingIdentity(dataKey, signedInUser.userId, identity);
    vaultCard.hidden = true;
    workspace.hidden = false;
    resetPrivateKeyTimer();
    showMessage(locationMessage, "Private location key unlocked. No location is shared until you choose members and start.", "success");
    await Promise.all([loadRecipients(), loadLocationShares()]);
  } catch (error) {
    sharingIdentity = undefined;
    showMessage(vaultMessage, error.message || "The private location key could not be unlocked.");
    vaultPassphrase.focus();
  } finally {
    vaultUnlock.disabled = false;
  }
}

function resetPrivateKeyTimer() {
  if (!sharingIdentity) return;
  clearTimeout(idleLockTimer);
  idleLockTimer = window.setTimeout(lockPrivateKey, PRIVATE_KEY_IDLE_MS);
}

function lockPrivateKey() {
  stopPositionUpdates();
  sharingIdentity = undefined;
  coordinateReadout.hidden = true;
  ownerMapLink.hidden = true;
  workspace.hidden = true;
  vaultCard.hidden = false;
  vaultForm.hidden = false;
  showMessage(vaultMessage, "The location key was locked after inactivity. An active share will stop updating; its last point will expire automatically.", "success");
}

async function loadRecipients() {
  recipientList.replaceChildren();
  trustedRecipients = [];
  try {
    const { connections } = await requestJson("/api/connections");
    trustedRecipients = connections.filter((connection) => connection.receiveLocation && connection.locationPublicKey);
    const notReady = connections.filter((connection) => connection.receiveLocation && !connection.locationPublicKey).length;
    recipientEmpty.hidden = trustedRecipients.length > 0;
    if (notReady && trustedRecipients.length === 0) {
      recipientEmpty.textContent = `${notReady} member${notReady === 1 ? " has" : "s have"} opted in but need to unlock the location page once to create a private sharing key.`;
    } else {
      recipientEmpty.textContent = "No members are ready to receive encrypted location. Both people must enable location in their circle preferences and unlock the location page once.";
    }
    for (const connection of trustedRecipients) {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "location-recipient";
      checkbox.value = connection.userId;
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = connection.username;
      const note = document.createElement("small");
      note.textContent = "Opted in · encrypted for this member's private key";
      copy.append(name, note);
      label.append(checkbox, copy);
      item.append(label);
      recipientList.append(item);
    }
  } catch (error) {
    showMessage(locationMessage, error.message || "Trusted recipients could not be loaded.");
  }
}

function selectedRecipients() {
  const ids = new Set([...recipientList.querySelectorAll('input[name="location-recipient"]:checked')]
    .map((checkbox) => checkbox.value));
  return trustedRecipients.filter((recipient) => ids.has(recipient.userId));
}

function readDevicePosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, POSITION_OPTIONS);
  });
}

async function startLocationShare() {
  if (!sharingIdentity) {
    showMessage(locationMessage, "Unlock your private location key before sharing.");
    return;
  }
  if (!window.isSecureContext || !navigator.geolocation) {
    showMessage(locationMessage, "Location needs a secure HTTPS page and browser geolocation support. No location has been requested.");
    return;
  }
  const recipients = selectedRecipients();
  if (!recipients.length) {
    showMessage(locationMessage, "Choose at least one member who opted in and has a private sharing key.");
    return;
  }
  if (ownShares.some((share) => share.status === "active")) {
    showMessage(locationMessage, "Stop your existing share before starting another.");
    return;
  }

  startButton.disabled = true;
  locationPausedForConsentChange = false;
  // Request permission directly from the user's click, before network or crypto work.
  const positionRequest = readDevicePosition();
  showMessage(locationMessage, "Your browser is asking whether KinGuardian may use your location. No map service is contacted.", "busy");
  try {
    const position = await positionRequest;
    const createResult = await requestJson("/api/location-shares", {
      method: "POST",
      body: {
        recipientUserIds: recipients.map((recipient) => recipient.userId),
        expiresInMinutes: Number(document.querySelector("#location-expiry").value),
      },
    });
    currentShareId = createResult.share.shareId;
    currentRecipients = recipients;
    const firstUpdateAt = await publishPosition(position);
    if (!firstUpdateAt) throw new Error("The page was hidden before the first encrypted location update was confirmed.");
    showMessage(locationMessage, "Encrypted location sharing is active for the selected members. They can open this page and refresh to see the latest point.", "success");
    await loadLocationShares();
    startPositionUpdates();
  } catch (error) {
    if (currentShareId) {
      await requestJson(`/api/location-shares/${encodeURIComponent(currentShareId)}/stop`, {
        method: "POST", body: {},
      }).catch(() => undefined);
      currentShareId = undefined;
      currentRecipients = [];
    }
    showMessage(locationMessage, locationErrorMessage(error));
    await loadLocationShares();
  } finally {
    startButton.disabled = false;
  }
}

function locationErrorMessage(error) {
  if (error.code === 1) return "Location permission was denied. Change the browser permission if you want to try again; nothing was shared.";
  if (error.code === 2) return "Your device could not determine a location. Try again when location is available.";
  if (error.code === 3) return "The device took too long to find a location. Try again when you have a clearer signal.";
  return error.message || "Location sharing could not be started. No delivery has been claimed.";
}

async function publishPosition(position) {
  if (!currentShareId || !sharingIdentity || locationPausedForConsentChange || document.hidden) return;
  const capturedAt = Number.isFinite(position.timestamp) ? Math.trunc(position.timestamp) : Date.now();
  const location = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    capturedAt,
  };
  const entries = await Promise.all(currentRecipients.map(async (recipient) => ({
    recipientUserId: recipient.userId,
    ...await encryptLocationForRecipient(location, sharingIdentity.privateKey,
      sharingIdentity.publicKey, recipient.locationPublicKey, {
        shareId: currentShareId,
        senderUserId: signedInUser.userId,
        recipientUserId: recipient.userId,
      }),
  })));
  if (document.hidden || !sharingIdentity || !currentShareId) return undefined;
  const result = await requestJson(`/api/location-shares/${encodeURIComponent(currentShareId)}/update`, {
    method: "POST", body: { entries },
  });
  showOwnLocation(location);
  return result.updatedAt;
}

function showOwnLocation(location) {
  const text = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · ±${Math.round(location.accuracy)} m · ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(location.capturedAt)}`;
  coordinateReadout.textContent = text;
  coordinateReadout.hidden = false;
  ownerMapLink.href = openStreetMapUrl(location.latitude, location.longitude);
  ownerMapLink.hidden = false;
}

function startPositionUpdates() {
  stopPositionUpdates();
  if (document.hidden || !currentShareId || !sharingIdentity) return;
  updateTimer = window.setInterval(async () => {
    if (!currentShareId || !sharingIdentity || document.hidden || isPublishing) return;
    isPublishing = true;
    try {
      const position = await readDevicePosition();
      const updatedAt = await publishPosition(position);
      if (!updatedAt) return;
      showMessage(locationMessage, "An encrypted location update was saved. Recipients must refresh to see it.", "success");
    } catch (error) {
      if (error.status === 409 || error.code === "RECIPIENT_CHANGED") {
        locationPausedForConsentChange = true;
        stopPositionUpdates();
        showMessage(locationMessage, "A member's consent changed. Location updates are paused. Stop this share and review the trusted circle.");
      } else if (error.code === 1) {
        stopPositionUpdates();
        showMessage(locationMessage, "The browser no longer allows location access. Updates have stopped on this device; the last encrypted point expires automatically.");
      } else {
        showMessage(locationMessage, "The latest location could not be confirmed with the server. Updates will retry at the next interval; recipients may see an older point.");
      }
    } finally {
      isPublishing = false;
    }
  }, UPDATE_INTERVAL_MS);
}

function stopPositionUpdates() {
  clearInterval(updateTimer);
  updateTimer = undefined;
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopPositionUpdates();
    if (currentShareId) showMessage(locationMessage, "Location updates are paused while this page is hidden. The last encrypted point remains until you stop or it expires.", "busy");
    return;
  }
  if (currentShareId && sharingIdentity && !locationPausedForConsentChange) startPositionUpdates();
}

async function loadLocationShares() {
  ownShareList.replaceChildren();
  incomingShareList.replaceChildren();
  try {
    const result = await requestJson("/api/location-shares");
    ownShares = result.ownShares || [];
    ownShareEmpty.hidden = ownShares.length > 0;
    startButton.disabled = ownShares.some((share) => share.status === "active");
    for (const share of ownShares) ownShareList.append(renderOwnShare(share));
    const incoming = result.incomingShares || [];
    incomingShareEmpty.hidden = incoming.length > 0;
    for (const share of incoming) incomingShareList.append(await renderIncomingShare(share));
  } catch (error) {
    showMessage(locationMessage, error.message || "Location sharing status could not be refreshed.");
  }
}

function renderOwnShare(share) {
  const item = document.createElement("li");
  item.className = "location-share-card";
  const title = document.createElement("strong");
  title.textContent = `Your share · ${share.status.replaceAll("_", " ")}`;
  const recipients = share.recipients.map((recipient) => recipient.username).join(", ") || "No remaining recipients";
  const details = document.createElement("p");
  const expiryText = new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(share.expiresAt);
  details.textContent = `For ${recipients}. Expires ${expiryText}${share.lastUpdatedAt ? ` · last update ${formatDate(share.lastUpdatedAt)}` : " · no location update is stored"}.`;
  item.append(title, details);
  if (share.status === "active") item.append(makeActionButton("Stop sharing and remove current point", "stop", share.shareId));
  return item;
}

async function renderIncomingShare(share) {
  const item = document.createElement("li");
  item.className = "location-share-card";
  const title = document.createElement("strong");
  title.textContent = `Location from ${share.senderUsername}`;
  const details = document.createElement("p");
  try {
    const location = await decryptLocationEnvelope(share.envelope, sharingIdentity.privateKey, {
      shareId: share.shareId,
      senderUserId: share.senderUserId,
      recipientUserId: signedInUser.userId,
    });
    const stale = Date.now() - location.capturedAt > STALE_AFTER_MS;
    details.textContent = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · ±${Math.round(location.accuracy)} m · captured ${formatDate(location.capturedAt)}${stale ? " · STALE: this point is older than five minutes" : " · current"}.`;
    if (stale) details.className = "location-status-stale";
    const map = document.createElement("a");
    map.className = "button button-outline";
    map.href = openStreetMapUrl(location.latitude, location.longitude);
    map.target = "_blank";
    map.rel = "noopener noreferrer";
    map.referrerPolicy = "no-referrer";
    map.textContent = "Open point in OpenStreetMap";
    item.append(title, details, map, makeActionButton("Stop receiving location", "leave", share.shareId));
  } catch {
    details.textContent = "This encrypted location could not be opened with this account's private key.";
    item.append(title, details, makeActionButton("Stop receiving location", "leave", share.shareId));
  }
  return item;
}

function makeActionButton(label, operation, shareId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-outline";
  button.dataset.operation = operation;
  button.dataset.shareId = shareId;
  button.textContent = label;
  return button;
}

async function handleOwnShareAction(event) {
  const button = event.target.closest('button[data-operation="stop"]');
  if (!button || !window.confirm("Stop sharing now? KinGuardian will remove the current encrypted location point.")) return;
  button.disabled = true;
  if (button.dataset.shareId === currentShareId) {
    stopPositionUpdates();
    currentShareId = undefined;
    currentRecipients = [];
    locationPausedForConsentChange = false;
  }
  try {
    await requestJson(`/api/location-shares/${encodeURIComponent(button.dataset.shareId)}/stop`, {
      method: "POST", body: {},
    });
    showMessage(locationMessage, "Sharing stopped. The current encrypted location point was removed from the server.", "success");
    await loadLocationShares();
  } catch (error) {
    showMessage(locationMessage, `${error.message || "The server could not confirm the stop request."} Location updates have stopped on this device; the last point can remain available until expiry. Reconnect and retry Stop.`);
    button.disabled = false;
  }
}

async function handleIncomingShareAction(event) {
  const button = event.target.closest('button[data-operation="leave"]');
  if (!button || !window.confirm("Stop receiving this member's location? Your current encrypted point will be removed.")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/location-shares/${encodeURIComponent(button.dataset.shareId)}/leave`, {
      method: "POST", body: {},
    });
    showMessage(locationMessage, "You stopped receiving this location share.", "success");
    await loadLocationShares();
  } catch (error) {
    showMessage(locationMessage, error.message || "The location share could not be removed.");
    button.disabled = false;
  }
}

function openStreetMapUrl(latitude, longitude) {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(value);
}
