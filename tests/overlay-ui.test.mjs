import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(projectRoot, path), "utf8");
const tokenFiles = [
  "design-system/tokens/colors.css",
  "design-system/tokens/elevation.css",
  "design-system/tokens/motion.css",
  "design-system/tokens/spacing.css",
  "design-system/tokens/typography.css"
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("all design-system token sheets retain the shadow-root host contract and values", async () => {
  const manifest = JSON.parse(await read("design-system/_ds_manifest.json"));
  const sources = await Promise.all(tokenFiles.map(async (file) => [file, await read(file)]));
  const byFile = new Map(sources);

  for (const [file, source] of sources) {
    assert.match(source, /:root\s*,\s*:host\s*\{/,
      `${file} must expose tokens to both document and shadow roots`);
    assert.doesNotMatch(source, /^\s*:root\s*\{/,
      `${file} must not regress to a :root-only token rule`);
  }

  for (const token of manifest.tokens) {
    const source = byFile.get(`design-system/${token.definedIn}`);
    assert.ok(source, `manifest token source is shipped: ${token.definedIn}`);
    assert.match(source, new RegExp(`${escapeRegExp(token.name)}\\s*:\\s*${escapeRegExp(token.value)}\\s*;`),
      `${token.name} value must remain the supplied design token`);
  }
});

test("overlay geometry, treatment, and hit targets cannot fall back when mounted in Shadow DOM", async () => {
  const css = await read("src/styles.css");
  assert.match(css, /@import url\("\.\/design-system\/tokens\/fonts\.css"\)/);
  assert.match(css, /\.bv-overlay-stack\.left\s*\{[^}]*left:\s*var\(--overlay-gutter\)[^}]*top:\s*var\(--overlay-gutter\)/s);
  assert.match(css, /\.bv-overlay-stack\.right\s*\{[^}]*right:\s*var\(--overlay-gutter\)[^}]*top:\s*var\(--overlay-gutter\)[^}]*width:\s*var\(--overlay-panel-width\)/s);
  assert.match(css, /\.bv-overlay-label\s*\{[^}]*right:\s*var\(--overlay-gutter\)[^}]*top:\s*var\(--overlay-gutter\)[^}]*bottom:\s*var\(--overlay-gutter\)/s);
  assert.match(css, /\.bv-overlay-actions\s*\{[^}]*right:\s*var\(--overlay-gutter\)[^}]*bottom:/s);
  assert.match(css, /\.bv-icon-button\s*\{[^}]*width:\s*var\(--control-height-md\)[^}]*height:\s*var\(--control-height-md\)/s);
  assert.match(css, /\.bv-overlay-root\s*>\s*\*\s*\{\s*pointer-events:\s*auto\s*;/);
  assert.match(css, /\.bv-runtime-evidence\s*\{[^}]*pointer-events:\s*none\s*;/s);
  assert.match(css, /\.bv-overlay-root\s*>\s*\.bv-runtime-evidence\s*\{\s*pointer-events:\s*none\s*;/);
  assert.match(css, /\.bv-overlay-root \.bv-panel\s*\{[^}]*background:\s*var\(--ink-900\)[^}]*border-color:\s*var\(--border-subtle\)[^}]*box-shadow:/s);
});

test("popup actions and overlay panel toggles remain wired", async () => {
  const popup = await read("src/popup.js");
  const content = await read("src/content.js");
  for (const label of ["Minimal", "Balanced", "Full", "Set up court", "Label it myself"]) {
    assert.match(popup, new RegExp(escapeRegExp(label)));
  }
  for (const action of ["seed-court", "manual-only", "open-overlay"]) assert.match(popup, new RegExp(`data-bso-action.*${action}`));
  for (const panel of ["stats", "map", "feed"]) assert.match(content, new RegExp(`TOGGLE_PANEL.*panel: "${panel}"`));
  assert.match(content, /function openLabeling/);
});

test("font packaging is local-only and records the supplied-system limitation", async () => {
  const fonts = await read("design-system/tokens/fonts.css");
  const typography = await read("design-system/tokens/typography.css");
  const manifest = JSON.parse(await read("manifest.json"));
  assert.doesNotMatch(fonts, /@import|@font-face|(?:https?:)?\/\//i);
  assert.match(fonts, /:root\s*,\s*:host\s*\{/);
  assert.match(typography, /system-ui/);
  assert.match(typography, /ui-monospace/);
  assert.equal(manifest.web_accessible_resources.some((entry) => entry.resources.includes("design-system/tokens/*")), true);
  assert.match(await read("docs/overlay-ui.md"), /no redistributable font binaries/);
  assert.match(await read("docs/overlay-ui.md"), /does not fetch Google Fonts/);
});
