import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const runtimeRoot = resolve(projectRoot, "work", "local-preview-runtime");
const paths = {
  profile: resolve(runtimeRoot, "profile"),
  appData: resolve(runtimeRoot, "appdata"),
  localAppData: resolve(runtimeRoot, "local-appdata"),
  config: resolve(runtimeRoot, "config"),
  cache: resolve(runtimeRoot, "cache"),
  logs: resolve(runtimeRoot, "logs"),
  registry: resolve(runtimeRoot, "registry"),
  persistence: resolve(runtimeRoot, "state"),
};

await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));

const env = {
  ...process.env,
  USERPROFILE: paths.profile,
  APPDATA: paths.appData,
  LOCALAPPDATA: paths.localAppData,
  XDG_CONFIG_HOME: paths.config,
  XDG_CACHE_HOME: paths.cache,
  WRANGLER_LOG_PATH: paths.logs,
  WRANGLER_REGISTRY_PATH: paths.registry,
};

const wrangler = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const child = spawn(process.execPath, [
  wrangler,
  "pages",
  "dev",
  resolve(projectRoot, "dist"),
  "--port",
  "8788",
  "--persist-to",
  paths.persistence,
], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  });
}

child.once("error", (error) => {
  console.error("Could not start Wrangler. Run npm ci, then try npm run dev again.");
  console.error(error.message);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
