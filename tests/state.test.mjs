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
  const imageToCourt = [[1.25, 0, -0.125], [0, -5 / 3, 4 / 3], [0, 0, 1]];
  const courtToImage = [[0.8, 0, 0.1], [0, -0.6, 0.8], [0, 0, 1]];
  return {
    version: 1,
    coordinateSystem: "normalized-video-image",
    courtCoordinateSystem: "normalized-court",
    seedPoints,
    homography: { imageToCourt, courtToImage }
  };
}

function identityRecord(seedPoints) {
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return Object.assign(validCalibration(), { seedPoints, homography: { imageToCourt: identity, courtToImage: identity } });
}

function frameCorners() {
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}

test("public setup journey keeps minimal density and exposes reversible states", async () => {
  const state = await stateModule();
  let current = state.initialExtensionState();
  assert.equal(current.density, "minimal");
  assert.deepEqual(JSON.parse(JSON.stringify(current.panels)), { feed: false, stats: false, map: false, controls: false, settings: false });
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
  const quad = validCalibration().seedPoints;
  const malformed = [
    { version: 1 },
    Object.assign(validCalibration(), { seedPoints: quad.slice(0, 3) }),
    Object.assign(validCalibration(), { homography: { imageToCourt: [[1, 0], [0, 1]], courtToImage: null } }),
    // Duplicate corners collapse the court quad even when the matrices are usable.
    identityRecord([quad[0], quad[1], quad[2], quad[0]]),
    // Three collinear corners cannot bound the court.
    identityRecord([{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.9, y: 0.8 }, { x: 0.5, y: 0.5 }]),
    // A self-intersecting click order is not a valid corner walk.
    identityRecord([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }]),
    // A singular matrix cannot project between image and court.
    Object.assign(validCalibration(), { homography: { imageToCourt: [[1, 2, 3], [1, 2, 3], [0, 0, 1]], courtToImage: [[0.8, 0, 0.1], [0, -0.6, 0.8], [0, 0, 1]] } })
  ];
  malformed.forEach((calibration) => {
    const current = state.initialExtensionState({ enabled: true, seeded: true, calibration });
    assert.equal(state.courtConfigurationState(current), "uncalibrated");
    assert.equal(current.seeded, false);
    assert.equal(current.calibration, null);
    assert.equal(current.enabled, true);
  });
});

