import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const source = async (name) => readFile(new URL(name, root), "utf8");

test("popup exposes local actions and honest unavailable states", async () => {
  const popup = await source("popup.js");
  assert.match(popup, /data-bso-action.*open-overlay/);
  assert.match(popup, /saved for this video/);
  assert.match(popup, /data-bso-action.*manual-only/);
  assert.match(popup, /data-bso-action.*seed-court/);
  assert.match(popup, /data-bso-action.*disable/);
  assert.match(popup, /See match summary · download data/);
  assert.match(popup, /Production inference unavailable/);
  assert.match(popup, /Open a YouTube watch page first/);
  assert.match(popup, /sendToTab\(message, onDone\)/);
  assert.match(popup, /chrome\.scripting\.executeScript/);
  assert.match(popup, /chrome\.tabs\.create\(\{ url: summaryUrl\(origin\) \}, finish\)/);
});

test("the production runtime does not construct the retired plain-text overlay", async () => {
  const runtime = await source("extension/content/runtime.js");
  assert.match(runtime, /overlay = null/);
  assert.match(runtime, /retired plain-text status layer/);
  assert.doesNotMatch(runtime, /new BSOOverlay\\.OverlayAnchor/);
});

test("panel toggles and keyboard shortcuts are explicit and re-render safe", async () => {
  const content = await source("content.js");
  assert.match(content, /SET_PANELS/);
  assert.match(content, /data-bso-overlay-access/);
  assert.match(content, /data-bso-overlay-menu/);
  assert.match(content, /overlayPanelShortcut/);
  assert.match(content, /SET_DENSITY/);
  assert.match(content, /if \(state\.panels\.stats\) overlay\.appendChild\(statsPanel\(\)\)/);
  assert.match(content, /if \(state\.panels\.map\)/);
  assert.match(content, /runtimeEvidenceDrawing/);
  assert.match(content, /data-bso-player-count/);
  assert.match(content, /cameraCut/);
  assert.match(content, /TOGGLE_PANEL.*panel: \"stats\"/);
  assert.match(content, /TOGGLE_PANEL.*panel: \"map\"/);
  assert.match(content, /key === "o"/);
  assert.match(content, /key >= "1" && key <= "9"/);
  assert.match(content, /key === "s"/);
  assert.match(content, /key === "e"/);
  assert.match(content, /key === "escape"/);
  assert.match(content, /event\.key === "Enter"/);
  assert.match(content, /isInteractiveTarget/);
  assert.match(content, /window\.addEventListener\("keydown", handleKeyboardShortcuts\)/);
});

test("summary navigation and both CSV exports remain local", async () => {
  const summary = await source("summary.js");
  const analysis = await source("analysis.js");
  assert.match(summary, /function backToVideo/);
  assert.match(summary, /chrome\.tabs\.update/);
  assert.match(summary, /window\.history\.back/);
  assert.match(summary, /Shots CSV/);
  assert.match(summary, /Rallies CSV/);
  assert.match(summary, /bvState/);
  assert.match(analysis, /"video_url", "shot_id", "start_sec", "end_sec", "label"/);
});

test("responsive summary layout and fixture boundary messaging are shipped", async () => {
  const css = await source("styles.css");
  const summary = await source("summary.js");
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /\.bv-map-layout \{ flex-direction: column/);
  assert.match(summary, /Fixture analyzer boundary/);
  assert.match(summary, /not production CV/);
  assert.match(summary, /Local pose runtime active/);
  assert.match(summary, /storage\.onChanged/);
});
