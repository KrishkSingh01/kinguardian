import { makeQrDataUrl } from "./qr-code.js";
import { requestJson, showMessage } from "./auth-client.js";

const message = document.querySelector("#pairing-message");
const requestPanel = document.querySelector("#pairing-request");
const approvalPanel = document.querySelector("#pairing-approval");
const manualForm = document.querySelector("#manual-pairing-form");
const pairingLink = document.querySelector("#pairing-link");
const pairingQr = document.querySelector("#pairing-qr");
const waitStatus = document.querySelector("#pairing-wait-status");
const approveButton = document.querySelector("#approve-pairing");
const rejectButton = document.querySelector("#reject-pairing");
let activeToken = window.location.hash.slice(1);
let polling = false;

window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

initialize().catch(() => showMessage(message, "KinGuardian could not check this device. Reconnect and try again."));

async function initialize() {
  let user = null;
  try {
    ({ user } = await requestJson("/api/auth/me"));
  } catch {
    // A signed-in account is required only on the device that approves the request.
  }

  if (activeToken) {
    if (!user || user.mustChangePassword) {
      document.querySelector("#manual-pairing-code").value = activeToken;
      manualForm.hidden = false;
      showMessage(message, "Sign in on this device, then use the one-time code below to approve the request.");
      return;
    }
    manualForm.hidden = true;
    await prepareApproval(activeToken, user);
    return;
  }

  if (user) {
    showMessage(message, "Use your new device to open this page and create a pairing request. You can approve its QR code here.", "success");
    manualForm.hidden = false;
    return;
  }

  await createPairingRequest();
}

async function createPairingRequest() {
  showMessage(message, "Creating a short-lived pairing request…", "busy");
  const result = await requestJson("/api/device-pairing", { method: "POST", body: {} });
  const pairingUrl = new URL(result.pairingUrl);
  activeToken = pairingUrl.hash.slice(1);
  pairingUrl.hash = "";
  pairingLink.value = result.pairingUrl;
  pairingQr.src = makeQrDataUrl(result.pairingUrl);
  requestPanel.hidden = false;
  const expiry = new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(result.expiresAt);
  waitStatus.textContent = `Waiting for approval. This request expires ${expiry}.`;
  showMessage(message, "Pairing request created. Scan it with a device that is already signed in.", "success");
  document.querySelector("#copy-pairing-link").addEventListener("click", copyPairingLink);
  document.querySelector("#cancel-pairing").addEventListener("click", cancelPairing);
  polling = true;
  pollPairing();
}

async function pollPairing() {
  if (!polling || !activeToken) return;
  try {
    const result = await requestJson("/api/device-pairing/status", { method: "POST", body: { token: activeToken } });
    if (result.status === "approved") {
      waitStatus.textContent = "Approved. Signing this device in…";
      const token = activeToken;
      const signedIn = await requestJson("/api/device-pairing/redeem", { method: "POST", body: { token } });
      if (signedIn.paired) {
        polling = false;
        activeToken = "";
        showMessage(message, "Device paired. Opening your KinGuardian account…", "success");
        window.location.replace("app.html");
        return;
      }
    }
    if (result.status === "revoked" || result.status === "paired") {
      polling = false;
      activeToken = "";
      showMessage(message, result.status === "revoked" ? "This pairing request was rejected or cancelled." : "This pairing request has already been used.");
      return;
    }
  } catch (error) {
    if (error.status === 404 || error.status === 429) {
      polling = false;
      activeToken = "";
      showMessage(message, error.message || "This pairing request is no longer available.");
      return;
    }
  }
  if (polling) window.setTimeout(pollPairing, 3000);
}

async function prepareApproval(token, user) {
  activeToken = token;
  const result = await requestJson("/api/device-pairing/status", { method: "POST", body: { token } });
  if (result.status !== "pending") {
    showMessage(message, result.status === "approved"
      ? "This request has already been approved. The new device can now finish pairing."
      : result.status === "paired" ? "This pairing request has already been used." : "This pairing request was cancelled.");
    return;
  }
  document.querySelector("#pairing-approver-identity").textContent = `You are signed in as ${user.username}.`;
  approvalPanel.hidden = false;
  showMessage(message, "Confirm that you started this request on the new device.", "success");
}

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = document.querySelector("#manual-pairing-code").value.trim();
  const hashToken = value.includes("#") ? value.slice(value.lastIndexOf("#") + 1) : value;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(hashToken)) {
    showMessage(message, "Paste the full pairing link or its 43-character one-time code.");
    return;
  }
  try {
    const { user } = await requestJson("/api/auth/me");
    if (user.mustChangePassword) {
      showMessage(message, "Complete your password change before approving a new device.");
      return;
    }
    await prepareApproval(hashToken, user);
    document.querySelector("#manual-pairing-code").value = "";
  } catch (error) {
    showMessage(message, error.message || "Sign in before approving another device.");
  }
});

approveButton.addEventListener("click", async () => {
  approveButton.disabled = true;
  rejectButton.disabled = true;
  try {
    await requestJson("/api/device-pairing/approve", { method: "POST", body: { token: activeToken } });
    activeToken = "";
    approvalPanel.hidden = true;
    showMessage(message, "Device sign-in approved. The new device can now finish pairing.", "success");
  } catch (error) {
    approveButton.disabled = false;
    rejectButton.disabled = false;
    showMessage(message, error.message || "The pairing request could not be approved.");
  }
});

rejectButton.addEventListener("click", async () => {
  approveButton.disabled = true;
  rejectButton.disabled = true;
  try {
    await requestJson("/api/device-pairing/reject", { method: "POST", body: { token: activeToken } });
    activeToken = "";
    approvalPanel.hidden = true;
    showMessage(message, "Pairing request rejected. The new device cannot sign in.", "success");
  } catch (error) {
    approveButton.disabled = false;
    rejectButton.disabled = false;
    showMessage(message, error.message || "The pairing request could not be rejected.");
  }
});

async function copyPairingLink() {
  try {
    await navigator.clipboard.writeText(pairingLink.value);
    showMessage(message, "One-time pairing link copied. Open it only on your signed-in device.", "success");
  } catch {
    pairingLink.select();
    showMessage(message, "Copy was unavailable. Select the pairing link and copy it manually.");
  }
}

async function cancelPairing() {
  polling = false;
  try {
    await requestJson("/api/device-pairing/cancel", { method: "POST", body: { token: activeToken } });
    activeToken = "";
    requestPanel.hidden = true;
    showMessage(message, "Pairing request cancelled.", "success");
  } catch (error) {
    showMessage(message, error.message || "The pairing request could not be cancelled.");
  }
}