test("calibration validity requires seed-to-corner correspondence, not just invertible matrices", async () => {
  const state = await stateModule();
  // A consistent fit-equivalent record with non-canonical seeds stays calibrated.
  const fitted = state.initialExtensionState({ seeded: true, calibration: validCalibration() });
  assert.equal(state.courtConfigurationState(fitted), "calibrated");
  assert.equal(fitted.seeded, true);
  // A court occupying the entire frame maps through identity matrices.
  const fullFrame = state.initialExtensionState({ seeded: true, calibration: identityRecord(frameCorners()) });
  assert.equal(state.courtConfigurationState(fullFrame), "calibrated");
  // Identity matrices that ignore where the seeds lie are not a calibration.
  const ignored = identityRecord(validCalibration().seedPoints);
  const rejected = state.initialExtensionState({ enabled: true, seeded: true, calibration: ignored });
  assert.equal(state.courtConfigurationState(rejected), "uncalibrated");
  assert.equal(rejected.seeded, false);
  assert.equal(rejected.calibration, null);
  assert.equal(rejected.enabled, true, "a rejected record never disables inference");
  // Both stored matrices must invert each other against the same seeds.
  const lopsided = state.initialExtensionState({ seeded: true, calibration: Object.assign(identityRecord(frameCorners()), { homography: { imageToCourt: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], courtToImage: [[0.8, 0, 0.1], [0, -0.6, 0.8], [0, 0, 1]] } }) });
  assert.equal(state.courtConfigurationState(lopsided), "uncalibrated");
  assert.equal(lopsided.seeded, false);
  assert.equal(lopsided.calibration, null);
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
  assert.deepEqual(JSON.parse(JSON.stringify(current.panelsByVideo[videoA])), { feed: false, stats: true, map: false, controls: false, settings: false });
  assert.equal(current.panels.evidence, undefined, "the retired standalone evidence panel has no visibility state owner");
  const legacy = state.initialExtensionState({ videoKey: videoA, panels: { evidence: true }, panelLayouts: { evidence: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 } }, collapsedPanels: { evidence: true } });
  assert.equal(legacy.panels.evidence, undefined, "legacy panel visibility cannot resurrect the standalone surface");
  assert.equal(legacy.panelLayouts.evidence, undefined, "legacy evidence geometry is discarded");
  assert.equal(legacy.collapsedPanels.evidence, undefined, "legacy evidence collapse state is discarded");

  const otherVideo = state.stateForVideo(current, videoB);
  assert.deepEqual(JSON.parse(JSON.stringify(otherVideo.panels)), { feed: false, stats: false, map: false, controls: false, settings: false });
  assert.equal(otherVideo.trackerSettings.body, true);
  const restored = state.stateForVideo(otherVideo, videoA);
  assert.equal(restored.panels.stats, true);
  assert.equal(restored.trackerSettings.body, false);

  const explicitVideoUpdate = state.reduceExtensionState(current, { type: "SET_PANEL_LAYOUT", videoKey: videoB, panel: "feed", layout: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 } });
  assert.equal(explicitVideoUpdate.videoKey, videoB);
  assert.equal(explicitVideoUpdate.trackerSettings.body, true);

  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "full" });
  assert.equal(current.panels.feed, true);
  assert.equal(current.panels.map, true);
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "minimal" });
  assert.equal(current.panels.stats, true, "an explicit panel choice survives a density change");
  assert.equal(current.panels.feed, false);
  assert.equal(current.panels.map, false);
  assert.equal(current.panels.evidence, undefined, "density never creates the retired standalone evidence panel");
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
  assert.deepEqual(JSON.parse(JSON.stringify(current.collapsedPanels)), { feed: true });
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "feed", videoKey: videoA, value: false });
  assert.equal(current.collapsedPanels.feed, undefined);
  // Non-collapsible panels (the transient setup card) are ignored.
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "courtSetup", videoKey: videoA, value: true });
  assert.equal(current.collapsedPanels.courtSetup, undefined);
  const persisted = JSON.parse(JSON.stringify(current));
  const restoredA = state.stateForVideo(persisted, videoA);
  const restoredB = state.stateForVideo(persisted, videoB);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredA.collapsedPanels)), {}, "expanded panels have no stored collapse state");
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

  // The retired standalone evidence panel is not a panel lifecycle owner.
  // Evidence preferences remain independently video-local below.
  current = state.reduceExtensionState(current, { type: "SET_PANELS", panels: { evidence: true, feed: false } });
  assert.equal(current.panels.evidence, undefined);
  assert.equal(current.panels.feed, false);
});

test("unscoped evidence preference set before the first video binds to that video", async () => {
  const state = await stateModule();
  const videoA = state.videoKeyForUrl("https://www.youtube.com/watch?v=alpha");
  const videoB = state.videoKeyForUrl("https://www.youtube.com/watch?v=beta");
  let current = state.initialExtensionState();
  current = state.reduceExtensionState(current, { type: "SET_TRACKER", tracker: "body", value: false });
  assert.equal(current.videoKey, null);
  assert.equal(current.trackerSettings.body, false);
  const persisted = JSON.parse(JSON.stringify(current));
  assert.equal(Object.keys(persisted.trackerSettingsByVideo).length, 0);
  const bound = state.stateForVideo(persisted, videoA);
  assert.equal(bound.videoKey, videoA);
  assert.equal(bound.trackerSettings.body, false, "unscoped preference is adopted by the first-bound video");
  assert.equal(bound.trackerSettingsByVideo[videoA].body, false, "the first-bound video stores the unscoped preference");
  const restored = state.stateForVideo(JSON.parse(JSON.stringify(bound)), videoA);
  assert.equal(restored.trackerSettings.body, false, "the bound preference survives a storage round trip");
  const otherVideo = state.stateForVideo(bound, videoB);
  assert.equal(otherVideo.trackerSettings.body, true, "other videos keep their defaults");
  const backToA = state.stateForVideo(JSON.parse(JSON.stringify(otherVideo)), videoA);
  assert.equal(backToA.trackerSettings.body, false, "returning to the first video restores its preference");
  const pristine = state.stateForVideo(state.initialExtensionState(), videoB);
  assert.equal(pristine.trackerSettings.body, true);
  assert.equal(Object.keys(pristine.trackerSettingsByVideo).length, 0, "no preference is fabricated for untouched videos");
});

