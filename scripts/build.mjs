import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Script } from "node:vm";
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
  "calibration.js",
  "content.js",
  "fixtures.js",
  "popup.html",
  "popup.js",
  "review.js",
  "runtime.js",
  "panel-layout.js",
  "seed-card.js",
  "state.js",
  "styles.css",
  "summary.html",
  "summary.js",
  "ui.js"
];
const browserPrimitiveFiles = [
  ["analysis/index.js", "analysis-primitives.js"]
];
const runtimeFiles = [
  ["background/service-worker.js", "background/service-worker.js"],
  ["common/protocol.js", "common/protocol.js"],
  ["common/player-tracking.js", "common/player-tracking.js"],
  ["common/capabilities.js", "common/capabilities.js"],
  ["common/synchronization.js", "common/synchronization.js"],
  ["common/frame-transport.js", "common/frame-transport.js"],
  ["content/capture.js", "content/capture.js"],
  ["content/video-discovery.js", "content/video-discovery.js"],
  ["content/runtime.js", "content/runtime.js"],
  ["offscreen/analyzer.js", "offscreen/analyzer.js"],
  ["offscreen/movenet-adapter.js", "offscreen/movenet-adapter.js"],
  ["offscreen/lite-runtime-loader.js", "offscreen/lite-runtime-loader.js"],
  ["offscreen/lite-openpose-adapter.js", "offscreen/lite-openpose-adapter.js"],
  // The bounded local shuttle adapter is loaded by offscreen.html and composed
  // with production pose results; it has no model weights or network path.
  ["offscreen/shuttle-tracking-adapter.js", "offscreen/shuttle-tracking-adapter.js"],
  ["offscreen/fixture-model.js", "offscreen/fixture-model.js"],
  ["offscreen/vendor/lite-openpose/pose_256.tflite", "offscreen/vendor/lite-openpose/pose_256.tflite"],
  ["offscreen/vendor/lite-openpose/LICENSE", "offscreen/vendor/lite-openpose/LICENSE"],
  ["offscreen/vendor/litert/core.js", "offscreen/vendor/litert/core.js"],
  ["offscreen/vendor/litert/wasm-utils.js", "offscreen/vendor/litert/wasm-utils.js"],
  ["offscreen/vendor/litert/litert_wasm_internal.js", "offscreen/vendor/litert/litert_wasm_internal.js"],
  ["offscreen/vendor/litert/litert_wasm_internal.wasm", "offscreen/vendor/litert/litert_wasm_internal.wasm"],
  ["offscreen/vendor/litert/litert_wasm_compat_internal.js", "offscreen/vendor/litert/litert_wasm_compat_internal.js"],
  ["offscreen/vendor/litert/litert_wasm_compat_internal.wasm", "offscreen/vendor/litert/litert_wasm_compat_internal.wasm"],
  ["offscreen/vendor/litert/LICENSE", "offscreen/vendor/litert/LICENSE"],
  ["offscreen/vendor/litert/LITERT-README.md", "offscreen/vendor/litert/LITERT-README.md"],
  ["offscreen/vendor/lite-openpose/MODEL-NOTICE.md", "offscreen/vendor/lite-openpose/MODEL-NOTICE.md"],
  ["offscreen/offscreen.html", "offscreen/offscreen.html"],
  ["offscreen/offscreen.js", "offscreen/offscreen.js"]
];
const manifestIcons = {
  "16": "design-system/assets/icon-16.png",
  "32": "design-system/assets/icon-32.png",
  "48": "design-system/assets/icon-48.png",
  "128": "design-system/assets/icon-128.png"
};
const designSystemFiles = [
  "tokens/fonts.css",
  "tokens/base.css",
  "tokens/colors.css",
  "tokens/elevation.css",
  "tokens/motion.css",
  "tokens/spacing.css",
  "tokens/typography.css",
  "assets/icon-16.svg",
  "assets/icon-32.svg",
  "assets/icon.svg",
  "assets/logo-mark.svg",
  ...Object.values(manifestIcons).map((file) => file.replace("design-system/", ""))
];

