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

  return Object.freeze({
    SEED_CARD_MARGIN: SEED_CARD_MARGIN,
    SEED_CARD_NUDGE: SEED_CARD_NUDGE,
    DEFAULT_SEED_CARD_TOP_RATIO: DEFAULT_SEED_CARD_TOP_RATIO,
    normalizePosition: normalizePosition,
    defaultSeedCardPosition: defaultSeedCardPosition,
    clampSeedCardPosition: clampSeedCardPosition,
    pixelSeedCardPosition: pixelSeedCardPosition,
    moveSeedCardPosition: moveSeedCardPosition,
    nudgeSeedCardPosition: nudgeSeedCardPosition,
    canSeedFromClick: canSeedFromClick,
    isWithinSeedCardBounds: isWithinSeedCardBounds
  });
});
