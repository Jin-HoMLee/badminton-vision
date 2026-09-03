import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function modules() {
  const stateSource = await readFile(new URL("../src/state.js", import.meta.url), "utf8");
  const context = { globalThis: {} };
  vm.runInNewContext(stateSource, context, { filename: "state.js" });
  return { state: context.globalThis.BVState };
}

test("panel controls disclosure starts collapsed (panelControlsExpanded = false)", async () => {
  const { state } = await modules();
  const initial = state.initialExtensionState();
  assert.equal(initial.panelControlsExpanded, false, "panelControlsExpanded should default to false");
});

test("TOGGLE_PANEL_CONTROLS_EXPANDED action toggles the expanded state", async () => {
  const { state } = await modules();
  let current = state.initialExtensionState();

  // Toggle to expanded
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_CONTROLS_EXPANDED", value: true });
  assert.equal(current.panelControlsExpanded, true, "should expand panel controls");

  // Toggle to collapsed
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_CONTROLS_EXPANDED", value: false });
  assert.equal(current.panelControlsExpanded, false, "should collapse panel controls");
});

test("panel controls expanded state persists across state reloads", async () => {
  const { state } = await modules();
  let current = state.initialExtensionState();

  // Set expanded
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_CONTROLS_EXPANDED", value: true });
  assert.equal(current.panelControlsExpanded, true);

  // Simulate persistence and reload
  const serialized = JSON.parse(JSON.stringify(current));
  const reloaded = state.initialExtensionState(serialized);
  assert.equal(reloaded.panelControlsExpanded, true, "expansion state should persist across reloads");
});

test("panel controls expansion is independent of other UI state changes", async () => {
  const { state } = await modules();
  let current = state.initialExtensionState();

  // Expand panel controls
  current = state.reduceExtensionState(current, { type: "TOGGLE_PANEL_CONTROLS_EXPANDED", value: true });
  assert.equal(current.panelControlsExpanded, true);

  // Change density (unrelated action)
  current = state.reduceExtensionState(current, { type: "SET_DENSITY", value: "balanced" });

  // Panel controls should still be expanded
  assert.equal(current.panelControlsExpanded, true, "expansion state should survive unrelated state changes");
});
