import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(root);
const dist = join(projectRoot, "dist");

const expectedFiles = [
  "analysis.js",
  "background.js",
  "content.js",
  "fixtures.js",
  "manifest.json",
  "popup.html",
  "popup.js",
  "runtime.js",
  "state.js",
  "styles.css",
  "summary.html",
  "summary.js",
  "ui.js",
  "design-system/assets/icon-16.svg",
  "design-system/assets/icon.svg",
  "design-system/assets/logo-mark.svg",
  "design-system/tokens/base.css",
  "design-system/tokens/colors.css",
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
  assert.equal((await readFile(join(dist, "manifest.json"), "utf8")).includes('"manifest_version": 3'), true);

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
  assert.match(await readFile(join(dist, "design-system/tokens/typography.css"), "utf8"), /Space Grotesk/);
  assert.doesNotMatch(await readFile(join(dist, "design-system/tokens/typography.css"), "utf8"), /@import/i);
});
