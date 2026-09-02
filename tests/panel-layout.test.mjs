import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function moduleApi(path, name) {
  const source = await readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: path });
  return context.globalThis[name];
}

const viewport = { width: 1280, height: 720 };
const rendered = { left: 120, top: 96, width: 360, height: 220 };
const panels = {
  courtSetup: { minWidth: 280, minHeight: 170, maxWidth: 560, maxHeight: 680 },
  stats: { minWidth: 220, minHeight: 128, maxWidth: 460, maxHeight: 420 },
  map: { minWidth: 176, minHeight: 190, maxWidth: 360, maxHeight: 520 },
  feed: { minWidth: 280, minHeight: 128, maxWidth: 560, maxHeight: 520 },
  manual: { minWidth: 320, minHeight: 300, maxWidth: 620, maxHeight: 690 },
  controls: { minWidth: 180, minHeight: 84, maxWidth: 360, maxHeight: 220 }
};

 test("all overlay panel layouts clamp movement and resize to the video viewport", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  for (const [panel, constraints] of Object.entries(panels)) {
    const start = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 };
    const moved = api.movePanelLayout(start, { x: 10000, y: 10000 }, viewport, rendered, constraints);
    const enlarged = api.resizePanelLayout(start, { x: 10000, y: 10000 }, viewport, rendered, constraints);
    const shrunk = api.resizePanelLayout(start, { x: -10000, y: -10000 }, viewport, rendered, constraints);
    assert.ok(api.isWithinBounds(moved, viewport, rendered, constraints), `${panel} move is bounded`);
    assert.ok(api.isWithinBounds(enlarged, viewport, rendered, constraints), `${panel} max resize is bounded`);
    assert.ok(api.isWithinBounds(shrunk, viewport, rendered, constraints), `${panel} min resize is bounded`);
  }
});

test("panel layouts normalize safely and persist per video through state", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const state = await moduleApi("state.js", "BVState");
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeLayout({ x: 3, y: -1, width: 0, height: 0.5 }))), { x: 1, y: 0, height: 0.5 });
  const videoA = state.videoKeyForUrl("https://www.youtube.com/watch?v=alpha");
  const videoB = state.videoKeyForUrl("https://www.youtube.com/watch?v=beta");
  let current = state.initialExtensionState({ videoKey: videoA });
  current = state.reduceExtensionState(current, { type: "SET_PANEL_LAYOUT", panel: "feed", videoKey: videoA, layout: { x: 0.4, y: 0.2, width: 0.5, height: 0.4 } });
  current = state.reduceExtensionState(current, { type: "SET_PANEL_LAYOUT", panel: "manual", videoKey: videoB, layout: { x: 0.1, y: 0.1, width: 0.6, height: 0.8 } });
  const restoredA = state.stateForVideo(JSON.parse(JSON.stringify(current)), videoA);
  const restoredB = state.stateForVideo(JSON.parse(JSON.stringify(current)), videoB);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredA.panelLayouts.feed)), { x: 0.4, y: 0.2, width: 0.5, height: 0.4 });
  assert.equal(restoredA.panelLayouts.manual, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredB.panelLayouts.manual)), { x: 0.1, y: 0.1, width: 0.6, height: 0.8 });
  assert.equal(restoredB.panelLayouts.feed, undefined);
});

