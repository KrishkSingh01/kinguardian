import { requestJson, showMessage } from "./auth-client.js";

const form = document.querySelector("#password-form");
const submit = document.querySelector("#password-submit");
const message = document.querySelector("#password-message");

try {
  const session = await requestJson("/api/auth/me");
  if (!session.user.mustChangePassword) location.replace("index.html");
} catch {
  location.replace("login.html");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = document.querySelector("#current-password").value;
  const newPassword = document.querySelector("#new-password").value;
  const confirmation = document.querySelector("#confirm-password").value;
  if (newPassword !== confirmation) {
    showMessage(message, "The new passwords do not match.");
    document.querySelector("#confirm-password").focus();
    return;
  }
  if ([...newPassword].length < 12 || new TextEncoder().encode(newPassword).byteLength > 256) {
    showMessage(message, "Use a passphrase with at least 12 characters and no more than 256 UTF-8 bytes.");
    return;
  }

  submit.disabled = true;
  showMessage(message, "Changing your password…", "busy");
  try {
    await requestJson("/api/auth/password", { method: "POST", body: { currentPassword, newPassword } });
    sessionStorage.removeItem("kinguardian-csrf");
    form.reset();
    const pendingInvite = sessionStorage.getItem("kg-pending-invite");
    const invitationDestination = /^[A-Za-z0-9_-]{43}$/u.test(pendingInvite || "")
      ? `invite.html#${pendingInvite}`
      : "index.html";
    location.replace(invitationDestination);
  } catch (error) {
    showMessage(message, error.message || "The password could not be changed.");
    submit.disabled = false;
  }
});
