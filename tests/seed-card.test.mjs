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

test("floating corner buttons pin to their corner and stay above the player strip", async () => {
  const api = await seedCardModule();
  const viewport = { width: 640, height: 360 }; // small player: strip top at 288
  const button = { height: 40 };
  const options = { reserve: 72 };
  const stripTop = viewport.height - options.reserve;
  const margin = api.SEED_BUTTON_MARGIN;
  // Near-left corner on a small player: its marked spot is clamped to 264px
  // and the pill floats above it, pinned to the corner and extending inward.
  const nearLeft = api.placeSeedCornerButton({ x: 140.8, y: 264 }, viewport, button, options);
  assert.equal(nearLeft.left, 140.8);
  assert.equal(nearLeft.right, null);
  assert.equal(nearLeft.top, 264 - api.SEED_RING_RADIUS - api.SEED_BUTTON_GAP);
  const nearRight = api.placeSeedCornerButton({ x: 499.2, y: 264 }, viewport, button, options);
  assert.equal(nearRight.left, null);
  assert.equal(nearRight.right, 140.8, "right-side pills extend inward from the corner");
  assert.equal(nearRight.top, nearLeft.top);
  const farRight = api.placeSeedCornerButton({ x: 403.2, y: 118.8 }, viewport, button, options);
  assert.equal(farRight.right, 236.8);
  assert.equal(farRight.top, 118.8 - api.SEED_RING_RADIUS - api.SEED_BUTTON_GAP);
  // A marked spot too high for an above pill flips the pill below the ring;
  // every placement stays inside the video and clear of the strip.
  const high = api.placeSeedCornerButton({ x: 320, y: 20 }, viewport, button, options);
  assert.equal(high.left, 320);
  assert.equal(high.top, 20 + api.SEED_RING_RADIUS + api.SEED_BUTTON_GAP + button.height);
  for (const placement of [nearLeft, nearRight, farRight, high]) {
    assert.ok(placement.top >= margin + button.height, "the pill never crosses the top edge");
    assert.ok(placement.top <= stripTop - margin + 1e-9, "the pill never covers the native player strip");
    const horizontal = placement.left != null ? placement.left : placement.right;
    assert.ok(horizontal >= 0 && horizontal <= viewport.width - margin + 1e-9, "the pill stays inside the video width");
  }
  // Narrow players still keep every corner reachable.
  const narrow = api.placeSeedCornerButton({ x: 280.8, y: 106 }, { width: 360, height: 202 }, button, options);
  assert.ok(Math.abs(narrow.right - 79.2) < 1e-9);
  assert.equal(narrow.top, 106 - api.SEED_RING_RADIUS - api.SEED_BUTTON_GAP);
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
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*width: min\(560px, calc\(100% - 24px\)\)/s);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*border: 2px solid var\(--lime-500\)/s);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*background: var\(--ink-900\)/s);
  assert.doesNotMatch(styles, /\.bv-seed-card[^\{]*\{[^}]*backdrop-filter:/s);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*box-shadow: 0 8px 28px rgba\(0,0,0,\.72\)/s);
  assert.match(styles, /\.bv-seed-card-handle[^\{]*\{[^}]*cursor: grab/s);
  assert.match(styles, /\.bv-seed-card[^\{]*\{[^}]*z-index: 3/s);
});
