import {
  appendNetworkEvent,
  getNetworkSnapshot,
  isNetworkEvent,
  MAX_NETWORK_EVENTS,
  networkStateLabel,
} from "./network-state.js";

const stateElement = document.querySelector("#network-state");
const explanation = document.querySelector("#network-explanation");
const toggle = document.querySelector("#network-monitor-enabled");
const clearButton = document.querySelector("#clear-network-history");
const storageNote = document.querySelector("#network-storage-note");
const historyList = document.querySelector("#network-history");
const emptyMessage = document.querySelector("#network-history-empty");

if (stateElement && toggle && clearButton && historyList && emptyMessage) {
  const connectionInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  let userId;
  let historyKey;
  let preferenceKey;
  let history = [];

  updateStatus();
  void initialize();

  window.addEventListener("online", handleConnectionChange);
  window.addEventListener("offline", handleConnectionChange);
  connectionInfo?.addEventListener?.("change", handleConnectionChange);
  toggle.addEventListener("change", handlePreferenceChange);
  clearButton.addEventListener("click", clearHistory);

  async function initialize() {
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.user?.userId !== "string") throw new Error("Sign-in is required.");
      userId = data.user.userId;
      historyKey = `kinguardian.network-history.v1.${userId}`;
      preferenceKey = `kinguardian.network-recording.v1.${userId}`;
      history = readHistory();
      toggle.checked = localStorage.getItem(preferenceKey) === "true";
      toggle.disabled = false;
      clearButton.disabled = history.length === 0;
      renderHistory();
      updateStorageNote();
      if (toggle.checked) recordCurrentState();
      updateStatus();
    } catch {
      toggle.checked = false;
      toggle.disabled = true;
      clearButton.disabled = true;
      storageNote.textContent = "Sign in and enable browser storage to keep a private connection history on this device.";
    }
  }

  function readHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter(isNetworkEvent).slice(0, MAX_NETWORK_EVENTS) : [];
    } catch {
      return [];
    }
  }

  function currentSnapshot() {
    return getNetworkSnapshot(navigator.onLine, connectionInfo);
  }

  function updateStatus() {
    const snapshot = currentSnapshot();
    stateElement.dataset.state = snapshot.state;
    stateElement.textContent = networkStateLabel(snapshot);
    explanation.textContent = describeAvailability(snapshot);
  }

  function describeAvailability(snapshot) {
    const details = [];
    if (snapshot.effectiveType) details.push(`${snapshot.effectiveType} connection estimate`);
    if (snapshot.downlinkMbps !== null) details.push(`about ${snapshot.downlinkMbps.toFixed(1)} Mbps`);
    if (snapshot.rttMs !== null) details.push(`about ${Math.round(snapshot.rttMs)} ms round trip`);
    const estimate = details.length ? ` Available browser estimate: ${details.join(", ")}.` : " This browser does not provide a connection estimate.";
    return `This is the browser's own online/offline signal, not a verified internet test. Browsers cannot reliably read cellular signal strength.${estimate} Location is never requested or saved by this feature.`;
  }

  function handleConnectionChange() {
    updateStatus();
    if (toggle.checked && userId) recordCurrentState();
  }

  function handlePreferenceChange() {
    if (!userId) {
      toggle.checked = false;
      return;
    }
    try {
      if (toggle.checked) {
        localStorage.setItem(preferenceKey, "true");
        recordCurrentState();
      } else {
        localStorage.removeItem(preferenceKey);
      }
      updateStorageNote();
    } catch {
      toggle.checked = false;
      toggle.disabled = true;
      storageNote.textContent = "This browser could not save your choice. Connection history recording is off.";
    }
  }

  function recordCurrentState() {
    const result = appendNetworkEvent(history, currentSnapshot());
    if (!result.added) return;
    try {
      localStorage.setItem(historyKey, JSON.stringify(result.events));
      history = result.events;
      renderHistory();
    } catch {
      toggle.checked = false;
      toggle.disabled = true;
      try { localStorage.removeItem(preferenceKey); } catch { /* storage is unavailable */ }
      storageNote.textContent = "This browser could not save the connection history. Recording has been turned off.";
    }
  }

  function renderHistory() {
    historyList.replaceChildren();
    for (const event of history) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const time = document.createElement("time");
      const date = new Date(event.occurredAt);
      label.textContent = networkStateLabel(event);
      time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat(navigator.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
      item.append(label, time);
      historyList.append(item);
    }
    emptyMessage.hidden = history.length > 0;
    clearButton.disabled = history.length === 0;
  }

  function updateStorageNote() {
    storageNote.textContent = toggle.checked
      ? "Recording is on. Up to 20 status changes are stored in this browser for this account; they are not sent to KinGuardian's server."
      : "Recording is off. Saved history stays here until you clear it; new changes are not saved.";
  }

  function clearHistory() {
    if (!userId || history.length === 0) return;
    if (!window.confirm("Clear the connection history saved in this browser?")) return;
    try {
      localStorage.removeItem(historyKey);
      history = [];
      renderHistory();
      updateStorageNote();
    } catch {
      storageNote.textContent = "This browser could not clear the saved connection history.";
    }
  }
}
