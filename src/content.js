/*
 * YouTube sibling overlay. It reads the active video and anchors to its client
 * rectangle; it never calls a playback mutator or writes to the video element.
 */
(function () {
  var ui = window.BVUI;
  var data = window.BVFixtures;
  var calibrationApi = window.BVCalibration;
  var state = window.BVState.initialExtensionState();
  var strokes = data.strokes.slice();
  var suggestion = data.suggestion ? Object.assign({}, data.suggestion) : null;
  var draft = { shot: null, start: "12:03.980", end: "12:04.420", axes: {} };
  data.axes.forEach(function (axis) { draft.axes[axis.label] = axis.value; });
  // Draft points are normalized to the current video rectangle. The fitted
  // result is also normalized, so a resize/theater/fullscreen only requires
  // the existing anchor to move; no refit or player mutation is needed.
  var seedPoints = [];
  var calibration = null;
  var activeVideoKey = null;
  var host = null;
  var shadow = null;
  var root = null;
  var video = null;
  var domObserver = null;
  var navigationListeners = [];
  var mediaTime = 0;
  var runtimeController = null;
  var runtimeView = {
    phase: "idle", message: "Local runtime starting", reason: "", analyzer: "none",
    inference: false, fallbacks: [], capabilities: {}, result: null,
    currentMediaTime: null, ageSeconds: null, stale: true
  };
  var publishedRuntimeKey = null;
  var lastRuntimeRenderAt = 0;

  function hasChrome() { return typeof chrome !== "undefined"; }
  function persist() {
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.set({ bvState: state }, function () { void chrome.runtime.lastError; });
  }
  function send(message) {
    if (hasChrome() && chrome.runtime) chrome.runtime.sendMessage(message, function () { void chrome.runtime.lastError; });
  }
  function courtDiagnosticState() {
    if (state.seeding) return "seeding";
    if (state.seeded && calibration) return "seeded";
    return "not-seeded";
  }
  function updateDiagnosticsMarkers() {
    if (!host) return;
    var result = runtimeView.result;
    var fallbacks = Array.isArray(runtimeView.fallbacks) ? runtimeView.fallbacks : [];
    var fallbackReasons = runtimeView.phase === "fallback"
      ? fallbacks.concat(runtimeView.reason || [])
      : [];
    host.setAttribute("data-bso-enabled", String(Boolean(state.enabled)));
    host.setAttribute("data-bso-court-state", courtDiagnosticState());
    host.setAttribute("data-bso-seed-count", String(state.seeding ? seedPoints.length : (state.seedPoints || []).length));
    host.setAttribute("data-bso-runtime-phase", runtimeView.phase || "unknown");
    host.setAttribute("data-bso-runtime-analyzer", runtimeView.analyzer || "none");
    host.setAttribute("data-bso-inference", String(Boolean(runtimeView.inference)));
    host.setAttribute("data-bso-analysis-state", result && result.state ? result.state : "unknown");
    host.setAttribute("data-bso-player-state", result && result.tracking && result.tracking.state || "unknown");
    host.setAttribute("data-bso-shuttle-state", result && result.shuttle && result.shuttle.state || "unknown");
    host.setAttribute("data-bso-frame-transport", runtimeView.capabilities && runtimeView.capabilities.frameTransport || "unknown");
    host.setAttribute("data-bso-fallback", fallbackReasons.filter(Boolean).join(",") || "none");
  }
  function publishRuntimeView(view) {
    runtimeView = view;
    updateDiagnosticsMarkers();
    var result = view.result;
    var playerCount = result && Array.isArray(result.players) ? result.players.length : null;
    var status = {
      phase: view.phase,
      message: view.message,
      reason: view.reason,
      analyzer: view.analyzer,
      inference: Boolean(view.inference),
      frameTransport: view.capabilities && view.capabilities.frameTransport || "unknown",
      fallbacks: Array.isArray(view.fallbacks) ? view.fallbacks.slice() : [],
      capabilities: view.capabilities || {},
      stale: Boolean(view.stale),
      ageSeconds: Number.isFinite(view.ageSeconds) ? view.ageSeconds : null,
      resultKind: result && result.kind ? result.kind : null,
      resultState: result && result.state ? result.state : "unknown",
      playerCount: playerCount,
      sessionId: runtimeController && runtimeController.sessionId ? runtimeController.sessionId : null
    };
    var key = JSON.stringify([status.phase, status.analyzer, status.inference, status.reason, status.frameTransport, status.stale, status.resultKind, status.playerCount]);
    var now = Date.now();
    var statusChanged = key !== publishedRuntimeKey;
    if (hasChrome() && chrome.storage && chrome.storage.local && statusChanged) {
      publishedRuntimeKey = key;
      chrome.storage.local.set({ bvRuntimeStatus: status }, function () { void chrome.runtime.lastError; });
    }
    // Synchronization is driven by every observed video frame, but the
    // design-system DOM only needs a modest refresh cadence for age/time labels.
    if (statusChanged || now - lastRuntimeRenderAt >= 250) {
      lastRuntimeRenderAt = now;
      render();
    }
  }
  function runtimeIsStale() { return Boolean(state.stale || runtimeView.stale); }
  function runtimeCaption() {
    if (runtimeView.result && runtimeView.result.kind === "runtime-integration-probe") return "fixture result observed · not production CV";
    if (runtimeView.analyzer === "fixture-probe-v1") return "local integration probe · not production CV";
    if (runtimeView.phase === "fallback") return "local analysis unavailable · playback unaffected";
    return "local runtime · awaiting analyzer";
  }
  function formatMediaTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var remaining = seconds - minutes * 60;
    return String(minutes).padStart(2, "0") + ":" + remaining.toFixed(3).padStart(6, "0");
  }
  function updateState(next) { state = window.BVState.initialExtensionState(next); persist(); render(); }
  function currentVideoKey() {
    return window.BVState.videoKeyForUrl(window.location && window.location.href);
  }
  function resetVideoLocalState(reason) {
    activeVideoKey = currentVideoKey();
    state = window.BVState.resetVideoLocalState(state, activeVideoKey);
    calibration = null;
    seedPoints = [];
    strokes = data.strokes.slice();
    suggestion = data.suggestion ? Object.assign({}, data.suggestion) : null;
    persist();
    render();
  }
  function restoreCalibrationState() {
    calibration = null;
    if (state.calibration && calibrationApi && calibrationApi.restoreCalibration) {
      try {
        calibration = calibrationApi.restoreCalibration(state.calibration);
      } catch (error) {
        // Corrupt storage must not become a silently accepted court.
        state = window.BVState.initialExtensionState(Object.assign({}, state, {
          seeded: false,
          calibration: null,
          seedPoints: [],
          calibrationError: calibrationApi.errorMessage(error)
        }));
      }
    }
    seedPoints = state.seeding ? state.seedDraftPoints.slice() : [];
    if (state.seeding) {
      // A re-seed draft must never accidentally reuse the previously
      // committed projection, especially after a reload with four bad clicks.
      calibration = null;
      if (seedPoints.length === 4) fitSeedPoints();
    }
  }
  function bindVideoState() {
    var key = currentVideoKey();
    if (activeVideoKey !== null && key !== activeVideoKey) resetVideoLocalState("navigation");
    else if (state.videoKey && key && state.videoKey !== key) resetVideoLocalState("video-replacement");
    else {
      activeVideoKey = key;
      if (!state.videoKey) state.videoKey = key;
      restoreCalibrationState();
    }
  }

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
    if (video && next !== video) resetVideoLocalState("video-replacement");
    video = next;
    bindVideoState();
    positionToVideo();
  }

  function startRuntime() {
    if (runtimeController || !window.BVRuntime || !window.BVRuntime.startIntegratedRuntime) return;
    var session = window.BVRuntime.startIntegratedRuntime({
      documentRef: document,
      windowRef: window,
      chromeApi: window.chrome,
      onChange: publishRuntimeView,
      onMediaTime: function (currentMediaTime) {
        if (Number.isFinite(currentMediaTime)) {
          mediaTime = currentMediaTime;
          if (!state.stale && Math.abs(mediaTime) > .001) state.time = formatMediaTime(mediaTime);
        }
      }
    });
    if (session) runtimeController = session.controller;
  }

  function fitSeedPoints() {
    if (seedPoints.length !== 4 || !calibrationApi) return false;
    var result = calibrationApi.tryFitCourtCalibration(seedPoints);
    if (result.ok) {
      calibration = result.calibration;
      state.calibrationError = null;
      return true;
    }
    calibration = null;
    state.calibrationError = calibrationApi.errorMessage(result.error);
    return false;
  }
  function seedPointStyle(point) { return { left: (point.x * 100) + "%", top: (point.y * 100) + "%" }; }
  function seedDrawing(points, fittedCalibration) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bv-seed-drawing"); svg.setAttribute("viewBox", "0 0 1 1"); svg.setAttribute("preserveAspectRatio", "none");
    function add(tag, attrs) { var node = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); }); svg.appendChild(node); }
    if (points.length > 1) add("polyline", { points: points.map(function (item) { return item.x + "," + item.y; }).join(" ") + (points.length === 4 ? " " + points[0].x + "," + points[0].y : ""), fill: "none", stroke: "var(--lime-500)", "stroke-width": ".25", "vector-effect": "non-scaling-stroke" });
    if (fittedCalibration && Array.isArray(fittedCalibration.lines)) {
      fittedCalibration.lines.forEach(function (line) {
        var attrs = {
          x1: line.start.x, y1: line.start.y, x2: line.end.x, y2: line.end.y,
          stroke: line.role === "net" ? "var(--court-net)" : "var(--court-line)",
          "stroke-width": line.role === "net" ? ".3" : line.boundary ? ".25" : ".15",
          "vector-effect": "non-scaling-stroke",
          "data-court-line-id": line.id,
          "data-court-line-role": line.role,
          "data-line-ownership": line.line_ownership
        };
        add("line", attrs);
      });
    }
    return svg;
  }
  function calibrationDrawing() {
    var drawing = seedDrawing([], calibration);
    drawing.setAttribute("class", "bv-calibration-court");
    return drawing;
  }
  function undoSeedPoint() {
    seedPoints.pop();
    calibration = null;
    state.seedDraftPoints = seedPoints.map(function (point) { return { x: point.x, y: point.y }; });
    state.calibrationError = null;
    persist();
    render();
  }
  function resetSeed() {
    state = window.BVState.reduceExtensionState(state, { type: "RESET_COURT" });
    seedPoints = [];
    calibration = null;
    persist();
    render();
  }
  function cancelSeeding() {
    state.seedDraftPoints = [];
    state.calibrationError = null;
    state.seeding = false;
    // Re-show the previously committed calibration if this was a re-seed.
    restoreCalibrationState();
    state.enabled = Boolean(state.seeded);
    persist();
    render();
  }
  function lockSeed() {
    if (!calibration && !fitSeedPoints()) return render();
    state = window.BVState.reduceExtensionState(state, { type: "LOCK_COURT", calibration: calibration, seedPoints: seedPoints });
    state.videoKey = activeVideoKey || currentVideoKey();
    persist();
    send({ type: "COURT_SEEDED", calibration: calibration });
    render();
  }
  function seedFlow() {
    var corners = ["Near left", "Near right", "Far right", "Far left"];
    var targets = [{ x: 22, y: 82 }, { x: 78, y: 82 }, { x: 63, y: 33 }, { x: 37, y: 33 }];
    var fitted = seedPoints.length === 4 && calibration;
    var invalid = seedPoints.length === 4 && !fitted;
    var layer = ui.el("div", {
      className: "bv-seed-layer",
      role: "dialog",
      "aria-label": "Set up court",
      "data-bso-court-seeding": "true",
      "data-bso-seed-count": seedPoints.length,
      "data-bso-seed-order": corners.slice(0, seedPoints.length).join("|")
    });
    layer.appendChild(seedDrawing(seedPoints, fitted));
    if (seedPoints.length < 4) layer.appendChild(ui.el("span", { className: "bv-seed-target", style: { left: targets[seedPoints.length].x + "%", top: targets[seedPoints.length].y + "%" } }));
    seedPoints.forEach(function (point, index) { layer.appendChild(ui.el("span", { className: "bv-seed-point", style: seedPointStyle(point) }, [index + 1])); });
    var card = ui.el("div", { className: "bv-seed-card" });
    var title = fitted ? "Court ready to lock" : invalid ? "Court needs correction" : "Click the " + corners[seedPoints.length].toLowerCase() + " outer corner";
    var top = ui.el("div", { className: "bv-seed-card-top" }, [ui.stepDots(Math.min(seedPoints.length, 4), corners), ui.el("span", { className: "bv-seed-card-title" }, [title]), fitted ? ui.badge("homography ok", "in") : invalid ? ui.badge("not accepted", "warn") : null, ui.el("span", { className: "bv-seed-card-actions" }, [ui.button("Undo", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0, onClick: function (event) { event.stopPropagation(); undoSeedPoint(); } }), ui.button("Reset", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0 && !state.seeded, onClick: function (event) { event.stopPropagation(); resetSeed(); } }), ui.button("Skip to manual", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); state.seeding = false; state.labeling = true; persist(); render(); } }), ui.button("Lock court", { variant: "primary", size: "sm", disabled: !fitted, onClick: function (event) { event.stopPropagation(); lockSeed(); } })])]);
    card.appendChild(top);
    if (state.calibrationError) card.appendChild(ui.callout("warn", "Calibration not accepted", state.calibrationError));
    card.appendChild(ui.el("p", {}, ["Your four clicks are the outer doubles corners only. Service lines, centre lines and the net come from the official 13.40 × 6.10 m court and are projected in — they never adapt to the image."]));
    card.appendChild(ui.el("div", { className: "bv-seed-note" }, [ui.icon("info", 13), ui.el("span", {}, ["Playback keeps running. A camera cut past tolerance pauses analysis, not the video."]), ui.button("Cancel", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); cancelSeeding(); } })]));
    layer.appendChild(card);
    layer.addEventListener("click", function (event) {
      if (event.target !== layer || seedPoints.length >= 4) return;
      var rect = layer.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        state.calibrationError = "The video has no measurable size. Keep playback running and try again.";
        persist(); render(); return;
      }
      var next = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || next.x < 0 || next.x > 1 || next.y < 0 || next.y > 1) {
        state.calibrationError = "That click was outside the video. Click the visible outer court corner.";
        persist(); render(); return;
      }
      seedPoints.push(next);
      state.seedDraftPoints = seedPoints.map(function (point) { return { x: point.x, y: point.y }; });
      state.calibrationError = null;
      if (seedPoints.length === 4) fitSeedPoints();
      persist();
      render();
    });
    return layer;
  }

  function statsPanel() {
    return ui.panel("Stats", { icon: "activity", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", actions: [ui.iconButton("chevron-up", "Hide stats", { size: "sm", onClick: function () { state.panels.stats = false; persist(); render(); } })] }, [ui.el("div", { className: "bv-stat-grid" }, [ui.stat("Rally", state.rally), ui.stat("Shots", strokes.length), ui.stat("Length", "28.4", "s")]), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", margin: "var(--sp-5) 0" } }, [ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-12)", color: "var(--text-muted)" } }, ["21–18 · 14–11"]), ui.badge("score OCR partial", "warn")]), ui.mixBar([{ label: "Clear", value: 5, color: "var(--player-a)" }, { label: "Drop", value: 4, color: "var(--court-fill)" }, { label: "Smash", value: 3, color: "var(--lime-500)" }, { label: "Net", value: 3, color: "var(--player-b)" }, { label: "Unclassified", value: 2, color: "var(--signal-unknown)" }]), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-5)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-hairline)" } }, [ui.el("span", { className: "bv-muted", style: { fontSize: "var(--fs-11)" } }, ["Last rally end"]), ui.badge("unclassified", "unknown"), ui.confidence(null, { showWord: true })])]);
  }
  function mapPanel() {
    return ui.panel("Court", { icon: "crosshair", mediaTime: state.time, className: "bv-court-panel", bodyStyle: { padding: "10px" }, actions: [ui.iconButton("chevron-down", "Hide court map", { size: "sm", onClick: function () { state.panels.map = false; persist(); render(); } })] }, [ui.courtDiagram({ renderWidth: 154, players: [{ x: 3.1, y: 9.7 }, { x: 2.5, y: 4.1, side: "b" }], trajectory: [{ x: 2.5, y: 4.3 }, { x: 3.5, y: 8.4 }, { x: 4.8, y: 12.9 }], landing: { x: 4.8, y: 12.9 }, call: "IN", ariaLabel: "Current court map" }), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-4)" } }, [ui.badge("IN", "in"), ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-10)", color: "var(--text-faint)" } }, ["0.11 m inside"])]), ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.confidence(.52, { label: "geo", showWord: true })])]);
  }
  function feedPanel() {
    var rows = ui.el("div", { className: "bv-feed" });
    strokes.forEach(function (stroke) { rows.appendChild(ui.strokeFeedItem(stroke)); });
    var children = [rows];
    if (suggestion) children.push(ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.suggestionRow(suggestion, acceptSuggestion, openLabeling)]));
    var footer = ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.badge("rally 13 · index 74", "accent", false), ui.el("span", { className: "bv-runtime-footnote" }, [runtimeView.result && runtimeView.result.kind === "runtime-integration-probe" ? "fixture result · not production CV" : "analysis unknown"]), ui.button("Older rallies", { variant: "ghost", size: "sm", iconRight: "chevron-right", style: { marginLeft: "auto" }, onClick: openSummary })]);
    return ui.panel("Stroke feed", { icon: "list", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", bodyStyle: { padding: "6px" }, footer: footer, actions: [ui.iconButton("pencil", "Open manual labeling (O)", { size: "sm", onClick: openLabeling }), ui.iconButton("chevron-up", "Hide stroke feed", { size: "sm", onClick: function () { state.panels.feed = false; persist(); render(); } })] }, children);
  }
  function liveOverlay() {
    var overlay = ui.el("div", {
      className: "bv-overlay-root",
      "data-bso-overlay-state": runtimeView.phase === "fallback" ? "fallback" : runtimeIsStale() ? "stale" : "live",
      "data-bso-runtime-phase": runtimeView.phase || "unknown",
      "data-bso-analysis-state": runtimeView.result && runtimeView.result.state || "unknown",
      "data-bso-player-state": runtimeView.result && runtimeView.result.tracking && runtimeView.result.tracking.state || "unknown",
      "data-bso-shuttle-state": runtimeView.result && runtimeView.result.shuttle && runtimeView.result.shuttle.state || "unknown",
      "data-bso-court-state": courtDiagnosticState()
    });
    if (calibration) overlay.appendChild(calibrationDrawing());
    var stale = runtimeIsStale();
    var statusState = runtimeView.phase === "fallback" ? "stale" : stale ? "stale" : "live";
    var statusLabel = runtimeView.phase === "fallback" ? "Analysis fallback" : stale ? "Analysis behind" : "Rally " + state.rally;
    var statusDetail = stale && Number.isFinite(runtimeView.ageSeconds)
      ? "+" + runtimeView.ageSeconds.toFixed(1) + "s"
      : state.time;
    var left = ui.el("div", { className: "bv-overlay-stack left" }, [
      ui.statusChip(statusState, statusLabel, statusDetail, openLabeling),
      ui.el("div", { className: "bv-runtime-note", role: "status" }, [ui.icon("info", 11), runtimeCaption()])
    ]);
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
    updateDiagnosticsMarkers();
    root.replaceChildren();
    if (!state.enabled && !state.seeding) return;
    if (state.seeding) root.appendChild(seedFlow());
    else root.appendChild(liveOverlay());
    if (state.labeling && !state.seeding) root.appendChild(ui.el("div", { className: "bv-overlay-label" }, [manualPanel()]));
  }
  function applyStoredState(nextState) {
    state = window.BVState.initialExtensionState(nextState);
    var key = currentVideoKey();
    if (state.videoKey && key && state.videoKey !== key) {
      state = window.BVState.resetVideoLocalState(state, key);
    } else {
      state.videoKey = state.videoKey || key;
    }
    if (state.seeded && !state.calibration) {
      state = window.BVState.resetVideoLocalState(state, key);
      state.calibrationError = "This saved court has no fitted calibration. Please seed the four outer corners again.";
    }
    activeVideoKey = key;
    restoreCalibrationState();
    persist();
  }
  function handleNavigation() {
    // Navigation is a hard video-local boundary even if YouTube reuses the
    // same HTMLVideoElement for its next watch page.
    resetVideoLocalState("navigation");
  }
  function handleMessage(message) {
    if (!message) return;
    if (message.type === "START_SEED") {
      state = window.BVState.reduceExtensionState(state, { type: "START_SEED" });
      state.videoKey = activeVideoKey || currentVideoKey();
      seedPoints = [];
      calibration = null;
      persist(); render();
    }
    else if (message.type === "ENABLE") {
      bindVideoState();
      state = window.BVState.reduceExtensionState(state, { type: "ENABLE" });
      state.videoKey = activeVideoKey || currentVideoKey();
      seedPoints = state.seeding ? state.seedDraftPoints.slice() : [];
      if (state.seeded && state.calibration && !calibration) restoreCalibrationState();
      persist(); render();
    }
    else if (message.type === "OPEN_LABELING") openLabeling();
    else if (message.type === "SET_DENSITY") { state.density = message.value; persist(); render(); }
    else if (message.type === "SET_PANELS") { state.panels = Object.assign({}, state.panels, message.panels); persist(); render(); }
    else if (message.type === "STATE_UPDATE" && message.state) { applyStoredState(message.state); render(); }
    else if (message.type === "CAMERA_CUT") {
      state = window.BVState.reduceExtensionState(state, { type: "CAMERA_CUT" });
      state.videoKey = activeVideoKey || currentVideoKey();
      calibration = null;
      seedPoints = [];
      persist(); render();
    }
  }
  function init() {
    host = document.createElement("div"); host.className = "bv-overlay-anchor"; host.setAttribute("data-badminton-vision", "overlay");
    host.style.position = "fixed"; host.style.zIndex = "2147483640"; host.style.pointerEvents = "none";
    shadow = host.attachShadow({ mode: "open" });
    var link = document.createElement("link"); link.rel = "stylesheet"; link.href = hasChrome() && chrome.runtime ? chrome.runtime.getURL("styles.css") : "styles.css"; shadow.appendChild(link);
    root = document.createElement("div"); root.className = "bv-overlay-root"; shadow.appendChild(root); document.documentElement.appendChild(host);
    window.addEventListener("resize", positionToVideo, { passive: true }); window.addEventListener("scroll", positionToVideo, { passive: true, capture: true });
    ["yt-navigate-start", "yt-navigate-finish", "popstate", "hashchange"].forEach(function (name) {
      var listener = handleNavigation;
      window.addEventListener(name, listener);
      navigationListeners.push([name, listener]);
    });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(positionToVideo).observe(document.documentElement);
    domObserver = new MutationObserver(attachVideo); domObserver.observe(document.documentElement, { childList: true, subtree: true }); attachVideo();
    startRuntime();
    if (hasChrome() && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(handleMessage);
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState"], function (result) { applyStoredState(result && result.bvState ? result.bvState : state); render(); });
    else { applyStoredState(state); render(); }
  }
  init();
})();
