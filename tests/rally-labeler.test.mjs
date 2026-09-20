import assert from "node:assert/strict";
import { test } from "node:test";
import model from "../src/rally-labeler.js";

function fixture() {
  return model.normalizeDocument({
    source: {
      id: "bwf-ws-2026",
      label: "BWF women's singles 2026",
      videoKey: "youtube:declared-match",
      videoUrl: "https://www.youtube.com/watch?v=declared-match",
      reviewWindow: { start: 100, end: 220 }
    },
    intervals: [
      { id: "bwf-ws-2026:rally-001", start: 110, end: 114.5 },
      { id: "bwf-ws-2026:rally-002", start: 130, end: 137 }
    ],
    controls: [
      { id: "club-fixed-cam:empty", kind: "empty-set", label: "Club source has no rallies" },
      { id: "negative-basketball:inactive", kind: "inactive", label: "Basketball source stays inactive" }
    ]
  });
}

const evidence = { comment: "Reviewed against the visible serve and shuttle-down transition.", verifier: "developer@example.test", verifiedAt: "2026-09-20" };

test("canonical normalization keeps stable source/interval identities and proposed values", () => {
  const document = fixture();
  assert.equal(document.schema, "badminton-vision.rally-review");
  assert.equal(document.version, 1);
  assert.equal(document.source.id, "bwf-ws-2026");
  assert.equal(document.source.videoKey, "youtube:declared-match");
  assert.deepEqual(document.intervals[0].original, { startSec: 110, endSec: 114.5 });
  assert.equal(document.intervals[0].corrected, null);
  assert.equal(document.intervals[0].action, "unresolved");
  assert.equal(model.formatSeconds(114.5), "1:54.500");
  assert.equal(model.parseSeconds("1:54.500"), 114.5);
});

test("zoom preserves the anchored review second and explicit scrolling is clamped", () => {
  const document = fixture();
  const view = model.createTimelineView(document, 600, 1, 0);
  assert.equal(view.contentWidth, 600);
  assert.equal(view.maxScroll, 0);
  const zoomed = model.zoomTimeline(document, view, 8, 300);
  assert.equal(zoomed.contentWidth, 4800);
  assert.equal(zoomed.scrollLeft, 2100);
  assert.equal(model.pixelsToSeconds(zoomed, zoomed.scrollLeft + 300), 160, "the center remains on the same media second");
  const right = model.scrollTimeline(document, zoomed, 99999);
  assert.equal(right.scrollLeft, right.maxScroll);
  const left = model.scrollTimeline(document, right, -99999);
  assert.equal(left.scrollLeft, 0);
});

test("pointer move and edge resize enforce review bounds and start < end", () => {
  const document = fixture();
  const view = model.createTimelineView(document, 600, 5, 0);
  const moved = model.pointerEdit(document, "bwf-ws-2026:rally-001", "move", 250, view);
  assert.deepEqual(model.effectiveBounds(moved.intervals[0]), { startSec: 120, endSec: 124.5 });
  assert.deepEqual(document.intervals[0].original, { startSec: 110, endSec: 114.5 }, "pointer edits never overwrite the proposal");
  assert.equal(moved.intervals[0].action, "correction");

  const collapsedStart = model.resizeInterval(moved, moved.intervals[0].id, "start", 999);
  const startBounds = model.effectiveBounds(collapsedStart.intervals[0]);
  assert.ok(startBounds.startSec < startBounds.endSec);
  assert.ok(Math.abs((startBounds.endSec - startBounds.startSec) - model.MIN_INTERVAL_SECONDS) < 1e-9);

  const clampedEnd = model.resizeInterval(document, document.intervals[0].id, "end", -1);
  const endBounds = model.effectiveBounds(clampedEnd.intervals[0]);
  assert.ok(endBounds.startSec < endBounds.endSec);
  assert.ok(Math.abs((endBounds.endSec - endBounds.startSec) - model.MIN_INTERVAL_SECONDS) < 1e-9);
  assert.throws(() => model.normalizeDocument({ source: { id: "bad", reviewWindow: { start: 0, end: 5 } }, intervals: [{ id: "bad:1", start: 2, end: 2 }] }), /start < end/);
});

