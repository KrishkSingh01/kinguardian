const statusElement = document.querySelector("#turnstile-status");
const rootElement = document.querySelector("#turnstile-root");
const action = new URLSearchParams(location.search).get("action");
const allowedActions = new Set(["login", "register"]);

function status(message) {
  if (statusElement) statusElement.textContent = message;
  window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "turnstile-status", message }));
}

function postToken(token) {
  if (!token || !allowedActions.has(action)) return;
  status("Security check complete.");
  window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "turnstile-token", action, token }));
}

async function start() {
  if (!allowedActions.has(action)) { status("This security check link is not valid."); return; }
  try {
    const response = await fetch("/api/auth/turnstile-config", { cache: "no-store", credentials: "omit" });
    const configuration = await response.json();
    if (!response.ok || configuration.mode !== "enabled" || typeof configuration.siteKey !== "string") {
      status("The security check is not configured yet. Contact the site owner."); return;
    }
    window.onKGTurnstileLoaded = () => {
      if (!window.turnstile || !rootElement) { status("The security check did not start. Reload and try again."); return; }
      rootElement.replaceChildren();
      window.turnstile.render(rootElement, {
        sitekey: configuration.siteKey, action, theme: "dark", size: "normal", callback: postToken,
        "expired-callback": () => status("The security check expired. Complete it again."),
        "error-callback": () => status("The security check could not load. Check your internet and reload."),
      });
      status("Complete the security check to continue.");
    };
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onKGTurnstileLoaded&render=explicit";
    script.async = true; script.defer = true;
    script.onerror = () => status("The security check could not load. Check your internet and reload.");
    document.head.append(script);
  } catch { status("The security check could not load. Check your internet and reload."); }
}

void start();
