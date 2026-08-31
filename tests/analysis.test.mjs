import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function loadGlobal(file, context = {}) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  vm.runInNewContext(source, context, { filename: file });
  return context;
}

test("highlights index is unavailable before ten completed rallies", async () => {
  const context = await loadGlobal("src/analysis.js", {});
  const result = context.BVAnalysis.calculateHighlightsIndex({ shots: 4, shotFamilies: ["Clear"], outcome: "winner", meanTrackingConfidence: 0.9 }, new Array(9).fill({ shots: 4 }));
  assert.equal(result.available, false);
  assert.equal(result.score, null);
});

test("fixture highlight ranking is deterministic and explainable", async () => {
  const context = await loadGlobal("src/analysis.js", {});
  await loadGlobal("src/fixtures.js", context);
  const first = context.BVAnalysis.rankRallies(context.BVFixtures.rallies);
  const second = context.BVAnalysis.rankRallies(context.BVFixtures.rallies);
  assert.deepEqual(first.map((rally) => [rally.rallyId, rally.index]), second.map((rally) => [rally.rallyId, rally.index]));
  assert.equal(first[0].rallyId, 23);
  assert.equal(first[0].indexComponents.sampleSize, 12);
  assert.equal(first[0].indexComponents.partial, true);
});

test("shot CSV preserves the shuttle-insights-compatible header and escapes values", async () => {
  const context = await loadGlobal("src/analysis.js", {});
  const csv = context.BVAnalysis.toShotsCsv([{ video_url: "https://example.test/a,b", shot_id: "s1", label: "Net Shot", start_sec: 1, end_sec: 2 }]);
  assert.equal(csv.split("\n")[0], "video_url,shot_id,start_sec,end_sec,label,longitudinal_position,lateral_position,timing,intention,impact,direction");
  assert.match(csv, /"https:\/\/example\.test\/a,b"/);
});
