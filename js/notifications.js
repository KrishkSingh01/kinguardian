import { requestJson, showMessage } from "./auth-client.js";

const message = document.querySelector("#notification-message");
const preferencesFieldset = document.querySelector("#notification-preferences");
const enableButton = document.querySelector("#enable-push");
const removeButton = document.querySelector("#remove-push");
const testButton = document.querySelector("#test-push");
const eventList = document.querySelector("#notification-events");
const labels = {
  sos: "SOS alert",
  invitation: "Trusted-circle invitation",
  checkin_reminder: "Check-in reminder",
  missed_checkin: "Missed check-in",
  acknowledgement: "Alert acknowledgement",
  account_security: "Account security",
  test: "Test notification",
};
const statusLabels = {
  prepared: "Queued",
  attempted: "Attempted",
  provider_accepted: "Accepted by push service",
  delivery_confirmed: "Delivery confirmed",
  failed: "Failed",
  unknown: "Unknown",
};

let settings = null;
let savedPreferences = null;

if (message && preferencesFieldset) {
  document.querySelectorAll("[data-preference]").forEach((input) => {
    input.addEventListener("change", savePreferences);
  });
  enableButton.addEventListener("click", enableNotifications);
  removeButton.addEventListener("click", removeNotifications);
  testButton.addEventListener("click", queueTest);
  void loadNotifications();
}

async function loadNotifications() {
  try {
    await requestJson("/api/auth/me");
    settings = await requestJson("/api/notifications");
    savedPreferences = { ...settings.preferences };
    for (const [key, value] of Object.entries(settings.preferences)) {
      const input = document.querySelector(`[data-preference="${key}"]`);
      if (input) input.checked = Boolean(value);
    }
    preferencesFieldset.disabled = false;
    const supported = isPushSupported();
    enableButton.disabled = !supported || !settings.pushAvailable || settings.activeDeviceCount >= settings.deviceLimit;
    testButton.disabled = !supported || !settings.pushAvailable || settings.activeDeviceCount === 0;
    const subscription = supported ? await (await navigator.serviceWorker.ready).pushManager.getSubscription() : null;
    removeButton.hidden = !subscription;
    if (!settings.pushAvailable) {
      showMessage(message, "Push notifications are not configured yet. Your category choices can be saved now.");
    } else if (!supported) {
      showMessage(message, "This browser or device does not support Web Push here. You can still manage your alert preferences.");
    } else if (Notification.permission === "denied") {
      showMessage(message, "Notifications are blocked in this browser. Change its site permission first, then try again.");
    } else if (subscription) {
      showMessage(message, `Notifications are enabled on this device. ${settings.activeDeviceCount} of ${settings.deviceLimit} device slots are in use.`);
    } else if (settings.activeDeviceCount >= settings.deviceLimit) {
      showMessage(message, "The five-device limit is full. Remove an old device before adding this one.");
    } else {
      showMessage(message, "No browser permission has been requested. Choose “Enable on this device” when you are ready.");
    }
    await loadEvents();
  } catch (error) {
    if (error.status === 401 || error.status === 403) return;
    preferencesFieldset.disabled = true;
    enableButton.disabled = true;
    testButton.disabled = true;
    showMessage(message, error.message || "Notification settings could not be loaded.");
  }
}

function isPushSupported() {
  return Boolean(globalThis.isSecureContext && "Notification" in globalThis
    && "serviceWorker" in navigator && "PushManager" in globalThis);
}

async function savePreferences() {
  const inputs = [...document.querySelectorAll("[data-preference]")];
  const next = Object.fromEntries(inputs.map((input) => [input.dataset.preference, input.checked]));
  preferencesFieldset.disabled = true;
  try {
    await requestJson("/api/notifications/preferences", { method: "POST", body: next });
    savedPreferences = next;
    showMessage(message, "Your notification choices are saved.");
  } catch (error) {
    for (const input of inputs) input.checked = Boolean(savedPreferences?.[input.dataset.preference]);
    showMessage(message, error.message || "Your notification choices could not be saved.");
  } finally {
    preferencesFieldset.disabled = false;
  }
}

async function enableNotifications() {
  if (!settings?.pushAvailable || !isPushSupported()) return;
  enableButton.disabled = true;
  showMessage(message, "Waiting for your browser’s notification permission…", "pending");
  try {
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showMessage(message, permission === "denied"
        ? "Permission was blocked. Change this site’s browser permission before enabling notifications."
        : "Permission was not granted. No device was added.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(settings.vapidPublicKey),
      });
    }
    await requestJson("/api/notifications/subscriptions", {
      method: "POST", body: subscription.toJSON(),
    });
    await loadNotifications();
    showMessage(message, "Notifications are enabled for this device. Delivery still depends on the browser and push service.", "success");
  } catch (error) {
    try {
      const registration = await navigator.serviceWorker.ready;
      removeButton.hidden = !(await registration.pushManager.getSubscription());
    } catch { /* Keep the control hidden when this browser has no subscription. */ }
    showMessage(message, error.message || "This device could not be added. Check browser support and try again.");
  } finally {
    if (settings?.pushAvailable && isPushSupported()) enableButton.disabled = false;
  }
}

async function removeNotifications() {
  removeButton.disabled = true;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await requestJson("/api/notifications/subscriptions", {
        method: "DELETE", body: { endpoint: subscription.endpoint },
      });
      await subscription.unsubscribe();
    }
    await loadNotifications();
    showMessage(message, "This device has been removed from push notifications.", "success");
  } catch (error) {
    showMessage(message, error.message || "This device could not be removed.");
  } finally {
    removeButton.disabled = false;
  }
}

async function queueTest() {
  testButton.disabled = true;
  try {
    const result = await requestJson("/api/notifications/test", { method: "POST", body: {} });
    showMessage(message, result.message, "success");
    await loadEvents();
  } catch (error) {
    showMessage(message, error.message || "The test notification could not be queued.");
  } finally {
    testButton.disabled = !settings?.pushAvailable || settings.activeDeviceCount === 0;
  }
}

async function loadEvents() {
  const { events } = await requestJson("/api/notifications/events");
  eventList.replaceChildren(...events.map(renderEvent));
}

function renderEvent(event) {
  const item = document.createElement("li");
  item.className = "notification-event";
  const name = document.createElement("span");
  name.textContent = labels[event.category] || "Notification";
  const detail = document.createElement("span");
  const time = document.createElement("time");
  time.dateTime = new Date(event.createdAt).toISOString();
  time.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(event.createdAt);
  const status = document.createElement("span");
  status.className = "notification-event-status";
  status.textContent = statusLabels[event.status] || "Status unavailable";
  detail.append(time, status);
  item.append(name, detail);
  return item;
}

function decodeVapidKey(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
