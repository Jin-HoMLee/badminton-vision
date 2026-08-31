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

test("public setup journey keeps minimal density and exposes reversible states", async () => {
  const state = await stateModule();
  let current = state.initialExtensionState();
  assert.equal(current.density, "minimal");
  assert.equal(current.panels.stats, false);
  current = state.reduceExtensionState(current, { type: "ENABLE" });
  assert.equal(current.seeding, true);
  current = state.reduceExtensionState(current, { type: "LOCK_COURT" });
  assert.equal(current.seeded, true);
  assert.equal(current.seeding, false);
  assert.equal(current.density, "minimal");
  current = state.reduceExtensionState(current, { type: "OPEN_LABELING" });
  assert.equal(current.labeling, true);
  current = state.reduceExtensionState(current, { type: "CLOSE_LABELING" });
  assert.equal(current.labeling, false);
});
