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

  // Capture backpressure is a bounded, healthy condition while the local
  // analyzer catches up. It must not erase the ready/inference state or turn
  // into the user-visible production fallback card.
  seam.acceptStatus({ type: "capture-status", status: "backpressure" });
  assert.equal(seam.snapshot().phase, "result");
  assert.equal(seam.snapshot().inference, true);
  assert.equal(seam.snapshot().reason, "");
  seam.acceptStatus({ type: "capture-status", status: "timeline-reset" });
  assert.equal(seam.snapshot().phase, "resyncing");
  assert.equal(seam.snapshot().reason, "timeline-reset");

  seam.reset("video-replaced");
  const reset = seam.snapshot();
  assert.equal(reset.phase, "resyncing");
  assert.equal(reset.result, null);
  assert.equal(reset.reason, "video-replaced");
});
