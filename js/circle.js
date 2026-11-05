import { requestJson, showMessage } from "./auth-client.js";
import { makeQrDataUrl } from "./qr-code.js";

const connectionList = document.querySelector("#connection-list");
const invitationList = document.querySelector("#invitation-list");
const circleMessage = document.querySelector("#circle-message");
const connectionEmpty = document.querySelector("#connection-empty");
const invitationResult = document.querySelector("#invitation-result");
const createInvitation = document.querySelector("#create-invitation");
const invitationQr = document.querySelector("#invitation-qr-image");
const downloadInvitationQr = document.querySelector("#download-invitation-qr");

if (connectionList && invitationList) {
  createInvitation.addEventListener("click", createOneTimeInvitation);
  document.querySelector("#refresh-invitations").addEventListener("click", loadInvitations);
  document.querySelector("#copy-invitation-link").addEventListener("click", () => copyInvitation("#invitation-link", "Invitation link"));
  document.querySelector("#copy-invitation-code").addEventListener("click", () => copyInvitation("#invitation-code", "Invitation code"));
  connectionList.addEventListener("change", saveConnectionPreference);
  connectionList.addEventListener("click", removeConnection);
  invitationList.addEventListener("click", revokeInvitation);
  void initializeCircle();
}

async function initializeCircle() {
  try {
    await requestJson("/api/auth/me");
  } catch {
    // The main app performs the session check; management panels remain hidden on failure.
    return;
  }
  await Promise.all([loadConnections(), loadInvitations()]);
}

async function createOneTimeInvitation() {
  createInvitation.disabled = true;
  invitationResult.hidden = true;
  try {
    const result = await requestJson("/api/invitations", { method: "POST", body: {} });
    document.querySelector("#invitation-link").value = result.inviteUrl;
    document.querySelector("#invitation-code").value = result.manualCode;
    document.querySelector("#invitation-warning").textContent = result.warning;
    try {
      const qrDataUrl = makeQrDataUrl(result.inviteUrl);
      invitationQr.src = qrDataUrl;
      invitationQr.hidden = false;
      downloadInvitationQr.href = qrDataUrl;
      downloadInvitationQr.hidden = false;
    } catch {
      invitationQr.hidden = true;
      downloadInvitationQr.hidden = true;
      showMessage(circleMessage, "The invitation link is ready, but its QR image could not be created. You can still copy the link or manual code.");
    }
    invitationResult.hidden = false;
    if (!invitationQr.hidden) {
      showMessage(circleMessage, "Invitation created. Share the QR code, link, or manual code privately; the token will not be shown again.", "success");
    }
    await loadInvitations();
  } catch (error) {
    showMessage(circleMessage, error.message || "The invitation could not be created.");
  } finally {
    createInvitation.disabled = false;
  }
}

async function copyInvitation(selector, label) {
  const input = document.querySelector(selector);
  try {
    await navigator.clipboard.writeText(input.value);
    showMessage(circleMessage, `${label} copied. Share it only with the intended person.`, "success");
  } catch {
    input.focus();
    input.select();
    showMessage(circleMessage, `Copy was unavailable. Select the ${label.toLowerCase()} and copy it manually.`);
  }
}

async function loadConnections() {
  connectionList.replaceChildren();
  try {
    const { connections } = await requestJson("/api/connections");
    connectionEmpty.hidden = connections.length > 0;
    connections.forEach((connection) => connectionList.append(renderConnection(connection)));
  } catch (error) {
    showMessage(circleMessage, error.message || "Trusted connections could not be loaded.");
  }
}

