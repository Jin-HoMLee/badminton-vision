import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = async (name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
const docs = async (name) => readFile(new URL(`../docs/${name}`, import.meta.url), "utf8");

test("the settings panel registers in every panel system list and stays density-independent", async () => {
  const state = await source("state.js");
  assert.match(state, /panels:\s*\{\s*feed:\s*false,\s*stats:\s*false,\s*map:\s*false,\s*controls:\s*false,\s*settings:\s*false\s*\}/);
  assert.match(state, /PANEL_VISIBILITY_KEYS = \["feed", "stats", "map", "controls", "settings"\]/);
  assert.match(state, /PANEL_LAYOUT_KEYS = \["courtSetup", "stats", "map", "feed", "manual", "controls", "settings"\]/);
  assert.match(state, /PANEL_COLLAPSE_KEYS = \["stats", "map", "feed", "manual", "controls", "settings"\]/);
  // Phase 1 ships read-only About content; the settings values container is
  // the documented Phase 2 home for display/inference preferences.
  assert.match(state, /settings:\s*\{\},/);
  // Density presets never own the settings panel.
  assert.doesNotMatch(state, /panelsForDensity[\s\S]{0,220}settings/);
});

test("content mounts settings furniture with About version and links, independent of inference", async () => {
  const content = await source("content.js");
  assert.match(content, /function settingsPanel\(\)/);
  assert.match(content, /layoutId: "settings"/);
  assert.match(content, /settings: \{\s*minWidth: 240, minHeight: 96, maxWidth: 420, maxHeight: 480, bottomReserve: PLAYER_CONTROLS_RESERVE\s*\}/);
  assert.match(content, /data-bso-settings-about/);
  assert.match(content, /data-bso-extension-version/);
  assert.match(content, /SETTINGS_ABOUT_LINKS/);
  assert.match(content, /data-bso-settings-links/);
  assert.match(content, /extensionVersion\(\)/);
  assert.match(content, /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(content, /version \|\| "—"/, "the version row fails open when no manifest is reachable");
  // The panel is a normal per-video toggle, is an overlay access-point
  // shortcut, and closes through the same TOGGLE_PANEL action as other panels.
  assert.match(content, /TOGGLE_PANEL[\s\S]{0,120}panel: "settings"/);
  assert.match(content, /overlayPanelShortcut\("Settings", "settings", "settings"/);
  assert.match(content, /Hide settings/);
  // About links are user-clicked only and never fetched by the extension.
  assert.match(content, /target: "_blank", rel: "noreferrer"/);
  // Mounting mirrors the independent-furniture rule for manual labeling and
  // withholds only when a camera-cut reseed hides every stale layer.
  assert.match(content, /state\.panels && state\.panels\.settings/);
  assert.match(content, /!\(state\.seeding && state\.cameraCut\)\) root\.appendChild\(settingsPanel\(\)\)/);
});

test("the popup gear and Panel Controls row toggle the same per-video settings panel", async () => {
  const popup = await source("popup.js");
  assert.match(popup, /data-bso-settings-toggle/);
  assert.match(popup, /function settingsHeaderButton\(\)/);
  assert.match(popup, /function toggleSettingsPanel\(\)/);
  assert.match(popup, /Show settings panel/);
  assert.match(popup, /Hide settings panel/);
  assert.match(popup, /Settings unavailable here/, "outside a watch page the gear says why it is disabled");
  assert.match(popup, /panelItems = \["feed", "stats", "map", "controls", "settings"\]/);
  assert.match(popup, /panelToggle\("Settings"/);
  assert.match(popup, /panel: "settings", value: next/);
});

test("the settings panel keeps the design-token hit and pointer contract", async () => {
  const css = await source("styles.css");
  // The default placement is bounded like the other panels' CSS defaults.
  assert.match(css, /\[data-bso-panel="settings"\]\s*\{\s*left:\s*var\(--overlay-gutter\);\s*top:\s*58px;[\s\S]{0,120}width:\s*min\(300px,\s*calc\(100% - 32px\)\)/);
  // About copy is token-styled only (no remote resources, no hard-coded sizes).
  assert.match(css, /\.bv-settings-about\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;\s*gap:\s*var\(--sp-4\);/);
  assert.match(css, /\.bv-settings-links a\s*\{[^}]*color:\s*var\(--lime-400\)/);
  assert.match(css, /\.bv-settings-note\s*\{[^}]*color:\s*var\(--text-muted\)/);
  // Panel-body pass-through covers the About links as real controls; the CSS
  // rule must keep anchors interactive inside an otherwise transparent body.
  assert.match(css, /\.bv-panel-body[\s\S]{0,40}a[\s\S]{0,80}\{\s*pointer-events:\s*auto;\s*\}/);
});

test("the Phase 2 settings extension point is documented next to the code", async () => {
  const guide = await docs("settings-panel.md");
  assert.match(guide, /Phase 1 ships/);
  assert.match(guide, /defaults\.settings/);
  assert.match(guide, /settingsPanel\(\)/);
  assert.match(guide, /SETTINGS_ABOUT_LINKS/);
  assert.match(guide, /state\.panels\.settings/);
  const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
  assert.match(agents, /docs\/settings-panel\.md/);
  assert.match(agents, /defaults\.settings/);
});
