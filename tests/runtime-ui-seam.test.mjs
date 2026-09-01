import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function loadRuntime() {
  const source = await readFile(new URL("../src/runtime.js", import.meta.url), "utf8");
  const context = { setTimeout, clearTimeout, globalThis: {} };
  vm.runInNewContext(source, context, { filename: "runtime.js" });
  return context.globalThis.BVRuntime;
}

test("runtime UI seam exposes capabilities, model-neutral player arrays, and analysis age", async () => {
  const runtime = await loadRuntime();
  const views = [];
  const seam = runtime.createRuntimeUiSeam({ onChange: (view) => views.push(view) });
  seam.acceptMessage({
    type: "runtime.capabilities",
    capabilities: { analyzer: "fixture-probe-v1", inference: true, offscreen: true },
    fallbacks: ["runtime-integration-probe-not-production-cv"],
    reason: "fixture"
  });
  seam.acceptMessage({
    type: "analysis.result",
    analyzer: "fixture-probe-v1",
    inferenceAvailable: true,
    status: "ok",
    capabilities: { analyzer: "fixture-probe-v1", inference: true },
    result: {
      kind: "runtime-integration-probe",
      state: "partial",
      rally: { state: "unknown" },
      rallyEnd: { state: "unknown" },
      winner: { state: "unknown" },
      players: [
        { trackId: "session-a:player-1", confidence: 0.81, state: "tracked" },
        { trackId: "session-a:player-2", confidence: null, state: "unknown" }
      ],
      shuttle: { state: "unknown", confidence: null }
    }
  }, { ageSeconds: 1.8, stale: true }, 14.2);

  const view = seam.snapshot();
  assert.equal(view.analyzer, "fixture-probe-v1");
  assert.equal(view.inference, true);
  assert.equal(view.stale, true);
  assert.equal(view.ageSeconds, 1.8);
  assert.equal(view.result.players.length, 2);
  assert.equal(view.result.players[1].state, "unknown");
  assert.ok(views.length >= 2);
  seam.reset("video-replaced");
  const reset = seam.snapshot();
  assert.equal(reset.phase, "resyncing");
  assert.equal(reset.result, null);
  assert.equal(reset.reason, "video-replaced");
});

test("runtime UI seam refreshes each newly selected result and holds future results until the media clock reaches them", async () => {
  const runtime = await loadRuntime();
  const views = [];
  const seam = runtime.createRuntimeUiSeam({ onChange: (view) => views.push(view) });
  const result = (mediaTime, marker) => ({
    type: "analysis.result", status: "ok", analyzer: "local-pose", inferenceAvailable: true,
    capabilities: { analyzer: "local-pose", inference: true },
    result: { kind: "pose", state: "tracked", marker, players: [{ trackId: "player-1", state: "tracked" }], tracking: { state: "tracked", accepted: true, players: [] }, shuttle: { state: "unknown" } },
    mediaTime
  });
  const first = result(10, "first");
  seam.acceptMessage(first, { result: null, ageSeconds: null, stale: true }, 9);
  assert.equal(seam.snapshot().result, null, "a result ahead of playback is held");

  seam.acceptSynchronization({ result: first, ageSeconds: 0, stale: false }, 10);
  assert.equal(seam.snapshot().result.marker, "first");
  const second = result(10, "replacement");
  seam.acceptSynchronization({ result: second, ageSeconds: 0, stale: false }, 10);
  assert.equal(seam.snapshot().result.marker, "replacement", "equal-timestamp result updates are not ignored");

  const third = result(11, "next");
  seam.acceptMessage(third, { result: null, ageSeconds: null, stale: true }, 10);
  assert.equal(seam.snapshot().result.marker, "replacement", "newer results remain held while playback is behind");
  seam.acceptSynchronization({ result: third, ageSeconds: 0, stale: false }, 11);
  assert.equal(seam.snapshot().result.marker, "next");
  assert.ok(views.length >= 4, "each selected result publishes a fresh view");
});
