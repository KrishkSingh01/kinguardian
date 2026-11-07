const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mobile = path.join(__dirname, "..");
const root = path.join(mobile, "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

test("the mobile UI is native and uses a WebView only for the Turnstile challenge", () => {
  const app = read("mobile/src/App.tsx");
  const auth = read("mobile/src/components/TurnstileChallenge.tsx");
  assert.match(app, /createBottomTabNavigator/u);
  assert.match(auth, /react-native-webview/u);
  assert.doesNotMatch(app, /WebView/u);
});

test("private session and queued SOS data are protected and fail closed without SQLCipher", () => {
  const session = read("mobile/src/auth/sessionStore.ts");
  const queue = read("mobile/src/storage/secureQueue.ts");
  assert.match(session, /expo-secure-store/u);
  assert.doesNotMatch(session, /AsyncStorage/u);
  assert.match(queue, /PRAGMA key/u);
  assert.match(queue, /PRAGMA cipher_version/u);
  assert.match(queue, /Encrypted private storage is not available/u);
  assert.match(queue, /CREATE TABLE IF NOT EXISTS queued_sos/u);
});

test("mobile auth keeps Turnstile required and never stores a new account before showing recovery codes", () => {
  const auth = read("mobile/src/screens/AuthScreen.tsx");
  const api = read("mobile/src/api/client.ts");
  assert.match(auth, /if \(!turnstileToken\)/u);
  assert.match(auth, /recoveryCodes/u);
  assert.ok(auth.indexOf("setRecoveryCodes(codes)") < auth.indexOf("saveSession(pendingSession)"));
  assert.match(api, /x-kg-client/u);
  assert.match(api, /Authorization/u);
});

test("a temporary refresh failure does not erase the saved mobile session", () => {
  const api = read("mobile/src/api/client.ts");
  const refresh = api.slice(api.indexOf("async function refreshSession"), api.indexOf("export async function apiRequest"));
  assert.match(refresh, /error instanceof ApiError && error\.status === 401/u);
  assert.match(refresh, /temporary network or server failure must not erase/u);
  assert.doesNotMatch(refresh, /catch \{\s*await clearSession\(\)/u);
});

test("the app reports offline status without claiming queued SOS events were delivered", () => {
  const app = read("mobile/src/App.tsx");
  assert.match(app, /NetInfo\.addEventListener/u);
  assert.match(app, /Offline · SOS and changes cannot reach your trusted people until you reconnect/u);
  assert.match(app, /accessibilityRole="alert"/u);
});

test("website release includes the hosted Turnstile challenge used by the app", () => {
  const build = read("tools/build.mjs");
  const page = read("mobile-turnstile.html");
  assert.match(build, /mobile-turnstile\.html/u);
  assert.match(build, /"mobile-turnstile"/u);
  assert.match(page, /mobile-turnstile\.js/u);
});
