import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = join(root, "src");
const extension = join(src, "extension");
const designSystem = join(root, "design-system");
const dist = join(root, "dist");

// This is the one public MV3 packaging surface. Keep the list explicit: the
// design-system source/docs and runtime-only entrypoints must not silently
// become extension dependencies.
const uiFiles = [
  "analysis.js",
  "content.js",
  "fixtures.js",
  "popup.html",
  "popup.js",
  "runtime.js",
  "state.js",
  "styles.css",
  "summary.html",
  "summary.js",
  "ui.js"
];
const runtimeFiles = [
  ["background/service-worker.js", "background/service-worker.js"],
  ["common/protocol.js", "common/protocol.js"],
  ["common/capabilities.js", "common/capabilities.js"],
  ["common/synchronization.js", "common/synchronization.js"],
  ["content/overlay.js", "content/overlay.js"],
  ["content/capture.js", "content/capture.js"],
  ["content/video-discovery.js", "content/video-discovery.js"],
  ["content/runtime.js", "content/runtime.js"],
  ["offscreen/analyzer.js", "offscreen/analyzer.js"],
  ["offscreen/fixture-model.js", "offscreen/fixture-model.js"],
  ["offscreen/offscreen.html", "offscreen/offscreen.html"],
  ["offscreen/offscreen.js", "offscreen/offscreen.js"]
];
const designSystemFiles = [
  "tokens/base.css",
  "tokens/colors.css",
  "tokens/elevation.css",
  "tokens/motion.css",
  "tokens/spacing.css",
  "tokens/typography.css",
  "assets/icon-16.svg",
  "assets/icon-32.svg",
  "assets/icon.svg",
  "assets/logo-mark.svg"
];

async function copyFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const remoteScriptTag = /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:(?:https?:)?\/\/)[^"'\s>]+/i;
const remoteLink = /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:(?:https?:)?\/\/)/i;
const remoteCssImport = /@import\s+(?:url\s*\(\s*)?["']?\s*(?:(?:https?:)?\/\/)/i;
const remoteCssAsset = /url\s*\(\s*["']?\s*(?:(?:https?:)?\/\/)/i;
const remoteCodeImport = /\b(?:import|require|fetch)\s*\(\s*["']\s*(?:(?:https?:)?\/\/)/i;

async function assertNoRemoteDependencies(directory) {
  const violations = [];
  for (const file of await listFiles(directory)) {
    const source = await readFile(file, "utf8");
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (remoteScriptTag.test(source)) violations.push(`${relative(directory, file)} contains a remote script tag`);
    if (remoteLink.test(source)) violations.push(`${relative(directory, file)} contains a remote linked resource`);
    if (remoteCssImport.test(source)) violations.push(`${relative(directory, file)} contains a remote CSS import`);
    if (extension === ".css" && remoteCssAsset.test(source)) violations.push(`${relative(directory, file)} contains a remote CSS asset`);
    if ((extension === ".js" || extension === ".mjs") && remoteCodeImport.test(source)) violations.push(`${relative(directory, file)} contains a remote code or data request`);
  }
  if (violations.length) throw new Error(`Remote production dependency detected:\n${violations.join("\n")}`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of uiFiles) await copyFile(join(src, file), join(dist, file));
await copyFile(join(root, "manifest.json"), join(dist, "manifest.json"));
for (const [source, destination] of runtimeFiles) await copyFile(join(extension, source), join(dist, destination));
for (const file of designSystemFiles) await copyFile(join(designSystem, file), join(dist, "design-system", file));

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || manifest.background?.service_worker !== "background/service-worker.js" ||
    !manifest.permissions?.includes("offscreen") || manifest.message_serialization !== "structured_clone") {
  throw new Error("manifest.json is not the canonical complete MV3 manifest");
}
const required = [
  ...uiFiles,
  "manifest.json",
  ...runtimeFiles.map(([, destination]) => destination),
  ...designSystemFiles.map((file) => join("design-system", file))
];
for (const file of required) {
  try { await stat(join(dist, file)); } catch { throw new Error(`Missing build output: ${file}`); }
}
const contentScripts = manifest.content_scripts?.flatMap((entry) => entry.js || []) || [];
for (const file of contentScripts) {
  if (!required.includes(file)) throw new Error(`Manifest content script is not packaged: ${file}`);
}
const offscreenHtml = await readFile(join(dist, "offscreen/offscreen.html"), "utf8");
for (const script of ["../common/protocol.js", "fixture-model.js", "analyzer.js", "offscreen.js"]) {
  if (!offscreenHtml.includes(`src="${script}"`)) throw new Error(`Packed offscreen document is missing ${script}`);
}
await assertNoRemoteDependencies(dist);
console.log(`Built canonical loadable MV3 extension in ${dist}`);
