import { requestJson, showMessage } from "./auth-client.js";
import { prepareTurnstile } from "./turnstile-client.js";

const form = document.querySelector("#login-form");
const submit = document.querySelector("#login-submit");
const message = document.querySelector("#login-message");
const securityContainer = document.querySelector("#login-turnstile");
let securityCheck = { mode: "loading", token: () => "", reset() {} };
const securityCheckReady = prepareTurnstile(securityContainer)
  .then((state) => { securityCheck = state; })
  .catch(() => { securityCheck = { mode: "unavailable", token: () => "", reset() {} }; });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  try {
    await securityCheckReady;
    if (securityCheck.mode === "unavailable") throw new Error("The account security check is unavailable. Refresh the page and try again.");
    if (securityCheck.mode === "enabled" && !securityCheck.token()) throw new Error("Complete the security check before signing in.");
    showMessage(message, "Signing in…", "busy");
    const payload = Object.fromEntries(new FormData(form));
    const response = await requestJson("/api/auth/login", {
      method: "POST",
      body: { username: payload.username, password: payload.password, turnstileToken: securityCheck.token() },
    });
    sessionStorage.setItem("kinguardian-csrf", response.csrfToken);
    form.reset();
    const pendingInvite = sessionStorage.getItem("kg-pending-invite");
    const invitationDestination = /^[A-Za-z0-9_-]{43}$/u.test(pendingInvite || "")
      ? `invite.html#${pendingInvite}`
      : "dashboard.html";
    const destination = response.user.mustChangePassword
      ? "change-password.html"
      : invitationDestination;
    location.replace(destination);
  } catch (error) {
    showMessage(message, error.message || "The username or password is incorrect.");
    submit.disabled = false;
    securityCheck.reset();
    document.querySelector("#password").value = "";
    document.querySelector("#password").focus();
  }
});

