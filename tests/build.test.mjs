import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(root);
const dist = join(projectRoot, "dist");

const expectedFiles = [
  "content.bundle.js",
  "analysis.js",
  "analysis-primitives.js",
  "calibration.js",
  "content.js",
  "fixtures.js",
  "manifest.json",
  "popup.html",
  "popup.js",
  "review.js",
  "runtime.js",
  "seed-card.js",
  "state.js",
  "styles.css",
  "summary.html",
  "summary.js",
  "ui.js",
  "background/service-worker.js",
  "common/capabilities.js",
  "common/player-tracking.js",
  "common/frame-transport.js",
  "common/protocol.js",
  "common/synchronization.js",
  "content/capture.js",
  "content/runtime.js",
  "content/video-discovery.js",
  "offscreen/analyzer.js",
  "offscreen/fixture-model.js",
  "offscreen/lite-openpose-adapter.js",
  "offscreen/lite-runtime-loader.js",
  "offscreen/movenet-adapter.js",
  "offscreen/shuttle-tracking-adapter.js",
  "offscreen/offscreen.html",
  "offscreen/offscreen.js",
  "offscreen/vendor/lite-openpose/LICENSE",
  "offscreen/vendor/lite-openpose/MODEL-NOTICE.md",
  "offscreen/vendor/lite-openpose/pose_256.tflite",
  "offscreen/vendor/litert/LICENSE",
  "offscreen/vendor/litert/LITERT-README.md",
  "offscreen/vendor/litert/core.js",
  "offscreen/vendor/litert/litert_wasm_compat_internal.js",
  "offscreen/vendor/litert/litert_wasm_compat_internal.wasm",
  "offscreen/vendor/litert/litert_wasm_internal.js",
  "offscreen/vendor/litert/litert_wasm_internal.wasm",
  "offscreen/vendor/litert/wasm-utils.js",
  "design-system/assets/icon-16.svg",
  "design-system/assets/icon-32.svg",
  "design-system/assets/icon.svg",
  "design-system/assets/logo-mark.svg",
  "design-system/tokens/base.css",
  "design-system/tokens/colors.css",
  "design-system/tokens/fonts.css",
  "design-system/tokens/elevation.css",
  "design-system/tokens/motion.css",
  "design-system/tokens/spacing.css",
  "design-system/tokens/typography.css"
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(relative(dist, path));
  }
  return files;
}

test("production build contains only local runtime design-system assets", async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], { cwd: projectRoot });

  assert.deepEqual((await listFiles(dist)).sort(), expectedFiles.sort());
  const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background/service-worker.js");
  assert.equal(manifest.permissions.includes("offscreen"), true);
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.equal(Object.hasOwn(manifest, "message_serialization"), false);
  assert.equal(manifest.action.default_icon["16"], "design-system/assets/icon-16.svg");
  assert.equal(manifest.action.default_icon["32"], "design-system/assets/icon-32.svg");
  assert.equal(manifest.icons["16"], "design-system/assets/icon-16.svg");
  assert.equal(manifest.icons["32"], "design-system/assets/icon-32.svg");
  assert.equal(manifest.web_accessible_resources.some((entry) => entry.resources.includes("design-system/tokens/*")), true);
  assert.deepEqual(manifest.content_scripts?.flatMap((entry) => entry.js || []), ["content.bundle.js"]);
  const contentBundle = await readFile(join(dist, "content.bundle.js"), "utf8");
  assert.doesNotThrow(() => new vm.Script(contentBundle, { filename: "dist/content.bundle.js" }));
  assert.match(contentBundle, /__BV_CONTENT_BUNDLE_LOADED__/);

  const cssFiles = (await listFiles(dist)).filter((file) => file.endsWith(".css"));
  const textFiles = await Promise.all((await listFiles(dist)).map(async (file) => ({
    file,
    source: await readFile(join(dist, file), "utf8")
  })));
  const remoteScriptTag = /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:(?:https?:)?\/\/)/i;
  const remoteCssImport = /@import\s+(?:url\s*\(\s*)?["']?\s*(?:(?:https?:)?\/\/)/i;
  const remoteCssAsset = /url\s*\(\s*["']?\s*(?:(?:https?:)?\/\/)/i;

  for (const { file, source } of textFiles) {
    assert.doesNotMatch(source, remoteScriptTag, `${file} contains a remote script tag`);
    assert.doesNotMatch(source, remoteCssImport, `${file} contains a remote CSS import`);
    if (file.endsWith(".css")) {
      assert.doesNotMatch(source, remoteCssAsset, `${file} contains a remote CSS asset`);
    }
  }

  assert.ok(cssFiles.includes("styles.css"));
  assert.equal((await listFiles(dist)).includes("background.js"), false);
  assert.equal((await listFiles(dist)).includes("manifest.runtime.json"), false);
  assert.equal((await listFiles(dist)).includes("content/overlay.js"), false);
  assert.match(await readFile(join(dist, "design-system/tokens/typography.css"), "utf8"), /Space Grotesk/);
  assert.match(await readFile(join(dist, "design-system/tokens/fonts.css"), "utf8"), /system-ui/);
  assert.doesNotMatch(await readFile(join(dist, "design-system/tokens/fonts.css"), "utf8"), /(?:@import|@font-face|https?:\/\/)/i);
  assert.doesNotMatch(await readFile(join(dist, "design-system/tokens/typography.css"), "utf8"), /@import/i);
  assert.match(await readFile(join(dist, "content.js"), "utf8"), /data-bso-frame-transport/);
  assert.match(await readFile(join(dist, "content.js"), "utf8"), /data-bso-court-seeding/);
  assert.match(await readFile(join(dist, "popup.js"), "utf8"), /data-bso-youtube-detected/);
});
