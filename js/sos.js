import { requestJson, showMessage } from "./auth-client.js";

const testMode = document.querySelector("#test-mode");
const realWarning = document.querySelector("#real-alert-warning");
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
const manualMessageLink = document.querySelector("#manual-message-link");

let signedInUser;
let countdownTimer;
let pendingSubmission = restorePendingSubmission();

testMode.addEventListener("change", updateMode);
startButton.addEventListener("click", startCountdown);
cancelButton.addEventListener("click", cancelCountdown);
retryButton.addEventListener("click", submitPendingAlert);
document.querySelector("#refresh-alerts").addEventListener("click", loadAlerts);
alertList.addEventListener("click", handleAlertAction);
void initialize();

async function initialize() {
  try {
    const { user } = await requestJson("/api/auth/me");
    signedInUser = user;
    if (user.mustChangePassword) {
      location.replace("change-password.html");
      return;
    }
    updateMode();
    if (pendingSubmission) {
      testMode.checked = pendingSubmission.testMode;
      updateMode();
      showMessage(message, "A previous submission needs a confirmed server response. Retry the same alert to avoid creating a duplicate.");
      startButton.hidden = true;
      retryButton.hidden = false;
      testMode.disabled = true;
      recipientFieldset.disabled = true;
    }
    await Promise.all([loadRecipients(), loadAlerts()]);
  } catch (error) {
    showMessage(message, error.status === 401
      ? "Your sign-in has expired. Sign in again before creating an alert."
      : error.message || "KinGuardian could not verify your account.");
    if (error.status === 401) location.replace("login.html");
    if (error.code === "PASSWORD_CHANGE_REQUIRED") location.replace("change-password.html");
  }
}

function updateMode() {
  const realAlert = !testMode.checked;
  recipientFieldset.hidden = !realAlert;
  recipientFieldset.disabled = !realAlert;
  realWarning.hidden = !realAlert;
}

async function loadRecipients() {
  recipientList.replaceChildren();
  try {
    const { connections } = await requestJson("/api/connections");
    const eligible = connections.filter((connection) => connection.receiveSos);
    recipientEmpty.hidden = eligible.length > 0;
    for (const connection of eligible) {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "sos-recipient";
      checkbox.value = connection.userId;
      checkbox.dataset.userId = connection.userId;
      const copy = document.createElement("span");
      copy.textContent = connection.username;
      label.append(checkbox, copy);
      item.append(label);
      recipientList.append(item);
    }
  } catch (error) {
    showMessage(message, error.message || "Trusted recipients could not be loaded.");
  }
}

function selectedRecipientIds() {
  return [...recipientList.querySelectorAll('input[name="sos-recipient"]:checked')]
    .map((checkbox) => checkbox.dataset.userId)
    .filter(Boolean);
}

function startCountdown() {
  if (!signedInUser) {
    showMessage(message, "Reconnect and sign in before creating an alert.");
    return;
  }
  if (!testMode.checked && selectedRecipientIds().length === 0) {
    showMessage(message, "Choose at least one trusted member, or turn test mode back on.");
    return;
  }
  pendingSubmission = {
    clientAlertId: crypto.randomUUID(),
    testMode: testMode.checked,
    trustedUserIds: selectedRecipientIds(),
    externalContactIds: [],
    senderTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
  };
  manualMessageLink.hidden = true;
  savePendingSubmission();
  let seconds = 5;
  countdownNumber.textContent = String(seconds);
  countdownPanel.hidden = false;
  startButton.hidden = true;
  retryButton.hidden = true;
  testMode.disabled = true;
  recipientFieldset.disabled = true;
  showMessage(message, testMode.checked
    ? "Test countdown started. No recipients or location will be included."
    : "Countdown started. The server will record this alert, but this prototype will not notify contacts.", "busy");
  countdownTimer = window.setInterval(() => {
    seconds -= 1;
    countdownNumber.textContent = String(Math.max(seconds, 0));
    if (seconds <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = undefined;
      countdownPanel.hidden = true;
      void submitPendingAlert();
    }
  }, 1000);
}

function cancelCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = undefined;
  countdownPanel.hidden = true;
  startButton.hidden = false;
  testMode.disabled = false;
  updateMode();
  pendingSubmission = undefined;
  clearPendingSubmission();
  showMessage(message, "Countdown cancelled. No alert was created or sent.", "success");
}

