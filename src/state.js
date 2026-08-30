/* UI state is serialisable so storage and runtime messages share one contract. */
(function (root) {
  var defaults = {
    enabled: false,
    seeded: false,
    seeding: false,
    labeling: false,
    stale: false,
    cameraCut: false,
    rally: 14,
    time: "12:04.320",
    density: "minimal",
    panels: { feed: true, stats: false, map: false }
  };

  function initialExtensionState(overrides) {
    var value = Object.assign({}, defaults, overrides || {});
    value.panels = Object.assign({}, defaults.panels, (overrides && overrides.panels) || {});
    return value;
  }

  function reduceExtensionState(state, action) {
    var current = initialExtensionState(state);
    switch (action && action.type) {
      case "ENABLE": return Object.assign(current, { enabled: true, seeding: !current.seeded });
      case "START_SEED": return Object.assign(current, { enabled: true, seeding: true, labeling: false });
      case "LOCK_COURT": return Object.assign(current, { enabled: true, seeded: true, seeding: false, cameraCut: false, stale: false });
      case "OPEN_LABELING": return Object.assign(current, { enabled: true, labeling: true, seeding: false });
      case "CLOSE_LABELING": return Object.assign(current, { labeling: false });
      case "SET_DENSITY": return Object.assign(current, { density: action.value });
      case "TOGGLE_PANEL": return Object.assign(current, { panels: Object.assign({}, current.panels, { [action.panel]: Boolean(action.value) }) });
      case "SET_STALE": return Object.assign(current, { stale: Boolean(action.value) });
      case "CAMERA_CUT": return Object.assign(current, { stale: true, cameraCut: true, seeding: false });
      default: return current;
    }
  }

  root.BVState = { defaults: defaults, initialExtensionState: initialExtensionState, reduceExtensionState: reduceExtensionState };
})(typeof globalThis !== "undefined" ? globalThis : window);
