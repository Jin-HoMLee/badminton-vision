import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function modules() {
  const [stateSource, reviewSource, analysisSource] = await Promise.all([
    readFile(new URL("../src/state.js", import.meta.url), "utf8"),
    readFile(new URL("../src/review.js", import.meta.url), "utf8"),
    readFile(new URL("../src/analysis.js", import.meta.url), "utf8")
  ]);
  const context = { globalThis: {} };
  vm.runInNewContext(reviewSource, context, { filename: "review.js" });
  vm.runInNewContext(stateSource, context, { filename: "state.js" });
  vm.runInNewContext(analysisSource, context, { filename: "analysis.js" });
  return { state: context.globalThis.BVState, review: context.globalThis.BVReview, analysis: context.globalThis.BVAnalysis };
}

test("video identity prefers YouTube ids and canonicalizes safe URL fallbacks", async () => {
  const { state } = await modules();
  assert.equal(state.videoKeyForUrl("https://www.youtube.com/watch?feature=share&v=abc123#t=5"), "youtube:abc123");
  assert.equal(state.videoKeyForUrl("https://example.test/match?b=2&a=1#timestamp"), "url:https://example.test/match?a=1&b=2");
});

test("versioned label migration keeps legacy records local to their known video", async () => {
  const { state } = await modules();
  const videoA = state.videoKeyForUrl("https://www.youtube.com/watch?v=alpha");
  const videoB = state.videoKeyForUrl("https://www.youtube.com/watch?v=beta");
  const legacy = {
    videoKey: videoA,
    manualLabels: [{ eventId: "legacy-1", shot: "Drop", startSec: 12.25, endSec: 12.8, axes: { Timing: "late" } }]
  };
  const restoredA = state.stateForVideo(legacy, videoA, { now: "2026-01-01T00:00:00.000Z" });
  const restoredB = state.stateForVideo(restoredA, videoB);
  assert.equal(restoredA.manualLabelsVersion, state.LABEL_STORE_VERSION);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredA.manualLabelsByVideo[videoA].map((label) => label.eventId))), ["legacy-1"]);
  assert.equal(restoredA.manualLabels[0].startSec, 12.25);
  assert.equal(restoredA.manualLabels[0].endSec, 12.8);
  assert.equal(restoredA.manualLabels[0].axes.Timing, "late");
  assert.equal(restoredA.manualLabels[0].createdAt, "2026-01-01T00:00:00.000Z");
  const reloaded = state.stateForVideo(JSON.parse(JSON.stringify(restoredA)), videoA);
  assert.equal(reloaded.manualLabels[0].eventId, "legacy-1");
  assert.deepEqual(JSON.parse(JSON.stringify(restoredB.manualLabels)), []);
  assert.equal(restoredB.lastEdit, null);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredB.manualLabelsByVideo[videoA].map((label) => label.eventId))), ["legacy-1"]);
});

test("legacy unscoped labels migrate once, then never leak to a second video", async () => {
  const { state } = await modules();
  const videoA = state.videoKeyForUrl("https://example.test/match?id=one#fragment");
  const videoB = state.videoKeyForUrl("https://example.test/match?id=two");
  const migrated = state.stateForVideo({ manualLabels: [{ eventId: "old", shot: "Clear" }] }, videoA, { now: "2026-01-01T00:00:00.000Z" });
  assert.equal(migrated.manualLabels[0].eventId, "old");
  assert.equal(state.stateForVideo(migrated, videoB).manualLabels.length, 0);
  const retained = state.initialExtensionState({ manualLabels: [{ eventId: "unscoped", shot: "Net Shot" }], manualLabelsByVideo: { [videoA]: [] } });
  assert.equal(retained.manualLabelsByVideo[state.UNSCOPED_LABEL_KEY][0].eventId, "unscoped");
});

