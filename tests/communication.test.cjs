const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const communicationUrl = pathToFileURL(path.resolve(__dirname, "../js/communication.js"));

test("SMS, email, and WhatsApp use user-reviewed international composer links", async () => {
  const communication = await import(communicationUrl);
  const message = "I need help now.";
  const sms = communication.prepareCommunication("sms", "+442070313000", message);
  const email = communication.prepareCommunication("email", "help@example.org", message, "Please call me");
  const whatsapp = communication.prepareCommunication("whatsapp", "+12133734253", message);

  assert.equal(sms.status, "prepared");
  assert.equal(sms.url, "sms:+442070313000?body=I%20need%20help%20now.");
  assert.match(email.url, /^mailto:help@example\.org\?subject=/u);
  assert.match(email.url, /body=I%20need%20help%20now\./u);
  assert.match(whatsapp.url, /^https:\/\/wa\.me\/12133734253\?text=/u);
  assert.equal(communication.communicationProviderStatus("sms"), "not_configured");
});

test("composer links reject missing, malformed, or excessive content", async () => {
  const communication = await import(communicationUrl);
  assert.throws(() => communication.prepareCommunication("sms", "02070313000", "Help"), /international phone/i);
  assert.throws(() => communication.prepareCommunication("email", "not-an-email", "Help"), /email address/i);
  assert.throws(() => communication.prepareCommunication("whatsapp", "+447000000000", "x".repeat(501)), /500 characters/i);
  assert.throws(() => communication.prepareCommunication("fax", "+447000000000", "Help"), /not supported/i);
});
