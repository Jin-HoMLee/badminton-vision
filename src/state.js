/* UI state is serialisable so storage and runtime messages share one contract. */
(function (root) {
  "use strict";

  var LABEL_STORE_VERSION = 1;
  var UNSCOPED_LABEL_KEY = "legacy:unscoped";
  var defaults = {
    enabled: false,
    seeded: false,
    seeding: false,
    labeling: false,
    stale: false,
    cameraCut: false,
    videoKey: null,
    videoUrl: null,
    // manualLabels is the active-video compatibility projection. The durable
    // source of truth is manualLabelsByVideo below.
    manualLabels: [],
    manualLabelsByVideo: {},
    labelUndoByVideo: {},
    manualLabelsVersion: LABEL_STORE_VERSION,
    lastEdit: null,
    // Evidence visibility is independent from analyzer execution. These
    // preferences survive every live result rerender; unavailable groups keep
    // their remembered value without implying that evidence exists.
    // The default video layer is evidence-only: pose, shuttle, and any
    // supplied racket signal. Player boxes remain an explicit opt-in so the
    // picture stays clear while the underlying runtime still analyzes them.
    trackerSettings: { court: true, players: false, body: true, shuttle: true, racket: true },
    // seedPoints are the committed, normalized outer-corner correspondences.
    seedPoints: [],
    // A draft is deliberately separate so Cancel can preserve a prior court.
    seedDraftPoints: [],
    // Kept for migration from the first movable court-card implementation.
    seedCardPosition: null,
    // Overlay geometry is normalized to the video rectangle and scoped by
    // video so theater/fullscreen changes can clamp it without touching video.
    panelLayouts: {},
    panelLayoutsByVideo: {},
    calibration: null,
    calibrationError: null,
    rally: 14,
    time: "12:04.320",
    density: "minimal",
    // Panels are on-demand furniture. Minimal starts with only the normalized
    // detection layer and the compact in-video access point; the popup is the
    // canonical place to choose persistent panel visibility.
    // Evidence visibility is controlled in the popup's disclosure; it is not
    // an on-video panel. Keep panel furniture limited to actual overlay
    // surfaces so legacy evidence-panel state cannot mount a duplicate UI.
    panels: { feed: false, stats: false, map: false, controls: false },
    // Explicit panel choices override density presets while the preference
    // still gives Balanced/Full a useful default presentation. Both the
    // effective values and overrides are scoped to the active video.
    panelOverrides: {},
    panelsByVideo: {},
    panelOverridesByVideo: {},
    trackerSettingsByVideo: {},
    // Collapse state mirrors panel geometry: per panel, scoped by video, so a
    // collapsed panel stays collapsed for that video only.
    collapsedPanels: {},
    collapsedPanelsByVideo: {},
    // The court-setup line overlay is a show/hide preference scoped by video.
    // Absent entries mean visible (the default); only explicit hides are kept.
    courtLinesByVideo: {},
  };

  function clone(value) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }

  function copyPoints(points) {
    return Array.isArray(points) ? points.map(function (point) {
      return point && typeof point === "object" ? { x: point.x, y: point.y } : point;
    }) : [];
  }

  function isNormalizedPoint(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      && typeof value.x === "number" && Number.isFinite(value.x)
      && typeof value.y === "number" && Number.isFinite(value.y)
      && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
  }

  var CANONICAL_COURT_CORNERS = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  var CALIBRATION_DUPLICATE_RATIO = 1e-7;
  var CALIBRATION_AREA_RATIO = 1e-7;
  var CALIBRATION_CORNER_TOLERANCE = 1e-4;

  function calibrationScale(matrix) {
    var scale = 1;
    for (var row = 0; row < 3; row += 1) {
      for (var col = 0; col < 3; col += 1) scale = Math.max(scale, Math.abs(matrix[row][col]));
    }
    return scale;
  }

  function isCalibrationMatrix(value) {
    if (!Array.isArray(value) || value.length !== 3 || value.some(function (row) {
      return !Array.isArray(row) || row.length !== 3 || row.some(function (entry) { return typeof entry !== "number" || !Number.isFinite(entry); });
    })) return false;
    var determinant = value[0][0] * (value[1][1] * value[2][2] - value[1][2] * value[2][1])
      - value[0][1] * (value[1][0] * value[2][2] - value[1][2] * value[2][0])
      + value[0][2] * (value[1][0] * value[2][1] - value[1][1] * value[2][0]);
    var scale = calibrationScale(value);
    return Number.isFinite(determinant) && Math.abs(determinant) > 1e-14 * scale * scale * scale;
  }

  function applyCalibrationMatrix(matrix, point) {
    var scale = Math.max(calibrationScale(matrix), Math.abs(point.x), Math.abs(point.y));
    var denominator = matrix[2][0] * point.x + matrix[2][1] * point.y + matrix[2][2];
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-12 * scale) return null;
    var result = {
      x: (matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2]) / denominator,
      y: (matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2]) / denominator
    };
    return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
  }

  function seedQuadScale(seedPoints) {
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    for (var index = 0; index < 4; index += 1) {
      minX = Math.min(minX, seedPoints[index].x);
      maxX = Math.max(maxX, seedPoints[index].x);
      minY = Math.min(minY, seedPoints[index].y);
      maxY = Math.max(maxY, seedPoints[index].y);
    }
    var scale = Math.max(maxX - minX, maxY - minY, 1e-15);
    for (var first = 0; first < 4; first += 1) {
      for (var second = first + 1; second < 4; second += 1) {
        var distance = Math.sqrt(Math.pow(seedPoints[first].x - seedPoints[second].x, 2)
          + Math.pow(seedPoints[first].y - seedPoints[second].y, 2));
        scale = Math.max(scale, distance);
      }
    }
    return scale;
  }

  function isValidSeedQuad(seedPoints) {
    var scale = seedQuadScale(seedPoints);
    var duplicateFloor = CALIBRATION_DUPLICATE_RATIO * scale;
    for (var first = 0; first < 4; first += 1) {
      for (var second = first + 1; second < 4; second += 1) {
        var distance = Math.sqrt(Math.pow(seedPoints[first].x - seedPoints[second].x, 2)
          + Math.pow(seedPoints[first].y - seedPoints[second].y, 2));
        if (distance <= duplicateFloor) return false;
      }
    }
    var collinearFloor = CALIBRATION_AREA_RATIO * scale * scale;
    var winding = 0;
    for (var index = 0; index < 4; index += 1) {
      var a = seedPoints[index];
      var b = seedPoints[(index + 1) % 4];
      var c = seedPoints[(index + 2) % 4];
      var cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) <= collinearFloor) return false;
      var sign = cross > 0 ? 1 : -1;
      if (winding !== 0 && sign !== winding) return false;
      winding = sign;
    }
    var doubledArea = 0;
    for (index = 0; index < 4; index += 1) {
      var point = seedPoints[index];
      var next = seedPoints[(index + 1) % 4];
      doubledArea += point.x * next.y - next.x * point.y;
    }
    return Math.abs(doubledArea) / 2 > collinearFloor;
  }

  function mapsSeedsToCanonicalCourt(seedPoints, homography) {
    for (var index = 0; index < 4; index += 1) {
      var seed = seedPoints[index];
      var canonical = CANONICAL_COURT_CORNERS[index];
      var projected = applyCalibrationMatrix(homography.imageToCourt, seed);
      if (!projected || Math.abs(projected.x - canonical.x) > CALIBRATION_CORNER_TOLERANCE
        || Math.abs(projected.y - canonical.y) > CALIBRATION_CORNER_TOLERANCE) return false;
      var mapped = applyCalibrationMatrix(homography.courtToImage, canonical);
      if (!mapped || Math.abs(mapped.x - seed.x) > CALIBRATION_CORNER_TOLERANCE
        || Math.abs(mapped.y - seed.y) > CALIBRATION_CORNER_TOLERANCE) return false;
    }
    return true;
  }

  function isCourtCalibration(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || value.version !== 1
      || value.coordinateSystem !== "normalized-video-image"
      || value.courtCoordinateSystem !== "normalized-court") return false;
    var seedPoints = value.seedPoints || value.normalizedSeedPoints || value.sourcePoints;
    var homography = value.homography;
    return Array.isArray(seedPoints) && seedPoints.length === 4 && seedPoints.every(isNormalizedPoint)
      && homography && typeof homography === "object"
      && isCalibrationMatrix(homography.imageToCourt)
      && isCalibrationMatrix(homography.courtToImage)
      && isValidSeedQuad(seedPoints)
      && mapsSeedsToCanonicalCourt(seedPoints, homography);
  }

  function copyCardPosition(position) {
    if (!position || typeof position !== "object") return null;
    var x = Number(position.x);
    var y = Number(position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  var PANEL_LAYOUT_KEYS = ["courtSetup", "stats", "map", "feed", "manual", "controls"];

  function copyPanelLayout(layout) {
    if (!layout || typeof layout !== "object") return null;
    var result = {};
    ["x", "y", "width", "height"].forEach(function (key) {
      if (layout[key] == null || layout[key] === "") return;
      var value = Number(layout[key]);
      if (!Number.isFinite(value)) return;
      value = Math.max(0, Math.min(1, value));
      if ((key === "width" || key === "height") && value === 0) return;
      result[key] = value;
    });
    return Object.keys(result).length ? result : null;
  }

  function copyPanelLayouts(layouts) {
    var result = {};
    if (!layouts || typeof layouts !== "object") return result;
    PANEL_LAYOUT_KEYS.forEach(function (key) {
      var layout = copyPanelLayout(layouts[key]);
      if (layout) result[key] = layout;
    });
    return result;
  }

  function copyPanelLayoutMap(raw) {
    var result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.keys(raw).forEach(function (key) {
      var layouts = copyPanelLayouts(raw[key]);
      if (Object.keys(layouts).length) result[String(key)] = layouts;
    });
    return result;
  }

  function panelLayoutsForVideo(stateOrMap, videoKey) {
    var map = stateOrMap && stateOrMap.panelLayoutsByVideo ? stateOrMap.panelLayoutsByVideo : stateOrMap;
    if (!map || videoKey == null || !map[String(videoKey)]) return {};
    return copyPanelLayouts(map[String(videoKey)]);
  }

  // Panels that are overlay furniture (not the transient court-setup card)
  // get a header collapse/expand affordance; state mirrors layout persistence.
  var PANEL_COLLAPSE_KEYS = ["stats", "map", "feed", "manual", "controls"];

  function copyPanelCollapseState(collapsed) {
    var result = {};
    if (!collapsed || typeof collapsed !== "object") return result;
    PANEL_COLLAPSE_KEYS.forEach(function (key) {
      if (collapsed[key] === true) result[key] = true;
    });
    return result;
  }

  function copyPanelCollapseMap(raw) {
    var result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.keys(raw).forEach(function (key) {
      var collapsed = copyPanelCollapseState(raw[key]);
      if (Object.keys(collapsed).length) result[String(key)] = collapsed;
    });
    return result;
  }

  function collapsedPanelsForVideo(stateOrMap, videoKey) {
    var map = stateOrMap && stateOrMap.collapsedPanelsByVideo ? stateOrMap.collapsedPanelsByVideo : stateOrMap;
    if (!map || videoKey == null || !map[String(videoKey)]) return {};
    return copyPanelCollapseState(map[String(videoKey)]);
  }

  function copyCourtLinesMap(raw) {
    var result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.keys(raw).forEach(function (key) {
      if (raw[key] === false) result[String(key)] = false;
    });
    return result;
  }

  function copyRecords(records) {
    return Array.isArray(records) ? records.map(clone) : [];
  }

  function copyEdit(edit) { return edit && typeof edit === "object" ? clone(edit) : null; }

  var PANEL_VISIBILITY_KEYS = ["feed", "stats", "map", "controls"];
  function copyPanelVisibility(panels) {
    var result = {};
    if (!panels || typeof panels !== "object") return result;
    PANEL_VISIBILITY_KEYS.forEach(function (key) {
      if (panels[key] != null) result[key] = Boolean(panels[key]);
    });
    return result;
  }
  function copyPanelVisibilityMap(raw) {
    var result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.keys(raw).forEach(function (key) {
      var panels = copyPanelVisibility(raw[key]);
      if (Object.keys(panels).length) result[String(key)] = panels;
    });
    return result;
  }
  function copyPanelOverrides(overrides) {
    return copyPanelVisibility(overrides);
  }
  function copyPanelOverridesMap(raw) {
    return copyPanelVisibilityMap(raw);
  }
  function copyTrackerSettings(settings) {
    var result = {};
    if (!settings || typeof settings !== "object") return result;
    Object.keys(defaults.trackerSettings).forEach(function (key) {
      if (settings[key] != null) result[key] = Boolean(settings[key]);
    });
    return result;
  }
  function copyTrackerSettingsMap(raw) {
    var result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.keys(raw).forEach(function (key) {
      var settings = copyTrackerSettings(raw[key]);
      if (Object.keys(settings).length) result[String(key)] = settings;
    });
    return result;
  }
  function panelsForDensity(density, overrides) {
    var panels = {
      // Minimal is deliberately evidence-only. Balanced and Full retain the
      // existing richer presets without making them the default experience.
      feed: density !== "minimal",
      stats: density !== "minimal",
      map: density === "full",
      controls: density !== "minimal"
    };
    Object.keys(overrides || {}).forEach(function (key) {
      panels[key] = Boolean(overrides[key]);
    });
    return panels;
  }
  function withPanelPreferences(current, panels, overrides) {
    var panelMap = copyPanelVisibilityMap(current.panelsByVideo);
    var overrideMap = copyPanelOverridesMap(current.panelOverridesByVideo);
    var key = current.videoKey == null ? null : String(current.videoKey);
    if (key) {
      panelMap[key] = copyPanelVisibility(panels);
      overrideMap[key] = copyPanelOverrides(overrides);
    }
    return initialExtensionState(Object.assign({}, current, {
      panels: Object.assign({}, defaults.panels, panels || {}),
      panelOverrides: copyPanelOverrides(overrides),
      panelsByVideo: panelMap,
      panelOverridesByVideo: overrideMap
    }));
  }
  function withTrackerPreferences(current, trackerSettings) {
    var trackerMap = copyTrackerSettingsMap(current.trackerSettingsByVideo);
    var key = current.videoKey == null ? null : String(current.videoKey);
    if (key) trackerMap[key] = copyTrackerSettings(trackerSettings);
    return initialExtensionState(Object.assign({}, current, {
      trackerSettings: Object.assign({}, defaults.trackerSettings, trackerSettings || {}),
      trackerSettingsByVideo: trackerMap
    }));
  }
  function timestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !value.trim()) return null;
    var text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    var parts = text.split(":");
    if (parts.length !== 2) return null;
    var minutes = Number(parts[0]);
    var seconds = Number(parts[1]);
    return Number.isFinite(minutes) && Number.isFinite(seconds) ? minutes * 60 + seconds : null;
  }

  function formatMediaTime(seconds) {
    if (!Number.isFinite(seconds)) return "";
    var minutes = Math.floor(seconds / 60);
    var remaining = seconds - minutes * 60;
    return String(minutes).padStart(2, "0") + ":" + remaining.toFixed(3).padStart(6, "0");
  }

  function nowIso(options) {
    var value = options && options.now;
    if (typeof value === "function") value = value();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" && value) return value;
    return new Date().toISOString();
  }

  function hash(text) {
    var result = 2166136261;
    String(text || "").split("").forEach(function (character) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    });
    return (result >>> 0).toString(36);
  }

  function createManualEventId(videoKey, startSec, records) {
    var base = "manual-" + hash(videoKey || UNSCOPED_LABEL_KEY) + "-" + (Number.isFinite(Number(startSec)) ? Math.round(Number(startSec) * 1000) : "point");
    var used = Object.create(null);
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (record && record.eventId != null) used[String(record.eventId)] = true;
    });
    if (!used[base]) return base;
    var suffix = 2;
    while (used[base + "-" + suffix]) suffix += 1;
    return base + "-" + suffix;
  }

  function normalizeLabel(record, index, videoKey, options) {
    var value = clone(record || {});
    var key = videoKey || UNSCOPED_LABEL_KEY;
    if (value.eventId == null && value.id != null) value.eventId = value.id;
    if (value.eventId == null || String(value.eventId) === "") {
      var generatedId = createManualEventId(key, timestamp(value.startSec != null ? value.startSec : value.time), []);
      value.eventId = generatedId + (index ? "-" + index : "");
    }
    value.eventId = String(value.eventId);
    var start = timestamp(value.startSec != null ? value.startSec : (value.start_media_time != null ? value.start_media_time : value.startTime != null ? value.startTime : value.time));
    var end = timestamp(value.endSec != null ? value.endSec : (value.end_media_time != null ? value.end_media_time : value.endTime));
    if (start != null && start >= 0) {
      value.startSec = start;
      if (value.time == null) value.time = formatMediaTime(start);
    }
    if (end != null && end >= 0) value.endSec = end;
    if (value.shot == null && value.label != null) value.shot = value.label;
    if (value.source == null) value.source = value.provenance || "manual";
    if (value.provenance == null) value.provenance = value.source;
    if (value.createdAt == null) value.createdAt = nowIso(options);
    if (value.updatedAt == null) value.updatedAt = value.createdAt;
    return value;
  }

  function mergeLabelValues(previous, value) {
    var merged = Object.assign({}, previous || {}, value || {});
    if (value && value.source === "manual") {
      ["confidence", "classification_confidence", "geometry_confidence"].forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(value, field)) delete merged[field];
      });
    }
    return merged;
  }

  function mergeRecords(base, additions, videoKey, options) {
    var result = [];
    var positions = Object.create(null);
    (Array.isArray(base) ? base : []).forEach(function (record, index) {
      var value = normalizeLabel(record, index, videoKey, options);
      var id = String(value.eventId);
      if (positions[id] == null) {
        positions[id] = result.length;
        result.push(value);
      } else result[positions[id]] = mergeLabelValues(result[positions[id]], value);
    });
    (Array.isArray(additions) ? additions : []).forEach(function (record, index) {
      var value = normalizeLabel(record, index, videoKey, options);
      var id = String(value.eventId);
      if (positions[id] == null) {
        positions[id] = result.length;
        result.push(value);
      } else result[positions[id]] = mergeLabelValues(result[positions[id]], value);
    });
    return result;
  }

  function copyLabelMap(raw, options) {
    var result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.keys(raw).forEach(function (key) {
      var entry = raw[key];
      var records = Array.isArray(entry) ? entry : entry && typeof entry === "object" && (entry.labels || entry.records);
      if (!Array.isArray(records)) return;
      result[String(key)] = mergeRecords([], records, String(key), options);
    });
    return result;
  }

  function copyUndoMap(raw) {
    var result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.keys(raw).forEach(function (key) {
      if (raw[key] && typeof raw[key] === "object") result[String(key)] = copyEdit(raw[key]);
    });
    return result;
  }

  function mapKeys(map) { return Object.keys(map || {}).filter(function (key) { return Array.isArray(map[key]); }); }

  // YouTube's video id is stable across theater/fullscreen and query ordering.
  // A canonical, fragment-free URL is the safe fallback for other media pages.
  function videoKeyForUrl(url) {
    var text = String(url || "");
    var parsed = null;
    try { if (typeof URL === "function") parsed = new URL(text); } catch (_) { parsed = null; }
    if (parsed && /^https?:$/.test(parsed.protocol)) {
      var host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      var id = null;
      if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
        if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || null;
        try { id = id || parsed.searchParams.get("v"); } catch (_) {}
        if (!id) {
          var pathMatch = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
          if (pathMatch) id = pathMatch[1];
        }
      }
      if (id) {
        try { id = decodeURIComponent(id); } catch (_) {}
        return "youtube:" + id;
      }
      var query = [];
      try { parsed.searchParams.forEach(function (value, key) { query.push([key, value]); }); } catch (_) {}
      query.sort(function (a, b) { return a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]); });
      var search = query.map(function (pair) { return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]); }).join("&");
      return "url:" + parsed.origin + parsed.pathname + (search ? "?" + search : "");
    }
    // The extension has URL in the browser, but keep normalization usable in
    // storage migrations and Node/unit-test sandboxes without that global.
    var youtubeMatch = text.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i);
    if (youtubeMatch) {
      var queryMatch = text.match(/[?&]v=([^&#]+)/i);
      var pathMatch = text.match(/\/(?:shorts|embed|live)\/([^/?#]+)/i) || text.match(/^https?:\/\/youtu\.be\/([^/?#]+)/i);
      var fallbackId = queryMatch && queryMatch[1] || pathMatch && pathMatch[1];
      if (fallbackId) {
        try { fallbackId = decodeURIComponent(fallbackId); } catch (_) {}
        return "youtube:" + fallbackId;
      }
    }
    var fallbackUrl = text.replace(/#.*$/, "").match(/^(https?:\/\/)([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?$/i);
    if (fallbackUrl) {
      var fallbackHost = fallbackUrl[2].replace(/^.*@/, "");
      var fallbackPath = fallbackUrl[3] || "/";
      var fallbackQuery = (fallbackUrl[4] || "").split("&").filter(Boolean).sort().join("&");
      return "url:" + fallbackUrl[1].toLowerCase() + fallbackHost.toLowerCase() + fallbackPath + (fallbackQuery ? "?" + fallbackQuery : "");
    }
    return "url:" + text.replace(/#.*$/, "");
  }

  function labelsForVideo(stateOrMap, videoKey) {
    var map = stateOrMap && stateOrMap.manualLabelsByVideo ? stateOrMap.manualLabelsByVideo : stateOrMap;
    if (!map || videoKey == null || !Array.isArray(map[String(videoKey)])) return [];
    return copyRecords(map[String(videoKey)]);
  }

  function stateForVideo(input, videoKey, options) {
    var current = initialExtensionState(input, options);
    var key = videoKey == null ? current.videoKey : String(videoKey);
    // The first active page is the only safe destination for an old global
    // array. Once migrated, subsequent videos only see their own map entry.
    if (key && !current.videoKey) {
      if (current.manualLabels.length && !mapKeys(current.manualLabelsByVideo).length) current.manualLabelsByVideo[key] = copyRecords(current.manualLabels);
      if (Object.keys(current.panelLayouts).length) current.panelLayoutsByVideo[key] = copyPanelLayouts(current.panelLayouts);
      if (Object.keys(current.collapsedPanels).length) current.collapsedPanelsByVideo[key] = copyPanelCollapseState(current.collapsedPanels);
      current.videoKey = key;
    }
    if (!key || current.videoKey === key) {
      current.videoKey = key || current.videoKey;
      if (current.videoKey != null && Object.prototype.hasOwnProperty.call(current.manualLabelsByVideo, String(current.videoKey))) {
        current.manualLabels = labelsForVideo(current, current.videoKey);
      }
      current.lastEdit = copyEdit(current.labelUndoByVideo[current.videoKey]) || current.lastEdit;
      return initialExtensionState(current, options);
    }
    return resetVideoLocalState(current, key, options);
  }

  function initialExtensionState(overrides, options) {
    var raw = overrides || {};
    var value = Object.assign({}, defaults, raw);
    value.panels = Object.assign({}, defaults.panels, copyPanelVisibility(raw.panels));
    value.panelOverrides = copyPanelOverrides(raw.panelOverrides);
    value.panelsByVideo = copyPanelVisibilityMap(raw.panelsByVideo);
    value.panelOverridesByVideo = copyPanelOverridesMap(raw.panelOverridesByVideo);
    value.trackerSettingsByVideo = copyTrackerSettingsMap(raw.trackerSettingsByVideo);
    value.seedPoints = copyPoints(raw.seedPoints);
    value.seedDraftPoints = copyPoints(raw.seedDraftPoints);
    value.seedCardPosition = copyCardPosition(raw.seedCardPosition);
    if (value.seeded && !isCourtCalibration(value.calibration)) {
      value.seeded = false;
      value.calibration = null;
      value.seedPoints = [];
    }
    value.panelLayoutsByVideo = copyPanelLayoutMap(raw.panelLayoutsByVideo);
    value.panelLayouts = copyPanelLayouts(raw.panelLayouts);
    value.collapsedPanelsByVideo = copyPanelCollapseMap(raw.collapsedPanelsByVideo);
    value.collapsedPanels = copyPanelCollapseState(raw.collapsedPanels);
    value.courtLinesByVideo = copyCourtLinesMap(raw.courtLinesByVideo);
    // Migrate a saved court-card position without retaining the old visible
    // grip affordance. New writes use the generic per-panel layout contract.
    if (value.seedCardPosition && !value.panelLayouts.courtSetup) value.panelLayouts.courtSetup = copyPanelLayout(value.seedCardPosition);
    if (raw.videoKey != null) {
      var panelVideoKey = String(raw.videoKey);
      if (Object.keys(value.panelLayouts).length) value.panelLayoutsByVideo[panelVideoKey] = Object.assign({}, value.panelLayoutsByVideo[panelVideoKey] || {}, copyPanelLayouts(value.panelLayouts));
      if (value.panelLayoutsByVideo[panelVideoKey]) value.panelLayouts = copyPanelLayouts(value.panelLayoutsByVideo[panelVideoKey]);
      if (Object.keys(value.collapsedPanels).length) value.collapsedPanelsByVideo[panelVideoKey] = Object.assign({}, value.collapsedPanelsByVideo[panelVideoKey] || {}, copyPanelCollapseState(value.collapsedPanels));
      if (value.collapsedPanelsByVideo[panelVideoKey]) value.collapsedPanels = copyPanelCollapseState(value.collapsedPanelsByVideo[panelVideoKey]);
      // Legacy states stored the active visibility preferences directly. Move
      // those values into the video-local maps once, while new states always
      // read the map entry instead of leaking another video's choices.
      if (!Object.prototype.hasOwnProperty.call(raw, "panelsByVideo") && raw.panels) {
        // Treat the legacy panel shape as a migration, not as a fresh opt-in; keep
        // deliberate SET_PANELS choices through panelOverrides and preserve a
        // deliberately selected Balanced/Full density preset.
        value.panelsByVideo[panelVideoKey] = copyPanelVisibility(panelsForDensity(raw.density || "minimal", raw.panelOverrides));
      }
      if (!Object.prototype.hasOwnProperty.call(raw, "panelOverridesByVideo") && raw.panelOverrides) value.panelOverridesByVideo[panelVideoKey] = copyPanelOverrides(raw.panelOverrides);
      if (!Object.prototype.hasOwnProperty.call(raw, "trackerSettingsByVideo") && raw.trackerSettings) value.trackerSettingsByVideo[panelVideoKey] = copyTrackerSettings(raw.trackerSettings);
      if (value.panelOverridesByVideo[panelVideoKey]) value.panelOverrides = copyPanelOverrides(value.panelOverridesByVideo[panelVideoKey]);
      if (value.panelsByVideo[panelVideoKey]) value.panels = Object.assign({}, defaults.panels, value.panelsByVideo[panelVideoKey]);
      if (value.trackerSettingsByVideo[panelVideoKey]) value.trackerSettings = Object.assign({}, defaults.trackerSettings, value.trackerSettingsByVideo[panelVideoKey]);
      else value.trackerSettings = Object.assign({}, defaults.trackerSettings);
    } else {
      value.trackerSettings = Object.assign({}, defaults.trackerSettings, raw.trackerSettings || {});
    }
    var labelOptions = options || {};
    var mapSource = raw.manualLabelsByVideo || raw.labelsByVideo || (raw.manualLabelStore && raw.manualLabelStore.videos) || {};
    value.manualLabelsByVideo = copyLabelMap(mapSource, labelOptions);
    value.labelUndoByVideo = copyUndoMap(raw.labelUndoByVideo);
    if (raw.videoKey != null && raw.lastEdit && !value.labelUndoByVideo[String(raw.videoKey)]) value.labelUndoByVideo[String(raw.videoKey)] = copyEdit(raw.lastEdit);
    value.manualLabelsVersion = Number(raw.manualLabelsVersion || (raw.manualLabelStore && raw.manualLabelStore.version)) || LABEL_STORE_VERSION;
    var legacy = copyRecords(raw.manualLabels);
    if (legacy.length && raw.videoKey != null) {
      var legacyKey = String(raw.videoKey);
      value.manualLabelsByVideo[legacyKey] = mergeRecords(value.manualLabelsByVideo[legacyKey], legacy, legacyKey, labelOptions);
    } else if (legacy.length && mapKeys(value.manualLabelsByVideo).length) {
      // Keep an old unscoped array intact when a newer per-video store already
      // exists. It is retained for a deliberate future migration, never shown
      // on a known video where it could be mistaken for that video's labels.
      value.manualLabelsByVideo[UNSCOPED_LABEL_KEY] = mergeRecords(value.manualLabelsByVideo[UNSCOPED_LABEL_KEY], legacy, UNSCOPED_LABEL_KEY, labelOptions);
    }
    value.manualLabels = legacy.map(function (record, index) { return normalizeLabel(record, index, raw.videoKey || UNSCOPED_LABEL_KEY, labelOptions); });
    if (raw.videoKey != null && value.manualLabelsByVideo[String(raw.videoKey)]) value.manualLabels = copyRecords(value.manualLabelsByVideo[String(raw.videoKey)]);
    value.lastEdit = copyEdit(raw.lastEdit);
    if (raw.videoKey != null && value.labelUndoByVideo[String(raw.videoKey)]) value.lastEdit = copyEdit(value.labelUndoByVideo[String(raw.videoKey)]);
    return value;
  }

  function resetVideoLocalState(state, videoKey, options) {
    var current = initialExtensionState(state, options);
    var key = videoKey == null ? current.videoKey : String(videoKey);
    var labels = labelsForVideo(current, key);
    var undo = copyEdit(current.labelUndoByVideo[key]);
    return initialExtensionState(Object.assign({}, current, {
      enabled: false,
      seeded: false,
      seeding: false,
      labeling: false,
      stale: false,
      cameraCut: false,
      videoKey: key,
      videoUrl: videoKey == null || key === current.videoKey ? current.videoUrl : null,
      seedPoints: [],
      seedDraftPoints: [],
      seedCardPosition: null,
      calibration: null,
      calibrationError: null,
      // Visibility is video-local too. Start a new video from the minimal
      // evidence-only defaults, then let initialExtensionState apply any
      // preferences explicitly saved for that key.
      panels: defaults.panels,
      panelOverrides: {},
      trackerSettings: defaults.trackerSettings,
      panelLayouts: panelLayoutsForVideo(current, key),
      collapsedPanels: collapsedPanelsForVideo(current, key),
      manualLabels: labels,
      lastEdit: undo
    }), options);
  }

  function without(records, eventId) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
      return record && String(record.eventId) !== String(eventId);
    }).map(clone);
  }

  function upsert(records, record) {
    var next = copyRecords(records);
    var id = record && record.eventId != null ? String(record.eventId) : null;
    var index = id == null ? -1 : next.findIndex(function (item) { return item && String(item.eventId) === id; });
    if (index < 0) next.push(clone(record));
    else next[index] = mergeLabelValues(next[index], clone(record));
    return next;
  }

  function undoLabels(records, edit) {
    if (!edit || edit.eventId == null) return copyRecords(records);
    var result = without(records, edit.eventId);
    if (edit.previousLabel) result = upsert(result, edit.previousLabel);
    return result;
  }

  function courtConfigurationState(input) {
    var current = initialExtensionState(input);
    var calibrated = current.seeded && isCourtCalibration(current.calibration);
    if (current.seeding) return calibrated ? "recalibrating" : "setup";
    return calibrated ? "calibrated" : "uncalibrated";
  }
  function reduceExtensionState(state, action) {
    var current = initialExtensionState(state);
    switch (action && action.type) {
      // Enabling inference is deliberately independent from court setup. The
      // map can be configured later without hiding or delaying raw evidence.
      case "ENABLE": return Object.assign(current, { enabled: true, seeding: false });
      case "DISABLE": return Object.assign(current, { enabled: false, seeding: false, labeling: false, stale: false, cameraCut: false });
      case "OPEN_OVERLAY": return Object.assign(current, { enabled: true, labeling: false });
      case "START_SEED": return Object.assign(current, { enabled: true, seeding: true, labeling: false, seedDraftPoints: [], calibrationError: null });
      case "SET_SEED_DRAFT": return Object.assign(current, { seedDraftPoints: copyPoints(action.points), calibrationError: action.error || null });
      case "SET_SEED_CARD_POSITION": return Object.assign(current, { seedCardPosition: copyCardPosition(action.position) });
      case "SET_PANEL_LAYOUT": {
        if (PANEL_LAYOUT_KEYS.indexOf(action.panel) < 0) return current;
        var layoutKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
        var nextLayouts = layoutKey && current.videoKey !== layoutKey
          ? panelLayoutsForVideo(current, layoutKey)
          : copyPanelLayouts(current.panelLayouts);
        var nextLayout = copyPanelLayout(action.layout);
        if (nextLayout) nextLayouts[action.panel] = nextLayout;
        else delete nextLayouts[action.panel];
        var nextLayoutMap = copyPanelLayoutMap(current.panelLayoutsByVideo);
        if (layoutKey) nextLayoutMap[layoutKey] = copyPanelLayouts(nextLayouts);
        return initialExtensionState(Object.assign({}, current, { videoKey: layoutKey || current.videoKey, seedCardPosition: null, panelLayouts: nextLayouts, panelLayoutsByVideo: nextLayoutMap }));
      }
      case "RESET_PANEL_LAYOUT": return reduceExtensionState(current, { type: "SET_PANEL_LAYOUT", videoKey: action.videoKey, panel: action.panel, layout: null });
      case "LOCK_COURT": return initialExtensionState(Object.assign(current, {
        enabled: true,
        seeded: true,
        seeding: false,
        cameraCut: false,
        stale: false,
        calibration: action.calibration || current.calibration,
        seedPoints: copyPoints(action.seedPoints || current.seedPoints),
        seedDraftPoints: [],
        calibrationError: null
      }));
      case "RESET_COURT": return Object.assign(current, {
        seeded: false,
        seeding: true,
        cameraCut: false,
        stale: false,
        calibration: null,
        seedPoints: [],
        seedDraftPoints: [],
        seedCardPosition: null,
        calibrationError: null
      });
      case "OPEN_LABELING": return Object.assign(current, { labeling: true, seeding: false });
      case "CLOSE_LABELING": return Object.assign(current, { labeling: false });
      case "SET_DENSITY": {
        var density = ["minimal", "balanced", "full"].indexOf(action.value) >= 0 ? action.value : current.density;
        // Density presets decide only the density-driven panels; explicit
        // toggles always win and survive.
        return withPanelPreferences(Object.assign({}, current, { density: density }), Object.assign({}, current.panels, panelsForDensity(density, current.panelOverrides)), current.panelOverrides);
      }
      case "TOGGLE_PANEL": {
        if (PANEL_VISIBILITY_KEYS.indexOf(action.panel) < 0) return current;
        var panelValue = Boolean(action.value);
        return withPanelPreferences(current, Object.assign({}, current.panels, { [action.panel]: panelValue }), Object.assign({}, current.panelOverrides, { [action.panel]: panelValue }));
      }
      case "TOGGLE_PANEL_COLLAPSE": {
        if (PANEL_COLLAPSE_KEYS.indexOf(action.panel) < 0) return current;
        var collapseKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
        var nextCollapsed = collapseKey && current.videoKey !== collapseKey
          ? collapsedPanelsForVideo(current, collapseKey)
          : copyPanelCollapseState(current.collapsedPanels);
        if (action.value === false) delete nextCollapsed[action.panel];
        else nextCollapsed[action.panel] = true;
        var nextCollapseMap = copyPanelCollapseMap(current.collapsedPanelsByVideo);
        if (collapseKey) nextCollapseMap[collapseKey] = copyPanelCollapseState(nextCollapsed);
        return initialExtensionState(Object.assign({}, current, { videoKey: collapseKey || current.videoKey, collapsedPanels: nextCollapsed, collapsedPanelsByVideo: nextCollapseMap }));
      }
      case "SET_COURT_LINES": {
        var linesKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
        var nextLines = copyCourtLinesMap(current.courtLinesByVideo);
        if (action.value === false) nextLines[linesKey] = false;
        else delete nextLines[linesKey];
        return initialExtensionState(Object.assign({}, current, { videoKey: linesKey || current.videoKey, courtLinesByVideo: nextLines }));
      }
      case "SET_PANELS": {
        var nextPanels = Object.assign({}, current.panels);
        var nextOverrides = Object.assign({}, current.panelOverrides);
        Object.keys(action.panels || {}).forEach(function (key) {
          if (PANEL_VISIBILITY_KEYS.indexOf(key) < 0) return;
          nextPanels[key] = Boolean(action.panels[key]);
          nextOverrides[key] = Boolean(action.panels[key]);
        });
        return withPanelPreferences(current, nextPanels, nextOverrides);
      }
      case "SET_TRACKER": return withTrackerPreferences(current, Object.assign({}, current.trackerSettings, { [action.tracker]: Boolean(action.value) }));
      case "CREATE_LABEL":
      case "LABEL_CREATE":
      case "UPDATE_LABEL":
      case "LABEL_UPDATE": {
        var mutationLabel = action.label || action.record;
        if (!mutationLabel || mutationLabel.eventId == null) return current;
        var mutationKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
        var previousMutationLabel = (current.manualLabels || []).find(function (label) { return label && String(label.eventId) === String(mutationLabel.eventId); });
        var mutationEdit = action.lastEdit || {
          eventId: String(mutationLabel.eventId),
          operation: action.type.indexOf("CREATE") >= 0 ? "create" : "update",
          source: mutationLabel.source || "manual",
          time: mutationLabel.time,
          previousLabel: previousMutationLabel ? clone(previousMutationLabel) : null
        };
        return reduceExtensionState(current, { type: "SET_REVIEW_LABELS", videoKey: mutationKey, labels: upsert(current.manualLabels, mutationLabel), lastEdit: mutationEdit });
      }
      case "DELETE_LABEL":
      case "LABEL_DELETE": {
        var deleteKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
        var deleteId = action.eventId != null ? action.eventId : action.label && action.label.eventId;
        if (deleteId == null) return current;
        var priorDelete = (current.manualLabels || []).find(function (label) { return label && String(label.eventId) === String(deleteId); });
        return reduceExtensionState(current, { type: "SET_REVIEW_LABELS", videoKey: deleteKey, labels: without(current.manualLabels, deleteId), lastEdit: action.lastEdit || { eventId: String(deleteId), operation: "delete", source: "manual", time: priorDelete && priorDelete.time, previousLabel: priorDelete ? clone(priorDelete) : null } });
      }
      case "SET_REVIEW_LABELS": {
        var reviewKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
        var reviewLabels = copyRecords(action.labels);
        var reviewMap = copyLabelMap(current.manualLabelsByVideo);
        if (reviewKey) reviewMap[reviewKey] = reviewLabels;
        var reviewUndos = copyUndoMap(current.labelUndoByVideo);
        if (reviewKey && action.lastEdit) reviewUndos[reviewKey] = copyEdit(action.lastEdit);
        else if (reviewKey && action.lastEdit === null) delete reviewUndos[reviewKey];
        return initialExtensionState(Object.assign({}, current, {
          videoKey: reviewKey || current.videoKey,
          manualLabels: reviewLabels,
          manualLabelsByVideo: reviewMap,
          labelUndoByVideo: reviewUndos,
          lastEdit: action.lastEdit === undefined ? current.lastEdit : copyEdit(action.lastEdit),
          manualLabelsVersion: LABEL_STORE_VERSION
        }));
      }
      case "UNDO_LAST_LABEL":
      case "UNDO_LABEL": {
        var undoKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
        var undoEdit = action.edit || current.lastEdit || (undoKey && current.labelUndoByVideo[undoKey]);
        var undoResult = action.labels ? copyRecords(action.labels) : undoLabels(current.manualLabels, undoEdit);
        var undoMap = copyLabelMap(current.manualLabelsByVideo);
        var undoHistory = copyUndoMap(current.labelUndoByVideo);
        if (undoKey) { undoMap[undoKey] = undoResult; delete undoHistory[undoKey]; }
        return initialExtensionState(Object.assign({}, current, { videoKey: undoKey || current.videoKey, manualLabels: undoResult, manualLabelsByVideo: undoMap, labelUndoByVideo: undoHistory, lastEdit: null }));
      }
      case "SET_STALE": return Object.assign(current, { stale: Boolean(action.value) });
      case "CAMERA_CUT": return Object.assign(current, {
        seeded: false,
        stale: true,
        cameraCut: true,
        seeding: true,
        calibration: null,
        seedPoints: [],
        seedDraftPoints: [],
        seedCardPosition: null,
        calibrationError: null
      });
      case "VIDEO_RESET": return resetVideoLocalState(current, action.videoKey);
      default: return current;
    }
  }

  root.BVState = {
    defaults: defaults,
    LABEL_STORE_VERSION: LABEL_STORE_VERSION,
    UNSCOPED_LABEL_KEY: UNSCOPED_LABEL_KEY,
    initialExtensionState: initialExtensionState,
    normalizeLabel: normalizeLabel,
    normalizeLabelStore: function (input, videoKey, options) { return stateForVideo(input, videoKey, options); },
    stateForVideo: stateForVideo,
    labelsForVideo: labelsForVideo,
    PANEL_LAYOUT_KEYS: PANEL_LAYOUT_KEYS.slice(),
    PANEL_COLLAPSE_KEYS: PANEL_COLLAPSE_KEYS.slice(),
    panelLayoutsForVideo: panelLayoutsForVideo,
    collapsedPanelsForVideo: collapsedPanelsForVideo,
    // This is the persisted court lifecycle, separate from inference. During
    // a re-seed the prior configuration remains recoverable by Cancel, but no
    // mapped output should be treated as active until the new fit is locked.
    courtConfigurationState: courtConfigurationState,
    courtLinesForVideo: function (stateOrMap, videoKey) {
      var map = stateOrMap && stateOrMap.courtLinesByVideo ? stateOrMap.courtLinesByVideo : stateOrMap;
      return map && videoKey != null && map[String(videoKey)] === false ? false : true;
    },
    createManualEventId: createManualEventId,
    videoKeyForUrl: videoKeyForUrl,
    resetVideoLocalState: resetVideoLocalState,
    undoLabels: undoLabels,
    reduceExtensionState: reduceExtensionState
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
