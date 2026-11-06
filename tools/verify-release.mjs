import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(projectRoot, "dist");
const ignoredDirectories = new Set([".git", "node_modules", ".wrangler", "dist", "work", "outputs"]);
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".py", ".sql",
  ".svg", ".toml", ".txt", ".webmanifest", ".yaml", ".yml",
]);
const prohibitedExtensions = new Set([
  ".aab", ".apk", ".db", ".dll", ".exe", ".jks", ".keystore", ".msi",
  ".key", ".mobileprovision", ".p12", ".pem", ".pfx", ".ppk", ".so",
  ".sqlite", ".sqlite3",
]);
const expectedTopLevelFiles = new Set([
  "_headers", "_routes.json", "account-setup.html", "change-password.html",
  "contacts.html", "index.html", "app.html", "invite.html", "location.html", "login.html", "register.html", "recover.html",
  "manifest.webmanifest", "pair-device.html", "release-manifest.json",
  "service-worker.js", "setup.html", "sos.html",
]);

const workspaceFiles = await listFiles(projectRoot);
const trackedFiles = new Set();
try {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  for (const filename of tracked.split("\0")) if (filename) trackedFiles.add(filename.replaceAll("\\", "/"));
} catch {
  // A fresh workspace may not have Git installed yet. GitHub CI will have it.
}
const prohibitedFiles = workspaceFiles.filter((filename) =>
  prohibitedExtensions.has(path.extname(filename).toLowerCase()),
);
if (prohibitedFiles.length) {
  fail(`Unexpected private or executable file(s) in the source workspace: ${prohibitedFiles.join(", ")}`);
}

const potentialSecrets = [];
for (const filename of workspaceFiles) {
  if (!textExtensions.has(path.extname(filename).toLowerCase())) continue;
  if (isLocalSecretFile(filename)) {
    if (trackedFiles.has(filename)) fail(`A local secret file is tracked by Git: ${filename}`);
    continue;
  }
  const contents = await readFile(path.join(projectRoot, filename), "utf8");
  const matches = findPotentialSecrets(contents);
  for (const marker of matches) potentialSecrets.push(`${filename} (${marker})`);
}
if (potentialSecrets.length) {
  fail(`Potential credential material found in source files: ${potentialSecrets.join(", ")}`);
}

const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
if (lock.packages?.[""]?.version !== packageJson.version) {
  fail("package.json and package-lock.json versions do not match.");
}
for (const group of ["dependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(packageJson[group] || {})) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
      fail(`${group}.${name} must use an exact version, found ${version}.`);
    }
    if (lock.packages?.[""]?.[group]?.[name] !== version) {
      fail(`package-lock.json does not pin ${group}.${name} to ${version}.`);
    }
  }
}

const manifestPath = path.join(publicRoot, "release-manifest.json");
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  fail("dist/release-manifest.json is missing. Run npm run build first.");
}
if (manifest.application !== packageJson.name || manifest.version !== packageJson.version) {
  fail("Release manifest application or version does not match package.json.");
}
if (!Number.isFinite(Date.parse(manifest.buildDate))) fail("Release manifest has an invalid build date.");
if (!["development", "preview", "production"].includes(manifest.releaseType)) {
  fail("Release manifest has an invalid release type.");
}
if (manifest.checksumAlgorithm !== "SHA-256" || !Array.isArray(manifest.assets)) {
  fail("Release manifest does not contain the expected SHA-256 asset list.");
}

const actualPublicFiles = await listFiles(publicRoot);
const listedFiles = new Set();
for (const asset of manifest.assets) {
  if (typeof asset.path !== "string" || asset.path.includes("..") || path.isAbsolute(asset.path)) {
    fail("Release manifest contains an unsafe asset path.");
  }
  if (listedFiles.has(asset.path)) fail(`Duplicate asset entry: ${asset.path}`);
  listedFiles.add(asset.path);
  const fullPath = path.join(publicRoot, asset.path);
  const contents = await readFile(fullPath).catch(() => null);
  if (!contents) fail(`Release manifest references a missing asset: ${asset.path}`);
  const actualHash = createHash("sha256").update(contents).digest("hex");
  if (actualHash !== asset.sha256) fail(`SHA-256 mismatch for ${asset.path}`);
}
const expectedPublicFiles = new Set([...listedFiles, "release-manifest.json"]);
for (const filename of actualPublicFiles) {
  if (!expectedPublicFiles.has(filename)) fail(`Unlisted public build file: ${filename}`);
  const extension = path.extname(filename).toLowerCase();
  if (prohibitedExtensions.has(extension)) fail(`Private or executable file in public build: ${filename}`);
  if (!(expectedTopLevelFiles.has(filename) || /^(?:assets|css|js)\//u.test(filename))) {
    fail(`Unexpected public build path: ${filename}`);
  }
  if (/^(?:functions|worker|tests|tools|node_modules|\.wrangler)\//u.test(filename)) {
    fail(`Development or server source copied into public build: ${filename}`);
  }
  if (textExtensions.has(extension) || expectedTopLevelFiles.has(filename)) {
    const contents = await readFile(path.join(publicRoot, filename), "utf8");
    const matches = findPotentialSecrets(contents);
    if (matches.length) fail(`Known credential pattern found in public build file ${filename}: ${matches.join(", ")}`);
  }
}
for (const filename of expectedPublicFiles) {
  if (!actualPublicFiles.includes(filename)) fail(`Release manifest lists a missing build file: ${filename}`);
}

const routes = JSON.parse(await readFile(path.join(publicRoot, "_routes.json"), "utf8"));
if (JSON.stringify(routes) !== JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] })) {
  fail("Public Pages routing must send only /api/* through Pages Functions.");
}

console.log(`PASS: ${manifest.application} ${manifest.version} (${manifest.releaseType}); ${manifest.assets.length} public assets have matching SHA-256 values; private/server build files and known credential patterns were not found.`);

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && prefix === "" && ignoredDirectories.has(entry.name)) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

function isLocalSecretFile(filename) {
  const basename = path.posix.basename(filename);
  return basename === ".dev.vars" || basename.startsWith(".dev.vars.") && basename !== ".dev.vars.example"
    || basename === ".env" || basename.startsWith(".env.") && basename !== ".env.example";
}

function findPotentialSecrets(contents) {
  const matches = [];
  const knownPatterns = [
    ["private-key-block", /-----BEGIN (?:(?:RSA|DSA|EC|OPENSSH) )?PRIVATE KEY-----/iu],
    ["PGP-private-key-block", new RegExp("-----BEGIN PGP " + "PRIVATE KEY BLOCK-----", "iu")],
    ["GitHub-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/u],
    ["AWS-access-key", /\bAKIA[0-9A-Z]{16}\b/u],
  ];
  for (const [label, pattern] of knownPatterns) if (pattern.test(contents)) matches.push(label);

  const assignment = /\b(OWNER_BOOTSTRAP_SECRET|AUTH_RATE_LIMIT_SECRET|VAPID_PRIVATE_KEY|CLOUDFLARE_API_TOKEN)\s*=\s*["']?([^\s"'#]+)["']?/giu;
  for (const match of contents.matchAll(assignment)) {
    if (/^(?:replace-with|REPLACE_WITH|<|YOUR_|your-)/u.test(match[2])) continue;
    if (match[2].length >= 24) matches.push(`${match[1]}-assignment`);
  }
  return matches;
}

function fail(message) {
  console.error(`RELEASE CHECK FAILED: ${message}`);
  process.exit(1);
}
