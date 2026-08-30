import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = join(root, "src");
const designSystem = join(root, "design-system");
const dist = join(root, "dist");

// Keep the unpacked extension explicit. In particular, the authored design-system
// tree contains previews, source components, and documentation that are not runtime
// dependencies and must not become part of the MV3 package.
const runtimeSourceFiles = [
  "analysis.js",
  "background.js",
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
const runtimeDesignSystemFiles = [
  "tokens/base.css",
  "tokens/colors.css",
  "tokens/elevation.css",
  "tokens/motion.css",
  "tokens/spacing.css",
  "tokens/typography.css",
  "assets/icon-16.svg",
  "assets/icon.svg",
  "assets/logo-mark.svg"
];

async function copyFiles(files, sourceRoot, destinationRoot) {
  for (const file of files) {
    const source = join(sourceRoot, file);
    const destination = join(destinationRoot, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
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
await copyFiles(runtimeSourceFiles, src, dist);
await copyFiles(["manifest.json"], root, dist);
await copyFiles(runtimeDesignSystemFiles, designSystem, join(dist, "design-system"));

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const required = [
  "popup.html",
  "summary.html",
  "background.js",
  "content.js",
  "runtime.js",
  "analysis.js",
  "fixtures.js",
  "state.js",
  "ui.js",
  "styles.css",
  "design-system/tokens/colors.css",
  "design-system/tokens/typography.css",
  "design-system/tokens/spacing.css",
  "design-system/tokens/elevation.css",
  "design-system/tokens/motion.css",
  "design-system/tokens/base.css",
  "design-system/assets/icon-16.svg",
  "design-system/assets/icon.svg",
  "design-system/assets/logo-mark.svg"
];
for (const file of required) {
  try { await stat(join(dist, file)); } catch { throw new Error(`Missing build output: ${file}`); }
}
if (manifest.manifest_version !== 3) throw new Error("The extension must be Manifest V3");
await assertNoRemoteDependencies(dist);
console.log(`Built loadable MV3 extension in ${dist}`);
