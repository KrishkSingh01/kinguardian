import { requestJson, showMessage } from "./auth-client.js";

const form = document.querySelector("#checkin-form");
const checkinList = document.querySelector("#checkin-list");
const checkinMessage = document.querySelector("#checkin-message");
const recipientOptions = document.querySelector("#checkin-recipients");
const recipientEmpty = document.querySelector("#checkin-recipient-empty");
const saveButton = document.querySelector("#save-checkin");
const recipientFieldset = document.querySelector(".checkin-recipient-fieldset");
const dailyForm = document.querySelector("#daily-checkin-form");
const dailyMessage = document.querySelector("#daily-checkin-message");
const dailyRecipientOptions = document.querySelector("#daily-checkin-recipients");
const dailyRecipientEmpty = document.querySelector("#daily-checkin-recipient-empty");
const dailyEnabled = document.querySelector("#daily-checkin-enabled");
const dailyStatus = document.querySelector("#daily-checkin-status");
const dailySummary = document.querySelector("#daily-checkin-summary");
const homeDailyStatus = document.querySelector("#home-daily-checkin-status");
let eligibleConnections = [];
let dailySettings = null;
let latestCheckins = [];
let editingCheckinId = null;
let pendingIdempotencyKey = null;
let pendingRequestFingerprint = null;

if (form && checkinList && dailyForm) {
  document.querySelector("#new-checkin").addEventListener("click", () => openForm());
  document.querySelector("#close-checkin-form").addEventListener("click", closeForm);
  document.querySelector("#cancel-checkin-form").addEventListener("click", closeForm);
  form.addEventListener("submit", saveCheckin);
  dailyForm.addEventListener("submit", saveDailyCheckin);
  document.querySelector("#edit-daily-checkin").addEventListener("click", () => openDailyForm());
  document.querySelector("#close-daily-checkin-form").addEventListener("click", closeDailyForm);
  document.querySelector("#cancel-daily-checkin-form").addEventListener("click", closeDailyForm);
  checkinList.addEventListener("click", handleCheckinAction);
  void initializeCheckins();
  window.setInterval(updateCountdowns, 30_000);
  window.setInterval(() => {
    if (!document.hidden) {
      void loadCheckins().catch((error) => showMessage(checkinMessage, error.message || "Check-in status could not be refreshed."));
    }
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void loadCheckins().catch((error) => showMessage(checkinMessage, error.message || "Check-in status could not be refreshed."));
    }
  });
}

async function initializeCheckins() {
  try {
    await requestJson("/api/auth/me");
    setDefaultTimeZone();
    populateTimeZoneSuggestions();
    try {
      await loadEligibleConnections();
    } catch (error) {
      showMessage(checkinMessage, error.message || "Trusted members could not be loaded.");
    }
    const results = await Promise.allSettled([loadCheckins(), loadDailyCheckin()]);
    if (results[0].status === "rejected") showMessage(checkinMessage, results[0].reason.message || "Check-ins could not be loaded.");
    if (results[1].status === "rejected") {
      dailySettings = null;
      dailyStatus.textContent = "Unavailable";
      dailySummary.textContent = "Daily check-ins could not be loaded. Refresh and try again.";
      if (homeDailyStatus) homeDailyStatus.textContent = "Daily check-in settings could not be loaded.";
    }
    updateDailyOverview();
  } catch (error) {
    showMessage(checkinMessage, error.message || "Check-ins could not be loaded.");
  }
}

function setDefaultTimeZone() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  document.querySelector("#checkin-timezone").value = timezone;
}

function populateTimeZoneSuggestions() {
  const list = document.querySelector("#checkin-timezones");
  if (typeof Intl.supportedValuesOf !== "function") return;
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    list.replaceChildren(...zones.map((zone) => {
      const option = document.createElement("option");
      option.value = zone;
      return option;
    }));
  } catch {
    // The user can still type a valid IANA time-zone name.
  }
}

function dateAndTimeFromLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    date: date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()),
    time: pad(date.getHours()) + ":" + pad(date.getMinutes()),
  };
}

