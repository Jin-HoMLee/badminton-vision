/* Pure geometry helpers for movable, resizable video-overlay panels. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BVPanelLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  var PANEL_MARGIN = 12;
  var PANEL_NUDGE = 16;
  var PANEL_RESIZE_NUDGE = 16;
  // YouTube draws its bottom control strip (progress bar, play/pause, volume,
  // settings) over the video's bottom edge. Overlay panels reserve this strip
  // so the native player stays fully interactive; callers pass the reserve in
  // per-panel constraints (0 keeps the classic full-area behavior).
  var DEFAULT_CONTROLS_RESERVE = 0;
  var OVERLAP_EPSILON = 1e-6;

  function finite(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function dimension(value) { return Math.max(0, finite(value, 0)); }

  function optionalRatio(value) {
    if (value == null || value === "") return null;
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
  }

  function normalizeLayout(layout) {
    if (!layout || typeof layout !== "object") return null;
    var result = {};
    ["x", "y", "width", "height"].forEach(function (key) {
      var value = optionalRatio(layout[key]);
      if (value != null) result[key] = value;
    });
    if (!Object.keys(result).length) return null;
    if (result.width === 0) delete result.width;
    if (result.height === 0) delete result.height;
    return Object.keys(result).length ? result : null;
  }

  function bounds(viewport, constraints) {
    var width = dimension(viewport && viewport.width);
    var height = dimension(viewport && viewport.height);
    var options = constraints || {};
    var margin = Math.max(0, finite(options.margin, PANEL_MARGIN));
    var bottomReserve = Math.max(0, finite(options.bottomReserve, DEFAULT_CONTROLS_RESERVE));
    var availableWidth = Math.max(0, width - margin * 2);
    var availableHeight = Math.max(0, height - margin * 2 - bottomReserve);
    var configuredMinWidth = Math.max(1, finite(options.minWidth, 160));
    var configuredMinHeight = Math.max(1, finite(options.minHeight, 96));
    var configuredMaxWidth = Math.max(configuredMinWidth, finite(options.maxWidth, width || configuredMinWidth));
    var configuredMaxHeight = Math.max(configuredMinHeight, finite(options.maxHeight, height || configuredMinHeight));
    return {
      width: width,
      height: height,
      margin: margin,
      bottomReserve: bottomReserve,
      minWidth: Math.min(configuredMinWidth, availableWidth || configuredMinWidth),
      minHeight: Math.min(configuredMinHeight, availableHeight || configuredMinHeight),
      maxWidth: Math.max(0, Math.min(configuredMaxWidth, availableWidth)),
      maxHeight: Math.max(0, Math.min(configuredMaxHeight, availableHeight))
    };
  }

  function clamp(value, minimum, maximum) {
    if (maximum < minimum) return maximum;
    return Math.max(minimum, Math.min(maximum, value));
  }

  function pixelPanelLayout(layout, viewport, rendered, constraints) {
    var area = bounds(viewport, constraints);
    var normalized = normalizeLayout(layout) || {};
    var fallback = rendered || {};
    var width = normalized.width != null ? normalized.width * area.width : dimension(fallback.width);
    var height = normalized.height != null ? normalized.height * area.height : dimension(fallback.height);
    width = clamp(width || area.minWidth, Math.min(area.minWidth, area.maxWidth), area.maxWidth);
    height = clamp(height || area.minHeight, Math.min(area.minHeight, area.maxHeight), area.maxHeight);
    var left = normalized.x != null ? normalized.x * area.width : finite(fallback.left, area.margin);
    var top = normalized.y != null ? normalized.y * area.height : finite(fallback.top, area.margin);
    left = clamp(left, area.margin, Math.max(area.margin, area.width - width - area.margin));
    // The bottom reserve keeps a panel bottom edge clear of the native player
    // control strip even when a saved layout (or a drag) aims below it.
    top = clamp(top, area.margin, Math.max(area.margin, area.height - height - area.margin - area.bottomReserve));
    return {
      left: left,
      top: top,
      width: width,
      height: height,
      layout: {
        x: area.width ? left / area.width : 0,
        y: area.height ? top / area.height : 0,
        width: area.width ? width / area.width : 0,
        height: area.height ? height / area.height : 0
      }
    };
  }

  function movePanelLayout(layout, delta, viewport, rendered, constraints) {
    var pixels = pixelPanelLayout(layout, viewport, rendered, constraints);
    var area = bounds(viewport, constraints);
    return pixelPanelLayout({
      x: area.width ? (pixels.left + finite(delta && delta.x, 0)) / area.width : 0,
      y: area.height ? (pixels.top + finite(delta && delta.y, 0)) / area.height : 0,
      width: pixels.layout.width,
      height: pixels.layout.height
    }, viewport, pixels, constraints).layout;
  }

  function resizePanelLayout(layout, delta, viewport, rendered, constraints) {
    var pixels = pixelPanelLayout(layout, viewport, rendered, constraints);
    var area = bounds(viewport, constraints);
    return pixelPanelLayout({
      x: pixels.layout.x,
      y: pixels.layout.y,
      width: area.width ? (pixels.width + finite(delta && delta.x, 0)) / area.width : 0,
      height: area.height ? (pixels.height + finite(delta && delta.y, 0)) / area.height : 0
    }, viewport, pixels, constraints).layout;
  }

  function nudgePanelLayout(layout, direction, viewport, rendered, constraints, amount) {
    var step = Math.max(1, finite(amount, PANEL_NUDGE));
    var delta = { x: 0, y: 0 };
    if (direction === "ArrowLeft") delta.x = -step;
    if (direction === "ArrowRight") delta.x = step;
    if (direction === "ArrowUp") delta.y = -step;
    if (direction === "ArrowDown") delta.y = step;
    return movePanelLayout(layout, delta, viewport, rendered, constraints);
  }

  function nudgePanelSize(layout, direction, viewport, rendered, constraints, amount) {
    var step = Math.max(1, finite(amount, PANEL_RESIZE_NUDGE));
    var delta = { x: 0, y: 0 };
    if (direction === "ArrowLeft") delta.x = -step;
    if (direction === "ArrowRight") delta.x = step;
    if (direction === "ArrowUp") delta.y = -step;
    if (direction === "ArrowDown") delta.y = step;
    return resizePanelLayout(layout, delta, viewport, rendered, constraints);
  }

  function isWithinBounds(layout, viewport, rendered, constraints) {
    var area = bounds(viewport, constraints);
    var pixels = pixelPanelLayout(layout, viewport, rendered, constraints);
    return pixels.left >= area.margin - 1e-9 && pixels.top >= area.margin - 1e-9 &&
      pixels.left + pixels.width <= area.width - area.margin + 1e-9 &&
      pixels.top + pixels.height <= area.height - area.margin - area.bottomReserve + 1e-9 &&
      pixels.width >= Math.min(area.minWidth, area.maxWidth) - 1e-9 &&
      pixels.height >= Math.min(area.minHeight, area.maxHeight) - 1e-9;
  }

  function firstOpenPanelPlacement(viewport, constraints, slot, occupants, gap) {
    var areaWidth = dimension(viewport && viewport.width);
    var areaHeight = dimension(viewport && viewport.height);
    var width = dimension(slot && slot.width);
    var height = dimension(slot && slot.height);
    if (!(areaWidth > 0 && areaHeight > 0 && width > 0 && height > 0)) return null;
    var startLeft = finite(slot.left, 0);
    var startTop = finite(slot.top, 0);
    var stepGap = Math.max(0, finite(gap, PANEL_MARGIN));
    var area = bounds(viewport, constraints || {});
    var maxTop = Math.max(area.margin, area.height - height - area.margin - area.bottomReserve);
    var openRects = [];
    (occupants || []).forEach(function (occupant) {
      if (!occupant) return;
      var occupantWidth = dimension(occupant.width);
      var occupantHeight = dimension(occupant.height);
      if (occupantWidth > 0 && occupantHeight > 0) {
        openRects.push({ left: finite(occupant.left, 0), top: finite(occupant.top, 0), width: occupantWidth, height: occupantHeight });
      }
    });
    var clampAt = function (left, top) {
      return pixelPanelLayout({
        x: left / areaWidth,
        y: top / areaHeight,
        width: width / areaWidth,
        height: height / areaHeight
      }, viewport, null, constraints || {});
    };
    var intersects = function (rect, other) {
      var widthOverlap = Math.min(rect.left + rect.width, other.left + other.width) - Math.max(rect.left, other.left);
      var heightOverlap = Math.min(rect.top + rect.height, other.top + other.height) - Math.max(rect.top, other.top);
      return widthOverlap > OVERLAP_EPSILON && heightOverlap > OVERLAP_EPSILON;
    };
    var overlapsAny = function (rect) {
      for (var index = 0; index < openRects.length; index += 1) {
        if (intersects(rect, openRects[index])) return true;
      }
      return false;
    };
    var clippedTop = function (top) { return Math.min(maxTop, Math.max(area.margin, top)); };
    var boundaryTops = function (withGap) {
      var tops = [];
      for (var index = 0; index < openRects.length; index += 1) {
        var occupant = openRects[index];
        tops.push(clippedTop(occupant.top + occupant.height + (withGap ? stepGap : 0)));
        tops.push(clippedTop(occupant.top - height - (withGap ? stepGap : 0)));
      }
      return tops.sort(function (a, b) { return a - b; });
    };
    var search = function (left, tops) {
      for (var index = 0; index < tops.length; index += 1) {
        var rect = clampAt(left, tops[index]);
        if (!overlapsAny(rect)) return rect;
      }
      return null;
    };
    var gapPass = [startTop, area.margin].concat(boundaryTops(true), [maxTop]);
    var flushPass = boundaryTops(false);
    var mirrorLeft = areaWidth - (startLeft + width);
    var placed = search(startLeft, gapPass) || search(mirrorLeft, gapPass) || search(startLeft, flushPass) || search(mirrorLeft, flushPass);
    if (placed) return placed;
    return clampAt(startLeft, maxTop);
  }

  return Object.freeze({
    PANEL_MARGIN: PANEL_MARGIN,
    PANEL_NUDGE: PANEL_NUDGE,
    PANEL_RESIZE_NUDGE: PANEL_RESIZE_NUDGE,
    normalizeLayout: normalizeLayout,
    pixelPanelLayout: pixelPanelLayout,
    firstOpenPanelPlacement: firstOpenPanelPlacement,
    movePanelLayout: movePanelLayout,
    resizePanelLayout: resizePanelLayout,
    nudgePanelLayout: nudgePanelLayout,
    nudgePanelSize: nudgePanelSize,
    isWithinBounds: isWithinBounds
  });
});
