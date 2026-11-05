import { requestJson, showMessage } from "./auth-client.js";
import { makeQrDataUrl } from "./qr-code.js";

const manager = document.querySelector("#owner-manager");
const message = document.querySelector("#owner-message");
const accountList = document.querySelector("#owner-account-list");
const createButton = document.querySelector("#create-member");
const setupPanel = document.querySelector("#account-setup-result");
const setupLinkInput = document.querySelector("#account-setup-link");
const setupExpiry = document.querySelector("#account-setup-expiry");
const setupQr = document.querySelector("#account-setup-qr");
const downloadSetupQr = document.querySelector("#download-account-setup-qr");

if (manager) {
  initializeOwnerTools();
}

async function initializeOwnerTools() {
  try {
    const { user } = await requestJson("/api/auth/me");
    if (user.role !== "owner") return;
    manager.hidden = false;
  } catch {
    // The main app performs the signed-in check; owner controls stay hidden on failure.
    return;
  }

  createButton.addEventListener("click", createMember);
  document.querySelector("#refresh-members").addEventListener("click", loadMembers);
  document.querySelector("#copy-account-setup-link").addEventListener("click", copySetupLink);
  accountList.addEventListener("click", handleAccountAction);
  await loadMembers();
}

async function loadMembers() {
  accountList.replaceChildren();
  const loading = document.createElement("li");
  loading.className = "owner-account-empty";
  loading.textContent = "Loading accounts…";
  accountList.append(loading);
  try {
    const { users } = await requestJson("/api/owner/users");
    accountList.replaceChildren();
    if (!users.length) {
      const empty = document.createElement("li");
      empty.className = "owner-account-empty";
      empty.textContent = "No accounts are available.";
      accountList.append(empty);
      return;
    }
    users.forEach((user) => accountList.append(renderAccount(user)));
  } catch (error) {
    accountList.replaceChildren();
    showMessage(message, error.message || "Accounts could not be loaded.");
  }
}

function renderAccount(user) {
  const row = document.createElement("li");
  row.className = "owner-account-row";
  row.dataset.userId = user.user_id;

  const identity = document.createElement("div");
  identity.className = "owner-account-identity";
  const username = document.createElement("strong");
  username.textContent = user.username;
  const summary = document.createElement("small");
  const role = user.role === "owner" ? "Owner" : "Member";
  const status = user.account_status === "active" ? "Active" : "Disabled";
  const pendingSetup = user.setup_link_expires_at
    ? ` · Setup link expires ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(user.setup_link_expires_at)}`
    : user.must_change_password ? " · Password setup pending" : "";
  summary.textContent = `${role} · ${status}${pendingSetup}`;
  identity.append(username, summary);
  row.append(identity);

  if (user.role === "member") {
    const actions = document.createElement("div");
    actions.className = "owner-account-actions";
    const statusButton = document.createElement("button");
    statusButton.type = "button";
    statusButton.className = "button button-outline";
    statusButton.dataset.operation = "status";
    statusButton.textContent = user.account_status === "active" ? "Disable" : "Reactivate";
    actions.append(statusButton);

    if (user.setup_link_expires_at) {
      const revokeSetup = document.createElement("button");
      revokeSetup.type = "button";
      revokeSetup.className = "button button-outline";
      revokeSetup.dataset.operation = "revoke-setup";
      revokeSetup.textContent = "Revoke setup link";
      actions.append(revokeSetup);
    }

    if (user.account_status === "active") {
      for (const [operation, text] of [["reset", "Issue password setup link"], ["sessions", "Revoke sessions"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-outline";
        button.dataset.operation = operation;
        button.textContent = text;
        actions.append(button);
      }
    }
    row.append(actions);
  }
  return row;
}

async function createMember() {
  createButton.disabled = true;
  setupPanel.hidden = true;
  try {
    const result = await requestJson("/api/owner/users", { method: "POST", body: {} });
    showSetupLink(result, result.user.username);
    showMessage(message, `Account ${result.user.username} is ready. Share the setup link only with the intended member.`, "success");
    await loadMembers();
  } catch (error) {
    showMessage(message, error.message || "The account could not be created.");
  } finally {
    createButton.disabled = false;
  }
}

function showSetupLink(result, username) {
  setupPanel.hidden = false;
  setupPanel.dataset.userId = result.userId || result.user?.userId || "";
  setupLinkInput.value = result.setupUrl;
  setupExpiry.textContent = `${username || "This member"} chooses a password. Link expires ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(result.expiresAt)}. Anyone holding it can claim the account until it expires or you revoke it.`;
  try {
    const qrDataUrl = makeQrDataUrl(result.setupUrl);
    setupQr.src = qrDataUrl;
    setupQr.alt = `QR code for ${username || "member"} to set an account password`;
    setupQr.hidden = false;
    downloadSetupQr.href = qrDataUrl;
    downloadSetupQr.hidden = false;
  } catch {
    setupQr.hidden = true;
    downloadSetupQr.hidden = true;
    showMessage(message, "The setup link is ready, but its QR image could not be created. Copy the link and share it privately.");
  }
}

async function copySetupLink() {
  try {
    await navigator.clipboard.writeText(setupLinkInput.value);
    showMessage(message, "One-time setup link copied. Share it only with the intended member.", "success");
  } catch {
    setupLinkInput.select();
    showMessage(message, "Copy was unavailable. Select the setup link and copy it manually.");
  }
}

async function handleAccountAction(event) {
  const button = event.target.closest("button[data-operation]");
  if (!button) return;
  const row = button.closest("[data-user-id]");
  const operation = button.dataset.operation;
  const userId = row.dataset.userId;
  const endpoint = `/api/owner/users/${encodeURIComponent(userId)}`;
  let path = endpoint;
  let options = { method: "POST", body: {} };

  if (operation === "status") {
    const disabling = button.textContent === "Disable";
    if (!window.confirm(disabling
      ? "Disable this account and end its active sessions?"
      : "Reactivate this account?")) return;
    path += "/status";
    options.body = { status: disabling ? "disabled" : "active" };
  } else if (operation === "reset") {
    if (!window.confirm("Issue a new one-time password setup link and end all sessions for this account? The previous password stops working.")) return;
    path += "/reset";
  } else if (operation === "revoke-setup") {
    if (!window.confirm("Revoke this account setup link? The member will no longer be able to use it.")) return;
    path += "/reset";
    options.method = "DELETE";
  } else if (operation === "sessions") {
    if (!window.confirm("End all signed-in sessions for this account?")) return;
    path += "/sessions";
  } else {
    return;
  }

  button.disabled = true;
  try {
    const result = await requestJson(path, options);
    if (result.setupUrl) {
      const username = row.querySelector(".owner-account-identity strong")?.textContent || "member";
      showSetupLink(result, username);
      showMessage(message, "One-time password setup link issued. Share it only with the intended member.", "success");
    } else {
      if (operation === "revoke-setup" && setupPanel.dataset.userId === userId) setupPanel.hidden = true;
      showMessage(message, operation === "revoke-setup" ? "Setup link revoked." : "Account action completed.", "success");
    }
    await loadMembers();
  } catch (error) {
    showMessage(message, error.message || "The account action could not be completed.");
  } finally {
    button.disabled = false;
  }
}
