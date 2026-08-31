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
    // seedPoints are the committed, normalized outer-corner correspondences.
    seedPoints: [],
    // A draft is deliberately separate so Cancel can preserve a prior court.
    seedDraftPoints: [],
    calibration: null,
    calibrationError: null,
    rally: 14,
    time: "12:04.320",
    density: "minimal",
    panels: { feed: true, stats: false, map: false }
  };

  function copyPoints(points) {
    return Array.isArray(points) ? points.map(function (point) {
      return point && typeof point === "object" ? { x: point.x, y: point.y } : point;
    }) : [];
  }

  function initialExtensionState(overrides) {
    var value = Object.assign({}, defaults, overrides || {});
    value.panels = Object.assign({}, defaults.panels, (overrides && overrides.panels) || {});
    value.seedPoints = copyPoints(overrides && overrides.seedPoints);
    value.seedDraftPoints = copyPoints(overrides && overrides.seedDraftPoints);
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
      calibration: null,
      calibrationError: null
    }));
  }

  function reduceExtensionState(state, action) {
    var current = initialExtensionState(state);
    switch (action && action.type) {
      case "ENABLE": return Object.assign(current, { enabled: true, seeding: !current.seeded });
      case "START_SEED": return Object.assign(current, { enabled: true, seeding: true, labeling: false, seedDraftPoints: [], calibrationError: null });
      case "SET_SEED_DRAFT": return Object.assign(current, { seedDraftPoints: copyPoints(action.points), calibrationError: action.error || null });
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
        calibrationError: null
      });
      case "OPEN_LABELING": return Object.assign(current, { enabled: true, labeling: true, seeding: false });
      case "CLOSE_LABELING": return Object.assign(current, { labeling: false });
      case "SET_DENSITY": return Object.assign(current, { density: action.value });
      case "TOGGLE_PANEL": return Object.assign(current, { panels: Object.assign({}, current.panels, { [action.panel]: Boolean(action.value) }) });
      case "SET_STALE": return Object.assign(current, { stale: Boolean(action.value) });
      case "CAMERA_CUT": return Object.assign(current, {
        seeded: false,
        stale: true,
        cameraCut: true,
        seeding: true,
        calibration: null,
        seedPoints: [],
        seedDraftPoints: [],
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