function renderConnection(connection) {
  const row = document.createElement("li");
  row.className = "connection-row";
  row.dataset.connectionId = connection.connectionId;
  const identity = document.createElement("div");
  identity.className = "connection-identity";
  const username = document.createElement("strong");
  username.textContent = connection.username;
  const accepted = document.createElement("small");
  accepted.textContent = `Connected ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium" }).format(connection.acceptedAt)}`;
  identity.append(username, accepted);

  const preferences = document.createElement("div");
  preferences.className = "connection-preferences";
  preferences.dataset.receiveSos = String(connection.receiveSos);
  preferences.dataset.receiveMissedCheckin = String(connection.receiveMissedCheckin);
  preferences.dataset.receiveLocation = String(connection.receiveLocation);
  for (const [name, text, checked] of [
    ["receiveSos", "Allow SOS alerts from this person", connection.receiveSos],
    ["receiveMissedCheckin", "Allow missed check-in notices", connection.receiveMissedCheckin],
    ["receiveLocation", "Allow encrypted location shares from this person", connection.receiveLocation],
  ]) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = name;
    checkbox.checked = checked;
    const copy = document.createElement("span");
    copy.textContent = text;
    label.append(checkbox, copy);
    preferences.append(label);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button button-outline";
  remove.dataset.operation = "remove";
  remove.textContent = "Remove connection";
  row.append(identity, preferences, remove);
  return row;
}

async function saveConnectionPreference(event) {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  const row = checkbox.closest("[data-connection-id]");
  const preferences = row.querySelector(".connection-preferences");
  const body = {
    receiveSos: preferences.querySelector('[name="receiveSos"]').checked,
    receiveMissedCheckin: preferences.querySelector('[name="receiveMissedCheckin"]').checked,
    receiveLocation: preferences.querySelector('[name="receiveLocation"]').checked,
  };
  checkbox.disabled = true;
  try {
    await requestJson(`/api/connections/${encodeURIComponent(row.dataset.connectionId)}`, { method: "PUT", body });
    showMessage(circleMessage, "Your receive preferences have been saved.", "success");
    preferences.dataset.receiveSos = String(body.receiveSos);
    preferences.dataset.receiveMissedCheckin = String(body.receiveMissedCheckin);
    preferences.dataset.receiveLocation = String(body.receiveLocation);
  } catch (error) {
    showMessage(circleMessage, error.message || "Your preferences could not be saved.");
    checkbox.checked = preferences.dataset[checkbox.name] === "true";
  } finally {
    checkbox.disabled = false;
  }
}

async function removeConnection(event) {
  const button = event.target.closest('button[data-operation="remove"]');
  if (!button) return;
  const row = button.closest("[data-connection-id]");
  if (!window.confirm("Remove this trusted connection? Future alerts will no longer be shared with this person.")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/connections/${encodeURIComponent(row.dataset.connectionId)}`, { method: "DELETE", body: {} });
    showMessage(circleMessage, "Trusted connection removed.", "success");
    await loadConnections();
  } catch (error) {
    showMessage(circleMessage, error.message || "The connection could not be removed.");
    button.disabled = false;
  }
}

async function loadInvitations() {
  invitationList.replaceChildren();
  try {
    const { invitations } = await requestJson("/api/invitations");
    invitations.forEach((invitation) => invitationList.append(renderInvitation(invitation)));
  } catch (error) {
    showMessage(circleMessage, error.message || "Invitations could not be loaded.");
  }
}

function renderInvitation(invitation) {
  const row = document.createElement("li");
  row.className = "invitation-row";
  row.dataset.invitationId = invitation.invitationId;
  const identity = document.createElement("div");
  identity.className = "invitation-identity";
  const title = document.createElement("strong");
  title.textContent = `Invitation · ${invitation.status}`;
  const expiry = document.createElement("small");
  expiry.textContent = `Expires ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(invitation.expiresAt)}`;
  identity.append(title, expiry);
  row.append(identity);
  if (invitation.status === "pending") {
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.className = "button button-outline";
    revoke.dataset.operation = "revoke";
    revoke.textContent = "Revoke invitation";
    row.append(revoke);
  }
  return row;
}

async function revokeInvitation(event) {
  const button = event.target.closest('button[data-operation="revoke"]');
  if (!button) return;
  const row = button.closest("[data-invitation-id]");
  if (!window.confirm("Revoke this invitation link now? Anyone holding it will no longer be able to accept.")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/invitations/${encodeURIComponent(row.dataset.invitationId)}`, { method: "DELETE", body: {} });
    showMessage(circleMessage, "Invitation revoked.", "success");
    await loadInvitations();
  } catch (error) {
    showMessage(circleMessage, error.message || "The invitation could not be revoked.");
    button.disabled = false;
  }
}