function openForm(checkin = null) {
  editingCheckinId = checkin?.checkinId || null;
  pendingIdempotencyKey = null;
  pendingRequestFingerprint = null;
  document.querySelector("#checkin-form-title").textContent = editingCheckinId ? "Edit your check-in" : "Create a check-in";
  saveButton.textContent = editingCheckinId ? "Save changes" : "Save check-in";
  recipientFieldset.hidden = Boolean(editingCheckinId);
  form.reset();
  document.querySelector("#checkin-reminder").checked = true;
  if (checkin) {
    document.querySelector("#checkin-date").value = checkin.localDate;
    document.querySelector("#checkin-time").value = checkin.localTime;
    document.querySelector("#checkin-timezone").value = checkin.timeZone;
    document.querySelector("#checkin-grace").value = String(checkin.graceMinutes);
    document.querySelector("#checkin-reminder").checked = checkin.reminderEnabled;
  } else {
    setDefaultTimeZone();
    const local = dateAndTimeFromLocal(new Date(Date.now() + 60 * 60_000));
    document.querySelector("#checkin-date").value = local.date;
    document.querySelector("#checkin-time").value = local.time;
  }
  showMessage(checkinMessage, "");
  form.hidden = false;
  form.querySelector("input:not([type=checkbox])").focus();
}

function closeForm() {
  form.hidden = true;
  editingCheckinId = null;
  pendingIdempotencyKey = null;
  pendingRequestFingerprint = null;
  showMessage(checkinMessage, "");
}

async function loadEligibleConnections() {
  const result = await requestJson("/api/connections");
  eligibleConnections = result.connections.filter((connection) =>
    connection.status === "accepted" && connection.receiveMissedCheckin);
  renderRecipientOptions(recipientOptions, eligibleConnections, "recipientUserIds");
  renderRecipientOptions(dailyRecipientOptions, eligibleConnections, "dailyRecipientUserIds");
  recipientEmpty.hidden = eligibleConnections.length > 0;
  dailyRecipientEmpty.hidden = eligibleConnections.length > 0;
}

function renderRecipientOptions(container, connections, inputName) {
  container.replaceChildren();
  for (const connection of connections) {
    const label = document.createElement("label");
    label.className = "checkin-recipient-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = inputName;
    checkbox.value = connection.userId;
    const name = document.createElement("span");
    name.textContent = connection.username;
    label.append(checkbox, name);
    container.append(label);
  }
}

async function saveCheckin(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  saveButton.disabled = true;
  showMessage(checkinMessage, editingCheckinId ? "Saving changes…" : "Saving your check-in…", "pending");
  const body = {
    localDate: document.querySelector("#checkin-date").value,
    localTime: document.querySelector("#checkin-time").value,
    timeZone: document.querySelector("#checkin-timezone").value.trim(),
    graceMinutes: Number(document.querySelector("#checkin-grace").value),
    reminderEnabled: document.querySelector("#checkin-reminder").checked,
  };
  try {
    if (editingCheckinId) {
      await requestJson("/api/checkins/" + encodeURIComponent(editingCheckinId), {
        method: "POST", body: { ...body, action: "edit" },
      });
    } else {
      const selected = [...recipientOptions.querySelectorAll('input[name="recipientUserIds"]:checked')]
        .map((checkbox) => checkbox.value);
      if (selected.length === 0) {
        showMessage(checkinMessage, "Choose at least one opted-in trusted member.");
        return;
      }
      const fingerprint = JSON.stringify({ ...body, recipientUserIds: [...selected].sort() });
      if (fingerprint !== pendingRequestFingerprint) {
        pendingIdempotencyKey = crypto.randomUUID();
        pendingRequestFingerprint = fingerprint;
      }
      const result = await requestJson("/api/checkins", {
        method: "POST", body: { ...body, recipientUserIds: selected, idempotencyKey: pendingIdempotencyKey },
      });
      if (result.repeated) showMessage(checkinMessage, "This check-in was already saved.", "success");
    }
    await loadCheckins();
    closeForm();
  } catch (error) {
    showMessage(checkinMessage, error.message || "The check-in could not be saved.");
  } finally {
    saveButton.disabled = false;
  }
}

async function loadCheckins() {
  const result = await requestJson("/api/checkins");
  latestCheckins = result.checkins;
  checkinList.replaceChildren(...latestCheckins.map(renderCheckin));
  document.querySelector("#checkin-empty").hidden = result.checkins.length > 0;
  updateCountdowns();
  updateDailyOverview();
  return latestCheckins;
}