test("settings panel visibility, collapse, and layout register like the other panels", async () => {
  const state = await stateModule();
  const videoA = state.videoKeyForUrl("https://www.youtube.com/watch?v=alpha");
  const videoB = state.videoKeyForUrl("https://www.youtube.com/watch?v=beta");
  let current = state.initialExtensionState({ videoKey: videoA });
  assert.equal(current.panels.settings, false, "settings starts closed");
  assert.deepEqual(JSON.parse(JSON.stringify(current.settings)), {}, "Phase 1 settings values are an empty reserved container");

  // The visibility toggle is a normal per-video panel choice and survives
  // density changes even though presets never own the settings panel.
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL", panel: "settings", value: true });
  assert.equal(current.panels.settings, true);
  assert.equal(current.panelOverrides.settings, true, "an explicit open becomes an override");
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "full" });
  assert.equal(current.panels.settings, true, "an open settings panel survives a density change");
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "minimal" });
  assert.equal(current.panels.settings, true, "density presets never close the settings panel");
  assert.deepEqual(JSON.parse(JSON.stringify(current.panelsByVideo[videoA])), { feed: false, stats: false, map: false, controls: false, settings: true });

  // Panel geometry and collapse follow the standard per-video contracts.
  current = state.reduceExtensionState(current, { type: "SET_PANEL_LAYOUT", panel: "settings", videoKey: videoA, layout: { x: 0.2, y: 0.15, width: 0.4, height: 0.3 } });
  assert.deepEqual(JSON.parse(JSON.stringify(current.panelLayouts.settings)), { x: 0.2, y: 0.15, width: 0.4, height: 0.3 });
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "settings", videoKey: videoA, value: true });
  assert.equal(current.collapsedPanels.settings, true);
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_COLLAPSE", panel: "settings", videoKey: videoA, value: false });
  assert.equal(current.collapsedPanels.settings, undefined);

  // Visibility is video-local like every panel; the values container is a
  // global serializable object that survives video switches and round trips.
  const other = state.stateForVideo(JSON.parse(JSON.stringify(current)), videoB);
  assert.equal(other.panels.settings, false, "another video starts with settings closed");
  const back = state.stateForVideo(JSON.parse(JSON.stringify(current)), videoA);
  assert.equal(back.panels.settings, true, "returning to the video restores the open settings panel");
  assert.deepEqual(JSON.parse(JSON.stringify(back.panelLayouts.settings)), { x: 0.2, y: 0.15, width: 0.4, height: 0.3 });

  const withValues = state.initialExtensionState(Object.assign({}, JSON.parse(JSON.stringify(current)), { settings: { densityDefault: "balanced" } }));
  assert.equal(withValues.settings.densityDefault, "balanced");
  const roundTrip = state.initialExtensionState(JSON.parse(JSON.stringify(withValues)));
  assert.equal(roundTrip.settings.densityDefault, "balanced", "future settings keys survive storage round trips");
  const reset = state.resetVideoLocalState(roundTrip, videoB);
  assert.equal(reset.settings.densityDefault, "balanced", "video-local resets never clear global settings values");
});
