import { requestJson, showMessage } from "./auth-client.js";
import { cacheOfflineProfile, deleteOfflineRecord, getOfflineProfile, getOfflineRecord, listOfflineRecords, putOfflineRecord } from "./offline-store.js";

const panel = document.querySelector(".journey-panel");
if (panel) {
  const form = document.querySelector("#journey-start-form");
  const duration = document.querySelector("#journey-duration");
  const customWrap = document.querySelector("#journey-custom-duration");
  const customMinutes = document.querySelector("#journey-custom-minutes");
  const recipientList = document.querySelector("#journey-recipient-list");
  const recipientEmpty = document.querySelector("#journey-recipient-empty");
  const startButton = document.querySelector("#start-journey");
  const activePanel = document.querySelector("#journey-active");
  const timerText = document.querySelector("#journey-countdown");
  const returnText = document.querySelector("#journey-return-time");
  const trustedCopy = document.querySelector("#journey-recipient-copy");
  const statusLabel = document.querySelector("#journey-status-label");
  const passwordForm = document.querySelector("#journey-password-form");
  const passwordInput = document.querySelector("#journey-password");
  const actionButton = document.querySelector("#confirm-journey-action");
  const message = document.querySelector("#journey-message");
  const historyList = document.querySelector("#journey-history");
  const historyEmpty = document.querySelector("#journey-history-empty");
  const homeStatus = document.querySelector("#home-journey-status");
  const homeCountdown = document.querySelector("#home-journey-countdown");
  let currentJourney = null;
  let actionMode = "complete";
  let currentUser = null;
  let connectionCache = [];
  let tickTimer;
  let synced = false;

  duration.addEventListener("change", () => { customWrap.hidden = duration.value !== "custom"; });
  form.addEventListener("submit", startJourney);
  document.querySelector("#complete-journey").addEventListener("click", () => openPasswordForm("complete"));
  document.querySelector("#extend-journey").addEventListener("click", () => openPasswordForm("extend"));
  document.querySelector("#cancel-journey-action").addEventListener("click", () => { passwordForm.hidden = true; passwordInput.value = ""; });
  passwordForm.addEventListener("submit", submitPasswordAction);
  window.addEventListener("kg:session", (event) => { currentUser = event.detail; void initializeOnline(); });
  window.addEventListener("kg:offline", () => { void initializeOffline(); });
  window.addEventListener("online", () => { if (currentUser) void initializeOnline(); });

  async function initializeOnline() {
    if (!currentUser?.userId || synced) return;
    synced = true;
    cacheOfflineProfile(currentUser);
    panel.hidden = false;
    const historyPanel = document.querySelector(".journey-history-panel");
    if (historyPanel) historyPanel.hidden = false;
    try {
      const [connectionsResult, journeysResult] = await Promise.all([
        requestJson("/api/connections"),
        requestJson("/api/journeys"),
      ]);
      connectionCache = connectionsResult.connections || [];
      await putOfflineRecord(currentUser.userId, "connections", connectionCache).catch(() => undefined);
      await renderRecipients(connectionCache);
      await synchronizePendingJourneys();
      await renderJourneys(journeysResult.journeys || []);
      const { journeys } = await requestJson("/api/journeys");
      await renderJourneys(journeys || []);
      showMessage(message, "Your Safe Journey timer is ready.", "success");
    } catch (error) {
      showMessage(message, error.message || "Safe Journey could not load. Reconnect and try again.");
      synced = false;
    }
  }

  async function initializeOffline() {
    currentUser = getOfflineProfile();
    if (!currentUser) {
      showMessage(message, "This device has no saved KinGuardian profile yet. Reconnect and sign in once to set up offline safety mode.");
      return;
    }
    panel.hidden = false;
    document.querySelector(".journey-history-panel").hidden = true;
    showMessage(message, "Offline mode. Journey changes stay on this device until you reconnect and sign in.", "pending");
    connectionCache = await getOfflineRecord(currentUser.userId, "connections") || [];
    await renderRecipients(connectionCache);
    const local = await getOfflineRecord(currentUser.userId, "journey:active");
    const pending = await getOfflineRecord(currentUser.userId, "journey:pending");
    currentJourney = local || pending;
    if (currentJourney) renderActive(currentJourney);
    else showActive(false);
  }

  async function renderRecipients(connections) {
    recipientList.replaceChildren();
    const eligible = connections.filter((connection) => connection.receiveSafeJourneys === true);
    recipientEmpty.hidden = eligible.length > 0;
    for (const connection of eligible) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "journey-recipient";
      checkbox.value = connection.userId;
      const copy = document.createElement("span");
      copy.textContent = connection.username;
      label.append(checkbox, copy);
      recipientList.append(label);
    }
  }

  async function startJourney(event) {
    event.preventDefault();
    const durationMinutes = duration.value === "custom" ? Number(customMinutes.value) : Number(duration.value);
    const recipientUserIds = [...recipientList.querySelectorAll('input[name="journey-recipient"]:checked')].map((input) => input.value);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
      showMessage(message, "Choose a time between 15 minutes and 24 hours.");
      return;
    }
    if (!recipientUserIds.length) {
      showMessage(message, "Choose at least one trusted person who allows Safe Journey alerts.");
      return;
    }
    const user = currentUser || getOfflineProfile();
    if (!user?.userId) {
      showMessage(message, "Reconnect and sign in once before starting a Safe Journey.");
      return;
    }
    startButton.disabled = true;
    const now = Date.now();
    const pending = {
      journeyId: null,
      clientJourneyId: crypto.randomUUID(),
      userId: user.userId,
      username: user.username,
      startedAt: now,
      expectedReturnAt: now + durationMinutes * 60_000,
      durationMinutes,
      recipientUserIds,
      recipientNames: connectionCache.filter((connection) => recipientUserIds.includes(connection.userId)).map((connection) => connection.username),
      status: "local_pending",
      completionAttemptAt: null,
      isOwner: true,
    };
    if (!navigator.onLine || !currentUser) {
      try {
        await saveActive(pending, "journey:pending");
        currentJourney = pending;
        renderActive(currentJourney);
        showMessage(message, "Journey timer saved on this device. Trusted people have not been notified; reconnect and sign in to share it.", "pending");
      } catch (error) {
        showMessage(message, error.message || "This browser could not safely save a local journey.");
      } finally { startButton.disabled = false; }
      return;
    }
    try {
      const result = await requestJson("/api/journeys", {
        method: "POST",
        body: { clientJourneyId: pending.clientJourneyId, durationMinutes, recipientUserIds },
      });
      currentJourney = result.journey;
      currentJourney.recipientNames = pending.recipientNames;
      await saveActive(currentJourney, "journey:active");
      renderActive(currentJourney);
      showMessage(message, result.message, "success");
      void refreshJourneys();
    } catch (error) {
      showMessage(message, error.message || "The journey could not be started. Check your connection and try again.");
    } finally { startButton.disabled = false; }
  }

  async function saveActive(journey, key) {
    await putOfflineRecord(journey.userId, key, journey);
  }

  function renderActive(journey) {
    currentJourney = journey;
    showActive(true);
    form.hidden = true;
    statusLabel.textContent = journey.status === "overdue" || journey.status === "offline_overdue" ? "RETURN TIMER PASSED" : "JOURNEY IN PROGRESS";
    returnText.textContent = `Expected return: ${formatTime(journey.expectedReturnAt)}`;
    trustedCopy.textContent = journey.status === "local_pending"
      ? "Not shared yet. Reconnect and sign in to notify your trusted people."
      : `Timer shared with ${(journey.recipientNames || []).join(", ") || "your selected trusted people"}.`;
    tick();
    clearInterval(tickTimer);
    tickTimer = window.setInterval(tick, 1000);
    homeStatus.textContent = journey.status === "overdue" || journey.status === "offline_overdue" ? "Return time passed" : "Safe Journey active";
    homeCountdown.textContent = `Expected back ${formatTime(journey.expectedReturnAt)}.`;
  }

  function tick() {
    if (!currentJourney) return;
    const remaining = Math.max(0, Math.ceil((currentJourney.expectedReturnAt - Date.now()) / 1000));
    timerText.textContent = formatDuration(remaining);
    if (!remaining) {
      statusLabel.textContent = "RETURN TIMER PASSED";
      if (currentJourney.status === "active") currentJourney.status = "overdue";
      if (currentJourney.status === "local_pending") currentJourney.status = "offline_overdue";
      void saveActive(currentJourney, currentJourney.journeyId ? "journey:active" : "journey:pending").catch(() => undefined);
      homeStatus.textContent = "Return time passed";
      homeCountdown.textContent = "If you are safe, reconnect and confirm your return.";
      if (navigator.onLine && currentUser) void refreshJourneys();
    }
  }

  function showActive(active) {
    activePanel.hidden = !active;
    form.hidden = active;
    if (!active) {
      currentJourney = null;
      clearInterval(tickTimer);
      homeStatus.textContent = "No active journey.";
      homeCountdown.textContent = "Start a timer and choose trusted people to see it.";
    }
  }

  function openPasswordForm(operation) {
    if (!currentJourney) return;
    actionMode = operation;
    passwordForm.hidden = false;
    actionButton.textContent = operation === "extend" ? "Verify and extend" : "Verify and stop journey";
    if (!navigator.onLine || !currentUser) {
      showMessage(message, operation === "complete"
        ? "You’re offline. Save that you are back; your password must be checked after you reconnect. A timer that expires before then may alert trusted people."
        : "Reconnect before extending. Your password must be checked by KinGuardian.", "pending");
    }
    passwordInput.focus();
  }

  async function submitPasswordAction(event) {
    event.preventDefault();
    if (!currentJourney) return;
    const password = passwordInput.value;
    if (!navigator.onLine || !currentUser) {
      if (actionMode !== "complete") {
        showMessage(message, "You must be online to extend a journey.");
        return;
      }
      currentJourney.completionAttemptAt = Date.now();
      currentJourney.status = "completion_pending";
      await saveActive(currentJourney, currentJourney.journeyId ? "journey:active" : "journey:pending");
      passwordInput.value = "";
      passwordForm.hidden = true;
      showMessage(message, "Your return time was saved on this device. Your password was not checked, and trusted people have not been told you are back. Reconnect and sign in to finish.", "pending");
      return;
    }
    if (!currentJourney.journeyId) {
      showMessage(message, "This journey is saved on this device. It must be synchronized before it can be confirmed.", "pending");
      return;
    }
    actionButton.disabled = true;
    try {
      const body = actionMode === "extend"
        ? { operation: "extend", extendMinutes: 30, password }
        : { operation: "complete", attemptedAt: currentJourney.completionAttemptAt || Date.now(), password };
      const result = await requestJson(`/api/journeys/${encodeURIComponent(currentJourney.journeyId)}`, { method: "POST", body });
      passwordInput.value = "";
      passwordForm.hidden = true;
      if (actionMode === "extend") {
        currentJourney.expectedReturnAt = result.expectedReturnAt;
        currentJourney.status = "active";
        await saveActive(currentJourney, "journey:active");
        renderActive(currentJourney);
      } else {
        await Promise.all([
          deleteOfflineRecord(currentUser.userId, "journey:active"),
          deleteOfflineRecord(currentUser.userId, "journey:pending"),
        ]);
        currentJourney = null;
        showActive(false);
        showMessage(message, result.message, "success");
        await refreshJourneys();
      }
    } catch (error) {
      showMessage(message, error.message || "KinGuardian could not verify that action.");
      passwordInput.select();
    } finally { actionButton.disabled = false; }
  }

  async function synchronizePendingJourneys() {
    const pending = await getOfflineRecord(currentUser.userId, "journey:pending");
    if (!pending) return;
    const body = {
      clientJourneyId: pending.clientJourneyId,
      durationMinutes: pending.durationMinutes,
      recipientUserIds: pending.recipientUserIds,
      startedAt: pending.startedAt,
    };
    const result = await requestJson("/api/journeys", { method: "POST", body });
    const journey = { ...result.journey, recipientNames: pending.recipientNames, completionAttemptAt: pending.completionAttemptAt };
    if (pending.completionAttemptAt) {
      journey.status = result.journey.status;
      await saveActive(journey, "journey:active");
      await deleteOfflineRecord(currentUser.userId, "journey:pending");
      currentJourney = journey;
      renderActive(journey);
      openPasswordForm("complete");
      showMessage(message, "Your saved return time is ready. Enter your password to confirm it with KinGuardian.", "pending");
    } else {
      await saveActive(journey, "journey:active");
      await deleteOfflineRecord(currentUser.userId, "journey:pending");
    }
  }

  async function refreshJourneys() {
    const result = await requestJson("/api/journeys");
    await renderJourneys(result.journeys || []);
  }

  async function renderJourneys(journeys) {
    const localActive = await getOfflineRecord(currentUser.userId, "journey:active");
    const open = journeys.find((journey) => journey.isOwner && ["active", "overdue"].includes(journey.status));
    const active = open || localActive;
    if (active) {
      const priorNames = localActive?.journeyId === active.journeyId ? localActive.recipientNames : [];
      currentJourney = { ...active, recipientNames: active.recipientNames?.length ? active.recipientNames : priorNames };
      await saveActive(currentJourney, "journey:active");
      renderActive(currentJourney);
    } else showActive(false);
    const history = journeys.filter((journey) => journey.isOwner && journey.status === "completed");
    historyList.replaceChildren(...history.map(renderHistoryItem));
    historyEmpty.hidden = history.length > 0;
  }

  function renderHistoryItem(journey) {
    const item = document.createElement("li");
    item.className = "journey-history-item";
    const title = document.createElement("strong");
    title.textContent = journey.completionAttemptedAt > journey.expectedReturnAt ? "Completed after return time" : "Completed";
    const detail = document.createElement("span");
    detail.textContent = `Started ${formatTime(journey.startedAt)} · expected ${formatTime(journey.expectedReturnAt)} · completed ${formatTime(journey.completedAt)}`;
    item.append(title, detail);
    return item;
  }

  async function loadOfflineHistory() {
    if (!currentUser) return;
    const records = await listOfflineRecords(currentUser.userId, "journey:");
    const local = records.find((record) => record.recordId === "journey:active" || record.recordId === "journey:pending");
    if (local) renderActive(local.value);
  }

  function formatTime(time) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time);
  }
  function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
  }
}
