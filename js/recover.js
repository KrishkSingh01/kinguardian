import { requestJson, showMessage } from "./auth-client.js";

const form = document.querySelector("#recover-form");
const submit = document.querySelector("#recover-submit");
const message = document.querySelector("#recover-message");
const complete = document.querySelector("#recover-complete");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form));
  if (payload.password !== payload.confirmPassword) {
    showMessage(message, "Those new passwords do not match. Please check them and try again.");
    document.querySelector("#confirm-password").focus();
    return;
  }

  submit.disabled = true;
  showMessage(message, "Checking your recovery details…", "busy");
  try {
    const response = await requestJson("/api/auth/recover", {
      method: "POST",
      body: { username: payload.username, recoveryCode: payload.recoveryCode, password: payload.password },
    });
    form.reset();
    form.hidden = true;
    complete.hidden = false;
    showMessage(message, response.message || "Your password has been changed. Sign in to continue.", "success");
  } catch (error) {
    showMessage(message, error.message || "The username, code, or new password could not be accepted.");
    document.querySelector("#recovery-code").value = "";
    document.querySelector("#new-password").value = "";
    document.querySelector("#confirm-password").value = "";
    submit.disabled = false;
    document.querySelector("#recovery-code").focus();
  }
});