function renderCheckin(checkin) {
  const row = document.createElement("li");
  row.className = "checkin-item";
  row.dataset.checkinId = checkin.checkinId;

  const copy = document.createElement("div");
  copy.className = "checkin-item-copy";
  const due = document.createElement("time");
  due.dateTime = new Date(checkin.scheduledFor).toISOString();
  try {
    due.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: "full", timeStyle: "short", timeZone: checkin.timeZone,
    }).format(checkin.scheduledFor);
  } catch {
    due.textContent = checkin.localDate + " " + checkin.localTime + " (" + checkin.timeZone + ")";
  }
  const names = checkin.recipients.map((recipient) => recipient.username).join(", ");
  const meta = document.createElement("p");
  meta.className = "checkin-item-meta";
  meta.textContent = "Time zone: " + checkin.timeZone + " · Grace period: " + checkin.graceMinutes
    + " min · Notices may go to: " + (names || "no active recipients");
  const status = document.createElement("span");
  status.className = "checkin-item-status";
  status.dataset.status = checkin.status;
  status.textContent = {
    pending: "Scheduled · waiting for server",
    overdue: "Missed · push delivery is not connected",
    safe: "Marked safe",
    cancelled: "Cancelled",
  }[checkin.status] || "Status unavailable";
  const countdown = document.createElement("p");
  countdown.className = "checkin-item-meta checkin-countdown";
  countdown.dataset.scheduled = String(checkin.scheduledFor);
  countdown.dataset.grace = String(checkin.graceMinutes);
  countdown.dataset.status = checkin.status;
  if (checkin.isDaily) {
    const recurrence = document.createElement("p");
    recurrence.className = "checkin-item-meta";
    recurrence.textContent = "Daily check-in";
    copy.append(recurrence);
  }
  copy.append(due, meta, status, countdown);

  const actions = document.createElement("div");
  actions.className = "checkin-item-actions";
  if (checkin.status === "pending") {
    if (checkin.scheduledFor > Date.now()) actions.append(actionButton("Edit", "edit"));
    actions.append(actionButton("I’m Safe", "safe", "button-dark"));
    actions.append(actionButton("Cancel", "cancel", "button-outline"));
  } else if (checkin.status === "overdue") {
    actions.append(actionButton("I’m Safe", "safe", "button-dark"));
  }
  row.append(copy, actions);
  return row;
}

function actionButton(label, action, style = "button-outline") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button " + style;
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

function updateCountdowns() {
  document.querySelectorAll(".checkin-countdown").forEach((element) => {
    const status = element.dataset.status;
    const scheduled = Number(element.dataset.scheduled);
    const graceEnds = scheduled + Number(element.dataset.grace) * 60_000;
    const now = Date.now();
    if (status !== "pending") {
      element.textContent = "";
    } else if (scheduled > now) {
      element.textContent = "Starts in " + remaining(scheduled - now);
    } else if (graceEnds > now) {
      element.textContent = "Grace period ends in " + remaining(graceEnds - now);
    } else {
      element.textContent = "Waiting for the server to update its status.";
    }
  });
}

function remaining(milliseconds) {
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return days + "d " + hours + "h";
  if (hours) return hours + "h " + minutes + "m";
  return minutes + "m";
}

async function handleCheckinAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest("[data-checkin-id]");
  const checkinId = row?.dataset.checkinId;
  if (!checkinId) return;
  if (button.dataset.action === "edit") {
    try {
      const result = await requestJson("/api/checkins");
      const checkin = result.checkins.find((item) => item.checkinId === checkinId);
      if (checkin) openForm(checkin);
    } catch (error) {
      showMessage(checkinMessage, error.message || "The check-in could not be opened.");
    }
    return;
  }
  if (button.dataset.action === "cancel"
    && !window.confirm("Cancel this check-in? It will no longer be marked overdue.")) return;
  button.disabled = true;
  try {
    await requestJson("/api/checkins/" + encodeURIComponent(checkinId), {
      method: "POST", body: { action: button.dataset.action },
    });
    await loadCheckins();
  } catch (error) {
    showMessage(checkinMessage, error.message || "That check-in could not be updated.");
  } finally {
    button.disabled = false;
  }
}

async function loadDailyCheckin() {
  const result = await requestJson("/api/daily-checkin");
  dailySettings = result.dailyCheckin;
  updateDailyOverview();
  if (!dailySettings) return;
  document.querySelector("#daily-checkin-enabled").checked = dailySettings.enabled;
  document.querySelector("#daily-checkin-time").value = dailySettings.localTime;
  document.querySelector("#daily-checkin-timezone").value = dailySettings.timeZone;
  document.querySelector("#daily-checkin-grace").value = String(dailySettings.graceMinutes);
  document.querySelector("#daily-checkin-reminder").checked = dailySettings.reminderEnabled;
  const recipientIds = new Set(dailySettings.recipientUserIds);
  dailyRecipientOptions.querySelectorAll('input[name="dailyRecipientUserIds"]').forEach((checkbox) => {
    checkbox.checked = recipientIds.has(checkbox.value);
  });
}

