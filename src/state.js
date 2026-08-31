/* UI state is serialisable so storage and runtime messages share one contract. */
(function (root) {
  var defaults = {
    enabled: false,
    seeded: false,
    seeding: false,
    labeling: false,
    stale: false,
    cameraCut: false,
    videoKey: null,
    // Manual and accepted fixture events are video-local and survive popup /
    // summary navigation without pretending to be production inference.
    manualLabels: [],
    lastEdit: null,
    trackerSettings: {},
    // seedPoints are the committed, normalized outer-corner correspondences.
    seedPoints: [],
    // A draft is deliberately separate so Cancel can preserve a prior court.
    seedDraftPoints: [],
    // The instruction card is video-local UI state, stored as normalized
    // top-left coordinates so resize/fullscreen can clamp it safely.
    seedCardPosition: null,
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

  function copyRecords(records) {
    return Array.isArray(records) ? records.map(function (record) {
      if (!record || typeof record !== "object") return record;
      var copy = Object.assign({}, record);
      if (record.axes && typeof record.axes === "object") copy.axes = Object.assign({}, record.axes);
      return copy;
    }) : [];
  }

  function copyEdit(edit) {
    if (!edit || typeof edit !== "object") return null;
    var copy = Object.assign({}, edit);
    ["previousLabel", "previousStroke", "previousSuggestion"].forEach(function (key) {
      if (edit[key] && typeof edit[key] === "object") copy[key] = Object.assign({}, edit[key]);
    });
    return copy;
  }

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
      map: density !== "minimal"
    };
    Object.keys(overrides || {}).forEach(function (key) {
      panels[key] = Boolean(overrides[key]);
    });
    return panels;
  }

  function initialExtensionState(overrides) {
    var value = Object.assign({}, defaults, overrides || {});
    value.panels = Object.assign({}, defaults.panels, (overrides && overrides.panels) || {});
    value.panelOverrides = copyPanelOverrides(overrides && overrides.panelOverrides);
    value.seedPoints = copyPoints(overrides && overrides.seedPoints);
    value.seedDraftPoints = copyPoints(overrides && overrides.seedDraftPoints);
    value.seedCardPosition = copyCardPosition(overrides && overrides.seedCardPosition);
    value.manualLabels = copyRecords(overrides && overrides.manualLabels);
    value.lastEdit = copyEdit(overrides && overrides.lastEdit);
    value.trackerSettings = Object.assign({}, defaults.trackerSettings, (overrides && overrides.trackerSettings) || {});
    return value;
  }

  // YouTube's video id is stable across theater/fullscreen and query ordering,
  // while a non-watch URL is still a useful navigation-local key in tests.
  function videoKeyForUrl(url) {
    var text = String(url || "");
    var match = text.match(/[?&]v=([^&#]+)/);
    if (match && match[1]) {
      try { return "youtube:" + decodeURIComponent(match[1]); } catch (_) { return "youtube:" + match[1]; }
    }
    return text.replace(/#.*$/, "");
  }

  function resetVideoLocalState(state, videoKey) {
    var current = initialExtensionState(state);
    return initialExtensionState(Object.assign({}, current, {
      enabled: false,
      seeded: false,
      seeding: false,
      labeling: false,
      stale: false,
      cameraCut: false,
      videoKey: videoKey == null ? current.videoKey : videoKey,
      seedPoints: [],
      seedDraftPoints: [],
      seedCardPosition: null,
      calibration: null,
      calibrationError: null,
      manualLabels: [],
      lastEdit: null
    }));
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
      case "OPEN_LABELING": return Object.assign(current, { enabled: true, labeling: true, seeding: false });
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
      case "SET_REVIEW_LABELS": return Object.assign(current, { manualLabels: copyRecords(action.labels), lastEdit: action.lastEdit ? copyEdit(action.lastEdit) : current.lastEdit });
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
    initialExtensionState: initialExtensionState,
    videoKeyForUrl: videoKeyForUrl,
    resetVideoLocalState: resetVideoLocalState,
    reduceExtensionState: reduceExtensionState
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
