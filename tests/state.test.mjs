import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function stateModule() {
  const source = await readFile(new URL("../src/state.js", import.meta.url), "utf8");
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: "state.js" });
  return context.globalThis.BVState;
}

test("public setup journey keeps minimal density and exposes reversible states", async () => {
  const state = await stateModule();
  let current = state.initialExtensionState();
  assert.equal(current.density, "minimal");
  assert.equal(current.panels.stats, false);
  current = state.reduceExtensionState(current, { type: "ENABLE" });
  assert.equal(current.seeding, true);
  current = state.reduceExtensionState(current, { type: "LOCK_COURT" });
  assert.equal(current.seeded, true);
  assert.equal(current.seeding, false);
  assert.equal(current.density, "minimal");
  current = state.reduceExtensionState(current, { type: "OPEN_LABELING" });
  assert.equal(current.labeling, true);
  current = state.reduceExtensionState(current, { type: "CLOSE_LABELING" });
  assert.equal(current.labeling, false);
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL", panel: "stats", value: true });
  assert.equal(current.panels.stats, true);
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "full" });
  assert.equal(current.panels.stats, true);
  assert.equal(current.panels.map, true);
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL", panel: "map", value: false });
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "minimal" });
  assert.equal(current.panels.map, false);
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "full" });
  assert.equal(current.panels.map, false);
  current = state.reduceExtensionState(current, { type: "OPEN_OVERLAY" });
  assert.equal(current.enabled, true);
  current = state.reduceExtensionState(current, { type: "DISABLE" });
  assert.equal(current.enabled, false);
  assert.equal(current.panels.stats, true);
  assert.equal(current.panelOverrides.map, false);
});

test("court instruction position is video-local, normalized, and safely reset", async () => {
  const state = await stateModule();
  const videoA = state.videoKeyForUrl("https://www.youtube.com/watch?v=alpha");
  const videoB = state.videoKeyForUrl("https://www.youtube.com/watch?v=beta");
  let current = state.initialExtensionState({ videoKey: videoA, seedCardPosition: { x: 0.42, y: 0.18 } });
  assert.deepEqual(JSON.parse(JSON.stringify(current.seedCardPosition)), { x: 0.42, y: 0.18 });
  current = state.reduceExtensionState(current, { type: "SET_SEED_CARD_POSITION", position: { x: 3, y: -1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(current.seedCardPosition)), { x: 1, y: 0 });
  const reset = state.resetVideoLocalState(current, videoB);
  assert.equal(reset.videoKey, videoB);
  assert.equal(reset.seedCardPosition, null);
  assert.equal(state.reduceExtensionState(current, { type: "RESET_COURT" }).seedCardPosition, null);
  assert.equal(state.reduceExtensionState(current, { type: "CAMERA_CUT" }).seedCardPosition, null);
});

test("video-local calibration state persists for one video and resets on navigation", async () => {
  const state = await stateModule();
  const videoA = state.videoKeyForUrl("https://www.youtube.com/watch?v=alpha");
  const videoB = state.videoKeyForUrl("https://www.youtube.com/watch?v=beta");
  const calibration = { version: 1, coordinateSystem: "normalized-video-image" };
  let current = state.initialExtensionState({ videoKey: videoA });
  current = state.reduceExtensionState(current, {
    type: "LOCK_COURT",
    calibration,
    seedPoints: [{ x: 0.1, y: 0.8 }, { x: 0.9, y: 0.8 }, { x: 0.9, y: 0.2 }, { x: 0.1, y: 0.2 }]
  });
  const persisted = state.initialExtensionState(JSON.parse(JSON.stringify(current)));
  assert.equal(persisted.videoKey, videoA);
  assert.equal(persisted.seedPoints[0].x, 0.1);
  assert.equal(persisted.seedPoints[0].y, 0.8);
  assert.equal(JSON.stringify(persisted.calibration), JSON.stringify(calibration));
  const reset = state.resetVideoLocalState(persisted, videoB);
  assert.equal(reset.videoKey, videoB);
  assert.equal(reset.seeded, false);
  assert.equal(reset.calibration, null);
  assert.equal(reset.seedPoints.length, 0);
  assert.equal(reset.density, "minimal");
  assert.equal(reset.manualLabels.length, 0);
});

test("manual review records persist by event id and reset with the video", async () => {
  const state = await stateModule();
  const label = { eventId: "r14-s07", shot: "Smash", source: "manual", status: "corrected", axes: { Timing: "late" } };
  let current = state.initialExtensionState({ manualLabels: [label] });
  assert.equal(current.manualLabels[0].eventId, "r14-s07");
  assert.equal(current.manualLabels[0].axes.Timing, "late");
  current = state.reduceExtensionState(current, { type: "DISABLE" });
  assert.equal(current.manualLabels.length, 1);
  current = state.resetVideoLocalState(current, "youtube:next");
  assert.equal(current.manualLabels.length, 0);
});

test("camera-cut invalidation requires a fresh seed", async () => {
  const state = await stateModule();
  const current = state.reduceExtensionState({ seeded: true, calibration: { version: 1 }, seedPoints: [{ x: 0, y: 0 }] }, { type: "CAMERA_CUT" });
  assert.equal(current.seeded, false);
  assert.equal(current.seeding, true);
  assert.equal(current.stale, true);
  assert.equal(current.calibration, null);
  assert.equal(current.seedPoints.length, 0);
});
