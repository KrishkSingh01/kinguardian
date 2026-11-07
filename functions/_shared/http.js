export class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function jsonResponse(value, status = 200, extraHeaders = {}) {
  const headers = new Headers(DEFAULT_HEADERS);
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return new Response(JSON.stringify(value), {
    status,
    headers,
  });
}

export function errorResponse(code, status, message = "The request could not be completed.") {
  return jsonResponse({ error: { code, message } }, status);
}

export async function readJsonRequest(request, maximumBytes = 16_384) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestError(415, "JSON_REQUIRED", "Send this request as JSON.");
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) {
    throw new RequestError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new RequestError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Expected a JSON object");
    }
    return parsed;
  } catch {
    throw new RequestError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
}

export function requireSameOrigin(request) {
  // Native clients cannot send a browser Origin header. Their cross-origin
  // requests carry an explicit marker; protected routes still require the
  // normal bearer session in requireSession(), and browsers cannot add this
  // non-simple header without a successful CORS preflight (which this API does
  // not grant). Login and registration remain protected by Turnstile/rate limits.
  if (request.headers.get("x-kg-client") === "native") return true;
  const origin = request.headers.get("origin");
  let requestOrigin;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  return Boolean(origin && origin === requestOrigin);
}

export function requirePost(context) {
  if (context.request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { ...DEFAULT_HEADERS, Allow: "POST" },
    });
  }
  if (!requireSameOrigin(context.request)) {
    return errorResponse("ORIGIN_REJECTED", 403, "This request did not come from KinGuardian.");
  }
  return null;
}

export function safeError(error) {
  if (error instanceof RequestError) {
    return errorResponse(error.code, error.status, error.message);
  }
  return errorResponse("INTERNAL_ERROR", 500, "KinGuardian could not complete this request.");
}