function openDailyForm() {
  dailyForm.reset();
  dailyEnabled.checked = Boolean(dailySettings?.enabled);
  document.querySelector("#daily-checkin-time").value = dailySettings?.localTime || "20:00";
  document.querySelector("#daily-checkin-timezone").value = dailySettings?.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  document.querySelector("#daily-checkin-grace").value = String(dailySettings?.graceMinutes ?? 10);
  document.querySelector("#daily-checkin-reminder").checked = dailySettings?.reminderEnabled ?? true;
  const recipientIds = new Set(dailySettings?.recipientUserIds || []);
  dailyRecipientOptions.querySelectorAll('input[name="dailyRecipientUserIds"]').forEach((checkbox) => {
    checkbox.checked = recipientIds.has(checkbox.value);
  });
  showMessage(dailyMessage, "");
  dailyForm.hidden = false;
  document.querySelector("#daily-checkin-time").focus();
}

function closeDailyForm() {
  dailyForm.hidden = true;
  showMessage(dailyMessage, "");
}

async function saveDailyCheckin(event) {
  event.preventDefault();
  const enabled = dailyEnabled.checked;
  const selected = [...dailyRecipientOptions.querySelectorAll('input[name="dailyRecipientUserIds"]:checked')]
    .map((checkbox) => checkbox.value);
  if (enabled && selected.length === 0) {
    showMessage(dailyMessage, "Choose at least one opted-in trusted member before turning on the daily plan.");
    return;
  }
  const save = document.querySelector("#save-daily-checkin");
  save.disabled = true;
  showMessage(dailyMessage, enabled ? "Saving your daily plan…" : "Pausing daily check-ins…", "pending");
  try {
    const result = await requestJson("/api/daily-checkin", {
      method: "POST",
      body: {
        enabled,
        localTime: document.querySelector("#daily-checkin-time").value,
        timeZone: document.querySelector("#daily-checkin-timezone").value.trim(),
        graceMinutes: Number(document.querySelector("#daily-checkin-grace").value),
        reminderEnabled: document.querySelector("#daily-checkin-reminder").checked,
        recipientUserIds: enabled ? selected : [],
      },
    });
    dailySettings = result.dailyCheckin;
    await loadCheckins();
    updateDailyOverview();
    closeDailyForm();
    showMessage(checkinMessage, enabled ? "Daily check-in is on." : "Daily check-ins are paused.", "success");
  } catch (error) {
    showMessage(dailyMessage, error.message || "The daily schedule could not be saved.");
  } finally {
    save.disabled = false;
  }
}

function localDateAt(instant, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instant)).filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function updateDailyOverview() {
  if (!dailyStatus || !dailySummary) return;
  if (!dailySettings) {
    dailyStatus.textContent = "Not set up";
    dailyStatus.dataset.status = "pending";
    dailySummary.textContent = "Choose a time and time zone. KinGuardian will create one check-in for each day while this plan is active.";
    if (homeDailyStatus) homeDailyStatus.textContent = "Set one gentle daily check-in in your time zone.";
    return;
  }
  if (!dailySettings.enabled) {
    dailyStatus.textContent = "Paused";
    dailyStatus.dataset.status = "cancelled";
    dailySummary.textContent = "Your daily plan is paused. Existing check-ins stay in your history.";
    if (homeDailyStatus) homeDailyStatus.textContent = "Your daily check-in is paused.";
    return;
  }

  dailyStatus.textContent = "On";
  dailyStatus.dataset.status = "safe";
  const next = new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: dailySettings.timeZone,
  }).format(dailySettings.nextCheckinAt);
  dailySummary.textContent = "Daily at " + dailySettings.localTime + " · " + dailySettings.timeZone
    + " · Next check-in: " + next + " · " + dailySettings.graceMinutes + " minute grace period.";
  let todaysStatus = "";
  try {
    const today = localDateAt(Date.now(), dailySettings.timeZone);
    const todaysCheckin = latestCheckins.find((item) => item.isDaily && item.localDate === today);
    if (todaysCheckin?.status === "safe") todaysStatus = "Today's check-in is complete.";
    else if (todaysCheckin?.status === "overdue") todaysStatus = "Today's check-in is marked missed. Contact delivery is not confirmed.";
    else if (todaysCheckin?.status === "pending") todaysStatus = "Today's check-in is scheduled. Mark it safe from the check-in list.";
    else todaysStatus = "Today's check-in will be created at " + dailySettings.localTime + ".";
  } catch {
    todaysStatus = "Your next daily check-in is at " + dailySettings.localTime + " (" + dailySettings.timeZone + ").";
  }
  if (homeDailyStatus) homeDailyStatus.textContent = todaysStatus;
}
