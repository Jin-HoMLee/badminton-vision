import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function loadGlobal(file, context = {}) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  vm.runInNewContext(source, context, { filename: file });
  return context;
}

async function analysis() {
  const context = await loadGlobal("src/analysis.js", {});
  return context.BVAnalysis;
}

const manual = (eventId, values = {}) => ({
  eventId,
  source: "manual",
  status: "accepted",
  shot: values.shot,
  player: values.player,
  startSec: values.startSec,
  endSec: values.endSec,
  axes: values.axes
});

test("empty manual data is explicit and never falls back to fixture totals", async () => {
  const A = await analysis();
  const result = A.calculateManualDatasetSummary({
    manualLabels: [],
    strokes: [{ eventId: "fixture-1", source: "auto", shot: "Smash" }]
  });

  assert.equal(result.totalLabels, 0);
  assert.equal(result.status, "empty");
  assert.match(result.insufficientData, /No manual labels/);
  assert.equal(result.coverage.classified.known, false);
  assert.equal(result.coverage.classified.status, "insufficient-data");
  assert.deepEqual({ ...result.shotLabelCounts }, {});
});

test("mixed known and unknown labels calculate deterministic coverage and dimensions", async () => {
  const A = await analysis();
  const result = A.calculateManualDatasetSummary([
    manual("a", { shot: "Clear", player: "A", startSec: 10, endSec: 11, axes: { Timing: "early", Direction: "cross" } }),
    manual("b", { shot: "unknown", player: "B", startSec: 20, endSec: 21, axes: { Timing: "late" } }),
    manual("c", { shot: null, player: null })
  ]);

  assert.equal(result.totalLabels, 3);
  assert.equal(result.classifiedCount, 1);
  assert.equal(result.unclassifiedCount, 2);
  assert.equal(result.classifiedPercentage, 33.3);
  assert.equal(result.unclassifiedPercentage, 66.7);
  assert.deepEqual({ ...result.shotLabelCounts }, { Clear: 1 });
  assert.deepEqual({ ...result.shotLabelPercentages }, { Clear: 100 });
  assert.equal(result.dimensions.Timing.counts.early, 1);
  assert.equal(result.dimensions.Timing.counts.late, 1);
  assert.equal(result.dimensions.Timing.unknownCount, 1);
  assert.equal(result.players.coverage.percentage, 66.7);
  assert.deepEqual({ ...result.perPlayerCounts }, { A: 1, B: 1 });
  assert.deepEqual({ ...result.perPlayerPercentages }, { A: 50, B: 50 });
  assert.equal(result.timestamps.coverage.percentage, 66.7);
  assert.equal(result.timestamps.durationSec, 11);
  assert.equal(result.duration.value, 11);
});

test("duplicate manual records use replacement semantics without duplicate counts", async () => {
  const A = await analysis();
  const result = A.calculateManualDatasetSummary([
    manual("same", { shot: "Clear", player: "A" }),
    manual("same", { shot: "Smash", player: "B", axes: { Timing: "late" } })
  ]);

  assert.equal(result.totalLabels, 1);
  assert.deepEqual({ ...result.shotLabelCounts }, { Smash: 1 });
  assert.deepEqual({ ...result.perPlayerCounts }, { B: 1 });
  assert.equal(result.records[0].label, "Smash");
  assert.equal(result.records[0].dimensions.Timing, "late");
});

test("durable per-video records are selected by identity and retain current record shape", async () => {
  const A = await analysis();
  const stored = {
    manualLabelsByVideo: {
      "youtube:one": { videoUrl: "https://video.test/one", labels: [manual("one-1", { shot: "Drop" })] },
      "youtube:two": { videoUrl: "https://video.test/two", records: [manual("two-1", { shot: "Net Shot" })] }
    }
  };
  const result = A.calculateManualDatasetSummary(stored, { videoKey: "youtube:two" });

  assert.equal(result.totalLabels, 1);
  assert.deepEqual({ ...result.shotLabelCounts }, { "Net Shot": 1 });
  assert.equal(result.records[0].videoKey, "youtube:two");
  assert.equal(result.records[0].videoUrl, "https://video.test/two");
});

test("fixture rows and model suggestions remain outside the manual collection", async () => {
  const A = await analysis();
  const fixture = { eventId: "fixture-1", source: "manual", status: "corrected", shot: "Drop" };
  const result = A.calculateManualDatasetSummary({
    manualLabels: [manual("saved-1", { shot: "Clear" })],
    strokes: [fixture],
    suggestion: { eventId: "suggestion-1", source: "model", shot: "Smash" }
  });
  assert.equal(result.totalLabels, 1);
  assert.deepEqual({ ...result.shotLabelCounts }, { Clear: 1 });

  const marked = A.calculateManualDatasetSummary([fixture, { eventId: "saved-1", source: "manual", shot: "Clear" }], { fixtureRows: [fixture] });
  assert.equal(marked.totalLabels, 1);
  assert.deepEqual({ ...marked.shotLabelCounts }, { Clear: 1 });
});

test("manual CSV rows preserve identity, timing, dimensions, player, and provenance metadata", async () => {
  const A = await analysis();
  const record = A.normalizeManualLabels([manual("csv-1", {
    shot: "Drive", player: "Player A", startSec: 12.25, endSec: 12.75,
    axes: { Longitudinal: "front", Timing: "late" }
  })])[0];
  const row = A.manualRecordToShotRow(record, "https://video.test/match", 0);
  const csv = A.toShotsCsv([row], { includeManualMetadata: true });

  assert.equal(row.video_url, "https://video.test/match");
  assert.equal(row.start_sec, 12.25);
  assert.equal(row.end_sec, 12.75);
  assert.equal(row.label, "Drive");
  assert.equal(row.player, "Player A");
  assert.equal(row.longitudinal_position, "front");
  assert.equal(row.timing, "late");
  assert.match(csv.split("\n")[0], /player,provenance$/);
  assert.match(csv, /Player A/);
  assert.match(csv, /manual/);
});

test("summary view model names the selected dataset and has an honest empty state", async () => {
  const summarySource = await readFile(new URL("../src/summary.js", import.meta.url), "utf8");
  assert.match(summarySource, /manualDatasetBlock\(manualSummary\)/);
  assert.match(summarySource, /not manual statistics/);
  const context = { window: {}, document: { getElementById: () => null } };
  context.window.location = { search: "" };
  await loadGlobal("src/summary.js", context);
  const empty = context.window.BVSummary.manualSummaryViewModel({
    dataset: { videoKey: "youtube:empty" }, totalLabels: 0, classifiedCount: 0, unclassifiedCount: 0,
    classifiedPercentage: null, unclassifiedPercentage: null, timestamps: { percentage: null }
  });
  const populated = context.window.BVSummary.manualSummaryViewModel({
    dataset: { videoUrl: "https://video.test/match" }, totalLabels: 2, classifiedCount: 1, unclassifiedCount: 1,
    classifiedPercentage: 50, unclassifiedPercentage: 50, timestamps: { knownCount: 1, percentage: 50 }
  });

  assert.equal(empty.dataset, "youtube:empty");
  assert.equal(empty.empty, true);
  assert.match(empty.timestampText, /timestamps unavailable/);
  assert.equal(populated.empty, false);
  assert.equal(populated.total, 2);
  assert.equal(populated.classifiedText, "1 (50%)");
  assert.equal(populated.timestampText, "1 / 2 (50%)");
});
