const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const qrModuleUrl = pathToFileURL(path.join(__dirname, "..", "js", "qr-code.js"));

test("one-time invite URLs become a self-contained, local SVG QR image", async () => {
  const { makeQrSvg, makeQrDataUrl } = await import(qrModuleUrl.href);
  const invitationUrl = `https://kin.example/invite.html#${"a".repeat(43)}`;
  const svg = makeQrSvg(invitationUrl);
  const dataUrl = makeQrDataUrl(invitationUrl);

  assert.match(svg, /^<svg viewBox="0 0 \d+ \d+" xmlns="http:\/\/www\.w3\.org\/2000\/svg">/u);
  assert.match(svg, /<path d="M/u);
  assert.doesNotMatch(svg, /<script|foreignObject|\s(?:href|xlink:href)=/u);
  assert.match(dataUrl, /^data:image\/svg\+xml;charset=utf-8,/u);
  assert.equal(decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1)), svg);
});

test("QR encoder rejects blank, non-text, and excessive payloads", async () => {
  const { makeQrSvg } = await import(qrModuleUrl.href);
  assert.throws(() => makeQrSvg(""), TypeError);
  assert.throws(() => makeQrSvg(null), TypeError);
  assert.throws(() => makeQrSvg("x".repeat(2049)), TypeError);
});