test("keyboard/numeric edge updates use the same invariant-preserving model", () => {
  let document = fixture();
  document = model.resizeInterval(document, document.intervals[0].id, "start", 109.125);
  document = model.resizeInterval(document, document.intervals[0].id, "end", 115.875);
  assert.deepEqual(model.effectiveBounds(document.intervals[0]), { startSec: 109.125, endSec: 115.875 });
  assert.deepEqual(document.intervals[0].original, { startSec: 110, endSec: 114.5 });
});

test("addition and removal are first-class durable actions", () => {
  let document = fixture();
  document = model.addInterval(document, 145, 149.25, evidence);
  const added = document.intervals.find((interval) => interval.action === "addition");
  assert.equal(added.id, "bwf-ws-2026:addition-001");
  assert.equal(added.original, null);
  assert.deepEqual(added.corrected, { startSec: 145, endSec: 149.25 });

  document = model.removeInterval(document, "bwf-ws-2026:rally-002", evidence);
  const removed = document.intervals.find((interval) => interval.id === "bwf-ws-2026:rally-002");
  assert.equal(removed.action, "removal");
  assert.equal(model.effectiveBounds(removed), null);
  assert.deepEqual(removed.original, { startSec: 130, endSec: 137 });

  document = model.removeInterval(document, added.id, evidence);
  assert.equal(document.intervals.find((interval) => interval.id === added.id).action, "removal", "an added bar can be removed too");
  document = model.restoreInterval(document, added.id);
  assert.equal(document.intervals.find((interval) => interval.id === added.id).action, "addition");
});

test("completion is blocked by unresolved evidence and contradictory controls", () => {
  let document = fixture();
  let result = model.completion(document);
  assert.equal(result.complete, false);
  assert.equal(result.unresolved.length, 4);

  for (const interval of document.intervals.slice()) {
    document = model.reviewInterval(document, interval.id, { action: "approve", ...evidence });
  }
  document = model.reviewControl(document, "club-fixed-cam:empty", { state: "rejected", ...evidence });
  document = model.reviewControl(document, "negative-basketball:inactive", { state: "rejected", ...evidence });
  result = model.completion(document);
  assert.equal(result.complete, true);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.contradictions, []);

  document = model.reviewControl(document, "club-fixed-cam:empty", { state: "confirmed", ...evidence });
  result = model.completion(document);
  assert.equal(result.complete, false);
  assert.deepEqual(result.contradictions, ["club-fixed-cam:empty:active-intervals"]);
});

test("canonical JSON round-trips source/start/end semantics without media", () => {
  let document = fixture();
  document = model.reviewInterval(document, document.intervals[0].id, { action: "correction", ...evidence });
  document = model.resizeInterval(document, document.intervals[0].id, "end", 115.125);
  document = model.reviewInterval(document, document.intervals[0].id, { action: "correction", ...evidence });
  const json = model.serialize(document);
  const parsed = model.parse(json, { videoKey: "youtube:declared-match" });
  assert.equal(parsed.ok, true);
  assert.equal(model.serialize(parsed.document), json);
  assert.deepEqual(parsed.document.intervals[0].original, { startSec: 110, endSec: 114.5 });
  assert.deepEqual(parsed.document.intervals[0].corrected, { startSec: 110, endSec: 115.125 });
  assert.doesNotMatch(json, /video\/|audio\/|frame|data:/i);

  const corpusShape = model.parse(JSON.stringify({
    source: "legacy-source",
    videoKey: "youtube:legacy",
    reviewWindow: { start: 10, end: 30 },
    rallies: [{ id: "stable-1", start: 12.25, end: 16.5 }]
  }), { videoKey: "youtube:legacy" });
  assert.equal(corpusShape.ok, true);
  assert.equal(corpusShape.document.source.id, "legacy-source");
  assert.deepEqual(corpusShape.document.intervals[0].original, { startSec: 12.25, endSec: 16.5 });
  assert.equal(model.parse(json, { videoKey: "youtube:other" }).ok, false, "a review cannot leak into another video's store");
});
