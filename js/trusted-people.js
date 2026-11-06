import { requestJson, showMessage } from "./auth-client.js";
import { cacheOfflineProfile, getOfflineProfile, getOfflineRecord, putOfflineRecord } from "./offline-store.js";

const connectionList = document.querySelector("#connection-list");
const requestList = document.querySelector("#invitation-list");
const form = document.querySelector("#username-search-form");
if (connectionList && form) {
  const message = document.querySelector("#circle-message");
  const connectionEmpty = document.querySelector("#connection-empty");
  const result = document.querySelector("#username-search-result");
  let currentUser = null;

  form.addEventListener("submit", searchUsername);
  document.querySelector("#refresh-invitations").addEventListener("click", loadConnections);
  connectionList.addEventListener("change", updatePreference);
  connectionList.addEventListener("click", removeConnection);
  requestList.addEventListener("click", answerRequest);
  window.addEventListener("kg:session", (event) => {
    currentUser = event.detail;
    cacheOfflineProfile(currentUser);
    void loadConnections();
  });
  window.addEventListener("kg:offline", () => { currentUser = getOfflineProfile(); void loadCachedConnections(); });
  window.addEventListener("offline", () => { currentUser = getOfflineProfile(); void loadCachedConnections(); });
  window.addEventListener("online", () => { if (currentUser) void loadConnections(); });

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

  async function loadConnections() {
    connectionList.replaceChildren();
    requestList.replaceChildren();
    try {
      const data = await requestJson("/api/connections");
      form.querySelectorAll("input, button").forEach((control) => { control.disabled = false; });
      const connections = data.connections || [];
      connectionEmpty.hidden = connections.length > 0;
      for (const connection of connections) connectionList.append(renderConnection(connection));
      for (const request of data.requests || []) requestList.append(renderIncomingRequest(request));
      for (const request of data.sentRequests || []) requestList.append(renderSentRequest(request));
      if (currentUser) await putOfflineRecord(currentUser.userId, "connections", connections).catch(() => undefined);
    } catch (error) {
      await loadCachedConnections();
    }
  }

  async function loadCachedConnections() {
    connectionList.replaceChildren();
    requestList.replaceChildren();
    form.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
    const saved = currentUser?.userId
      ? await getOfflineRecord(currentUser.userId, "connections").catch(() => [])
      : [];
    const connections = saved || [];
    connectionEmpty.hidden = connections.length > 0;
    for (const connection of connections) connectionList.append(renderConnection(connection, true));
    showMessage(message, connections.length
      ? "Showing trusted people saved on this device. This list may be out of date; changes need internet."
      : "No saved trusted-person list is available on this device. Reconnect to refresh it.", "pending");
  }

  function renderConnection(connection, readOnly = false) {
    const row = document.createElement("li");
    row.className = "connection-row";
    row.dataset.connectionId = connection.connectionId;
    const identity = document.createElement("div");
    identity.className = "connection-identity";
    const name = document.createElement("strong");
    name.textContent = `@${connection.username}`;
    const since = document.createElement("small");
    since.textContent = `Connected ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium" }).format(connection.acceptedAt)}`;
    identity.append(name, since);
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
    const text = document.createElement("strong");
    text.textContent = `@${request.username} wants to connect`;
    const accept = makeRequestButton("Accept", "accept");
    const reject = makeRequestButton("Decline", "reject");
    row.append(text, accept, reject);
    return row;
  }

  function renderSentRequest(request) {
    const row = document.createElement("li");
    row.className = "invitation-row";
    const text = document.createElement("span");
    text.textContent = `Waiting for @${request.username} to answer your request.`;
    row.append(text);
    return row;
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
    button.disabled = true;
    try {
      await requestJson(`/api/connections/${encodeURIComponent(row.dataset.connectionId)}`, { method: "POST", body: { action } });
      showMessage(message, action === "accept" ? "Request accepted. Choose what you want to receive." : "Request declined.", "success");
      await loadConnections();
    } catch (error) {
      button.disabled = false;
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
