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
    trackerSettings: { court: true, players: true, body: true, shuttle: true, racket: true },
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
    panels: { feed: true, stats: false, map: false },
    // Explicit panel choices override density presets while the preference
    // still gives Balanced/Full a useful default presentation.
    panelOverrides: {}
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

  function copyCardPosition(position) {
    if (!position || typeof position !== "object") return null;
    var x = Number(position.x);
    var y = Number(position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  var PANEL_LAYOUT_KEYS = ["courtSetup", "stats", "map", "feed", "manual", "controls", "evidence"];

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

  function copyRecords(records) {
    return Array.isArray(records) ? records.map(clone) : [];
  }

  function copyEdit(edit) { return edit && typeof edit === "object" ? clone(edit) : null; }

  function copyPanelOverrides(overrides) {
    var result = {};
    if (!overrides || typeof overrides !== "object") return result;
    ["feed", "stats", "map"].forEach(function (key) {
      if (overrides[key] != null) result[key] = Boolean(overrides[key]);
    });
    return result;
  }

  function panelsForDensity(density, overrides) {
    var panels = {
      feed: true,
      stats: density !== "minimal",
      map: density === "full"
    };
    Object.keys(overrides || {}).forEach(function (key) {
      panels[key] = Boolean(overrides[key]);
    });
    return panels;
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
    value.panels = Object.assign({}, defaults.panels, raw.panels || {});
    value.panelOverrides = copyPanelOverrides(raw.panelOverrides);
    value.seedPoints = copyPoints(raw.seedPoints);
    value.seedDraftPoints = copyPoints(raw.seedDraftPoints);
    value.seedCardPosition = copyCardPosition(raw.seedCardPosition);
    value.panelLayoutsByVideo = copyPanelLayoutMap(raw.panelLayoutsByVideo);
    value.panelLayouts = copyPanelLayouts(raw.panelLayouts);
    // Migrate a saved court-card position without retaining the old visible
    // grip affordance. New writes use the generic per-panel layout contract.
    if (value.seedCardPosition && !value.panelLayouts.courtSetup) value.panelLayouts.courtSetup = copyPanelLayout(value.seedCardPosition);
    if (raw.videoKey != null) {
      var panelVideoKey = String(raw.videoKey);
      if (Object.keys(value.panelLayouts).length) value.panelLayoutsByVideo[panelVideoKey] = Object.assign({}, value.panelLayoutsByVideo[panelVideoKey] || {}, copyPanelLayouts(value.panelLayouts));
      if (value.panelLayoutsByVideo[panelVideoKey]) value.panelLayouts = copyPanelLayouts(value.panelLayoutsByVideo[panelVideoKey]);
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
    value.trackerSettings = Object.assign({}, defaults.trackerSettings, raw.trackerSettings || {});
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
      panelLayouts: panelLayoutsForVideo(current, key),
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

  function reduceExtensionState(state, action) {
    var current = initialExtensionState(state);
    switch (action && action.type) {
      case "ENABLE": return Object.assign(current, { enabled: true, seeding: !current.seeded });
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
      case "LOCK_COURT": return Object.assign(current, {
        enabled: true,
        seeded: true,
        seeding: false,
        cameraCut: false,
        stale: false,
        calibration: action.calibration || current.calibration,
        seedPoints: copyPoints(action.seedPoints || current.seedPoints),
        seedDraftPoints: [],
        calibrationError: null
      });
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
        return Object.assign(current, { density: density, panels: panelsForDensity(density, current.panelOverrides) });
      }
      case "TOGGLE_PANEL": {
        var panelValue = Boolean(action.value);
        return Object.assign(current, {
          panels: Object.assign({}, current.panels, { [action.panel]: panelValue }),
          panelOverrides: Object.assign({}, current.panelOverrides, { [action.panel]: panelValue })
        });
      }
      case "SET_PANELS": {
        var nextPanels = Object.assign({}, current.panels);
        var nextOverrides = Object.assign({}, current.panelOverrides);
        Object.keys(action.panels || {}).forEach(function (key) {
          if (["feed", "stats", "map"].indexOf(key) < 0) return;
          nextPanels[key] = Boolean(action.panels[key]);
          nextOverrides[key] = Boolean(action.panels[key]);
        });
        return Object.assign(current, { panels: nextPanels, panelOverrides: nextOverrides });
      }
      case "SET_TRACKER": return Object.assign(current, { trackerSettings: Object.assign({}, current.trackerSettings, { [action.tracker]: Boolean(action.value) }) });
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
    panelLayoutsForVideo: panelLayoutsForVideo,
    createManualEventId: createManualEventId,
    videoKeyForUrl: videoKeyForUrl,
    resetVideoLocalState: resetVideoLocalState,
    undoLabels: undoLabels,
    reduceExtensionState: reduceExtensionState
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
