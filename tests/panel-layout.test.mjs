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
  controls: { minWidth: 180, minHeight: 84, maxWidth: 360, maxHeight: 220 },
  settings: { minWidth: 240, minHeight: 96, maxWidth: 420, maxHeight: 480 }
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

test("first-open placement accepts a clamped below-occupant spot when it is overlap-free", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const viewport = { width: 640, height: 560 };
  const constraints = { minWidth: 240, minHeight: 96, maxWidth: 420, maxHeight: 480, bottomReserve: 72 };
  const slot = { left: 336, top: 58, width: 288, height: 190 };
  const intersects = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  const feed = { left: 336, top: 16, width: 288, height: 330 };
  // Stats bottoms sweep through the (274, 286] band where the below-occupant
  // request clamps at the bound: the clamped mirror spot must be accepted
  // whenever it no longer overlaps the occupant.
  for (const [statsHeight, expectedTop] of [[210, 280], [222, 286], [228, 286]]) {
    const stats = { left: 16, top: 58, width: 288, height: statsHeight };
    const placed = api.firstOpenPanelPlacement(viewport, constraints, slot, [feed, stats], api.PANEL_MARGIN);
    assert.ok(placed, `stats h=${statsHeight} still places`);
    assert.ok(Math.abs(placed.left - 16) < 1e-6, `stats h=${statsHeight} lands in the opposite column (left ${placed.left})`);
    assert.ok(Math.abs(placed.top - expectedTop) < 1e-6, `stats h=${statsHeight} lands at ${expectedTop} (top ${placed.top})`);
    assert.equal(intersects(placed, stats), false, `stats h=${statsHeight}: the clamped spot never covers stats`);
    assert.equal(intersects(placed, feed), false, `stats h=${statsHeight}: the clamped spot never covers feed`);
    assert.ok(placed.top + placed.height <= viewport.height - 12 - 72 + 1e-9, `stats h=${statsHeight} stays within the overlay bounds`);
  }
});

test("first-open placement never covers an occupant while any free spot exists", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const viewport = { width: 640, height: 560 };
  const constraints = { minWidth: 240, minHeight: 96, maxWidth: 420, maxHeight: 480, bottomReserve: 72 };
  const slot = { left: 336, top: 58, width: 288, height: 190 };
  const intersects = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  const boundsOk = (placed) => placed.left >= 12 - 1e-9 && placed.top >= 12 - 1e-9 && placed.left + placed.width <= viewport.width - 12 + 1e-9 && placed.top + placed.height <= viewport.height - 12 - 72 + 1e-9;
  const feed = { left: 336, top: 16, width: 288, height: 330 };
  // Sweep the left-column occupant (stats) through heights where the free
  // spot below it exists (bottom <= 286) and beyond it.
  for (let statsHeight = 128; statsHeight <= 236; statsHeight += 1) {
    const stats = { left: 16, top: 58, width: 288, height: statsHeight };
    const placed = api.firstOpenPanelPlacement(viewport, constraints, slot, [feed, stats], api.PANEL_MARGIN);
    assert.ok(placed, `stats h=${statsHeight} always places`);
    assert.ok(boundsOk(placed), `stats h=${statsHeight} stays within bounds`);
    const statsBottom = stats.top + stats.height;
    if (statsBottom <= viewport.height - 190 - 12 - 72) {
      assert.equal(intersects(placed, stats), false, `stats h=${statsHeight} never covers stats while a free spot exists`);
      assert.equal(intersects(placed, feed), false, `stats h=${statsHeight} never covers feed while a free spot exists`);
      assert.ok(Math.abs(placed.left - 16) < 1e-6, `stats h=${statsHeight} uses the opposite column`);
    }
  }
  // Sweep the right-column occupant (feed) through heights where the free
  // spot below it exists and beyond it.
  for (let feedHeight = 128; feedHeight <= 420; feedHeight += 1) {
    const occupant = { left: 336, top: 16, width: 288, height: feedHeight };
    const stats = { left: 16, top: 58, width: 288, height: 210 };
    const placed = api.firstOpenPanelPlacement(viewport, constraints, slot, [occupant, stats], api.PANEL_MARGIN);
    assert.ok(placed, `feed h=${feedHeight} always places`);
    assert.ok(boundsOk(placed), `feed h=${feedHeight} stays within bounds`);
    const feedBottom = occupant.top + occupant.height;
    if (feedBottom <= viewport.height - 190 - 12 - 72) {
      assert.equal(intersects(placed, occupant), false, `feed h=${feedHeight} never covers the feed while a free spot exists`);
      assert.equal(intersects(placed, stats), false, `feed h=${feedHeight} never covers stats while a free spot exists`);
    }
  }
});

