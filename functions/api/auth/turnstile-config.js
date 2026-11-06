import { getTurnstileConfiguration } from "../../_shared/turnstile.js";
import { jsonResponse } from "../../_shared/http.js";

export function onRequestGet({ env }) {
  const configuration = getTurnstileConfiguration(env);
  if (configuration.mode === "enabled") {
    return jsonResponse({ mode: "enabled", siteKey: configuration.siteKey }, 200, {
      "Cache-Control": "no-store, max-age=0",
    });
  }
  return jsonResponse({ mode: configuration.mode }, 200, { "Cache-Control": "no-store, max-age=0" });
}
