/*
 * YouTube sibling overlay. It reads the active video and anchors to its client
 * rectangle; it never calls a playback mutator or writes to the video element.
 */
(function () {
  var ui = window.BVUI;
  var data = window.BVFixtures;
  var state = window.BVState.initialExtensionState();
  var strokes = data.strokes.slice();
  var suggestion = data.suggestion ? Object.assign({}, data.suggestion) : null;
  var draft = { shot: null, start: "12:03.980", end: "12:04.420", axes: {} };
  data.axes.forEach(function (axis) { draft.axes[axis.label] = axis.value; });
  var seedPoints = [];
  var host = null;
  var shadow = null;
  var root = null;
  var video = null;
  var playback = null;
  var domObserver = null;
  var mediaTime = 0;

  function hasChrome() { return typeof chrome !== "undefined"; }
  function persist() {
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.set({ bvState: state }, function () { void chrome.runtime.lastError; });
  }
  function send(message) {
    if (hasChrome() && chrome.runtime) chrome.runtime.sendMessage(message, function () { void chrome.runtime.lastError; });
  }
  function formatMediaTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var remaining = seconds - minutes * 60;
    return String(minutes).padStart(2, "0") + ":" + remaining.toFixed(3).padStart(6, "0");
  }
  function updateState(next) { state = window.BVState.initialExtensionState(next); persist(); render(); }

  function positionToVideo() {
    if (!host || !video || typeof video.getBoundingClientRect !== "function") return;
    var rect = video.getBoundingClientRect();
    var visible = rect.width > 0 && rect.height > 0;
    host.style.display = visible ? "block" : "none";
    if (!visible) return;
    host.style.left = rect.left + "px";
    host.style.top = rect.top + "px";
    host.style.width = rect.width + "px";
    host.style.height = rect.height + "px";
  }
  function attachVideo() {
    var next = document.querySelector("video");
    if (next === video) { positionToVideo(); return; }
    if (playback) playback.stop();
    if (video && next && next !== video) {
      state = window.BVState.initialExtensionState({ density: state.density, panels: state.panels });
      strokes = data.strokes.slice();
      suggestion = data.suggestion ? Object.assign({}, data.suggestion) : null;
      seedPoints = [];
      persist();
    }
    video = next;
    if (video && window.BVRuntime) playback = window.BVRuntime.createPlaybackAdapter(video, function (frame) {
      mediaTime = frame.mediaTime;
      if (!state.stale && Math.abs(mediaTime) > .001) state.time = formatMediaTime(mediaTime);
    });
    if (playback) playback.start();
    positionToVideo();
  }

  function seedDrawing(points, done) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bv-seed-drawing"); svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
    function add(tag, attrs) { var node = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); }); svg.appendChild(node); }
    if (points.length > 1) add("polyline", { points: points.map(function (point) { return point.x + "," + point.y; }).join(" ") + (done ? " " + points[0].x + "," + points[0].y : ""), fill: done ? "rgba(200,240,74,.1)" : "none", stroke: "var(--lime-500)", "stroke-width": ".25", "vector-effect": "non-scaling-stroke" });
    if (done) {
      [0.07, 0.35, 0.5, 0.65, 0.93].forEach(function (t) { var left = { x: points[0].x + (points[3].x - points[0].x) * t, y: points[0].y + (points[3].y - points[0].y) * t }; var right = { x: points[1].x + (points[2].x - points[1].x) * t, y: points[1].y + (points[2].y - points[1].y) * t }; add("line", { x1: left.x, y1: left.y, x2: right.x, y2: right.y, stroke: "rgba(233,245,240,.7)", "stroke-width": t === .5 ? ".3" : ".15", "vector-effect": "non-scaling-stroke" }); });
      [0.075, 0.5, 0.925].forEach(function (t) { var a = { x: points[0].x + (points[1].x - points[0].x) * t, y: points[0].y + (points[1].y - points[0].y) * t }; var b = { x: points[3].x + (points[2].x - points[3].x) * t, y: points[3].y + (points[2].y - points[3].y) * t }; add("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "rgba(233,245,240,.7)", "stroke-width": ".15", "vector-effect": "non-scaling-stroke" }); });
    }
    return svg;
  }
  function seedFlow() {
    var corners = ["Near left", "Near right", "Far right", "Far left"];
    var targets = [{ x: 22, y: 82 }, { x: 78, y: 82 }, { x: 63, y: 33 }, { x: 37, y: 33 }];
    var done = seedPoints.length === 4;
    var layer = ui.el("div", { className: "bv-seed-layer", role: "dialog", "aria-label": "Set up court" });
    layer.appendChild(seedDrawing(seedPoints, done));
    if (!done) layer.appendChild(ui.el("span", { className: "bv-seed-target", style: { left: targets[seedPoints.length].x + "%", top: targets[seedPoints.length].y + "%" } }));
    seedPoints.forEach(function (point, index) { layer.appendChild(ui.el("span", { className: "bv-seed-point", style: { left: point.x + "%", top: point.y + "%" } }, [index + 1])); });
    var card = ui.el("div", { className: "bv-seed-card" });
    var top = ui.el("div", { className: "bv-seed-card-top" }, [ui.stepDots(seedPoints.length, corners), ui.el("span", { className: "bv-seed-card-title" }, [done ? "Court locked" : "Click the " + corners[seedPoints.length].toLowerCase() + " outer corner"]), done ? ui.badge("homography ok", "in") : null, ui.el("span", { className: "bv-seed-card-actions" }, [ui.button("Undo", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0, onClick: function (event) { event.stopPropagation(); seedPoints.pop(); render(); } }), ui.button("Skip to manual", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); state.seeding = false; state.labeling = true; persist(); render(); } }), ui.button("Lock court", { variant: "primary", size: "sm", disabled: !done, onClick: function (event) { event.stopPropagation(); if (!done) return; state.seeded = true; state.enabled = true; state.seeding = false; state.cameraCut = false; persist(); send({ type: "COURT_SEEDED" }); render(); } })])]);
    card.appendChild(top);
    card.appendChild(ui.el("p", {}, ["Your four clicks are the outer doubles corners only. Service lines, centre lines and the net come from the official 13.40 × 6.10 m court and are projected in — they never adapt to the image."]));
    card.appendChild(ui.el("div", { className: "bv-seed-note" }, [ui.icon("info", 13), ui.el("span", {}, ["Playback keeps running. A camera cut past tolerance pauses analysis, not the video."]), ui.button("Cancel", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); state.seeding = false; state.enabled = Boolean(state.seeded); persist(); render(); } })]));
    layer.appendChild(card);
    layer.addEventListener("click", function (event) { if (event.target !== layer || done) return; var rect = layer.getBoundingClientRect(); seedPoints.push({ x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 }); render(); });
    return layer;
  }

  function statsPanel() {
    return ui.panel("Stats", { icon: "activity", mediaTime: state.time, stale: state.stale, className: "bv-overlay-feed", actions: [ui.iconButton("chevron-up", "Hide stats", { size: "sm", onClick: function () { state.panels.stats = false; persist(); render(); } })] }, [ui.el("div", { className: "bv-stat-grid" }, [ui.stat("Rally", state.rally), ui.stat("Shots", strokes.length), ui.stat("Length", "28.4", "s")]), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", margin: "var(--sp-5) 0" } }, [ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-12)", color: "var(--text-muted)" } }, ["21–18 · 14–11"]), ui.badge("score OCR partial", "warn")]), ui.mixBar([{ label: "Clear", value: 5, color: "var(--player-a)" }, { label: "Drop", value: 4, color: "var(--court-fill)" }, { label: "Smash", value: 3, color: "var(--lime-500)" }, { label: "Net", value: 3, color: "var(--player-b)" }, { label: "Unclassified", value: 2, color: "var(--signal-unknown)" }]), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-5)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-hairline)" } }, [ui.el("span", { className: "bv-muted", style: { fontSize: "var(--fs-11)" } }, ["Last rally end"]), ui.badge("unclassified", "unknown"), ui.confidence(null, { showWord: true })])]);
  }
  function mapPanel() {
    return ui.panel("Court", { icon: "crosshair", mediaTime: state.time, className: "bv-court-panel", bodyStyle: { padding: "10px" }, actions: [ui.iconButton("chevron-down", "Hide court map", { size: "sm", onClick: function () { state.panels.map = false; persist(); render(); } })] }, [ui.courtDiagram({ renderWidth: 154, players: [{ x: 3.1, y: 9.7 }, { x: 2.5, y: 4.1, side: "b" }], trajectory: [{ x: 2.5, y: 4.3 }, { x: 3.5, y: 8.4 }, { x: 4.8, y: 12.9 }], landing: { x: 4.8, y: 12.9 }, call: "IN", ariaLabel: "Current court map" }), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-4)" } }, [ui.badge("IN", "in"), ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-10)", color: "var(--text-faint)" } }, ["0.11 m inside"])]), ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.confidence(.52, { label: "geo", showWord: true })])]);
  }
  function feedPanel() {
    var rows = ui.el("div", { className: "bv-feed" });
    strokes.forEach(function (stroke) { rows.appendChild(ui.strokeFeedItem(stroke)); });
    var children = [rows];
    if (suggestion) children.push(ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.suggestionRow(suggestion, acceptSuggestion, openLabeling)]));
    var footer = ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.badge("rally 13 · index 74", "accent", false), ui.button("Older rallies", { variant: "ghost", size: "sm", iconRight: "chevron-right", style: { marginLeft: "auto" }, onClick: openSummary })]);
    return ui.panel("Stroke feed", { icon: "list", mediaTime: state.time, stale: state.stale, className: "bv-overlay-feed", bodyStyle: { padding: "6px" }, footer: footer, actions: [ui.iconButton("pencil", "Open manual labeling (O)", { size: "sm", onClick: openLabeling }), ui.iconButton("chevron-up", "Hide stroke feed", { size: "sm", onClick: function () { state.panels.feed = false; persist(); render(); } })] }, children);
  }
  function liveOverlay() {
    var overlay = ui.el("div", { className: "bv-overlay-root" });
    var left = ui.el("div", { className: "bv-overlay-stack left" }, [ui.statusChip(state.stale ? "stale" : "live", state.stale ? "Analysis behind" : "Rally " + state.rally, state.stale ? "+1.2s" : state.time, openLabeling)]);
    if (state.density !== "minimal" && state.panels.stats) left.appendChild(statsPanel());
    overlay.appendChild(left);
    if (state.density === "full" && state.panels.map) overlay.appendChild(ui.el("div", { className: "bv-overlay-map" }, [mapPanel()]));
    if (state.panels.feed) overlay.appendChild(ui.el("div", { className: "bv-overlay-stack right" }, [feedPanel()]));
    var actions = ui.el("div", { className: "bv-overlay-actions" }, [ui.button("Density: " + state.density, { size: "sm", icon: "sliders", onClick: cycleDensity }), ui.button("Summary", { size: "sm", icon: "table", onClick: openSummary })]);
    overlay.appendChild(actions);
    return overlay;
  }

  function openLabeling() { state.labeling = true; state.enabled = true; state.seeding = false; persist(); render(); }
  function acceptSuggestion() {
    if (!suggestion) return;
    strokes.push({ eventId: suggestion.eventId, rallyId: suggestion.rallyId, sequence: strokes.length + 1, player: "A", shot: suggestion.shot, time: suggestion.time, status: "accepted", source: "auto", confidence: suggestion.confidence });
    send({ type: "ACCEPT_SUGGESTION", eventId: suggestion.eventId });
    suggestion = null; render();
  }
  function cycleDensity() {
    var values = ["minimal", "balanced", "full"]; state.density = values[(values.indexOf(state.density) + 1) % values.length]; persist(); send({ type: "SET_DENSITY", value: state.density }); render();
  }
  function openSummary() {
    send({ type: "OPEN_SUMMARY" });
  }
  function exportCsv() {
    var rows = strokes.map(function (stroke, index) { return { video_url: data.video.url, shot_id: stroke.eventId, start_sec: 721 + index * .7, end_sec: 721 + index * .7 + .4, label: stroke.shot || "unclassified", longitudinal_position: draft.axes.Longitudinal || "", lateral_position: draft.axes.Lateral || "", timing: draft.axes.Timing || "", intention: draft.axes.Intention || "", impact: draft.axes.Impact || "", direction: draft.axes.Direction || "" }; });
    var link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([window.BVAnalysis.toShotsCsv(rows)], { type: "text/csv" })); link.download = "badminton-vision-shots.csv"; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
  }
  function manualPanel() {
    var saveLabel = draft.shot || (suggestion && suggestion.shot);
    var panel = ui.panel("Manual labeling", { icon: "pencil", mediaTime: state.time, className: "bv-label-panel", bodyStyle: { flex: "1" }, actions: [ui.kbd("Esc"), ui.iconButton("x", "Close manual labeling", { size: "sm", onClick: closeLabeling })], footer: ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.button("Export CSV", { variant: "ghost", size: "sm", icon: "download", onClick: exportCsv }), ui.el("span", { style: { marginLeft: "auto", display: "flex", gap: "var(--sp-3)" } }, [ui.button("Cancel", { variant: "ghost", size: "sm", onClick: closeLabeling }), ui.button("Save shot", { variant: "primary", size: "sm", disabled: !saveLabel, onClick: function () { saveManual(saveLabel); } })])]) }, []);
    panel.tabIndex = 0;
    var body = panel.querySelector(".bv-panel-body");
    body.appendChild(ui.el("div", { className: "bv-segment-window" }, [ui.el("span", { className: "bv-mono" }, [draft.start + " → " + draft.end]), ui.el("span", { className: "bv-segment-controls" }, [ui.button("Start", { variant: "ghost", size: "sm", iconRight: null, onClick: function () { draft.start = formatMediaTime(mediaTime); render(); } }), ui.button("End", { variant: "ghost", size: "sm", onClick: function () { draft.end = formatMediaTime(mediaTime); render(); } })]) ]));
    if (suggestion) body.appendChild(ui.el("div", { className: "bv-manual-suggestion" }, [ui.badge("auto suggestion", "warn"), ui.el("span", { className: "bv-feed-shot" + (draft.shot ? " replaced" : "") }, [suggestion.shot]), ui.confidence(suggestion.confidence, { showWord: true }), ui.el("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", font: "var(--type-ui-sm)", color: "var(--text-faint)" } }, ["accept", ui.kbd("↵", true)])]));
    body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Shot family"]));
    body.appendChild(ui.shotPicker(draft.shot, suggestion && suggestion.shot, function (shot) { draft.shot = shot; render(); }));
    body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Dimensions"]));
    var axisList = ui.el("div", { className: "bv-axis-list" });
    data.axes.forEach(function (axis) { axisList.appendChild(ui.dimensionAxis(axis.label, axis.options, draft.axes[axis.label], function (value) { draft.axes[axis.label] = value; render(); })); });
    body.appendChild(axisList);
    body.appendChild(ui.el("p", { className: "bv-helper" }, ["Manual labels are first-class records. Saving updates the same event id and appends provenance — it never creates a duplicate."]));
    panel.addEventListener("keydown", function (event) {
      if (event.target !== panel) return;
      var key = event.key.toLowerCase();
      if (key >= "1" && key <= "9") { draft.shot = ["Serve", "Clear", "Drop", "Smash", "Half Smash", "Lift", "Net Shot", "Net Kill", "Push"][Number(key) - 1]; event.preventDefault(); render(); }
      else if (key === "s") { draft.start = formatMediaTime(mediaTime); event.preventDefault(); render(); }
      else if (key === "e") { draft.end = formatMediaTime(mediaTime); event.preventDefault(); render(); }
      else if (key === "o") { event.preventDefault(); }
      else if (event.key === "Escape") { event.preventDefault(); closeLabeling(); }
      else if (event.key === "Enter" && saveLabel) { event.preventDefault(); saveManual(saveLabel); }
    });
    setTimeout(function () { panel.focus(); }, 0);
    return panel;
  }
  function saveManual(shot) {
    if (!shot) return;
    var eventId = suggestion ? suggestion.eventId : "r" + state.rally + "-s" + String(strokes.length + 1).padStart(2, "0");
    strokes = strokes.filter(function (stroke) { return stroke.eventId !== eventId; });
    strokes.push({ eventId: eventId, rallyId: state.rally, sequence: strokes.length + 1, player: "A", shot: shot, time: draft.start, status: suggestion ? "corrected" : "accepted", source: "manual", confidence: null });
    send({ type: "LABEL_EVENT", eventId: eventId, shot: shot, provenance: "manual" });
    suggestion = null; closeLabeling();
  }
  function closeLabeling() { state.labeling = false; persist(); render(); }

  function render() {
    if (!root) return;
    root.replaceChildren();
    if (!state.enabled && !state.seeding) return;
    if (state.seeding) root.appendChild(seedFlow());
    else root.appendChild(liveOverlay());
    if (state.labeling && !state.seeding) root.appendChild(ui.el("div", { className: "bv-overlay-label" }, [manualPanel()]));
  }
  function handleMessage(message) {
    if (!message) return;
    if (message.type === "START_SEED") { state.enabled = true; state.seeding = true; state.labeling = false; seedPoints = []; persist(); render(); }
    else if (message.type === "ENABLE") { state.enabled = true; state.seeding = !state.seeded; persist(); render(); }
    else if (message.type === "OPEN_LABELING") openLabeling();
    else if (message.type === "SET_DENSITY") { state.density = message.value; persist(); render(); }
    else if (message.type === "SET_PANELS") { state.panels = Object.assign({}, state.panels, message.panels); persist(); render(); }
    else if (message.type === "STATE_UPDATE" && message.state) { state = window.BVState.initialExtensionState(message.state); render(); }
    else if (message.type === "CAMERA_CUT") { state.cameraCut = true; state.stale = true; state.seeding = true; seedPoints = []; persist(); render(); }
  }
  function init() {
    host = document.createElement("div"); host.className = "bv-overlay-anchor"; host.setAttribute("data-badminton-vision", "overlay");
    host.style.position = "fixed"; host.style.zIndex = "2147483640"; host.style.pointerEvents = "none";
    shadow = host.attachShadow({ mode: "open" });
    var link = document.createElement("link"); link.rel = "stylesheet"; link.href = hasChrome() && chrome.runtime ? chrome.runtime.getURL("styles.css") : "styles.css"; shadow.appendChild(link);
    root = document.createElement("div"); root.className = "bv-overlay-root"; shadow.appendChild(root); document.documentElement.appendChild(host);
    window.addEventListener("resize", positionToVideo, { passive: true }); window.addEventListener("scroll", positionToVideo, { passive: true, capture: true });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(positionToVideo).observe(document.documentElement);
    domObserver = new MutationObserver(attachVideo); domObserver.observe(document.documentElement, { childList: true, subtree: true }); attachVideo();
    if (hasChrome() && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(handleMessage);
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState"], function (result) { if (result && result.bvState) state = window.BVState.initialExtensionState(result.bvState); render(); });
    else render();
  }
  init();
})();