test("create, edit, delete, and undo operate on one durable video record", async () => {
  const { state, review } = await modules();
  const key = state.videoKeyForUrl("https://www.youtube.com/watch?v=crud");
  const created = review.normalizeManualLabel({
    eventId: state.createManualEventId(key, 42.125, []),
    startSec: 42.125,
    endSec: 42.8,
    playerId: "player-1",
    shot: "Smash",
    axes: { Timing: "late" },
    source: "manual",
    provenance: "manual"
  }, { now: "2026-01-01T00:00:00.000Z" });
  let current = state.stateForVideo({ videoKey: key }, key);
  const createEdit = { eventId: created.eventId, operation: "create", previousLabel: null, source: "manual" };
  current = state.reduceExtensionState(current, { type: "SET_REVIEW_LABELS", videoKey: key, labels: [created], lastEdit: createEdit });
  assert.equal(current.manualLabels[0].eventId, created.eventId);
  assert.equal(current.manualLabels[0].startSec, 42.125);
  assert.equal(current.manualLabels[0].playerId, "player-1");
  assert.equal(current.manualLabels[0].createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(Object.hasOwn(current.manualLabels[0], "confidence"), false);

  const edited = review.normalizeManualLabel({ ...created, shot: "Drop", updatedAt: "2026-01-01T00:01:00.000Z" }, { now: "2026-01-01T00:01:00.000Z" });
  const updateEdit = { eventId: created.eventId, operation: "update", previousLabel: created, source: "manual" };
  current = state.reduceExtensionState(current, { type: "SET_REVIEW_LABELS", videoKey: key, labels: [edited], lastEdit: updateEdit });
  assert.equal(current.manualLabels[0].shot, "Drop");
  assert.equal(current.manualLabels[0].createdAt, created.createdAt);
  assert.equal(current.manualLabels[0].updatedAt, "2026-01-01T00:01:00.000Z");
  assert.equal(review.toShotRow({ eventId: "open", source: "manual", startSec: 10, shot: "Clear" }, "", 0).end_sec, "");
  const honest = review.mergeStrokes([{ eventId: "auto-1", shot: "Clear", confidence: 0.9 }], [{ eventId: "auto-1", shot: "Drop", source: "manual" }]);
  assert.equal(Object.hasOwn(honest[0], "confidence"), false);

  const deleted = state.reduceExtensionState(current, { type: "SET_REVIEW_LABELS", videoKey: key, labels: [], lastEdit: { eventId: created.eventId, operation: "delete", previousLabel: edited, source: "manual" } });
  assert.equal(deleted.manualLabels.length, 0);
  const undone = state.reduceExtensionState(deleted, { type: "UNDO_LABEL", videoKey: key, edit: deleted.lastEdit });
  assert.equal(undone.manualLabels[0].shot, "Drop");
  assert.equal(undone.manualLabels[0].eventId, created.eventId);
});

test("manual content path is playback-neutral and does not start runtime for labeling", async () => {
  const content = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
  assert.match(content, /Manual \/ offline mode/);
  // The settings panel is independent furniture too: the overlay may render it
  // without inference while manual labeling still never starts the runtime.
  assert.match(content, /if \(!state\.enabled && !state\.seeding && !state\.labeling && !\(state\.panels && state\.panels\.settings\)\) return/);
  assert.match(content, /else if \(message\.type === "OPEN_LABELING"\) \{ bindVideoState\(\); openLabeling\(\); \}/);
  assert.doesNotMatch(content, /video\.currentTime\s*=/);
  assert.doesNotMatch(content, /video\.(?:play|pause)\s*\(/);
  assert.doesNotMatch(content, /startRuntime\(\);\s*if \(hasChrome\(\) && chrome\.runtime && chrome\.runtime\.onMessage/);
});

test("CSV export to import round trip restores identical manual label records", async () => {
  const { state, review, analysis } = await modules();
  const key = state.videoKeyForUrl("https://www.youtube.com/watch?v=roundtrip");
  const labels = [
    review.normalizeManualLabel({
      eventId: state.createManualEventId(key, 12.25, []),
      startSec: 12.25, endSec: 12.75, shot: "Serve", playerId: "A", player: "A",
      axes: { Timing: "early" }, source: "manual", provenance: "manual"
    }, { now: "2026-01-01T00:00:00.000Z" }),
    review.normalizeManualLabel({
      eventId: state.createManualEventId(key, 15.5, []),
      startSec: 15.5, endSec: null, shot: "Clear", playerId: "B", player: "B",
      axes: { Longitudinal: "front", Direction: "cross" }, source: "manual", provenance: "manual"
    }, { now: "2026-01-01T00:00:00.000Z" })
  ];
  const rows = labels.map((label, index) => review.toShotRow(label, "https://www.youtube.com/watch?v=roundtrip", index));
  const csv = analysis.toShotsCsv(rows, { includeManualMetadata: true });
  const parsed = analysis.parseShotsCsv(csv);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 2);
  const imported = analysis.normalizeImportedShots(parsed.rows, { now: "2026-01-02T00:00:00.000Z" });
  assert.equal(imported.imported, 2);
  assert.equal(imported.skipped, 0);
  imported.records.forEach((record, index) => {
    assert.equal(record.eventId, labels[index].eventId);
    assert.equal(record.startSec, labels[index].startSec);
    assert.equal(record.endSec, labels[index].endSec);
    assert.equal(record.shot, labels[index].shot);
    assert.equal(record.playerId, labels[index].playerId);
    assert.deepEqual(record.axes, labels[index].axes);
    assert.equal(record.provenance, labels[index].provenance);
    assert.equal(record.source, "manual");
  });
});

test("CSV import validates headers, normalizes timestamps, and de-duplicates by event id or time window", async () => {
  const { state, review, analysis } = await modules();
  const key = state.videoKeyForUrl("https://www.youtube.com/watch?v=dedupe");
  const label = review.normalizeManualLabel({
    eventId: state.createManualEventId(key, 30, []), startSec: 30, endSec: 30.4, shot: "Smash",
    axes: { Impact: "above" }, source: "manual", provenance: "manual"
  }, { now: "2026-01-01T00:00:00.000Z" });
  const csv = analysis.toShotsCsv([review.toShotRow(label, "https://www.youtube.com/watch?v=dedupe", 0)], { includeManualMetadata: true });
  const parsed = analysis.parseShotsCsv(csv);
  const first = analysis.normalizeImportedShots(parsed.rows, { now: "2026-01-02T00:00:00.000Z" });
  assert.equal(first.imported, 1);
  const second = analysis.normalizeImportedShots(parsed.rows, { existing: first.records, now: "2026-01-02T00:00:00.000Z" });
  assert.equal(second.imported, 0, "the same event id is a duplicate");
  assert.equal(second.skipped, 1);
  const nearWindow = analysis.normalizeImportedShots(
    [{ eventId: "manual-other", shot: "Smash", startSec: 30.2, endSec: 30.4, provenance: "manual" }],
    { existing: first.records, now: "2026-01-02T00:00:00.000Z" });
  assert.equal(nearWindow.imported, 0, "the same time window and shot is a duplicate even with a different event id");
  assert.equal(nearWindow.skipped, 1);
  const otherShot = analysis.normalizeImportedShots(
    [{ eventId: "manual-other", shot: "Clear", startSec: 30.2, endSec: 30.4, provenance: "manual" }],
    { existing: first.records, now: "2026-01-02T00:00:00.000Z" });
  assert.equal(otherShot.imported, 1, "the same window with a different shot is a new record");
  const autoRows = analysis.normalizeImportedShots(
    [{ eventId: "auto-1", shot: "Drop", startSec: 40, provenance: "auto" }],
    { now: "2026-01-02T00:00:00.000Z" });
  assert.equal(autoRows.imported, 0, "automatic rows are never restored as manual labels");
  assert.equal(autoRows.skipped, 1);
  assert.equal(analysis.parseShotsCsv("player,score\nA,1").ok, false, "foreign headers are rejected");
  assert.equal(analysis.parseShotsCsv("").ok, false, "empty files are rejected");
  const formatted = analysis.normalizeImportedShots(
    [{ eventId: "t1", shot: "Lift", startSec: "02:05.500", endSec: "02:06", provenance: "manual" }],
    { now: "2026-01-02T00:00:00.000Z" });
  assert.equal(formatted.records[0].startSec, 125.5);
  assert.equal(formatted.records[0].endSec, 126);
  assert.equal(formatted.records[0].time, "02:05.500");
  const quoted = analysis.parseShotsCsv('shot_id,label,start_sec\n"a,""b",Net Shot,1');
  assert.equal(quoted.ok, true);
  assert.equal(quoted.rows[0].eventId, 'a,"b');
});