test("first-open placement searches the free region above a mid-column occupant", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const viewport = { width: 640, height: 560 };
  const constraints = { minWidth: 240, minHeight: 96, maxWidth: 420, maxHeight: 480, bottomReserve: 72 };
  const slot = { left: 336, top: 58, width: 288, height: 190 };
  const intersects = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  // The default column's feed is dragged mid-column and the left column is
  // fully blocked: the only free spot is above the feed, at the top margin.
  const feed = { left: 336, top: 210, width: 288, height: 160 };
  const stats = { left: 16, top: 58, width: 288, height: 230 };
  const placed = api.firstOpenPanelPlacement(viewport, constraints, slot, [feed, stats], api.PANEL_MARGIN);
  assert.ok(placed, "a mid-column occupant still places");
  assert.ok(Math.abs(placed.left - 336) < 1e-6, `settings stays in the default column above the feed (left ${placed.left})`);
  assert.ok(Math.abs(placed.top - 12) < 1e-6, `settings opens at the top margin (top ${placed.top})`);
  assert.equal(intersects(placed, feed), false, "the above-occupant spot never covers the dragged feed");
  assert.equal(intersects(placed, stats), false, "the above-occupant spot never covers the stats panel");
  assert.ok(placed.top + placed.height <= viewport.height - 12 - 72 + 1e-9, "the above-occupant spot stays within bounds");
  // Mirrored: the left column's stats are dragged mid-column and the default
  // column is blocked, so the free spot is above stats at the top margin.
  const draggedStats = { left: 16, top: 210, width: 288, height: 160 };
  const defaultFeed = { left: 336, top: 16, width: 288, height: 330 };
  const mirrored = api.firstOpenPanelPlacement(viewport, constraints, slot, [defaultFeed, draggedStats], api.PANEL_MARGIN);
  assert.ok(mirrored, "the mirrored mid-column occupant still places");
  assert.ok(Math.abs(mirrored.left - 16) < 1e-6, `settings uses the opposite column above the occupant (left ${mirrored.left})`);
  assert.ok(Math.abs(mirrored.top - 12) < 1e-6, `the mirrored above-occupant spot sits at the top margin (top ${mirrored.top})`);
  assert.equal(intersects(mirrored, draggedStats), false, "the mirrored spot never covers the dragged stats panel");
  assert.equal(intersects(mirrored, defaultFeed), false, "the mirrored spot never covers the feed panel");
});

test("first-open placement never covers a free spot across occupant tops and heights", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const viewport = { width: 640, height: 560 };
  const constraints = { minWidth: 240, minHeight: 96, maxWidth: 420, maxHeight: 480, bottomReserve: 72 };
  const slot = { left: 336, top: 58, width: 288, height: 190 };
  const intersects = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  const freeSpotExists = (occupants) => {
    for (const left of [336, 16]) {
      for (let top = 12; top <= 286; top += 1) {
        const rect = { left, top, width: 288, height: 190 };
        if (!occupants.some((occupant) => intersects(rect, occupant))) return true;
      }
    }
    return false;
  };
  // Sweep both occupants' tops (dragged positions included) and heights.
  for (const feedTop of [16, 120, 210]) {
    for (const feedHeight of [160, 240, 330]) {
      for (const statsTop of [58, 150, 240]) {
        for (const statsHeight of [160, 210, 240]) {
          const feed = { left: 336, top: feedTop, width: 288, height: feedHeight };
          const stats = { left: 16, top: statsTop, width: 288, height: statsHeight };
          const placed = api.firstOpenPanelPlacement(viewport, constraints, slot, [feed, stats], api.PANEL_MARGIN);
          assert.ok(placed, `feed t=${feedTop} h=${feedHeight}, stats t=${statsTop} h=${statsHeight} always places`);
          assert.ok(placed.top + placed.height <= viewport.height - 12 - 72 + 1e-9, `bounds hold for feed t=${feedTop} h=${feedHeight}, stats t=${statsTop} h=${statsHeight}`);
          if (freeSpotExists([feed, stats])) {
            assert.equal(intersects(placed, feed) || intersects(placed, stats), false,
              `free spot exists for feed t=${feedTop} h=${feedHeight}, stats t=${statsTop} h=${statsHeight} but the placement overlaps`);
          }
        }
      }
    }
  }
});

