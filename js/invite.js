import { requestJson, showMessage } from "./auth-client.js";

const inviteMessage = document.querySelector("#invite-message");
const codeForm = document.querySelector("#invite-code-form");
const decision = document.querySelector("#invite-decision");
let activeToken = "";

document.querySelector("#accept-invitation").addEventListener("click", () => respondToInvitation("accept"));
document.querySelector("#reject-invitation").addEventListener("click", () => respondToInvitation("reject"));
codeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void checkInvitation(document.querySelector("#invite-code-entry").value.trim());
});

let token = location.hash.slice(1);
if (token) {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  void checkInvitation(token);
} else {
  codeForm.hidden = false;
  showMessage(inviteMessage, "Enter the one-time code the other member shared with you.");
}

async function checkInvitation(candidate) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(candidate)) {
    showMessage(inviteMessage, "Enter a valid 43-character invitation code.");
    return;
  }
  codeForm.hidden = true;
  showMessage(inviteMessage, "Checking your sign-in…", "busy");
  try {
    const { user } = await requestJson("/api/auth/me");
    if (user.mustChangePassword) {
      sessionStorage.setItem("kg-pending-invite", candidate);
      location.replace("change-password.html");
      return;
    }
  } catch (error) {
    if (error.status === 401 || error.code === "PASSWORD_CHANGE_REQUIRED") {
      sessionStorage.setItem("kg-pending-invite", candidate);
      location.replace(error.code === "PASSWORD_CHANGE_REQUIRED" ? "change-password.html" : "login.html");
      return;
    }
    codeForm.hidden = false;
    showMessage(inviteMessage, error.message || "KinGuardian could not verify your sign-in.");
    return;
  }
  sessionStorage.removeItem("kg-pending-invite");
  activeToken = candidate;
  document.querySelector("#invite-intro").textContent = "This link was shared for a KinGuardian connection. You can accept or decline; either choice is final for this single-use link.";
  decision.hidden = false;
  showMessage(inviteMessage, "Review the connection before you choose.", "success");
}

async function respondToInvitation(action) {
  if (!activeToken) return;
  const buttons = [...decision.querySelectorAll("button")];
  buttons.forEach((button) => { button.disabled = true; });
  showMessage(inviteMessage, action === "accept" ? "Accepting invitation…" : "Declining invitation…", "busy");
  try {
    const result = await requestJson("/api/invitations/accept", {
      method: "POST",
      body: { token: activeToken, action },
    });
    activeToken = "";
    showMessage(inviteMessage, result.accepted
      ? `You are connected with ${result.connectedUsername}. Alert preferences remain off until each of you chooses what to receive.`
      : "Invitation declined. It can no longer be accepted.", "success");
    decision.hidden = true;
    sessionStorage.removeItem("kg-pending-invite");
    window.setTimeout(() => location.replace("index.html#circle"), 1800);
  } catch (error) {
    showMessage(inviteMessage, error.message || "This invitation could not be completed.");
    buttons.forEach((button) => { button.disabled = false; });
  }
}
