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
const checksButton = document.querySelector("#run-owner-checks");
const sosTestButton = document.querySelector("#run-sos-test");
const closeSosTestButton = document.querySelector("#close-sos-test");
const testMessage = document.querySelector("#owner-test-message");
const testResults = document.querySelector("#owner-test-results");
let openTestAlertId = null;

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
  checksButton.addEventListener("click", runOwnerChecks);
  sosTestButton.addEventListener("click", createSafeSosTest);
  closeSosTestButton.addEventListener("click", closeSafeSosTest);
  accountList.addEventListener("click", handleAccountAction);
  await Promise.all([loadMembers(), restoreOpenTestAlert()]);
}

async function runOwnerChecks() {
  checksButton.disabled = true;
  testResults.replaceChildren();
  showMessage(testMessage, "Checking account and safety services…", "busy");
  const checks = [
    ["Owner session", async () => {
      const { user } = await requestJson("/api/auth/me");
      if (user.role !== "owner") throw new Error("Owner access is not active.");
      return "Signed in as owner";
    }],
    ["Member accounts", async () => {
      const { users } = await requestJson("/api/owner/users");
      return `${users.filter((user) => user.role === "member").length} member account(s)`;
    }],
    ["Trusted circle", async () => {
      const { connections } = await requestJson("/api/connections");
      return `${connections.length} connection(s)`;
    }],
    ["Check-ins", async () => {
      const { checkins } = await requestJson("/api/checkins");
      return `${checkins.length} check-in(s)`;
    }],
    ["SOS service", async () => {
      const { alerts } = await requestJson("/api/sos");
      return `${alerts.length} alert(s) in your history`;
    }],
    ["Notification setup", async () => {
      const settings = await requestJson("/api/notifications");
      return settings.pushAvailable
        ? `Configured · ${settings.activeDeviceCount} device(s)`
        : "Not configured yet · no message sent";
    }],
  ];

  const outcomes = await Promise.all(checks.map(async ([label, check]) => {
    try {
      return { label, detail: await check(), state: "passed" };
    } catch (error) {
      return { label, detail: error.message || "Could not check this service.", state: "failed" };
    }
  }));
  testResults.replaceChildren(...outcomes.map(renderTestResult));
  const failures = outcomes.filter((item) => item.state === "failed").length;
  showMessage(testMessage, failures
    ? `${outcomes.length - failures} of ${outcomes.length} checks passed. Review the results above.`
    : "All read-only checks passed. No messages or alerts were sent.", failures ? "error" : "success");
  checksButton.disabled = false;
}

async function createSafeSosTest() {
  sosTestButton.disabled = true;
  showMessage(testMessage, "Creating a test alert for your account only…", "busy");
  try {
    const result = await requestJson("/api/sos", {
      method: "POST",
      body: {
        testMode: true,
        clientAlertId: crypto.randomUUID(),
        senderTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
        trustedUserIds: [],
        externalContactIds: [],
      },
    });
    openTestAlertId = result.alert.alertId;
    closeSosTestButton.hidden = false;
    showMessage(testMessage, "Safe test SOS created. It has no recipients and no notifications were sent.", "success");
  } catch (error) {
    sosTestButton.disabled = false;
    showMessage(testMessage, error.message || "The safe SOS test could not be created.");
  }
}

async function restoreOpenTestAlert() {
  try {
    const { alerts } = await requestJson("/api/sos");
    const alert = alerts.find((item) => item.isSender && item.testMode && !["resolved", "closed"].includes(item.status));
    if (!alert) return;
    openTestAlertId = alert.alertId;
    sosTestButton.disabled = true;
    closeSosTestButton.hidden = false;
    showMessage(testMessage, "You have an open test SOS. Resolve and close it here when finished.");
  } catch {
    // The main sign-in check and owner-only access remain the source of truth.
  }
}

async function closeSafeSosTest() {
  if (!openTestAlertId) return;
  closeSosTestButton.disabled = true;
  showMessage(testMessage, "Closing your test alert…", "busy");
  try {
    const alertPath = `/api/sos/${encodeURIComponent(openTestAlertId)}`;
    await requestJson(`${alertPath}/resolve`, { method: "POST", body: {} });
    await requestJson(`${alertPath}/close`, { method: "POST", body: {} });
    openTestAlertId = null;
    sosTestButton.disabled = false;
    closeSosTestButton.hidden = true;
    showMessage(testMessage, "Test SOS resolved and closed. No notifications were sent.", "success");
  } catch (error) {
    showMessage(testMessage, error.message || "The test alert could not be closed.");
  } finally {
    closeSosTestButton.disabled = false;
  }
}

function renderTestResult({ label, detail, state }) {
  const row = document.createElement("li");
  row.dataset.state = state;
  row.textContent = `${label}: ${detail}`;
  return row;
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
