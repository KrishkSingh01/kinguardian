import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = fileURLToPath(new URL("..", import.meta.url));

async function readPinnedPackage(name, expectedVersion) {
  const packagePath = join(mobileRoot, "node_modules", name, "package.json");
  const packageData = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageData.version !== expectedVersion) {
    throw new Error(`${name} version ${packageData.version} is unexpected; this compatibility patch was checked for ${expectedVersion}.`);
  }
  return packagePath;
}

const constantsPackage = await readPinnedPackage("expo-constants", "58.0.15");
const constantsGradle = join(mobileRoot, "node_modules", "expo-constants", "scripts", "get-app-config-android.gradle");
let constantsSource = await readFile(constantsGradle, "utf8");
const androidDeclaration = 'def androidExtension = project.extensions.getByName("android")';
const constantsMarker = 'def nodeExecutableAndArgs = config.nodeExecutableAndArgs ?: ["node"]';
if (!constantsSource.includes(androidDeclaration)) {
  if (!constantsSource.includes(constantsMarker)) throw new Error("Could not find the expected expo-constants Gradle script marker.");
  constantsSource = constantsSource.replace(constantsMarker, `${constantsMarker}\n${androidDeclaration}`);
}
const patchedConstants = constantsSource.replaceAll("project.android.", "androidExtension.");
if (patchedConstants.includes("project.android.")) throw new Error("Could not patch every expo-constants Android DSL reference.");
if (patchedConstants !== constantsSource) await writeFile(constantsGradle, patchedConstants, "utf8");

await readPinnedPackage("expo-modules-core", "58.0.30");
const modulesCoreGradle = join(mobileRoot, "node_modules", "expo-modules-core", "android", "build.gradle");
let modulesCoreSource = await readFile(modulesCoreGradle, "utf8");
const ndkCompatibilityAccess = 'project.extensions.getByName("android").ndkDirectory';
if (!modulesCoreSource.includes(ndkCompatibilityAccess)) {
  const ndkAccess = /(?:project\.)?android\.ndkDirectory/g;
  const matches = modulesCoreSource.match(ndkAccess) ?? [];
  if (matches.length !== 1) throw new Error(`Expected one NDK directory reference in expo-modules-core, found ${matches.length}.`);
  modulesCoreSource = modulesCoreSource.replace(ndkAccess, ndkCompatibilityAccess);
  await writeFile(modulesCoreGradle, modulesCoreSource, "utf8");
}

console.log("Android Gradle compatibility patch applied (expo-constants 58.0.15, expo-modules-core 58.0.30).");