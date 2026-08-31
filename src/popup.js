(function () {
  var ui = window.BVUI;
  var root = document.getElementById("app");
  var state = window.BVState.initialExtensionState();
  var expanded = false;
  var detected = false;
  var trackers = [
    { id: "court", label: "Court", health: "degraded", note: "not seeded", on: true },
    { id: "players", label: "Players", health: "ok", note: "2 tracked", on: true },
    { id: "body", label: "Body pose", health: "ok", note: "17 keypoints", on: true },
    { id: "shuttle", label: "Shuttle", health: "degraded", note: "low light", on: true },
    { id: "score", label: "Score OCR", health: "degraded", note: "partial", on: true },
    { id: "racket", label: "Racket", health: "unavailable", note: "not in MVP", on: false, disabled: true }
  ];

  function chromeAvailable() { return typeof chrome !== "undefined"; }
  function persist() {
    if (!chromeAvailable() || !chrome.storage || !chrome.storage.local) return;
    var write = chrome.storage.local.set({ bvState: state });
    if (write && typeof write.catch === "function") write.catch(function () {});
  }
  function sendToTab(message) {
    if (!chromeAvailable() || !chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || tab.id == null) return;
      chrome.tabs.sendMessage(tab.id, message, function () { void chrome.runtime.lastError; });
    });
  }
  function dispatch(action, message) {
    state = window.BVState.reduceExtensionState(state, action);
    if (action.type === "START_SEED") state.seeding = true;
    if (action.type === "OPEN_LABELING") state.labeling = true;
    persist();
    sendToTab(message || { type: "STATE_UPDATE", state: state });
    render();
  }
  function openSummary() {
    if (chromeAvailable() && chrome.tabs && chrome.runtime) chrome.tabs.create({ url: chrome.runtime.getURL("summary.html") });
    else window.open("summary.html", "_blank");
  }
  function closePopup() { if (window.close) window.close(); }
  function isWatchPage(url) { return /^https?:\/\/(www\.)?youtube\.com\/watch(?:\?|$)/.test(url || ""); }

  function section(title, content, aside) {
    return ui.el("section", { className: "bv-section" }, [ui.el("div", { className: "bv-section-title" }, [title, aside ? ui.el("span", { className: "bv-section-aside" }, [aside]) : null]), content]);
  }
  function trackerRow(tracker) {
    var dotClass = tracker.disabled ? "off" : tracker.health === "degraded" ? "warn" : tracker.on ? "" : "off";
    var colorHealth = tracker.health === "degraded" ? "warn" : "";
    var switchButton = ui.el("button", { className: "bv-mini-switch", type: "button", role: "switch", "aria-checked": tracker.on, disabled: tracker.disabled, "aria-label": "Toggle " + tracker.label, onClick: function () { tracker.on = !tracker.on; render(); } }, [ui.el("i")]);
    return ui.el("div", { className: "bv-tracker-row" + (tracker.disabled ? " unavailable" : "") }, [ui.el("i", { className: "bv-tracker-dot " + dotClass }), ui.el("span", { className: "bv-tracker-label" }, [tracker.label]), ui.el("span", { className: "bv-tracker-meta" }, [ui.el("span", { className: "bv-tracker-note " + colorHealth }, [tracker.on ? tracker.note : "off"]), switchButton])]);
  }
  function panelToggle(label, description, key, disabled) {
    return ui.toggle(label, description, state.panels[key], function (next) { dispatch({ type: "TOGGLE_PANEL", panel: key, value: next }, { type: "SET_PANELS", panels: Object.assign({}, state.panels, { [key]: next }) }); }, { disabled: disabled, id: "panel-" + key });
  }

  function render() {
    var fixture = window.BVFixtures;
    var trackerCount = trackers.filter(function (t) { return t.on; }).length;
    var degraded = trackers.some(function (t) { return t.on && t.health === "degraded"; });
    trackers[0].note = state.seeded ? "seeded" : "not seeded";
    trackers[0].health = state.seeded ? "ok" : "degraded";
    var header = ui.el("header", { className: "bv-popup-header" }, [ui.el("span", { className: "bv-logo" }, [ui.el("img", { src: "design-system/assets/logo-mark.svg", alt: "" }), ui.el("strong", { className: "bv-logo-name" }, ["Badminton Vision"])]), ui.el("span", { className: "bv-popup-head-actions" }, [ui.iconButton("settings", "Settings", { size: "sm", disabled: true }), ui.iconButton("x", "Close", { size: "sm", onClick: closePopup })])]);
    var statusState = state.enabled ? (state.stale ? "stale" : "live") : "ready";
    var statusLabel = state.seeding ? "Court setup in progress" : state.enabled ? (state.stale ? "Analysis behind" : "Rally " + state.rally) : detected ? "Badminton match found" : "No YouTube match";
    var statusDetail = state.enabled ? (state.stale ? "+1.2s" : state.time) : null;
    var intro = ui.el("div", { className: "bv-popup-intro" }, [ui.statusChip(statusState, statusLabel, statusDetail), ui.el("div", { className: "bv-detected" }, [ui.el("span", { className: "bv-detected-icon" }, [ui.icon(detected ? "check" : "info", 15)]), ui.el("span", { className: "bv-detected-copy" }, [ui.el("strong", {}, [detected ? fixture.video.title : "Open a YouTube match"]), ui.el("span", {}, [detected ? fixture.video.channel + " · " + fixture.video.duration : "Badminton Vision runs on youtube.com/watch pages only."])])]), !state.enabled && detected ? ui.callout("guide", "Three steps to get going", "Turn the overlay on, click the four court corners once, then keep watching — the video is never paused or moved.") : null, state.cameraCut ? ui.callout("warn", "Camera cut", "The court projection is stale. Re-seed the court; analysis stays paused while the video keeps playing.") : null]);

    var barNodes = trackers.map(function (t) { return ui.el("i", { className: t.on ? (t.health === "degraded" ? "warn" : "") : "off" }); });
    var trackerHeader = ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" } }, ["What's being tracked", ui.el("span", { className: "bv-tracker-bars" }, barNodes)]);
    var trackerAside = ui.el("button", { className: "bv-link-button", type: "button", onClick: function () { expanded = !expanded; render(); } }, [trackerCount + " of " + trackers.length + " on", ui.icon(expanded ? "chevron-up" : "chevron-down", 12)]);
    var trackerBody = expanded ? ui.el("div", { className: "bv-tracker-list" }, trackers.map(trackerRow).concat([ui.el("p", { className: "bv-helper" }, ["Fixture output stays editable. If a tracker is off, dependent values stay blank rather than being guessed."])])) : ui.el("div", { className: "bv-tracker-summary" }, [ui.badge(degraded ? "some parts unsure" : "all working", degraded ? "warn" : "in"), ui.el("small", {}, ["local UI · inference runtime unavailable · nothing uploaded"]) ]);
    var trackerSection = section(trackerHeader, trackerBody, trackerAside);

    var densitySection = section(ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" } }, ["How much to show", ui.infoTip("How much to show", "Changes only what appears on the video. Everything is still analysed either way.")]), ui.segmented([{ value: "minimal", label: "Minimal" }, { value: "balanced", label: "Balanced" }, { value: "full", label: "Full" }], state.density, function (value) { dispatch({ type: "SET_DENSITY", value: value }, { type: "SET_DENSITY", value: value }); }, true));
    var panelSection = section("Panels on the video", ui.el("div", { className: "bv-panel-toggles" }, [panelToggle("Shots this rally", "Every stroke as it happens", "feed"), panelToggle("Rally stats", null, "stats"), panelToggle("Court map", "Where players and the shuttle are", "map"), ui.toggle("Compare with the pros", "Coming later — needs a licensed benchmark", false, null, { disabled: true, id: "panel-pro" })]));

    var primaryLabel = state.enabled ? "Back to the match" : "Turn on — step 1 of 3";
    var primary = ui.button(primaryLabel, { variant: "primary", full: true, icon: state.enabled ? "layout" : "play", disabled: !detected, onClick: function () { if (state.enabled) { closePopup(); return; } dispatch({ type: "ENABLE" }, { type: "ENABLE" }); closePopup(); } });
    var actions = ui.el("div", { className: "bv-footer-actions" }, [primary, ui.el("div", { className: "bv-footer-row" }, [ui.button(state.seeded ? "Set up court again" : "Set up court", { icon: "crosshair", onClick: function () { dispatch({ type: "START_SEED" }, { type: "START_SEED" }); closePopup(); } }), ui.button("Label it myself", { icon: "pencil", onClick: function () { dispatch({ type: "OPEN_LABELING" }, { type: "OPEN_LABELING" }); closePopup(); } })]), ui.button("See match summary · download data", { variant: "ghost", icon: "table", onClick: function () { openSummary(); closePopup(); } })]);
    root.replaceChildren(header, intro, trackerSection, densitySection, panelSection, actions);
  }

  function load() {
    if (!chromeAvailable() || !chrome.tabs) { detected = true; render(); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      detected = isWatchPage(tabs && tabs[0] && tabs[0].url);
      if (chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState"], function (result) {
        if (result && result.bvState) state = window.BVState.initialExtensionState(result.bvState);
        render();
      }); else render();
    });
  }
  render();
  load();
})();
