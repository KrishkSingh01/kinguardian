import { requestJson, showMessage } from "./auth-client.js";

const form = document.querySelector("#login-form");
const submit = document.querySelector("#login-submit");
const message = document.querySelector("#login-message");
const setupLink = document.querySelector("#setup-link");

try {
  const status = await requestJson("/api/auth/bootstrap-status");
  setupLink.hidden = !status.setupAvailable;
} catch {
  showMessage(message, "KinGuardian could not reach its sign-in service. Reconnect and try again.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  showMessage(message, "Signing in…", "busy");
  try {
    const payload = Object.fromEntries(new FormData(form));
    const response = await requestJson("/api/auth/login", {
      method: "POST",
      body: { username: payload.username, password: payload.password },
    });
    sessionStorage.setItem("kinguardian-csrf", response.csrfToken);
    form.reset();
    const pendingInvite = sessionStorage.getItem("kg-pending-invite");
    const invitationDestination = /^[A-Za-z0-9_-]{43}$/u.test(pendingInvite || "")
      ? `invite.html#${pendingInvite}`
      : "app.html";
    const destination = response.user.mustChangePassword
      ? "change-password.html"
      : invitationDestination;
    location.replace(destination);
  } catch (error) {
    showMessage(message, error.message || "The username or password is incorrect.");
    submit.disabled = false;
    document.querySelector("#password").value = "";
    document.querySelector("#password").focus();
  }
});
