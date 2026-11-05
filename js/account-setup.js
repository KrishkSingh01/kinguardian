import { requestJson, showMessage } from "./auth-client.js";

const form = document.querySelector("#account-setup-form");
const submit = document.querySelector("#account-setup-submit");
const message = document.querySelector("#account-setup-message");
const success = document.querySelector("#account-setup-success");
const passwordInput = document.querySelector("#new-password");
const confirmInput = document.querySelector("#confirm-password");

let setupToken = window.location.hash.slice(1);
window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

if (!/^[A-Za-z0-9_-]{43}$/u.test(setupToken)) {
  form.hidden = true;
  showMessage(message, "This setup link is invalid, expired, or already used. Ask your KinGuardian owner for a new one.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!setupToken) return;
  if (passwordInput.value !== confirmInput.value) {
    showMessage(message, "The passwords do not match.");
    confirmInput.focus();
    return;
  }

  submit.disabled = true;
  showMessage(message, "Saving your password…", "busy");
  try {
    const result = await requestJson("/api/auth/setup-password", {
      method: "POST",
      body: { token: setupToken, newPassword: passwordInput.value },
    });
    setupToken = "";
    passwordInput.value = "";
    confirmInput.value = "";
    form.hidden = true;
    success.hidden = false;
    showMessage(message, `Password saved for ${result.username}. Sign in to continue.`, "success");
  } catch (error) {
    showMessage(message, error.message || "The password could not be saved.");
    submit.disabled = false;
  }
});
