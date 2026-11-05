const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const pages = ["index.html", "login.html", "setup.html", "change-password.html", "account-setup.html", "pair-device.html", "contacts.html", "invite.html", "sos.html", "location.html"];
const source = (filename) => readFileSync(path.join(root, filename), "utf8");

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return result;
}

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("static pages have valid local resources, labels, and accessible names", () => {
  let totalIds = 0;
  for (const filename of pages) {
    const html = source(filename);
    const idMatches = [...html.matchAll(/\bid="([^"]+)"/gu)];
    const ids = new Set(idMatches.map((match) => match[1]));
    assert.equal(ids.size, idMatches.length, `duplicate IDs in ${filename}`);
    totalIds += ids.size;
    assert.match(html, /<html\b[^>]*\blang="en"/u, `document language missing from ${filename}`);

    for (const match of html.matchAll(/\baria-labelledby="([^"]+)"/gu)) {
      for (const id of match[1].split(/\s+/u)) assert.ok(ids.has(id), `unknown ${id} in ${filename}`);
    }
    const labelTargets = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/gu)].map((match) => match[1]));
    for (const labelTarget of labelTargets) assert.ok(ids.has(labelTarget), `missing label target ${labelTarget} in ${filename}`);

    for (const match of html.matchAll(/<(button)\b[^>]*>/giu)) {
      assert.ok(attributes(match[0]).type, `button type missing in ${filename}`);
    }
    for (const match of html.matchAll(/<(input|select|textarea)\b[^>]*>/giu)) {
      const attrs = attributes(match[0]);
      if (attrs.type === "hidden") continue;
      const openLabel = html.lastIndexOf("<label", match.index);
      const closeLabel = html.lastIndexOf("</label>", match.index);
      const nestedLabel = openLabel > closeLabel && html.indexOf("</label>", match.index) > match.index;
      const labeled = nestedLabel || (attrs.id && labelTargets.has(attrs.id)) || attrs["aria-label"] || attrs["aria-labelledby"];
      assert.ok(labeled, `unlabeled ${attrs.id || match[1]} in ${filename}`);
    }

    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
      assert.ok(attributes(`<script ${match[1]}>`).src, `inline script in ${filename}`);
      assert.equal(match[2].trim(), "", `inline script content in ${filename}`);
    }
    for (const match of html.matchAll(/(?<![\w-])(?:href|src|action)="([^"]+)"/giu)) {
      const reference = match[1];
      if (/^(?:#|data:|mailto:|tel:|https?:\/\/)/iu.test(reference)) continue;
      const target = path.resolve(root, reference.startsWith("/") ? reference.slice(1) : reference.split(/[?#]/u)[0]);
      assert.ok(statSync(target, { throwIfNoEntry: false })?.isFile(), `missing ${reference} in ${filename}`);
    }
  }
  assert.ok(totalIds > 0);
});

test("light and dark themes retain contrast, focus, reduced motion, and mobile rules", () => {
  const tokens = source("css/tokens.css");
  const themes = [
    tokens.match(/:root\s*\{([^}]+)\}/u)?.[1],
    tokens.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/u)?.[1],
  ];
  assert.ok(themes.every(Boolean));
  for (const [index, block] of themes.entries()) {
    const colors = Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/gu)].map((match) => [match[1], match[2]]));
    const theme = index === 0 ? "light" : "dark";
    for (const [foreground, background, minimum] of [
      ["--ink", "--paper", 4.5], ["--ink-soft", "--surface", 4.5],
      ["--ink-muted", "--surface", 4.5], ["--coral-text", "--coral-pale", 4.5],
      ["--coral-ink", "--coral", 4.5], ["--line-strong", "--surface", 3],
      ["--focus-ring", "--surface", 3],
    ]) {
      assert.ok(colors[foreground] && colors[background], `missing ${theme} tokens`);
      assert.ok(contrast(colors[foreground], colors[background]) >= minimum, `${theme}: ${foreground} on ${background}`);
    }
  }
  const base = source("css/base.css");
  for (const selector of ["button:focus-visible", "a:focus-visible", "input:focus-visible", "textarea:focus-visible", "select:focus-visible", "--focus-ring"]) {
    assert.ok(base.includes(selector), `keyboard focus styling missing ${selector}`);
  }
  assert.ok(source("css/animations.css").includes("prefers-reduced-motion: reduce"));
  const responsive = source("css/responsive.css");
  for (const breakpoint of ["max-width: 1160px", "max-width: 850px", "max-width: 680px", "max-width: 390px"]) assert.ok(responsive.includes(breakpoint));
  assert.ok(source("css/notifications.css").includes("max-width: 620px"));
  const navItems = [...source("index.html").matchAll(/<button\b[^>]*class="nav-item[^>]*>/gu)].map((match) => match[0]);
  assert.ok(navItems.length > 0 && navItems.every((button) => attributes(button)["aria-label"]));
  const cssBytes = readdirSync(path.join(root, "css")).filter((name) => name.endsWith(".css"))
    .reduce((total, name) => total + statSync(path.join(root, "css", name)).size, 0);
  assert.ok(cssBytes <= 200_000, `CSS source weighs ${cssBytes} bytes`);
});
