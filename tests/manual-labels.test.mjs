import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function modules() {
  const [stateSource, reviewSource] = await Promise.all([
    readFile(new URL("../src/state.js", import.meta.url), "utf8"),
    readFile(new URL("../src/review.js", import.meta.url), "utf8")
  ]);
  const context = { globalThis: {} };
  vm.runInNewContext(reviewSource, context, { filename: "review.js" });
  vm.runInNewContext(stateSource, context, { filename: "state.js" });
  return { state: context.globalThis.BVState, review: context.globalThis.BVReview };
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
  assert.match(content, /if \(!state\.enabled && !state\.seeding && !state\.labeling\) return/);
  assert.match(content, /else if \(message\.type === "OPEN_LABELING"\) \{ bindVideoState\(\); openLabeling\(\); \}/);
  assert.doesNotMatch(content, /video\.currentTime\s*=/);
  assert.doesNotMatch(content, /video\.(?:play|pause)\s*\(/);
  assert.doesNotMatch(content, /startRuntime\(\);\s*if \(hasChrome\(\) && chrome\.runtime && chrome\.runtime\.onMessage/);
});
