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

function validCalibration() {
  const seedPoints = [{ x: 0.1, y: 0.8 }, { x: 0.9, y: 0.8 }, { x: 0.9, y: 0.2 }, { x: 0.1, y: 0.2 }];
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return {
    version: 1,
    coordinateSystem: "normalized-video-image",
    courtCoordinateSystem: "normalized-court",
    seedPoints,
    homography: { imageToCourt: identity, courtToImage: identity }
  };
}

test("public setup journey keeps minimal density and exposes reversible states", async () => {
  const state = await stateModule();
  let current = state.initialExtensionState();
  assert.equal(current.density, "minimal");
  assert.deepEqual(JSON.parse(JSON.stringify(current.panels)), { feed: false, stats: false, map: false, evidence: false, controls: false });
  assert.equal(current.trackerSettings.body, true);
  assert.equal(current.trackerSettings.shuttle, true);
  assert.equal(current.trackerSettings.players, false);
  assert.equal(current.panels.stats, false);
  current = state.reduceExtensionState(current, { type: "ENABLE" });
  assert.equal(current.enabled, true);
  assert.equal(current.seeding, false, "inference enable does not require court setup");
  assert.equal(state.courtConfigurationState(current), "uncalibrated");
  current = state.reduceExtensionState(current, { type: "START_SEED" });
  assert.equal(state.courtConfigurationState(current), "setup");
  const calibration = validCalibration();
  current = state.reduceExtensionState(current, { type: "LOCK_COURT", calibration, seedPoints: calibration.seedPoints });
  assert.equal(current.seeded, true);
  assert.equal(current.seeding, false);
  assert.equal(state.courtConfigurationState(current), "calibrated");
  current = state.reduceExtensionState(current, { type: "START_SEED" });
  assert.equal(state.courtConfigurationState(current), "recalibrating");
  assert.equal(current.enabled, true);
  current = state.reduceExtensionState(current, { type: "RESET_COURT" });
  assert.equal(current.enabled, true, "clearing court configuration does not disable inference");
  assert.equal(state.courtConfigurationState(current), "setup");
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

test("malformed court records return to first-use setup without disabling inference", async () => {
  const state = await stateModule();
  const malformed = [
    { version: 1 },
    Object.assign(validCalibration(), { seedPoints: validCalibration().seedPoints.slice(0, 3) }),
    Object.assign(validCalibration(), { homography: { imageToCourt: [[1, 0], [0, 1]], courtToImage: null } })
  ];
  malformed.forEach((calibration) => {
    const current = state.initialExtensionState({ enabled: true, seeded: true, calibration });
    assert.equal(state.courtConfigurationState(current), "uncalibrated");
    assert.equal(current.seeded, false);
    assert.equal(current.calibration, null);
    assert.equal(current.enabled, true);
  });
});

test("default overlay preferences are evidence-only, video-local, and reversible", async () => {
  const state = await stateModule();
  const videoA = state.videoKeyForUrl("https://www.youtube.com/watch?v=alpha");
  const videoB = state.videoKeyForUrl("https://www.youtube.com/watch?v=beta");
  let current = state.stateForVideo(state.initialExtensionState(), videoA);
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL", panel: "stats", value: true });
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL", panel: "evidence", value: true });
  current = state.reduceExtensionState(current, { type: "SET_TRACKER", tracker: "body", value: false });
  assert.equal(current.panels.stats, true);
  assert.equal(current.trackerSettings.body, false);
  assert.deepEqual(JSON.parse(JSON.stringify(current.panelsByVideo[videoA])), { feed: false, stats: true, map: false, evidence: true, controls: false });

  const otherVideo = state.stateForVideo(current, videoB);
  assert.deepEqual(JSON.parse(JSON.stringify(otherVideo.panels)), { feed: false, stats: false, map: false, evidence: false, controls: false });
  assert.equal(otherVideo.trackerSettings.body, true);
  const restored = state.stateForVideo(current, videoA);
  assert.equal(restored.panels.stats, true);
  assert.equal(restored.trackerSettings.body, false);

  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "full" });
  assert.equal(current.panels.feed, true);
  assert.equal(current.panels.map, true);
  assert.equal(current.panels.evidence, true);
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "minimal" });
  assert.equal(current.panels.stats, true, "an explicit panel choice survives a density change");
  assert.equal(current.panels.feed, false);
  assert.equal(current.panels.map, false);
  assert.equal(current.panels.evidence, true, "an explicit evidence-panel choice survives a density change");
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
  const calibration = validCalibration();
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

test("panel collapse and court-line visibility persist per video like layout state", async () => {
  const state = await stateModule();
  const videoA = state.videoKeyForUrl("https://www.youtube.com/watch?v=alpha");
  const videoB = state.videoKeyForUrl("https://www.youtube.com/watch?v=beta");
  let current = state.initialExtensionState({ videoKey: videoA });

  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "feed", videoKey: videoA, value: true });
  assert.equal(current.collapsedPanels.feed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(current.collapsedPanelsByVideo[videoA])), { feed: true });
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "evidence", videoKey: videoA, value: true });
  assert.deepEqual(JSON.parse(JSON.stringify(current.collapsedPanels)), { feed: true, evidence: true });
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "feed", videoKey: videoA, value: false });
  assert.equal(current.collapsedPanels.feed, undefined);
  // Non-collapsible panels (the transient setup card) are ignored.
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "courtSetup", videoKey: videoA, value: true });
  assert.equal(current.collapsedPanels.courtSetup, undefined);
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "evidence", videoKey: videoA, value: true });

  const persisted = JSON.parse(JSON.stringify(current));
  const restoredA = state.stateForVideo(persisted, videoA);
  const restoredB = state.stateForVideo(persisted, videoB);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredA.collapsedPanels)), { evidence: true }, "collapse is restored for the same video");
  assert.deepEqual(JSON.parse(JSON.stringify(restoredB.collapsedPanels)), {}, "collapse does not leak to another video");

  // Court-setup lines: explicit hides are video-scoped; default is visible.
  assert.equal(state.courtLinesForVideo(current, videoA), true);
  current = state.reduceExtensionState(current, { type: "SET_COURT_LINES", videoKey: videoA, value: false });
  assert.equal(state.courtLinesForVideo(current, videoA), false);
  assert.equal(state.courtLinesForVideo(current, videoB), true);
  const restoredLines = state.stateForVideo(JSON.parse(JSON.stringify(current)), videoA);
  assert.equal(state.courtLinesForVideo(restoredLines, videoA), false);
  current = state.reduceExtensionState(current, { type: "SET_COURT_LINES", videoKey: videoA, value: true });
  assert.equal(state.courtLinesForVideo(current, videoA), true);

  // Evidence visibility is a panel like the rest: an explicit toggle survives
  // density presets and partial SET_PANELS messages.
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL", panel: "evidence", value: false });
  assert.equal(current.panels.evidence, false);
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "full" });
  assert.equal(current.panels.evidence, false, "density presets do not resurrect the evidence panel");
  assert.equal(current.panels.stats, true);
  current = state.reduceExtensionState(current, { type: "SET_PANELS", panels: { feed: false } });
  assert.equal(current.panels.evidence, false, "partial panel messages keep other explicit toggles");
  assert.equal(current.panels.feed, false);
  current = state.reduceExtensionState(current, { type: "SET_PANELS", panels: { evidence: true } });
  assert.equal(current.panels.evidence, true);
});
