/* Geometry helpers for the movable court-seeding instruction card. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BVSeedCard = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  var SEED_CARD_MARGIN = 12;
  var SEED_CARD_NUDGE = 16;
  // The card sits in the quiet middle band, between the likely far and near
  // corner clicks, rather than over the bottom video controls/corners.
  var DEFAULT_SEED_CARD_TOP_RATIO = 0.35;

  function finite(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function dimension(value) { return Math.max(0, finite(value, 0)); }

  function normalizePosition(position) {
    if (!position || typeof position !== "object") return null;
    var x = finite(position.x, NaN);
    var y = finite(position.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  function available(viewport, card, margin) {
    var width = dimension(viewport && viewport.width);
    var height = dimension(viewport && viewport.height);
    var cardWidth = dimension(card && card.width);
    var cardHeight = dimension(card && card.height);
    var inset = Math.max(0, finite(margin, SEED_CARD_MARGIN));
    return {
      width: width,
      height: height,
      cardWidth: cardWidth,
      cardHeight: cardHeight,
      margin: inset,
      maxLeft: Math.max(inset, width - cardWidth - inset),
      maxTop: Math.max(inset, height - cardHeight - inset)
    };
  }

  function defaultSeedCardPosition(viewport, card, margin) {
    var bounds = available(viewport, card, margin);
    return {
      x: bounds.width ? ((bounds.maxLeft + bounds.margin) / 2) / bounds.width : 0,
      y: bounds.height ? Math.max(bounds.margin, Math.min(bounds.maxTop, bounds.height * DEFAULT_SEED_CARD_TOP_RATIO)) / bounds.height : 0
    };
  }

  function clampSeedCardPosition(position, viewport, card, margin) {
    var bounds = available(viewport, card, margin);
    var fallback = defaultSeedCardPosition(viewport, card, margin);
    var normalized = normalizePosition(position) || fallback;
    var left = normalized.x * bounds.width;
    var top = normalized.y * bounds.height;
    left = Math.max(bounds.margin, Math.min(bounds.maxLeft, left));
    top = Math.max(bounds.margin, Math.min(bounds.maxTop, top));
    return {
      x: bounds.width ? left / bounds.width : 0,
      y: bounds.height ? top / bounds.height : 0
    };
  }

  function pixelSeedCardPosition(position, viewport, card, margin) {
    var bounds = available(viewport, card, margin);
    var clamped = clampSeedCardPosition(position, viewport, card, margin);
    return {
      left: clamped.x * bounds.width,
      top: clamped.y * bounds.height,
      position: clamped
    };
  }

  function moveSeedCardPosition(position, delta, viewport, card, margin) {
    var bounds = available(viewport, card, margin);
    var current = pixelSeedCardPosition(position, viewport, card, margin);
    var next = {
      x: bounds.width ? (current.left + finite(delta && delta.x, 0)) / bounds.width : 0,
      y: bounds.height ? (current.top + finite(delta && delta.y, 0)) / bounds.height : 0
    };
    return clampSeedCardPosition(next, viewport, card, margin);
  }

  function nudgeSeedCardPosition(position, direction, viewport, card, margin, amount) {
    var delta = { x: 0, y: 0 };
    var step = Math.max(1, finite(amount, SEED_CARD_NUDGE));
    if (direction === "ArrowLeft") delta.x = -step;
    if (direction === "ArrowRight") delta.x = step;
    if (direction === "ArrowUp") delta.y = -step;
    if (direction === "ArrowDown") delta.y = step;
    return moveSeedCardPosition(position, delta, viewport, card, margin);
  }

  function canSeedFromClick(target, layer, seedCount, defaultPrevented) {
    return !defaultPrevented && target === layer && Number(seedCount) < 4;
  }

  function isWithinSeedCardBounds(position, viewport, card, margin) {
    var bounds = available(viewport, card, margin);
    var pixels = pixelSeedCardPosition(position, viewport, card, margin);
    return pixels.left >= bounds.margin - 1e-9 &&
      pixels.top >= bounds.margin - 1e-9 &&
      pixels.left + bounds.cardWidth <= bounds.width - bounds.margin + 1e-9 &&
      pixels.top + bounds.cardHeight <= bounds.height - bounds.margin + 1e-9;
  }

  // Floating corner-seed button geometry (small-screen court calibration).
  var SEED_BUTTON_GAP = 12; // space between the corner ring edge and the button
  var SEED_BUTTON_MARGIN = 12; // minimum distance from the video edges
  var SEED_RING_RADIUS = 13; // half of the 26px .bv-seed-target guide ring

  // The seed layer's click capture (and guide ring) ends above the native
  // player control strip, so on small players a near corner would have no
  // reachable click target. The floating corner button is the tappable
  // affordance for that corner: it is pinned next to the ring but always sits
  // fully above the strip reserve. The button carries translateY(-100%), so
  // the returned `top` is the button's visible bottom edge.
  function placeSeedCornerButton(anchor, viewport, button, options) {
    var margin = Math.max(0, finite(options && options.margin, SEED_BUTTON_MARGIN));
    var gap = Math.max(0, finite(options && options.gap, SEED_BUTTON_GAP));
    var radius = Math.max(0, finite(options && options.ringRadius, SEED_RING_RADIUS));
    var reserve = Math.max(0, finite(options && options.reserve, 0));
    var anchorX = finite(anchor && anchor.x, NaN);
    var anchorY = finite(anchor && anchor.y, NaN);
    var height = dimension(button && button.height);
    var viewportWidth = dimension(viewport && viewport.width);
    var viewportHeight = dimension(viewport && viewport.height);
    var layout = { left: null, right: null, top: margin };
    if (!viewportWidth || !viewportHeight || !height) return layout;
    // Horizontal pin: anchor the near edge of the button at the corner and let
    // it extend toward the middle of the video, so it never crosses an edge.
    if (!Number.isFinite(anchorX)) layout.left = margin;
    else if (anchorX <= viewportWidth / 2) layout.left = Math.max(0, Math.min(viewportWidth - margin, anchorX));
    else layout.right = Math.max(0, Math.min(viewportWidth - margin, viewportWidth - anchorX));
    // Vertical: prefer sitting above the marked spot, clear of its ring, then
    // clamp so the whole button stays above the player strip reserve. When the
    // spot is too high for the button to fit above it, sit below the spot.
    var stripTop = Math.max(0, viewportHeight - reserve);
    var minTop = margin + height;
    var maxTop = Math.max(minTop, stripTop - margin);
    var above = Number.isFinite(anchorY) ? anchorY - radius - gap : minTop;
    if (Number.isFinite(anchorY) && above < minTop) {
      layout.top = Math.min(maxTop, Math.max(minTop, anchorY + radius + gap + height));
    } else {
      layout.top = Math.max(minTop, Math.min(above, maxTop));
    }
    return layout;
  }

  return Object.freeze({
    SEED_CARD_MARGIN: SEED_CARD_MARGIN,
    SEED_CARD_NUDGE: SEED_CARD_NUDGE,
    DEFAULT_SEED_CARD_TOP_RATIO: DEFAULT_SEED_CARD_TOP_RATIO,
    SEED_BUTTON_GAP: SEED_BUTTON_GAP,
    SEED_BUTTON_MARGIN: SEED_BUTTON_MARGIN,
    SEED_RING_RADIUS: SEED_RING_RADIUS,
    normalizePosition: normalizePosition,
    defaultSeedCardPosition: defaultSeedCardPosition,
    clampSeedCardPosition: clampSeedCardPosition,
    pixelSeedCardPosition: pixelSeedCardPosition,
    moveSeedCardPosition: moveSeedCardPosition,
    nudgeSeedCardPosition: nudgeSeedCardPosition,
    canSeedFromClick: canSeedFromClick,
    isWithinSeedCardBounds: isWithinSeedCardBounds,
    placeSeedCornerButton: placeSeedCornerButton
  });
});
