import { requestJson, showMessage } from "./auth-client.js";
import { prepareTurnstile } from "./turnstile-client.js";

const form = document.querySelector("#register-form");
const submit = document.querySelector("#register-submit");
const message = document.querySelector("#register-message");
const recoveryResult = document.querySelector("#registration-recovery-result");
const recoveryOutput = document.querySelector("#registration-recovery-codes");
const securityContainer = document.querySelector("#register-turnstile");
let securityCheck = { mode: "loading", token: () => "", reset() {} };
const securityCheckReady = prepareTurnstile(securityContainer)
  .then((state) => { securityCheck = state; })
  .catch(() => { securityCheck = { mode: "unavailable", token: () => "", reset() {} }; });

document.querySelector("#copy-registration-recovery-codes").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(recoveryOutput.value);
    showMessage(message, "Recovery codes copied. Save them somewhere private.", "success");
  } catch {
    recoveryOutput.focus();
    recoveryOutput.select();
    showMessage(message, "Copy was unavailable. Select the codes and copy them manually.");
  }
});

document.querySelector("#continue-after-registration").addEventListener("click", () => {
  recoveryOutput.value = "";
  continueToAccount();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form));
  if (payload.password !== payload.confirmPassword) {
    showMessage(message, "Those passwords do not match. Please check them and try again.");
    document.querySelector("#confirm-password").focus();
    return;
  }

  submit.disabled = true;
  try {
    await securityCheckReady;
    if (securityCheck.mode === "unavailable") throw new Error("KinGuardian's security check is not ready. Please try again later.");
    if (securityCheck.mode === "enabled" && !securityCheck.token()) throw new Error("Complete the security check before creating your account.");
    showMessage(message, "Creating your account…", "busy");
    const response = await requestJson("/api/auth/register", {
      method: "POST",
      body: { username: payload.username, password: payload.password, turnstileToken: securityCheck.token() },
    });
    sessionStorage.setItem("kinguardian-csrf", response.csrfToken);
    form.reset();
    if (!Array.isArray(response.recoveryCodes) || response.recoveryCodes.length !== 10) {
      form.hidden = true;
      recoveryResult.hidden = false;
      recoveryResult.querySelector("h2").textContent = "Create your recovery codes in Settings.";
      recoveryResult.querySelector("p:not(.eyebrow):not(.auth-field-help)").textContent = "Your account was created, but the codes could not be displayed. You are signed in; open Settings and create your recovery codes before signing out.";
      recoveryOutput.hidden = true;
      document.querySelector("#copy-registration-recovery-codes").hidden = true;
      showMessage(message, "Account created. Save recovery codes from Settings before signing out.");
      return;
    }
    recoveryOutput.value = response.recoveryCodes.join("\n");
    form.hidden = true;
    recoveryResult.hidden = false;
    submit.disabled = false;
    showMessage(message, "Your account is ready. Save these one-time recovery codes before continuing.", "success");
  } catch (error) {
    showMessage(message, error.message || "Your account could not be created. Please try again.");
    submit.disabled = false;
    securityCheck.reset();
    document.querySelector("#password").value = "";
    document.querySelector("#confirm-password").value = "";
    document.querySelector("#password").focus();
  }
});

function continueToAccount() {
  const pendingInvite = sessionStorage.getItem("kg-pending-invite");
  const invitationDestination = /^[A-Za-z0-9_-]{43}$/u.test(pendingInvite || "")
    ? `invite.html#${pendingInvite}`
    : "dashboard.html";
  location.replace(invitationDestination);
}