const contentBundleSources = [
  "src/extension/common/protocol.js",
  "src/extension/common/player-tracking.js",
  "src/extension/common/frame-transport.js",
  "src/extension/common/capabilities.js",
  "src/extension/common/synchronization.js",
  "src/extension/content/capture.js",
  "src/extension/content/video-discovery.js",
  "src/extension/content/runtime.js",
  "src/runtime.js",
  "src/analysis.js",
  "analysis/index.js",
  "src/calibration.js",
  "src/panel-layout.js",
  "src/seed-card.js",
  "src/fixtures.js",
  "src/review.js",
  "src/state.js",
  "src/ui.js",
  "src/content.js"
];

async function copyFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

async function writeContentBundle(destination) {
  if (new Set(contentBundleSources).size !== contentBundleSources.length) {
    throw new Error("Content bundle source list must not contain duplicate entrypoints");
  }
  const sources = await Promise.all(contentBundleSources.map(async (file) => {
    const source = await readFile(join(root, file), "utf8");
    return `/* ${file} */\n${source}`;
  }));
  const bundle = [
    "/* Generated single-entry MV3 content script. Do not edit dist directly. */",
    "(function (root) {",
    "  if (root.__BV_CONTENT_BUNDLE_LOADED__) return;",
    "  root.__BV_CONTENT_BUNDLE_LOADED__ = true;",
    ...sources.map((source) => source.replace(/^/gm, "  ")),
    "})(typeof globalThis === \"object\" ? globalThis : self);",
    ""
  ].join("\n");
  // Parse the generated artifact before writing it. This catches accidental
  // concatenation regressions (especially top-level lexical collisions) at
  // build time rather than after Chrome has injected the content script.
  new Script(bundle, { filename: relative(root, destination) });
  await writeFile(destination, bundle, "utf8");
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

function parseXmlAttributes(source, file) {
  const attributes = {};
  let remainder = source;
  while (remainder.length) {
    if (!remainder.trim()) break;
    const match = /^\s+([A-Za-z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/.exec(remainder);
    if (!match) throw new Error(`Invalid SVG attributes in ${file}: ${remainder.trim()}`);
    if (Object.hasOwn(attributes, match[1])) throw new Error(`Duplicate SVG attribute in ${file}: ${match[1]}`);
    attributes[match[1]] = match[2].slice(1, -1);
    remainder = remainder.slice(match[0].length);
  }
  return attributes;
}

function assertValidSvg(source, file) {
  const xml = source.replace(/<!--[\s\S]*?-->/g, "");
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\b)|<(?:script|foreignObject)\b/i.test(xml)) {
    throw new Error(`Unsafe or unsupported SVG content in ${file}`);
  }

  const stack = [];
  let cursor = 0;
  let rootAttributes;
  let roots = 0;
  const tagPattern = /<(\/?)\s*([A-Za-z_][\w:.-]*)([^<>]*?)(\/?)>/g;
  for (const match of xml.matchAll(tagPattern)) {
    if (xml.slice(cursor, match.index).trim()) throw new Error(`Invalid SVG markup in ${file}`);
    cursor = match.index + match[0].length;
    const [, closing, name, attributeSource, selfClosing] = match;
    if (closing) {
      if (attributeSource.trim() || selfClosing || stack.pop() !== name) {
        throw new Error(`Mismatched SVG element in ${file}: ${name}`);
      }
      continue;
    }

    const attributes = parseXmlAttributes(attributeSource, file);
    if (!stack.length) {
      roots += 1;
      if (roots > 1 || name !== "svg") throw new Error(`Invalid SVG root in ${file}`);
      rootAttributes = attributes;
    }
    if (!selfClosing) stack.push(name);
  }
  if (xml.slice(cursor).trim() || stack.length || roots !== 1) throw new Error(`Unclosed or invalid SVG markup in ${file}`);
  if (rootAttributes.xmlns !== "http://www.w3.org/2000/svg") throw new Error(`Missing SVG namespace in ${file}`);

  const viewBox = rootAttributes.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error(`Invalid SVG viewBox in ${file}`);
  }
  if (!Number.isFinite(Number(rootAttributes.width)) || Number(rootAttributes.width) <= 0 ||
      !Number.isFinite(Number(rootAttributes.height)) || Number(rootAttributes.height) <= 0) {
    throw new Error(`Invalid SVG dimensions in ${file}`);
  }
  if (/\b(?:href|xlink:href)\s*=|\burl\s*\(/i.test(source)) throw new Error(`SVG must not reference external assets: ${file}`);
}

function assertPng(buffer, expectedSize, file) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(pngSignature) ||
      buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR" ||
      buffer.toString("ascii", buffer.length - 8, buffer.length - 4) !== "IEND") {
    throw new Error(`Invalid PNG icon: ${file}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`PNG icon ${file} must be ${expectedSize}x${expectedSize}, got ${width}x${height}`);
  }
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
for (const [source, destination] of browserPrimitiveFiles) await copyFile(join(root, source), join(dist, destination));
await copyFile(join(root, "manifest.json"), join(dist, "manifest.json"));
for (const [source, destination] of runtimeFiles) await copyFile(join(extension, source), join(dist, destination));
for (const file of designSystemFiles) await copyFile(join(designSystem, file), join(dist, "design-system", file));
await writeContentBundle(join(dist, "content.bundle.js"));

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || manifest.background?.service_worker !== "background/service-worker.js" ||
    !manifest.permissions?.includes("offscreen") || Object.hasOwn(manifest, "message_serialization")) {
  throw new Error("manifest.json is not the canonical stable-channel MV3 manifest");
}
for (const [surface, icons] of [["action.default_icon", manifest.action?.default_icon], ["icons", manifest.icons]]) {
  if (JSON.stringify(icons) !== JSON.stringify(manifestIcons)) {
    throw new Error(`${surface} must reference the canonical local PNG icon set`);
  }
  for (const [size, file] of Object.entries(icons)) {
    if (file.startsWith("/") || file.includes("\\") || file.split("/").includes("..") ||
        /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(file)) {
      throw new Error(`${surface}.${size} is not a local extension path: ${file}`);
    }
    assertPng(await readFile(join(dist, file)), Number(size), file);
  }
}
for (const file of ["icon-16.svg", "icon-32.svg", "icon.svg", "logo-mark.svg"]) {
  assertValidSvg(await readFile(join(dist, "design-system/assets", file), "utf8"), `design-system/assets/${file}`);
}
const required = [
  ...uiFiles,
  "content.bundle.js",
  "manifest.json",
  ...browserPrimitiveFiles.map(([, destination]) => destination),
  ...runtimeFiles.map(([, destination]) => destination),
  ...designSystemFiles.map((file) => join("design-system", file))
];
for (const file of required) {
  try { await stat(join(dist, file)); } catch { throw new Error(`Missing build output: ${file}`); }
}
const contentScripts = manifest.content_scripts?.flatMap((entry) => entry.js || []) || [];
if (contentScripts.length !== 1 || contentScripts[0] !== "content.bundle.js" || new Set(contentScripts).size !== contentScripts.length) {
  throw new Error("Manifest must inject exactly one singleton content bundle");
}
for (const file of contentScripts) {
  if (!required.includes(file)) throw new Error(`Manifest content script is not packaged: ${file}`);
}
const cssImportPattern = /@import\s+(?:url\(\s*["']([^"']+)["']\s*\)|["']([^"']+)["'])\s*;/g;
for (const file of required.filter((entry) => entry.endsWith(".css"))) {
  const css = await readFile(join(dist, file), "utf8");
  for (const match of css.matchAll(cssImportPattern)) {
    const imported = match[1] || match[2];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(imported)) continue;
    const importedPath = join(dirname(join(dist, file)), imported);
    try { await stat(importedPath); } catch { throw new Error(`Missing CSS import from ${file}: ${imported}`); }
  }
}
const offscreenHtml = await readFile(join(dist, "offscreen/offscreen.html"), "utf8");
for (const script of ["../common/protocol.js", "../common/player-tracking.js", "movenet-adapter.js", "lite-runtime-loader.js", "lite-openpose-adapter.js", "shuttle-tracking-adapter.js", "fixture-model.js", "analyzer.js", "offscreen.js"]) {
  if (!offscreenHtml.includes(`src="${script}"`)) throw new Error(`Packed offscreen document is missing ${script}`);
}
await assertNoRemoteDependencies(dist);
console.log(`Built canonical loadable MV3 extension in ${dist}`);
