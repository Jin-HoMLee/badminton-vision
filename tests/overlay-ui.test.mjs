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
  // Every overlay layer passes pointer events through by default; only the
  // explicit interactive surfaces (stacks, panels, seed layer) opt back in.
  assert.match(css, /\.bv-overlay-root\s*>\s*\*\s*\{\s*pointer-events:\s*none\s*;/);
  assert.match(css, /\.bv-overlay-stack,\s*\.bv-overlay-empty,[^}]*\[data-bso-panel-layout\]:not\(\.bv-panel\)[^}]*\.bv-seed-layer\s*\{\s*pointer-events:\s*auto\s*;/s);
  assert.match(css, /\.bv-runtime-evidence\s*\{[^}]*pointer-events:\s*none\s*;/s);
  assert.match(css, /\.bv-overlay-root\s*>\s*\.bv-runtime-evidence\s*\{\s*pointer-events:\s*none\s*;/);
  // Panel chrome also passes through: the header/footer/resize surfaces and
  // actual controls keep their hit areas, empty body space never blocks the
  // player (including popups such as YouTube's settings menu).
  assert.match(css, /\.bv-panel\s*\{\s*pointer-events:\s*none\s*;/);
  assert.match(css, /\.bv-panel-header,\s*\.bv-panel-footer,\s*\.bv-panel-resize-handle\s*\{\s*pointer-events:\s*auto\s*;/);
  assert.match(css, /\.bv-panel-body\s*\{\s*pointer-events:\s*none\s*;/);
  assert.match(css, /\.bv-panel-body\s*button,[^}]*\[role="button"\][^}]*\.bv-feed[^}]*\{\s*pointer-events:\s*auto\s*;/s);
  assert.match(css, /\.bv-label-panel \.bv-panel-body\s*\{\s*pointer-events:\s*auto\s*;/);
  // The seed layer's capture surface ends at the player control strip.
  assert.match(css, /\.bv-seed-layer\s*\{[^}]*clip-path:\s*inset\(0 0 var\(--overlay-controls-reserve\) 0\)/s);
  assert.match(css, /\.bv-overlay-root \.bv-panel\s*\{[^}]*background:\s*var\(--ink-900\)[^}]*border-color:\s*var\(--border-subtle\)[^}]*box-shadow:/s);
});

test("overlay panels reserve the native player strip and every panel collapses from its header", async () => {
  const css = await read("src/styles.css");
  const ui = await read("src/ui.js");
  const content = await read("src/content.js");
  const state = await read("src/state.js");
  // The bottom strip is reserved in tokens, default placement, and clamping.
  assert.match(css, /--overlay-controls-reserve:\s*72px/);
  assert.match(css, /\[data-bso-panel="map"\]\s*\{[^}]*bottom:\s*calc\(var\(--overlay-controls-reserve\) \+ 16px\)/s);
  assert.match(css, /\[data-bso-panel="controls"\]\s*\{[^}]*bottom:\s*var\(--overlay-controls-reserve\)/s);
  assert.match(content, /PLAYER_CONTROLS_RESERVE = 72/);
  assert.match(content, /bottomReserve: PLAYER_CONTROLS_RESERVE/);
  // The court projection is one toggle: the calibrated court polygon over the
  // video, backed by the per-video court-lines store. There is no second,
  // confusing "setup lines" control.
  assert.match(css, /--court-setup-line:\s*var\(--lime-400\)/);
  assert.match(css, /--court-setup-net:\s*var\(--lime-300\)/);
  assert.match(content, /stroke: line\.role === "net" \? "var\(--court-setup-net\)" : "var\(--court-setup-line\)"/);
  assert.match(content, /ui\.toggle\("Court projection"/);
  assert.doesNotMatch(content, /ui\.toggle\("Court setup lines"/);
  assert.doesNotMatch(content, /name: "court", label: "Court projection"/);
  assert.match(content, /data-bso-court-projection-toggle/);
  // Collapse (chevron, aria-expanded) and close (x icon) are visually and
  // semantically distinct header affordances.
  assert.match(ui, /data-bso-panel-collapse/);
  assert.match(ui, /bv-panel-collapsed/);
  assert.match(ui, /if \(movable && opts\.collapsible !== false\)/);
  assert.match(ui, /aria-expanded/);
  assert.match(css, /\.bv-panel-layout\.bv-panel-collapsed/);
  assert.match(content, /TOGGLE_PANEL_COLLAPSE/);
  assert.match(content, /if \(state\.panels\.evidence\) overlay\.appendChild\(evidenceVisibilityPanel\(\)\)/);
  assert.match(content, /courtLinesVisible\(\)\) overlay\.appendChild\(calibrationDrawing\(\)\)/);
  assert.match(content, /SET_COURT_LINES/);
  assert.match(content, /iconButton\("x", "Hide evidence visibility"/);
  assert.match(content, /iconButton\("x", "Hide stats"/);
  assert.match(content, /iconButton\("x", "Hide court map"/);
  assert.match(content, /iconButton\("x", "Hide stroke feed"/);
  assert.doesNotMatch(content, /iconButton\("chevron-(up|down)", "Hide (stats|court map|stroke feed|evidence visibility)"/);
  // The evidence panel is a panel like the rest: hidden in Minimal and
  // re-openable from the popup panel list or the in-video access point.
  assert.match(state, /panels: \{ feed: false, stats: false, map: false, evidence: false, controls: false \}/);
  assert.match(state, /trackerSettings: \{ court: true, players: false, body: true, shuttle: true, racket: true \}/);
  assert.match(content, /data-bso-overlay-access/);
  assert.match(content, /data-bso-overlay-menu/);
  assert.match(css, /\.bv-overlay-access\s*\{[^}]*top:\s*var\(--overlay-gutter\)[^}]*right:\s*var\(--overlay-gutter\)/s);
  assert.match(await read("src/popup.js"), /panelToggle\("Evidence visibility"/);
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

test("the stroke feed renders every entry inside a scrollable bounded body", async () => {
  const css = await read("src/styles.css");
  assert.match(css, /\.bv-feed\s*\{[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(css, /\.bv-feed\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.bv-manual-saved \.bv-feed\s*\{[^}]*overflow-y:\s*auto/s);
});

test("popup font packaging is local-only and records the supplied-system limitation", async () => {
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
