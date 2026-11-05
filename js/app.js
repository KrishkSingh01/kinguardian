import { requestJson } from "./auth-client.js";

const views = [...document.querySelectorAll("[data-view]")];
const navButtons = [...document.querySelectorAll("[data-nav]")];
const pageTitle = document.querySelector("#page-title");
const liveStatus = document.querySelector("#live-status");
const dialog = document.querySelector("#app-dialog");
const dialogTitle = document.querySelector("#dialog-title");
const dialogCopy = document.querySelector("#dialog-copy");
const dialogPrimary = document.querySelector("#dialog-primary");
const countdownPanel = document.querySelector("#dialog-countdown");
const countdownNumber = document.querySelector("#countdown-number");
const themeSelect = document.querySelector("#theme-select");

const viewTitles = {
  home: "A little more connected.",
  circle: "Your trusted circle.",
  checkins: "A moment for you.",
  settings: "Make it feel like yours.",
};

let countdownTimer;
let countdownValue = 5;

function navigate(viewName) {
  if (!viewTitles[viewName]) return;
  views.forEach((view) => {
    view.hidden = view.dataset.view !== viewName;
  });
  navButtons.forEach((button) => {
    const active = button.dataset.nav === viewName;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  pageTitle.textContent = viewTitles[viewName];
  document.title = `${viewTitles[viewName]} · KinGuardian`;
  history.replaceState(null, "", `#${viewName}`);
}

function setTheme(theme) {
  const accepted = ["system", "light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = accepted;
  localStorage.setItem("kinguardian-theme", accepted);
  if (themeSelect) themeSelect.value = accepted;
  const followsDarkSystem = accepted === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const useDarkColors = accepted === "dark" || followsDarkSystem;
  document.querySelector('meta[name="theme-color"]').content = useDarkColors ? "#111a17" : "#f3f2ec";
  const mode = accepted === "system" ? "device setting" : `${accepted} mode`;
  document.querySelectorAll(".theme-cycle").forEach((button) => {
    button.setAttribute("aria-label", `Change colour theme. Current theme: ${mode}.`);
    button.title = `Theme: ${mode}`;
  });
}

function cycleTheme() {
  const sequence = ["system", "light", "dark"];
  const current = document.documentElement.dataset.theme || "system";
  setTheme(sequence[(sequence.indexOf(current) + 1) % sequence.length]);
}

function stopCountdown() {
  if (countdownTimer) window.clearInterval(countdownTimer);
  countdownTimer = undefined;
  countdownPanel.hidden = true;
  dialogPrimary.disabled = false;
}

function showDialog({ title, paragraphs, primary = "Understood", countdown = false }) {
  stopCountdown();
  dialogTitle.textContent = title;
  dialogCopy.replaceChildren(...paragraphs.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
  dialogPrimary.textContent = primary;
  dialogPrimary.dataset.countdown = String(countdown);
  dialogPrimary.dataset.operation = "";
  dialogPrimary.hidden = false;
  if (countdown) {
    dialogPrimary.textContent = "Start 5-second preview";
  }
  if (!dialog.open) dialog.showModal();
}

function startPreviewCountdown() {
  countdownValue = 5;
  countdownNumber.textContent = String(countdownValue);
  countdownPanel.hidden = false;
  dialogPrimary.hidden = true;
  liveStatus.textContent = "Preview countdown started. No alert will be sent.";
  countdownTimer = window.setInterval(() => {
    countdownValue -= 1;
    countdownNumber.textContent = String(Math.max(countdownValue, 0));
    if (countdownValue <= 0) {
      stopCountdown();
      dialogCopy.replaceChildren();
      const message = document.createElement("p");
      message.textContent = "Preview complete. No alert was created or sent.";
      dialogCopy.append(message);
      dialogTitle.textContent = "No alert was sent.";
      dialogPrimary.textContent = "Close";
      dialogPrimary.hidden = false;
      dialogPrimary.dataset.countdown = "false";
      dialogPrimary.dataset.operation = "";
      liveStatus.textContent = "Preview complete. No alert was created or sent.";
    }
  }, 1000);
}

function previewAction(action) {
  if (action === "checkin-preview") {
    navigate("checkins");
    document.querySelector("#new-checkin")?.click();
    return;
  }
  if (action === "contact-preview" && location.protocol !== "file:") {
    location.assign("contacts.html");
    return;
  }
  if (action === "sos-preview" && location.protocol !== "file:") {
    location.assign("sos.html");
    return;
  }
  if (action === "location-preview" && location.protocol !== "file:") {
    location.assign("location.html");
    return;
  }
  if (action === "invite-preview" && location.protocol !== "file:") {
    navigate("circle");
    document.querySelector("#create-invitation")?.click();
    return;
  }
  if (action === "logout") {
    showDialog({
      title: "Sign out on this device?",
      paragraphs: ["This ends your KinGuardian session here. It does not remove your account or sign out other devices."],
      primary: "Sign out",
    });
    dialogPrimary.dataset.operation = "logout";
    return;
  }
  const content = {
    "sos-preview": {
      title: "This SOS cannot reach anyone yet.",
      paragraphs: ["KinGuardian is in design preview. This control will not create an alert or contact anyone.", "You can preview the cancel countdown to see how the protected action will feel."],
      primary: "Start 5-second preview",
      countdown: true,
    },
    "location-preview": {
      title: "Location remains your choice.",
      paragraphs: ["KinGuardian requests your device location only after you choose members and press Start on the location page.", "No location was read or shared by this preview."],
    },
    "contact-preview": {
      title: "Your contacts stay private.",
      paragraphs: ["Contact setup will be connected after account security is in place.", "This preview has not saved or shared any contact information."],
    },
    "invite-preview": {
      title: "Invitations need both people.",
      paragraphs: ["KinGuardian invitations will be short-lived and require the other person to accept.", "No invitation code has been created in this preview."],
    },
  }[action];
  if (content) showDialog(content);
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    navigate(nav.dataset.nav);
    return;
  }
  const action = event.target.closest("[data-action]");
  if (action) {
    previewAction(action.dataset.action);
    return;
  }
  if (event.target.closest("[data-dialog-close]")) {
    stopCountdown();
    dialog.close();
    return;
  }
  if (event.target.closest(".theme-cycle")) cycleTheme();
});

dialogPrimary.addEventListener("click", () => {
  if (dialogPrimary.dataset.countdown === "true") startPreviewCountdown();
  else if (dialogPrimary.dataset.operation === "logout") void signOut();
  else {
    stopCountdown();
    dialog.close();
  }
});

async function signOut() {
  dialogPrimary.disabled = true;
  try {
    await requestJson("/api/auth/logout", { method: "POST", body: {} });
    sessionStorage.removeItem("kinguardian-csrf");
    location.replace("login.html");
  } catch (error) {
    dialogPrimary.disabled = false;
    dialogTitle.textContent = "You are still signed in.";
    dialogCopy.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.textContent = error.message || "Reconnect and try signing out again.";
    dialogCopy.append(paragraph);
    dialogPrimary.textContent = "Close";
    dialogPrimary.dataset.operation = "";
  }
}

dialog.addEventListener("cancel", stopCountdown);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    stopCountdown();
    dialog.close();
  }
});

