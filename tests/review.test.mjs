import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function reviewModule() {
  const source = await readFile(new URL("../src/review.js", import.meta.url), "utf8");
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: "review.js" });
  return context.globalThis.BVReview;
}

test("manual correction replaces one fixture event and keeps provenance", async () => {
  const review = await reviewModule();
  const base = [{ eventId: "r14-s04", sequence: 4, shot: "Drop", time: "12:03.020", source: "manual" }];
  const correction = [{ eventId: "r14-s04", sequence: 4, shot: "Smash", time: "12:03.020", source: "manual", status: "corrected", axes: { Timing: "late" } }];
  const merged = review.mergeStrokes(base, correction);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].shot, "Smash");
  assert.equal(merged[0].status, "corrected");
  assert.equal(merged[0].axes.Timing, "late");
});

test("manual records preserve timestamps, axes, and CSV-compatible values", async () => {
  const review = await reviewModule();
  const row = review.toShotRow({
    eventId: "r14-s07", shot: "Net Shot", time: "12:04.120", endSec: 724.52,
    axes: { Longitudinal: "front", Lateral: "centre", Timing: "late", Intention: "offensive", Impact: "above", Direction: "cross" }
  }, "https://www.youtube.com/watch?v=fixture", 0);
  assert.equal(row.start_sec, 724.12);
  assert.equal(row.end_sec, 724.52);
  assert.equal(row.label, "Net Shot");
  assert.equal(row.longitudinal_position, "front");
  assert.equal(row.direction, "cross");
  assert.equal(review.mediaSeconds("724.52"), 724.52);
});

test("review undo can remove a new event without touching fixture rows", async () => {
  const review = await reviewModule();
  const base = [{ eventId: "r14-s01", sequence: 1, shot: "Serve", time: "12:01.020" }];
  const after = review.mergeStrokes(base, [{ eventId: "r14-s07", sequence: 7, shot: "Smash", time: "12:04.120" }]);
  const undone = review.mergeStrokes(base, review.without([{ eventId: "r14-s07", shot: "Smash" }], "r14-s07"));
  assert.equal(after.length, 2);
  assert.equal(undone.length, 1);
  assert.equal(undone[0].eventId, "r14-s01");
});
