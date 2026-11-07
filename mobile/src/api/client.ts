import Constants from "expo-constants";
import { clearSession, readSession, saveSession } from "../auth/sessionStore";
import type { MobileSession } from "./models";

const API_BASE = String(Constants.expoConfig?.extra?.apiBaseUrl || "https://kinguardian.pages.dev").replace(/\/$/u, "");
const NATIVE_HEADERS = { "x-kg-client": "native" };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "REQUEST_FAILED") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: any = {};
  try { body = await response.json(); } catch { /* The response may have no JSON body. */ }
  if (!response.ok) {
    throw new ApiError(body?.error?.message || `Request failed (${response.status}).`, response.status, body?.error?.code);
  }
  return body as T;
}

async function rawRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("x-kg-client", "native");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${API_BASE}${path}`, {
      ...init, headers, signal: controller.signal, credentials: "omit",
    });
    return await parseResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ApiError("The request took too long. Check your connection and try again.", 0, "TIMEOUT");
    throw new ApiError("Could not reach KinGuardian. Check your internet connection.", 0, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

let refreshPromise: Promise<MobileSession | null> | null = null;

async function refreshSession(): Promise<MobileSession | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const existing = await readSession();
    if (!existing || existing.refreshExpiresAt <= Date.now()) {
      await clearSession();
      return null;
    }
    try {
      const next = await rawRequest<MobileSession>("/api/auth/refresh", {
        method: "POST", body: JSON.stringify({ refreshToken: existing.refreshToken }),
      });
      await saveSession(next);
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await clearSession();
        return null;
      }
      // A temporary network or server failure must not erase a valid device session.
      throw error;
    }
  })();
  try { return await refreshPromise; } finally { refreshPromise = null; }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  if (!authenticated) return rawRequest<T>(path, init);
  let session = await readSession();
  if (!session) throw new ApiError("Sign in to continue.", 401, "NOT_SIGNED_IN");
  if (session.accessExpiresAt <= Date.now() + 30_000) {
    session = await refreshSession();
    if (!session) throw new ApiError("Your session expired. Sign in again.", 401, "SESSION_EXPIRED");
  }
  try {
    return await rawRequest<T>(path, init, session.accessToken);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    session = await refreshSession();
    if (!session) throw error;
    return rawRequest<T>(path, init, session.accessToken);
  }
}

export async function login(username: string, password: string, turnstileToken: string): Promise<MobileSession> {
  const session = await rawRequest<MobileSession>("/api/auth/login", {
    method: "POST", body: JSON.stringify({ username, password, turnstileToken }),
  });
  await saveSession(session);
  return session;
}

export async function register(username: string, password: string, turnstileToken: string): Promise<MobileSession & { recoveryCodes: string[] }> {
  return rawRequest<MobileSession & { recoveryCodes: string[] }>("/api/auth/register", {
    method: "POST", body: JSON.stringify({ username, password, turnstileToken }),
  });
}

export async function recoverPassword(username: string, recoveryCode: string, password: string): Promise<{ recovered: boolean; message: string }> {
  return rawRequest("/api/auth/recover", {
    method: "POST", body: JSON.stringify({ username, recoveryCode, password }),
  });
}

export async function logout(): Promise<void> {
  const session = await readSession();
  try {
    if (session) await apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: session.refreshToken }) });
  } finally {
    await clearSession();
  }
}

export function apiBaseUrl(): string { return API_BASE; }
