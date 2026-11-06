import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createHash } from "node:crypto";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "dist");
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const releaseType = process.env.KG_RELEASE_TYPE || "development";
if (!new Set(["development", "preview", "production"]).has(releaseType)) {
  throw new Error("KG_RELEASE_TYPE must be development, preview, or production.");
}
const staticFiles = [
  "index.html", "app.html", "login.html", "register.html", "recover.html", "setup.html", "change-password.html", "account-setup.html", "pair-device.html", "contacts.html", "invite.html", "sos.html", "location.html",
  "manifest.webmanifest", "service-worker.js", "_headers", "_routes.json",
];
const staticDirectories = ["css", "assets"];
const entryPoints = [
  "app", "owner", "login", "register", "recover", "recovery-codes", "setup", "change-password", "account-setup", "pair-device", "contacts", "circle", "checkins", "invite", "sos", "location",
  "notifications",
].map((name) => path.join(projectRoot, "js", `${name}.js`));

// dist is a generated directory. Start clean so stale files cannot leak into a release.
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const filename of staticFiles) {
  await cp(path.join(projectRoot, filename), path.join(outputRoot, filename));
}
for (const directory of staticDirectories) {
  await cp(path.join(projectRoot, directory), path.join(outputRoot, directory), { recursive: true });
}
await mkdir(path.join(outputRoot, "js"), { recursive: true });
await build({
  entryPoints,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  outdir: path.join(outputRoot, "js"),
  minify: false,
  sourcemap: false,
});

const outputFiles = await listFiles(outputRoot);
const checksums = [];
for (const relativePath of outputFiles) {
  const contents = await readFile(path.join(outputRoot, relativePath));
  checksums.push({
    path: relativePath,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}
const buildManifest = {
  application: packageMetadata.name,
  version: packageMetadata.version,
  buildDate: new Date().toISOString(),
  releaseType,
  checksumAlgorithm: "SHA-256",
  assets: checksums,
};
await writeFile(
  path.join(outputRoot, "release-manifest.json"),
  `${JSON.stringify(buildManifest, null, 2)}\n`,
  "utf8",
);
console.log(`Built KinGuardian ${packageMetadata.version} (${releaseType}) into dist/ with ${checksums.length} asset checksums.`);

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}