test("panel UI uses header semantics and removes the old visible setup drag copy", async () => {
  const [ui, content, styles] = await Promise.all([
    readFile(new URL("../src/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  for (const panel of Object.keys(panels).filter((panel) => panel !== "courtSetup")) assert.match(content, new RegExp(`layoutId: "${panel}"`));
  assert.match(content, /data-bso-panel.*courtSetup/);
  assert.match(ui, /data-bso-panel-drag-handle/);
  assert.match(ui, /data-bso-panel-resize-handle/);
  assert.match(ui, /aria-keyshortcuts.*ArrowLeft.*Home/);
  assert.match(styles, /\.bv-panel-layout > \.bv-panel-header[^\{]*\{[^}]*cursor: grab/s);
  assert.match(styles, /\.bv-panel-resize-handle[^\{]*\{[^}]*cursor: nwse-resize/s);
  assert.doesNotMatch(content, /bv-seed-card-handle-text/);
  assert.doesNotMatch(content, /\["Drag to move"\]/);
});

test("panel layouts reserve the native player control strip at the bottom", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const reserve = 72;
  const constraints = { minWidth: 280, minHeight: 128, maxWidth: 560, maxHeight: 520, bottomReserve: reserve };
  const stripViewport = { width: 1280, height: 720 };
  const bottomClear = (layout) => {
    const pixels = api.pixelPanelLayout(layout, stripViewport, rendered, constraints);
    assert.ok(pixels.top + pixels.height <= stripViewport.height - reserve + 1e-9, `panel bottom stays above the ${reserve}px control strip`);
    return pixels;
  };

  // A CSS default that would land inside the strip is pushed above it.
  const defaulted = api.pixelPanelLayout(null, stripViewport, { left: 120, top: 720 - 190 - 16, width: 360, height: 190 }, constraints);
  assert.ok(defaulted.top + defaulted.height <= stripViewport.height - reserve + 1e-9, "default bottom placement clears the strip");

  // Dragging or resizing toward the bottom never enters the strip.
  const start = { x: 0.2, y: 0.7, width: 0.3, height: 0.3 };
  for (const layout of [
    api.movePanelLayout(start, { x: 0, y: 10000 }, stripViewport, rendered, constraints),
    api.movePanelLayout(start, { x: 0, y: -10000 }, stripViewport, rendered, constraints),
    api.resizePanelLayout(start, { x: 0, y: 10000 }, stripViewport, rendered, constraints)
  ]) {
    assert.ok(api.isWithinBounds(layout, stripViewport, rendered, constraints), "reserved move/resize stays bounded");
    bottomClear(layout);
  }

  // A saved layout aimed below the strip is clamped to the reserve.
  const savedLow = api.pixelPanelLayout({ x: 0.1, y: 0.9, width: 0.3, height: 0.3 }, stripViewport, rendered, constraints);
  assert.ok(savedLow.top + savedLow.height <= stripViewport.height - reserve + 1e-9, "saved low layouts clamp above the strip");

  // Without a reserve the classic full-area behavior is unchanged.
  const classic = api.pixelPanelLayout({ x: 0.1, y: 0.9, width: 0.3, height: 0.3 }, stripViewport, rendered, { minWidth: 220, minHeight: 96, maxWidth: 400, maxHeight: 300 });
  assert.ok(classic.top + classic.height > stripViewport.height - reserve, "no reserve keeps the old full-area placement");
});

test("a panel taller than the free area is height-capped so it can never cover the strip", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const reserve = 72;
  const constraints = { minWidth: 280, minHeight: 128, maxWidth: 560, maxHeight: 520, bottomReserve: reserve };
  const smallViewport = { width: 640, height: 360 };
  // The manual/feed panels can measure far taller than the space above the
  // strip on a small player; the layout must cap the rendered height, not
  // just nudge the top.
  for (const renderedHeight of [520, 690, 2000]) {
    const layout = api.pixelPanelLayout(null, smallViewport, { left: 12, top: 12, width: 380, height: renderedHeight }, constraints);
    assert.ok(layout.top + layout.height <= smallViewport.height - reserve + 1e-9,
      `a ${renderedHeight}px-tall panel is capped above the strip`);
    assert.ok(api.isWithinBounds(layout, smallViewport, { left: 12, top: 12, width: 380, height: renderedHeight }, constraints),
      `capped ${renderedHeight}px-tall panel stays within bounds`);
    assert.ok(layout.height <= smallViewport.height - 2 * 12 - reserve + 1e-9,
      `height itself never exceeds the free area above the strip`);
  }
  // Dragging such a panel down keeps the same guarantee.
  const tall = api.pixelPanelLayout(null, smallViewport, { left: 12, top: 12, width: 380, height: 2000 }, constraints);
  const moved = api.movePanelLayout({ x: tall.layout.x, y: tall.layout.y, width: tall.layout.width, height: tall.layout.height }, { x: 0, y: 10000 }, smallViewport, { left: 12, top: 12, width: 380, height: 2000 }, constraints);
  const movedPixels = api.pixelPanelLayout(moved, smallViewport, { left: 12, top: 12, width: 380, height: 2000 }, constraints);
  assert.ok(movedPixels.top + movedPixels.height <= smallViewport.height - reserve + 1e-9, "dragging a tall panel down keeps it above the strip");
});
