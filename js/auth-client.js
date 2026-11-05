function csrfFromCookie() {
  const pair = document.cookie.split(";").map((item) => item.trim())
    .find((item) => item.startsWith("__Host-kg_csrf="));
  return pair ? pair.slice("__Host-kg_csrf=".length) : "";
}

export async function requestJson(path, { method = "GET", body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  const upperMethod = method.toUpperCase();
  if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(upperMethod)) {
    const csrfToken = sessionStorage.getItem("kinguardian-csrf") || csrfFromCookie();
    if (csrfToken) requestHeaders.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(path, {
    method: upperMethod,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  let data = {};
  try { data = await response.json(); } catch { /* keep a generic response */ }
  if (!response.ok) {
    const error = new Error(data.error?.message || "The request could not be completed.");
    error.code = data.error?.code || "REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return data;
}

export function showMessage(element, text, state = "error") {
  element.textContent = text;
  element.dataset.state = state;
}
