import { requestJson, showMessage } from "./auth-client.js";

const form = document.querySelector("#setup-form");
const submit = document.querySelector("#setup-submit");
const message = document.querySelector("#setup-message");
const result = document.querySelector("#credential-result");
const passwordOutput = document.querySelector("#temporary-password");
const copyButton = document.querySelector("#copy-password");
const recoveryOutput = document.querySelector("#owner-recovery-codes");
const copyRecoveryButton = document.querySelector("#copy-owner-recovery-codes");

try {
  const status = await requestJson("/api/auth/bootstrap-status");
  if (!status.setupAvailable) {
    form.hidden = true;
    showMessage(message, status.ownerExists ? "Owner setup is already complete. Sign in to continue." : "Owner setup is not configured on the server.");
  }
} catch {
  form.hidden = true;
  showMessage(message, "KinGuardian could not verify setup availability. Reconnect and try again.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  showMessage(message, "Creating the owner account…", "busy");
  try {
    const bootstrapSecret = document.querySelector("#bootstrap-secret").value;
    const response = await requestJson("/api/auth/bootstrap", { method: "POST", body: { bootstrapSecret } });
    document.querySelector("#bootstrap-secret").value = "";
    form.hidden = true;
    passwordOutput.textContent = response.temporaryPassword;
    recoveryOutput.value = Array.isArray(response.recoveryCodes) ? response.recoveryCodes.join("\n") : "";
    result.hidden = false;
    showMessage(message, "The owner account was created. Save the temporary password and recovery codes now.", "success");
  } catch (error) {
    document.querySelector("#bootstrap-secret").value = "";
    showMessage(message, error.message || "Owner setup could not be completed.");
    submit.disabled = false;
  }
});

copyRecoveryButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(recoveryOutput.value);
    showMessage(message, "Recovery codes copied. Store them safely; they will not be shown again.", "success");
  } catch {
    recoveryOutput.focus();
    recoveryOutput.select();
    showMessage(message, "Copy was unavailable. Select the recovery codes and copy them manually.");
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(passwordOutput.textContent);
    showMessage(message, "Temporary password copied. Store it safely; it will not be shown again.", "success");
  } catch {
    showMessage(message, "Copy was unavailable. Select the temporary password and copy it manually.");
  }
});