async function submitPendingAlert() {
  if (!pendingSubmission || countdownTimer) return;
  startButton.disabled = true;
  retryButton.disabled = true;
  showMessage(message, "Submitting alert to the KinGuardian server…", "busy");
  try {
    const result = await requestJson("/api/sos", { method: "POST", body: pendingSubmission });
    pendingSubmission = undefined;
    clearPendingSubmission();
    showMessage(message, result.message || "Alert status received from the server.", "success");
    if (result.alert && !result.alert.testMode) {
      manualMessageLink.href = `contacts.html?alertId=${encodeURIComponent(result.alert.alertId)}`;
      manualMessageLink.hidden = false;
    }
    startButton.hidden = false;
    retryButton.hidden = true;
    testMode.disabled = false;
    updateMode();
    await loadAlerts();
  } catch (error) {
    retryButton.hidden = false;
    retryButton.textContent = error.status ? "Retry alert submission" : "Retry the same alert safely";
    startButton.hidden = true;
    testMode.disabled = true;
    recipientFieldset.disabled = true;
    showMessage(message, error.status
      ? error.message || "The alert could not be accepted by the server."
      : "The connection was lost before KinGuardian confirmed the result. The alert may have been accepted; retry uses the same ID so it cannot create a duplicate.");
  } finally {
    startButton.disabled = false;
    retryButton.disabled = false;
  }
}

function restorePendingSubmission() {
  try {
    const stored = sessionStorage.getItem("kinguardian.pending-sos");
    if (!stored) return undefined;
    const value = JSON.parse(stored);
    if (typeof value.clientAlertId !== "string" || typeof value.testMode !== "boolean"
      || !Array.isArray(value.trustedUserIds) || !Array.isArray(value.externalContactIds)
      || typeof value.senderTimezone !== "string") return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function savePendingSubmission() {
  try {
    sessionStorage.setItem("kinguardian.pending-sos", JSON.stringify(pendingSubmission));
  } catch {
    showMessage(message, "This browser could not keep the alert retry in this tab. Keep this page open and retry until the server confirms the result.");
  }
}

function clearPendingSubmission() {
  try {
    sessionStorage.removeItem("kinguardian.pending-sos");
  } catch { /* the pending request remains in memory until this page closes */ }
}

async function loadAlerts() {
  alertList.replaceChildren();
  try {
    const { alerts } = await requestJson("/api/sos");
    alertEmpty.hidden = alerts.length > 0;
    alerts.forEach((alert) => alertList.append(renderAlert(alert)));
  } catch (error) {
    showMessage(message, error.message || "Alert status could not be refreshed.");
  }
}

function statusLabel(status) {
  return ({
    accepted_by_server: "Accepted by server · notification not attempted",
    notification_attempted: "Accepted by push service · display not confirmed",
    recipient_acknowledged: "Recipient acknowledged",
    resolved: "Resolved by sender",
    closed: "Closed by sender",
  })[status] || status.replaceAll("_", " ");
}

function renderAlert(alert) {
  const item = document.createElement("li");
  item.className = "sos-alert-card";
  const top = document.createElement("div");
  top.className = "sos-alert-top";
  const title = document.createElement("strong");
  title.textContent = alert.testMode ? "Test alert · no recipients" : alert.isSender ? "Your SOS alert" : `SOS alert from ${alert.senderUsername}`;
  const timestamp = document.createElement("time");
  timestamp.dateTime = new Date(alert.createdAt).toISOString();
  timestamp.textContent = new Intl.DateTimeFormat(navigator.language, {
    dateStyle: "medium", timeStyle: "short", timeZone: alert.senderTimezone,
  }).format(alert.createdAt);
  top.append(title, timestamp);
  const status = document.createElement("span");
  status.className = "sos-status-badge";
  status.textContent = statusLabel(alert.status);
  item.append(top, status);

  if (!alert.isSender && alert.recipientStatus === "acknowledged") {
    const acknowledged = document.createElement("p");
    acknowledged.textContent = "You acknowledged this alert.";
    item.append(acknowledged);
  }
  if (!alert.isSender && alert.recipientStatus !== "acknowledged" && !["resolved", "closed"].includes(alert.status)) {
    item.append(makeActionButton("Acknowledge alert", "acknowledge", alert.alertId));
  }
  if (alert.isSender && !["resolved", "closed"].includes(alert.status)) {
    item.append(makeActionButton("Resolve alert", "resolve", alert.alertId));
  }
  if (alert.isSender && alert.status === "resolved") {
    item.append(makeActionButton("Close alert", "close", alert.alertId));
  }
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
  const operation = button.dataset.operation;
  if (operation !== "acknowledge" && !window.confirm(operation === "resolve"
    ? "Mark this SOS alert as resolved? You can close it afterward."
    : "Close this resolved SOS alert?")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/sos/${encodeURIComponent(button.dataset.alertId)}/${operation}`, {
      method: "POST",
      body: {},
    });
    showMessage(message, operation === "acknowledge"
      ? "Your acknowledgement was recorded on the server."
      : operation === "resolve" ? "The alert is resolved." : "The alert is closed.", "success");
    await loadAlerts();
  } catch (error) {
    showMessage(message, error.message || "The alert status could not be changed.");
    button.disabled = false;
  }
}
