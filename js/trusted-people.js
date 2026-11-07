import { requestJson, showMessage } from "./auth-client.js";
import { cacheOfflineProfile, getOfflineProfile, getOfflineRecord, putOfflineRecord } from "./offline-store.js";

const connectionList = document.querySelector("#connection-list");
const requestList = document.querySelector("#invitation-list");
const sentRequestList = document.querySelector("#sent-request-list");
const recentRepliesList = document.querySelector("#recent-replies-list");
const form = document.querySelector("#username-search-form");
if (connectionList && form) {
  const message = document.querySelector("#circle-message");
  const connectionEmpty = document.querySelector("#connection-empty");
  const incomingEmpty = document.querySelector("#incoming-requests-empty");
  const sentEmpty = document.querySelector("#sent-requests-empty");
  const repliesEmpty = document.querySelector("#recent-replies-empty");
  const result = document.querySelector("#username-search-result");
  let currentUser = null;
  let connectionLoad = null;
  let refreshTimer;

  form.addEventListener("submit", searchUsername);
  document.querySelector("#refresh-invitations")?.addEventListener("click", () => void loadConnections());
  connectionList.addEventListener("change", updatePreference);
  connectionList.addEventListener("click", removeConnection);
  requestList.addEventListener("click", answerRequest);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentUser) void loadConnections();
  });
  window.addEventListener("kg:session", (event) => {
    currentUser = event.detail;
    cacheOfflineProfile(currentUser);
    void loadConnections();
    scheduleRefresh();
  });
  window.addEventListener("kg:offline", () => { currentUser = getOfflineProfile(); stopRefresh(); void loadCachedConnections(); });
  window.addEventListener("offline", () => { currentUser = getOfflineProfile(); stopRefresh(); void loadCachedConnections(); });
  window.addEventListener("online", () => { if (currentUser) { void loadConnections(); scheduleRefresh(); } });

  function scheduleRefresh() {
    stopRefresh();
    if (!currentUser || !navigator.onLine) return;
    refreshTimer = window.setInterval(() => {
      if (!document.hidden) void loadConnections();
    }, 30_000);
  }

  function stopRefresh() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  async function searchUsername(event) {
    event.preventDefault();
    const username = document.querySelector("#trusted-username").value.trim();
    result.replaceChildren();
    showMessage(message, "Looking for that username…", "pending");
    try {
      const found = await requestJson("/api/connections/search", { method: "POST", body: { username } });
      if (!found.found) {
        showMessage(message, "No account with that username is available. Check the spelling.");
        return;
      }
      const copy = document.createElement("p");
      copy.textContent = `Send a trusted-person request to @${found.username}? They must accept before you share safety alerts or location.`;
      const send = document.createElement("button");
      send.type = "button";
      send.className = "button button-dark";
      send.textContent = "Send request";
      send.addEventListener("click", () => void sendRequest(found.username, send));
      result.append(copy, send);
      showMessage(message, "Account found. Check the username before sending.", "success");
    } catch (error) {
      showMessage(message, error.message || "That username could not be checked.");
    }
  }

  async function sendRequest(username, button) {
    button.disabled = true;
    try {
      const response = await requestJson("/api/connections/request", { method: "POST", body: { username } });
      result.replaceChildren();
      document.querySelector("#trusted-username").value = "";
      showMessage(message, response.message, response.requestSent ? "success" : "pending");
      await loadConnections();
    } catch (error) {
      button.disabled = false;
      showMessage(message, error.message || "The request could not be sent.");
    }
  }

  function loadConnections() {
    if (connectionLoad) return connectionLoad;
    if (!navigator.onLine) {
      showMessage(message, "You’re offline. Incoming requests cannot be refreshed or answered until you reconnect.", "pending");
      return loadCachedConnections();
    }
    connectionLoad = (async () => {
      try {
        const data = await requestJson("/api/connections");
      form.querySelectorAll("input, button").forEach((control) => { control.disabled = false; });
      const connections = data.connections || [];
      connectionEmpty.hidden = connections.length > 0;
        const requests = data.requests || [];
        const sentRequests = data.sentRequests || [];
        const recentReplies = data.recentReplies || [];
        connectionList.replaceChildren(...connections.map((connection) => renderConnection(connection)));
        requestList.replaceChildren(...requests.map(renderIncomingRequest));
        if (sentRequestList) sentRequestList.replaceChildren(...sentRequests.map(renderSentRequest));
        if (recentRepliesList) recentRepliesList.replaceChildren(...recentReplies.map(renderRecentReply));
        if (incomingEmpty) incomingEmpty.hidden = requests.length > 0;
        if (sentEmpty) sentEmpty.hidden = sentRequests.length > 0;
        if (repliesEmpty) repliesEmpty.hidden = recentReplies.length > 0;
      if (currentUser) await putOfflineRecord(currentUser.userId, "connections", connections).catch(() => undefined);
        showMessage(message, "Trusted people and requests are up to date.", "success");
      } catch (error) {
        form.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
        requestList.querySelectorAll("button").forEach((control) => { control.disabled = true; });
        showMessage(message, `${error.message || "Trusted people could not be refreshed."} Your current request list is still shown; refresh after reconnecting.`, "error");
      } finally {
        connectionLoad = null;
      }
    })();
    return connectionLoad;
  }

  async function loadCachedConnections() {
    connectionList.replaceChildren();
    form.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
    const saved = currentUser?.userId
      ? await getOfflineRecord(currentUser.userId, "connections").catch(() => [])
      : [];
    const connections = saved || [];
    connectionEmpty.hidden = connections.length > 0;
    for (const connection of connections) connectionList.append(renderConnection(connection, true));
    requestList.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    if (sentRequestList) sentRequestList.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    if (incomingEmpty) { incomingEmpty.hidden = false; incomingEmpty.textContent = "Requests need an internet connection to refresh. Reconnect to see the current list."; }
    showMessage(message, connections.length
      ? "Showing saved trusted people. This list may be out of date; request changes need internet."
      : "No saved trusted-person list is available on this device. Reconnect to refresh it.", "pending");
  }

  function renderConnection(connection, readOnly = false) {
    const row = document.createElement("li");
    row.className = "connection-row";
    row.dataset.connectionId = connection.connectionId;
    const identity = makeIdentity(connection.username, "connection-identity");
    const name = document.createElement("strong");
    name.textContent = `@${connection.username}`;
    const since = document.createElement("small");
    since.textContent = `Connected ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium" }).format(connection.acceptedAt)}`;
    const info = document.createElement("span");
    info.className = "person-info";
    info.append(name, since);
    const badge = document.createElement("span");
    badge.className = "request-status request-status-accepted";
    badge.textContent = "Trusted member";
    identity.append(info, badge);
    const preferences = document.createElement("div");
    preferences.className = "connection-preferences";
    for (const [key, label, value] of [
      ["receiveSos", "Receive SOS alerts", connection.receiveSos],
      ["receiveSafeJourneys", "Allow Safe Journey alerts", connection.receiveSafeJourneys],
      ["receiveLocation", "Allow location updates", connection.receiveLocation],
    ]) {
      const wrapper = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = key;
      checkbox.checked = value;
      checkbox.disabled = readOnly;
      const text = document.createElement("span");
      text.textContent = label;
      wrapper.append(checkbox, text);
      preferences.append(wrapper);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-outline";
    remove.dataset.removeConnection = "true";
    remove.textContent = "Remove";
    remove.disabled = readOnly;
    row.append(identity, preferences, remove);
    return row;
  }

  function renderIncomingRequest(request) {
    const row = document.createElement("li");
    row.className = "invitation-row";
    row.dataset.connectionId = request.connectionId;
    const identity = makeIdentity(request.username, "invitation-identity");
    const info = document.createElement("span");
    info.className = "person-info";
    const text = document.createElement("strong");
    text.textContent = `@${request.username}`;
    const detail = document.createElement("small");
    detail.textContent = "Wants to join your Trusted Circle";
    info.append(text, detail);
    const badge = document.createElement("span");
    badge.className = "request-status request-status-pending";
    badge.textContent = "Needs your answer";
    identity.append(info, badge);
    const accept = makeRequestButton("Accept", "accept");
    const reject = makeRequestButton("Decline", "reject");
    const actions = document.createElement("div");
    actions.className = "request-actions";
    actions.append(accept, reject);
    row.append(identity, actions);
    return row;
  }

  function renderSentRequest(request) {
    const row = document.createElement("li");
    row.className = "invitation-row";
    const identity = makeIdentity(request.username, "invitation-identity");
    const info = document.createElement("span");
    info.className = "person-info";
    const text = document.createElement("strong");
    text.textContent = `@${request.username}`;
    const detail = document.createElement("small");
    detail.textContent = "Waiting for them to accept or decline";
    info.append(text, detail);
    const badge = document.createElement("span");
    badge.className = "request-status request-status-pending";
    badge.textContent = "Pending";
    identity.append(info, badge);
    row.append(identity);
    return row;
  }

  function renderRecentReply(reply) {
    const row = document.createElement("li");
    row.className = "invitation-row invitation-row-status";
    const identity = makeIdentity(reply.username, "invitation-identity");
    const info = document.createElement("span");
    info.className = "person-info";
    const name = document.createElement("strong");
    name.textContent = `@${reply.username}`;
    const detail = document.createElement("small");
    detail.textContent = reply.status === "accepted" ? "Accepted your request" : "Declined your request";
    info.append(name, detail);
    const badge = document.createElement("span");
    badge.className = `request-status request-status-${reply.status}`;
    badge.textContent = reply.status === "accepted" ? "Accepted" : "Declined";
    identity.append(info, badge);
    row.append(identity);
    return row;
  }

  function makeIdentity(username, className) {
    const identity = document.createElement("div");
    identity.className = className;
    const avatar = document.createElement("span");
    avatar.className = "person-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = (username || "?").slice(0, 1).toLocaleUpperCase();
    identity.append(avatar);
    return identity;
  }

  function makeRequestButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-outline";
    button.dataset.answerRequest = action;
    button.textContent = label;
    return button;
  }

  async function answerRequest(event) {
    const button = event.target.closest("[data-answer-request]");
    if (!button) return;
    const row = button.closest("[data-connection-id]");
    const action = button.dataset.answerRequest;
    if (action === "reject" && !window.confirm("Decline this trusted-person request?")) return;
    const rowButtons = row.querySelectorAll("button");
    rowButtons.forEach((control) => { control.disabled = true; });
    try {
      await requestJson(`/api/connections/${encodeURIComponent(row.dataset.connectionId)}`, { method: "POST", body: { action } });
      showMessage(message, action === "accept" ? "Request accepted. Choose what you want to receive." : "Request declined.", "success");
      await loadConnections();
    } catch (error) {
      rowButtons.forEach((control) => { control.disabled = false; });
      showMessage(message, error.message || "The request could not be updated.");
    }
  }

  async function updatePreference(event) {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    const row = input.closest("[data-connection-id]");
    const controls = row.querySelectorAll('input[type="checkbox"]');
    const body = Object.fromEntries([...controls].map((control) => [control.name, control.checked]));
    controls.forEach((control) => { control.disabled = true; });
    try {
      await requestJson(`/api/connections/${encodeURIComponent(row.dataset.connectionId)}`, { method: "PUT", body });
      showMessage(message, "Your choices are saved.", "success");
    } catch (error) {
      input.checked = !input.checked;
      showMessage(message, error.message || "Your choice could not be saved.");
    } finally { controls.forEach((control) => { control.disabled = false; }); }
  }

  async function removeConnection(event) {
    const button = event.target.closest("[data-remove-connection]");
    if (!button) return;
    const row = button.closest("[data-connection-id]");
    if (!window.confirm("Remove this trusted person? They will no longer receive future alerts or location from you.")) return;
    button.disabled = true;
    try {
      await requestJson(`/api/connections/${encodeURIComponent(row.dataset.connectionId)}`, { method: "DELETE", body: {} });
      showMessage(message, "Trusted person removed.", "success");
      await loadConnections();
    } catch (error) {
      button.disabled = false;
      showMessage(message, error.message || "This person could not be removed.");
    }
  }
}