themeSelect.addEventListener("change", (event) => setTheme(event.target.value));
document.querySelector(".notice-close").addEventListener("click", () => {
  document.querySelector(".preview-notice").hidden = true;
});

const offlineNotice = document.querySelector("#offline-notice");
function updateConnectionStatus() {
  const offline = !navigator.onLine;
  offlineNotice.hidden = !offline;
  if (offline) liveStatus.textContent = "You are offline. Server features cannot reach KinGuardian.";
}
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

const storedTheme = localStorage.getItem("kinguardian-theme") || "system";
setTheme(storedTheme);
navigate(location.hash.slice(1) || "home");

const now = new Date();
document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "long", month: "long", day: "numeric",
}).format(now).toLocaleUpperCase();
document.querySelector("#timezone-label").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
updateConnectionStatus();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
      document.querySelector("#pwa-status").textContent = "App shell ready · offline assets cached";
    } catch {
      document.querySelector("#pwa-status").textContent = "App shell ready · offline setup unavailable";
    }
  }, { once: true });
}

async function enforceSignedInSession() {
  if (location.protocol === "file:") return;
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace("login.html");
      return;
    }
    if (response.status === 403 && payload.error?.code === "PASSWORD_CHANGE_REQUIRED") {
      location.replace("change-password.html");
      return;
    }
    if (!response.ok || !payload.user) throw new Error("Sign-in could not be verified.");
    document.querySelector("#account-indicator").textContent = `Signed in · ${payload.user.username}`;
    document.querySelector(".profile-meta strong").textContent = payload.user.username;
    document.querySelector(".profile-meta small").textContent = payload.user.role === "owner" ? "Owner account" : "Member account";
    document.querySelectorAll("[data-auth-only]").forEach((element) => { element.hidden = false; });
    document.querySelectorAll("[data-owner-only]").forEach((element) => { element.hidden = payload.user.role !== "owner"; });
    if (payload.user.mustChangePassword) location.replace("change-password.html");
  } catch {
    document.querySelector("#app-shell").hidden = true;
    document.querySelector(".mobile-nav").hidden = true;
    document.querySelector("#auth-blocker").hidden = false;
    document.querySelector("#auth-blocker-title").textContent = navigator.onLine ? "Sign-in is unavailable." : "You’re offline.";
    document.querySelector("#auth-blocker-message").textContent = navigator.onLine
      ? "KinGuardian could not verify your session. Sign in again when the service is available."
      : "Reconnect before opening private KinGuardian information. No alert was sent.";
  }
}

void enforceSignedInSession();
