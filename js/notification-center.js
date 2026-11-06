import { requestJson, showMessage } from "./auth-client.js";
import { cacheOfflineProfile, getOfflineProfile, getOfflineRecord, putOfflineRecord } from "./offline-store.js";

const notificationList = document.querySelector("#notification-center-list");
if (notificationList) {
  const message = document.querySelector("#notification-center-message");
  const empty = document.querySelector("#notification-center-empty");
  const markAll = document.querySelector("#mark-all-notifications");
  const counts = [...document.querySelectorAll("[data-unread-count]")];
  const labels = {
    sos: "SOS alert",
    invitation: "Trusted person request",
    journey_started: "Safe Journey started",
    journey_extended: "Safe Journey extended",
    journey_completed: "Safe Journey completed",
    journey_overdue: "Safe Journey return time passed",
    acknowledgement: "SOS acknowledgement",
    account_security: "Account security update",
    test: "Test notification",
  };
  const statuses = {
    prepared: "Waiting to try a browser alert",
    attempted: "Trying a browser alert",
    provider_accepted: "Browser alert service accepted the request",
    delivery_confirmed: "Confirmed",
    failed: "Browser alert was not sent",
    unknown: "Browser alert status is unknown",
  };
  let lastUnread = 0;
  let pollTimer;
  let signedIn = false;
  let currentUser = null;

  markAll.addEventListener("click", markEverythingRead);
  notificationList.addEventListener("click", handleNotificationClick);
  window.addEventListener("kg:session", (event) => {
    signedIn = true;
    currentUser = event.detail;
    cacheOfflineProfile(currentUser);
    void refresh();
    schedulePoll();
  });
  window.addEventListener("kg:offline", () => { signedIn = false; currentUser = getOfflineProfile(); clearTimeout(pollTimer); void renderCached(); });
  window.addEventListener("offline", () => { signedIn = false; currentUser = getOfflineProfile(); clearTimeout(pollTimer); void renderCached(); });
  window.addEventListener("online", () => { if (currentUser) { signedIn = true; void refresh(); schedulePoll(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(pollTimer);
    else if (signedIn) { void refresh(); schedulePoll(); }
  });

  async function refresh() {
    if (!signedIn || !navigator.onLine) return;
    try {
      const { events } = await requestJson("/api/notifications/events");
      const rows = events || [];
      render(rows);
      if (currentUser?.userId) await putOfflineRecord(currentUser.userId, "notifications", rows).catch(() => undefined);
    } catch (error) {
      if (error.status === 401) signedIn = false;
      showMessage(message, error.message || "Notifications could not be updated.");
    }
  }

  async function renderCached() {
    markAll.disabled = true;
    const events = currentUser?.userId
      ? await getOfflineRecord(currentUser.userId, "notifications").catch(() => [])
      : [];
    if (events?.length) {
      render(events, true);
      showMessage(message, "Showing saved notifications from this device. They may be out of date; actions need internet.", "pending");
    } else {
      render([]);
      showMessage(message, "No saved notification list is available on this device. Reconnect to refresh it.", "pending");
    }
  }

  function render(events, readOnly = false) {
    const unread = events.filter((event) => !event.readAt).length;
    counts.forEach((counter) => {
      counter.textContent = unread > 99 ? "99+" : String(unread);
      counter.hidden = unread === 0;
      counter.closest("button")?.classList.toggle("has-unread", unread > 0);
    });
    if (unread > lastUnread) {
      for (const counter of counts) counter.closest("button")?.classList.add("notification-pulse");
      window.setTimeout(() => counts.forEach((counter) => counter.closest("button")?.classList.remove("notification-pulse")), 950);
    }
    lastUnread = unread;
    markAll.disabled = readOnly || !navigator.onLine || unread === 0;
    empty.hidden = events.length > 0;
    notificationList.replaceChildren(...events.map((item) => renderItem(item, readOnly)));
  }

  function renderItem(item, readOnly) {
    const row = document.createElement("li");
    row.className = `notification-card${item.readAt ? " is-read" : " is-unread"}`;
    row.dataset.eventId = item.eventId;
    row.dataset.category = item.category;
    const heading = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = labels[item.category] || "KinGuardian update";
    const detail = document.createElement("p");
    detail.textContent = notificationText(item);
    const time = document.createElement("time");
    time.dateTime = new Date(item.createdAt).toISOString();
    time.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt);
    const delivery = document.createElement("small");
    delivery.textContent = statuses[item.status] || "Status unavailable";
    const controls = document.createElement("div");
    controls.className = "notification-card-actions";
    if (!item.readAt) {
      const readButton = document.createElement("button");
      readButton.type = "button";
      readButton.className = "button button-outline";
      readButton.dataset.markRead = item.eventId;
      readButton.textContent = "Mark as read";
      readButton.disabled = readOnly;
      controls.append(readButton);
    }
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "text-link";
    openButton.dataset.openNotification = item.category;
    openButton.textContent = item.category === "sos" ? "Open SOS" : item.category.startsWith("journey_") ? "Open Safe Journey" : item.category === "invitation" ? "Open Trusted People" : "Open update";
    controls.append(openButton);
    heading.append(title, detail, time, delivery);
    row.append(heading, controls);
    return row;
  }

  function notificationText(item) {
    if (item.category === "sos") return item.relatedUsername ? `${item.relatedUsername} needs assistance.` : "A trusted person needs assistance.";
    if (item.category === "journey_overdue") return item.relatedUsername ? `${item.relatedUsername} may be late. Please check whether they are safe.` : "A trusted person’s return timer has passed. Please check whether they are safe.";
    if (item.category === "journey_started") return `${item.relatedUsername || "A trusted person"} started a Safe Journey.`;
    if (item.category === "journey_extended") return `${item.relatedUsername || "A trusted person"} extended a Safe Journey.`;
    if (item.category === "journey_completed") return `${item.relatedUsername || "A trusted person"} completed a Safe Journey.`;
    if (item.category === "invitation") return "A trusted-person request or connection update needs your attention.";
    if (item.category === "account_security") return "There is an update about your account.";
    if (item.category === "acknowledgement") return "A trusted person has acknowledged an SOS alert.";
    return "Your KinGuardian test notification arrived.";
  }

  async function handleNotificationClick(event) {
    const readButton = event.target.closest("[data-mark-read]");
    if (readButton) {
      readButton.disabled = true;
      try {
        await requestJson("/api/notifications/read", { method: "POST", body: { notificationIds: [readButton.dataset.markRead] } });
        await refresh();
      } catch (error) { showMessage(message, error.message || "This notification could not be marked as read."); readButton.disabled = false; }
      return;
    }
    const openButton = event.target.closest("[data-open-notification]");
    if (!openButton) return;
    const category = openButton.dataset.openNotification;
    if (category === "sos") location.assign("sos.html");
    else if (category === "invitation") { document.querySelector('[data-nav="circle"]')?.click(); }
    else if (category.startsWith("journey_")) { document.querySelector('[data-nav="journey"]')?.click(); }
  }

  async function markEverythingRead() {
    markAll.disabled = true;
    try {
      await requestJson("/api/notifications/read", { method: "POST", body: { markAll: true } });
      showMessage(message, "All notifications are marked as read.", "success");
      await refresh();
    } catch (error) { showMessage(message, error.message || "Notifications could not be updated."); markAll.disabled = false; }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (signedIn && !document.hidden) pollTimer = window.setTimeout(async () => { await refresh(); schedulePoll(); }, 15_000);
  }
}
