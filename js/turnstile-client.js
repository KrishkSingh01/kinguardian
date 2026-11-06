const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise;

export async function prepareTurnstile(container) {
  const response = await fetch("/api/auth/turnstile-config", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The account security check could not be loaded.");
  const configuration = await response.json();
  if (configuration.mode === "off") return createState("off");
  if (configuration.mode !== "enabled" || typeof configuration.siteKey !== "string") {
    return createState("unavailable");
  }

  container.hidden = false;
  await loadTurnstileScript();
  if (!window.turnstile) throw new Error("The account security check could not be loaded.");

  let token = "";
  const widgetId = window.turnstile.render(container, {
    sitekey: configuration.siteKey,
    action: container.dataset.action,
    theme: "auto",
    callback(value) { token = value; },
    "expired-callback"() { token = ""; },
    "error-callback"() { token = ""; },
  });
  return {
    mode: "enabled",
    token: () => token,
    reset() {
      token = "";
      window.turnstile.reset(widgetId);
    },
  };
}

function createState(mode) {
  return { mode, token: () => "", reset() {} };
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("The account security check could not be loaded.")), { once: true });
    document.head.append(script);
  });
  return scriptPromise;
}
