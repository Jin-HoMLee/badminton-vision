import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function seedCardModule() {
  const source = await readFile(new URL("../src/seed-card.js", import.meta.url), "utf8");
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: "seed-card.js" });
  return context.globalThis.BVSeedCard;
}

const viewport = { width: 1280, height: 720 };
const card = { width: 560, height: 170 };

 test("default instruction card placement is bounded and leaves likely court corners open", async () => {
  const api = await seedCardModule();
  const position = api.defaultSeedCardPosition(viewport, card);
  const pixels = api.pixelSeedCardPosition(null, viewport, card);
  assert.equal(position.y, api.DEFAULT_SEED_CARD_TOP_RATIO);
  assert.ok(pixels.left > 0 && pixels.top >= viewport.height * api.DEFAULT_SEED_CARD_TOP_RATIO);
  assert.ok(api.isWithinSeedCardBounds(position, viewport, card));
  // The default middle-band placement is clear of both likely corner rows.
  assert.ok(pixels.top > viewport.height * 0.33);
  assert.ok(pixels.top + card.height < viewport.height * 0.82);
  assert.ok(pixels.left > viewport.width * 0.15);
  assert.ok(pixels.left + card.width < viewport.width * 0.85);
});

test("the instruction card cannot turn gestures into court seed points", async () => {
  const api = await seedCardModule();
  const layer = {};
  const card = {};
  assert.equal(api.canSeedFromClick(layer, layer, 0, false), true);
  assert.equal(api.canSeedFromClick(card, layer, 0, false), false);
  assert.equal(api.canSeedFromClick(layer, layer, 4, false), false);
  assert.equal(api.canSeedFromClick(layer, layer, 0, true), false);
});

test("custom position movement is clamped to the video overlay", async () => {
  const api = await seedCardModule();
  const moved = api.moveSeedCardPosition({ x: 0.25, y: 0.2 }, { x: 500, y: 156 }, viewport, card);
  assert.ok(api.isWithinSeedCardBounds(moved, viewport, card));
  assert.equal(moved.x, (viewport.width - card.width - api.SEED_CARD_MARGIN) / viewport.width);
  assert.equal(moved.y, 300 / viewport.height);

  const beyond = api.moveSeedCardPosition(moved, { x: 10000, y: 10000 }, viewport, card);
  assert.equal(beyond.x, (viewport.width - card.width - api.SEED_CARD_MARGIN) / viewport.width);
  assert.equal(beyond.y, (viewport.height - card.height - api.SEED_CARD_MARGIN) / viewport.height);
  assert.ok(api.isWithinSeedCardBounds(beyond, viewport, card));
});

test("keyboard nudges use the same safe bounds as dragging", async () => {
  const api = await seedCardModule();
  const start = { x: 0.5, y: 0.5 };
  const left = api.nudgeSeedCardPosition(start, "ArrowLeft", viewport, card);
  const down = api.nudgeSeedCardPosition(start, "ArrowDown", viewport, card);
  assert.equal(left.x, (0.5 * viewport.width - api.SEED_CARD_NUDGE) / viewport.width);
  assert.equal(left.y, 0.5);
  assert.equal(down.x, 0.5);
  assert.equal(down.y, (0.5 * viewport.height + api.SEED_CARD_NUDGE) / viewport.height);
  assert.ok(api.isWithinSeedCardBounds(left, viewport, card));
  assert.ok(api.isWithinSeedCardBounds(down, viewport, card));
});

test("seed-card rendering exposes readable contrast and accessible movement hooks", async () => {
  const [content, styles] = await Promise.all([
    readFile(new URL("../src/content.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  assert.match(content, /data-bso-seed-card/);
  assert.match(content, /data-bso-contrast.*high/);
  assert.match(content, /data-bso-seed-card-handle/);
  assert.match(content, /aria-label.*Move court setup instructions/);
  assert.match(content, /aria-describedby.*bv-seed-card-help/);
  assert.match(content, /aria-keyshortcuts.*ArrowLeft.*Home/);
  assert.match(content, /Reset position/);
  assert.match(content, /seedCardApi\.canSeedFromClick/);
  assert.match(content, /data-bso-seed-click-policy.*layer-only/);
  assert.match(content, /if \(state\.panels\.map\)/);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*top: 35%/s);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*background: var\(--surface-panel\)/s);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*backdrop-filter: var\(--blur-panel\)/s);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*box-shadow: var\(--shadow-modal\)/s);
  assert.match(styles, /\.bv-seed-card-handle[^\{]*\{[^}]*cursor: grab/s);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*z-index: 3/s);
});