test("first-open placement takes the zero-slack flush spot between same-column occupants", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const viewport = { width: 640, height: 560 };
  const constraints = { minWidth: 240, minHeight: 96, maxWidth: 420, maxHeight: 480, bottomReserve: 72 };
  const slot = { left: 336, top: 58, width: 288, height: 190 };
  const overlaps = (a, b) =>
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) > 1e-6 &&
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > 1e-6;
  const pairOccupants = (left, flushTop) => [
    { left, top: flushTop - 66, width: 288, height: 66 },
    { left, top: flushTop + 190, width: 288, height: 60 }
  ];
  const blocker = { left: 16, top: 57, width: 288, height: 230 };
  for (const flushTop of [122, 141, 188]) {
    const occupants = pairOccupants(336, flushTop).concat([blocker]);
    const placed = api.firstOpenPanelPlacement(viewport, constraints, slot, occupants, api.PANEL_MARGIN);
    assert.ok(placed, `flush spot at ${flushTop} still places`);
    assert.ok(Math.abs(placed.left - 336) < 1e-6, `flush spot at ${flushTop} stays in the default column (left ${placed.left})`);
    assert.ok(Math.abs(placed.top - flushTop) < 1e-6, `flush spot at ${flushTop} is chosen over the clamped last resort (top ${placed.top})`);
    for (const occupant of occupants) {
      assert.equal(overlaps(placed, occupant), false, `flush spot at ${flushTop} covers no occupant`);
    }
    assert.ok(placed.top + placed.height <= viewport.height - 12 - 72 + 1e-9, `flush spot at ${flushTop} stays within bounds`);
  }
});

test("first-open placement takes the zero-slack flush spot in the mirror column", async () => {
  const api = await moduleApi("panel-layout.js", "BVPanelLayout");
  const viewport = { width: 640, height: 560 };
  const constraints = { minWidth: 240, minHeight: 96, maxWidth: 420, maxHeight: 480, bottomReserve: 72 };
  const slot = { left: 336, top: 58, width: 288, height: 190 };
  const overlaps = (a, b) =>
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) > 1e-6 &&
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > 1e-6;
  const occupants = [
    { left: 16, top: 122, width: 288, height: 66 },
    { left: 16, top: 378, width: 288, height: 60 },
    { left: 336, top: 57, width: 288, height: 230 }
  ];
  const placed = api.firstOpenPanelPlacement(viewport, constraints, slot, occupants, api.PANEL_MARGIN);
  assert.ok(placed, "the mirrored flush spot still places");
  assert.ok(Math.abs(placed.left - 16) < 1e-6, `the mirrored flush spot uses the mirror column (left ${placed.left})`);
  assert.ok(Math.abs(placed.top - 188) < 1e-6, `the mirrored flush spot at 188 is chosen over the clamped last resort (top ${placed.top})`);
  for (const occupant of occupants) assert.equal(overlaps(placed, occupant), false, "the mirrored flush spot covers no occupant");
  assert.ok(placed.top + placed.height <= viewport.height - 12 - 72 + 1e-9, "the mirrored flush spot stays within bounds");
});
