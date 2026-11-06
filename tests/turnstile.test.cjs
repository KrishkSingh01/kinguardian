const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = (filename) => import(pathToFileURL(path.join(root, filename)));

test("Turnstile is explicitly off only when both keys are absent", async () => {
  const { getTurnstileConfiguration, verifyTurnstile } = await load("functions/_shared/turnstile.js");
  assert.deepEqual(getTurnstileConfiguration({}), { mode: "off", siteKey: null });
  const result = await verifyTurnstile({
    env: {}, request: new Request("https://kinguardian.pages.dev/api/auth/login"),
    token: "", expectedAction: "login",
    fetchImpl: () => { throw new Error("fetch should not run while Turnstile is off"); },
  });
  assert.deepEqual(result, { ok: true, required: false });
});

test("partial Turnstile configuration fails closed", async () => {
  const { getTurnstileConfiguration, verifyTurnstile } = await load("functions/_shared/turnstile.js");
  assert.equal(getTurnstileConfiguration({ TURNSTILE_SITE_KEY: "public-key" }).mode, "misconfigured");
  assert.equal(getTurnstileConfiguration({ TURNSTILE_SECRET_KEY: "private-key" }).mode, "misconfigured");
  const result = await verifyTurnstile({
    env: { TURNSTILE_SITE_KEY: "public-key" },
    request: new Request("https://kinguardian.pages.dev/api/auth/login"),
    token: "token", expectedAction: "login",
  });
  assert.deepEqual(result, { ok: false, unavailable: true });
});

test("configured Turnstile requires a token and never sends one without server verification", async () => {
  const { verifyTurnstile } = await load("functions/_shared/turnstile.js");
  let calls = 0;
  const options = {
    env: { TURNSTILE_SITE_KEY: "public-key", TURNSTILE_SECRET_KEY: "private-key" },
    request: new Request("https://kinguardian.pages.dev/api/auth/login"),
    expectedAction: "login",
    fetchImpl: () => { calls += 1; throw new Error("unexpected network call"); },
  };
  assert.deepEqual(await verifyTurnstile({ ...options, token: "" }), { ok: false, unavailable: false });
  assert.equal(calls, 0);
});

test("Turnstile accepts only a successful token for this hostname and form action", async () => {
  const { verifyTurnstile } = await load("functions/_shared/turnstile.js");
  const env = { TURNSTILE_SITE_KEY: "public-key", TURNSTILE_SECRET_KEY: "private-key" };
  const request = new Request("https://kinguardian.pages.dev/api/auth/register", {
    headers: { "cf-connecting-ip": "192.0.2.5" },
  });
  let sent;
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(init.method, "POST");
    sent = JSON.parse(init.body);
    return Response.json({ success: true, hostname: "kinguardian.pages.dev", action: "register" });
  };
  const result = await verifyTurnstile({ env, request, token: "single-use-token", expectedAction: "register", fetchImpl });
  assert.deepEqual(result, { ok: true, unavailable: false });
  assert.equal(sent.secret, "private-key");
  assert.equal(sent.response, "single-use-token");
  assert.equal(sent.remoteip, "192.0.2.5");
  assert.match(sent.idempotency_key, /^[0-9a-f-]{36}$/u);

  for (const invalidResult of [
    { success: false, hostname: "kinguardian.pages.dev", action: "register" },
    { success: true, hostname: "attacker.example", action: "register" },
    { success: true, hostname: "kinguardian.pages.dev", action: "login" },
  ]) {
    const invalid = await verifyTurnstile({
      env, request, token: "single-use-token", expectedAction: "register",
      fetchImpl: async () => Response.json(invalidResult),
    });
    assert.deepEqual(invalid, { ok: false, unavailable: false });
  }
});

test("Turnstile service failures return an unavailable result", async () => {
  const { verifyTurnstile } = await load("functions/_shared/turnstile.js");
  const env = { TURNSTILE_SITE_KEY: "public-key", TURNSTILE_SECRET_KEY: "private-key" };
  const request = new Request("https://kinguardian.pages.dev/api/auth/login");
  const result = await verifyTurnstile({
    env, request, token: "single-use-token", expectedAction: "login",
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  assert.deepEqual(result, { ok: false, unavailable: true });
});

test("public Turnstile config never returns the private key", async () => {
  const { onRequestGet } = await load("functions/api/auth/turnstile-config.js");
  const response = onRequestGet({ env: { TURNSTILE_SITE_KEY: "public-key", TURNSTILE_SECRET_KEY: "private-key" } });
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), { mode: "enabled", siteKey: "public-key" });
});
