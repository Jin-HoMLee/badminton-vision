/*
 * YouTube sibling overlay. It reads the active video and anchors to its client
 * rectangle; it never calls a playback mutator or writes to the video element.
 */
(function () {
  var ui = window.BVUI;
  var data = window.BVFixtures;
  var calibrationApi = window.BVCalibration;
  var seedCardApi = window.BVSeedCard;
  var state = window.BVState.initialExtensionState();
  var strokes = data.strokes.slice();
  var suggestion = data.suggestion ? Object.assign({}, data.suggestion) : null;
  var mediaTime = 0;
  var editingEventId = null;
  var draft = newDraft();

  function currentMediaTimestamp() {
    return Number.isFinite(mediaTime) && mediaTime >= 0 ? mediaTime : null;
  }
  function newDraft(record) {
    var start = record && record.startSec != null ? record.startSec : currentMediaTimestamp();
    var end = record && record.endSec != null ? record.endSec : null;
    var next = {
      shot: record && (record.shot || record.label) || null,
      start: start == null ? "" : formatMediaTime(start),
      end: end == null ? "" : formatMediaTime(end),
      playerId: record && (record.playerId != null ? record.playerId : record.player) || null,
      axes: {}
    };
    var dimensionFields = {
      Longitudinal: "longitudinal_position",
      Lateral: "lateral_position",
      Timing: "timing",
      Intention: "intention",
      Impact: "impact",
      Direction: "direction"
    };
    data.axes.forEach(function (axis) {
      var axes = record && record.axes && typeof record.axes === "object" ? record.axes : {};
      var field = dimensionFields[axis.label];
      next.axes[axis.label] = axes[axis.label] != null ? axes[axis.label] : axes[field] != null ? axes[field] : record && record[axis.label] != null ? record[axis.label] : record && field && record[field] != null ? record[field] : null;
    });
    return next;
  }
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
  var mediaTimeListener = null;
  var runtimeController = null;
  var runtimeView = {
    phase: "idle", message: "Local runtime starting", reason: "", analyzer: "none",
    inference: false, fallbacks: [], capabilities: {}, result: null,
    currentMediaTime: null, ageSeconds: null, stale: true
  };
  var publishedRuntimeKey = null;
  var lastRuntimeRenderAt = 0;
  var seedCardDrag = null;

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
  function reviewStrokes() {
    var merged = window.BVReview ? window.BVReview.mergeStrokes(data.strokes, state.manualLabels) : data.strokes.slice();
    return merged.map(function (stroke) {
      var isFixture = data.strokes.some(function (fixture) { return String(fixture.eventId) === String(stroke.eventId); });
      var hasSavedReview = labelForEvent(stroke.eventId);
      return isFixture && !hasSavedReview ? Object.assign({}, stroke, { fixtureRow: true }) : stroke;
    });
  }
  function restoreReviewState() {
    strokes = reviewStrokes();
    if (suggestion && strokes.some(function (stroke) { return String(stroke.eventId) === String(suggestion.eventId); })) suggestion = null;
  }
  function resetVideoLocalState(reason) {
    activeVideoKey = currentVideoKey();
    state = window.BVState.resetVideoLocalState(state, activeVideoKey);
    calibration = null;
    seedPoints = [];
    seedCardDrag = null;
    editingEventId = null;
    strokes = reviewStrokes();
    suggestion = data.suggestion ? Object.assign({}, data.suggestion) : null;
    draft = newDraft();
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
      state = window.BVState.stateForVideo(state, key);
      restoreReviewState();
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
    refreshSeedCardPosition();
  }
  function attachVideo() {
    var next = document.querySelector("video");
    if (next === video) { positionToVideo(); return; }
    if (video && next !== video) {
      if (mediaTimeListener) video.removeEventListener("timeupdate", mediaTimeListener);
      mediaTimeListener = null;
      resetVideoLocalState("video-replacement");
    }
    video = next;
    bindVideoState();
    if (video) {
      mediaTime = Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0;
      if (!state.stale) state.time = formatMediaTime(mediaTime);
      mediaTimeListener = function () {
        var nextTime = Number(video.currentTime);
        if (Number.isFinite(nextTime) && nextTime >= 0) {
          mediaTime = nextTime;
          if (!state.stale) state.time = formatMediaTime(nextTime);
          if (state.labeling) render();
        }
      };
      video.addEventListener("timeupdate", mediaTimeListener);
    }
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
  function seedClickAllowed(event, layer) {
    return seedCardApi
      ? seedCardApi.canSeedFromClick(event.target, layer, seedPoints.length, event.defaultPrevented)
      : !event.defaultPrevented && event.target === layer && seedPoints.length < 4;
  }
  function seedCardMetrics(layer, card) {
    var layerRect = layer && typeof layer.getBoundingClientRect === "function" ? layer.getBoundingClientRect() : { width: 0, height: 0 };
    var cardRect = card && typeof card.getBoundingClientRect === "function" ? card.getBoundingClientRect() : { width: 0, height: 0 };
    return {
      viewport: { width: Math.max(0, layerRect.width || 0), height: Math.max(0, layerRect.height || 0) },
      card: { width: Math.max(0, cardRect.width || 0), height: Math.max(0, cardRect.height || 0) }
    };
  }
  function seedCardPositionFromLayout(layer, card) {
    var metrics = seedCardMetrics(layer, card);
    var layerRect = layer.getBoundingClientRect();
    var cardRect = card.getBoundingClientRect();
    return {
      x: metrics.viewport.width ? (cardRect.left - layerRect.left) / metrics.viewport.width : 0,
      y: metrics.viewport.height ? (cardRect.top - layerRect.top) / metrics.viewport.height : 0
    };
  }
  function applySeedCardPosition(layer, card, position) {
    if (!seedCardApi) return seedCardPositionFromLayout(layer, card);
    var metrics = seedCardMetrics(layer, card);
    var result = seedCardApi.pixelSeedCardPosition(position, metrics.viewport, metrics.card);
    card.style.left = result.left + "px";
    card.style.top = result.top + "px";
    card.style.right = "auto";
    card.style.bottom = "auto";
    card.style.transform = "none";
    card.setAttribute("data-bso-seed-card-position", position ? "custom" : "default");
    card.setAttribute("data-bso-seed-card-bounds", "clamped");
    return result.position;
  }
  function refreshSeedCardPosition() {
    if (!root || !state.seeding) return;
    var layer = root.querySelector && root.querySelector("[data-bso-court-seeding]");
    var card = layer && layer.querySelector("[data-bso-seed-card]");
    if (layer && card) applySeedCardPosition(layer, card, state.seedCardPosition);
  }
  function storeSeedCardPosition(position) {
    state = window.BVState.reduceExtensionState(state, { type: "SET_SEED_CARD_POSITION", position: position });
    persist();
  }
  function resetSeedCardPosition() {
    storeSeedCardPosition(null);
    render();
    setTimeout(function () {
      var handle = root && root.querySelector && root.querySelector("[data-bso-seed-card-handle]");
      if (handle && typeof handle.focus === "function") handle.focus();
    }, 0);
  }
  function installSeedCardMovement(layer, card, handle) {
    function stop(event) { event.stopPropagation(); }
    function currentPosition() { return state.seedCardPosition || seedCardPositionFromLayout(layer, card); }
    function move(event) {
      if (!seedCardDrag || event.pointerId !== seedCardDrag.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      var metrics = seedCardMetrics(layer, card);
      var position = seedCardApi
        ? seedCardApi.moveSeedCardPosition(seedCardDrag.position, { x: event.clientX - seedCardDrag.clientX, y: event.clientY - seedCardDrag.clientY }, metrics.viewport, metrics.card)
        : currentPosition();
      applySeedCardPosition(layer, card, position);
      seedCardDrag.position = position;
    }
    function finish(event) {
      if (!seedCardDrag || event.pointerId !== seedCardDrag.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      var position = seedCardDrag.position;
      if (handle.releasePointerCapture && handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      seedCardDrag = null;
      storeSeedCardPosition(position);
      card.setAttribute("data-bso-seed-card-position", "custom");
    }
    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      seedCardDrag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, position: currentPosition() };
      if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
      handle.setAttribute("aria-grabbed", "true");
      card.classList.add("is-dragging");
    });
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", function (event) {
      handle.setAttribute("aria-grabbed", "false");
      card.classList.remove("is-dragging");
      finish(event);
    });
    handle.addEventListener("pointercancel", function (event) {
      handle.setAttribute("aria-grabbed", "false");
      card.classList.remove("is-dragging");
      finish(event);
    });
    handle.addEventListener("keydown", function (event) {
      var key = event.key;
      if (key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        resetSeedCardPosition();
        return;
      }
      if (!seedCardApi || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(key) === -1) return;
      event.preventDefault();
      event.stopPropagation();
      var metrics = seedCardMetrics(layer, card);
      var position = seedCardApi.nudgeSeedCardPosition(currentPosition(), key, metrics.viewport, metrics.card);
      storeSeedCardPosition(position);
      applySeedCardPosition(layer, card, position);
      handle.setAttribute("aria-grabbed", "false");
    });
    // The card is above the seed layer. The layer's click handler also
    // requires the layer itself as the target, so card gestures cannot seed.
    card.addEventListener("pointerdown", stop);
    card.addEventListener("pointermove", stop);
    card.addEventListener("pointerup", stop);
    card.addEventListener("click", stop);
  }
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
    seedCardDrag = null;
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
      "data-bso-seed-order": corners.slice(0, seedPoints.length).join("|"),
      "data-bso-seed-click-policy": "layer-only",
      "data-bso-seed-lockable": String(Boolean(fitted))
    });
    layer.appendChild(seedDrawing(seedPoints, fitted));
    if (seedPoints.length < 4) layer.appendChild(ui.el("span", { className: "bv-seed-target", style: { left: targets[seedPoints.length].x + "%", top: targets[seedPoints.length].y + "%" } }));
    seedPoints.forEach(function (point, index) { layer.appendChild(ui.el("span", { className: "bv-seed-point", style: seedPointStyle(point) }, [index + 1])); });
    var card = ui.el("div", { className: "bv-seed-card", role: "group", "aria-label": "Court setup instructions", "data-bso-seed-card": "true", "data-bso-contrast": "high" });
    var title = fitted ? "Court ready to lock" : invalid ? "Court needs correction" : "Click the " + corners[seedPoints.length].toLowerCase() + " outer corner";
    var handle = ui.el("button", { className: "bv-seed-card-handle", type: "button", "aria-label": "Move court setup instructions", "aria-describedby": "bv-seed-card-help", "aria-grabbed": "false", "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home", title: "Drag to move. Use arrow keys to nudge. Home resets the position.", "data-bso-seed-card-handle": "true" }, [ui.icon("grip", 14), ui.el("span", { className: "bv-seed-card-handle-text" }, ["Drag to move"])]);
    var help = ui.el("span", { className: "bv-sr-only", id: "bv-seed-card-help" }, ["Drag this handle to move the instructions inside the video. Use the arrow keys to nudge it. Press Home to reset its position."]);
    var top = ui.el("div", { className: "bv-seed-card-top" }, [handle, ui.stepDots(Math.min(seedPoints.length, 4), corners), ui.el("span", { className: "bv-seed-card-title" }, [title]), fitted ? ui.badge("homography ok", "in") : invalid ? ui.badge("not accepted", "warn") : null, ui.el("span", { className: "bv-seed-card-actions" }, [ui.button("Reset position", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); resetSeedCardPosition(); } }), ui.button("Undo", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0, onClick: function (event) { event.stopPropagation(); undoSeedPoint(); } }), ui.button("Reset court", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0 && !state.seeded, onClick: function (event) { event.stopPropagation(); resetSeed(); } }), ui.button("Skip to manual", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); openLabeling(); } }), ui.button("Lock court", { variant: "primary", size: "sm", disabled: !fitted, onClick: function (event) { event.stopPropagation(); lockSeed(); } })])]);
    top.appendChild(help);
    card.appendChild(top);
    if (state.calibrationError) card.appendChild(ui.callout("warn", "Calibration not accepted", state.calibrationError));
    card.appendChild(ui.el("p", {}, ["Your four clicks are the outer doubles corners only. Service lines, centre lines and the net come from the official 13.40 × 6.10 m court and are projected in — they never adapt to the image."]));
    card.appendChild(ui.el("div", { className: "bv-seed-note" }, [ui.icon("info", 13), ui.el("span", {}, ["Playback keeps running. A camera cut past tolerance pauses analysis, not the video."]), ui.button("Cancel", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); cancelSeeding(); } })]));
    layer.appendChild(card);
    applySeedCardPosition(layer, card, state.seedCardPosition);
    installSeedCardMovement(layer, card, handle);
    layer.addEventListener("click", function (event) {
      if (!seedClickAllowed(event, layer)) return;
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
    return ui.panel("Stats", { icon: "activity", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", actions: [ui.iconButton("chevron-up", "Hide stats", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "stats", value: false }); persist(); render(); } })] }, [ui.el("div", { className: "bv-stat-grid" }, [ui.stat("Rally", state.rally), ui.stat("Shots", strokes.length), ui.stat("Length", "28.4", "s")]), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", margin: "var(--sp-5) 0" } }, [ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-12)", color: "var(--text-muted)" } }, ["21–18 · 14–11"]), ui.badge("score OCR partial", "warn")]), ui.mixBar([{ label: "Clear", value: 5, color: "var(--player-a)" }, { label: "Drop", value: 4, color: "var(--court-fill)" }, { label: "Smash", value: 3, color: "var(--lime-500)" }, { label: "Net", value: 3, color: "var(--player-b)" }, { label: "Unclassified", value: 2, color: "var(--signal-unknown)" }]), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-5)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-hairline)" } }, [ui.el("span", { className: "bv-muted", style: { fontSize: "var(--fs-11)" } }, ["Last rally end"]), ui.badge("unclassified", "unknown"), ui.confidence(null, { showWord: true })])]);
  }
  function mapPanel() {
    return ui.panel("Court", { icon: "crosshair", mediaTime: state.time, className: "bv-court-panel", bodyStyle: { padding: "10px" }, actions: [ui.iconButton("chevron-down", "Hide court map", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "map", value: false }); persist(); render(); } })] }, [ui.courtDiagram({ renderWidth: 154, players: [{ x: 3.1, y: 9.7 }, { x: 2.5, y: 4.1, side: "b" }], trajectory: [{ x: 2.5, y: 4.3 }, { x: 3.5, y: 8.4 }, { x: 4.8, y: 12.9 }], landing: { x: 4.8, y: 12.9 }, call: "IN", ariaLabel: "Current court map" }), ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-4)" } }, [ui.badge("IN", "in"), ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-10)", color: "var(--text-faint)" } }, ["0.11 m inside"])]), ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.confidence(.52, { label: "geo", showWord: true })])]);
  }
  function labelForEvent(eventId) {
    return (state.manualLabels || []).find(function (label) { return label && String(label.eventId) === String(eventId); }) || null;
  }
  function openExistingLabel(stroke) {
    if (!stroke || stroke.eventId == null) return openLabeling();
    editingEventId = String(stroke.eventId);
    openLabeling(labelForEvent(stroke.eventId) || stroke);
  }
  function feedPanel() {
    var rows = ui.el("div", { className: "bv-feed" });
    strokes.forEach(function (stroke) { rows.appendChild(ui.strokeFeedItem(stroke, function () { openExistingLabel(stroke); })); });
    var children = [];
    if (state.lastEdit) children.push(ui.el("div", { className: "bv-review-undo", role: "status" }, [ui.el("span", {}, [(state.lastEdit.source === "manual" ? "Saved manual label at " : "Saved review suggestion at ") + (state.lastEdit.time || "the current timestamp") + "."]), ui.button("Undo", { variant: "ghost", size: "sm", onClick: undoLastEdit })]));
    children.push(rows);
    if (suggestion) children.push(ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.suggestionRow(suggestion, acceptSuggestion, function () { openLabeling(); })]));
    var footer = ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.badge("rally 13 · index 74", "accent", false), ui.el("span", { className: "bv-runtime-footnote" }, [runtimeView.result && runtimeView.result.kind === "runtime-integration-probe" ? "fixture result · not production CV" : "analysis unknown"]), ui.button("Older rallies", { variant: "ghost", size: "sm", iconRight: "chevron-right", style: { marginLeft: "auto" }, onClick: openSummary })]);
    return ui.panel("Stroke feed", { icon: "list", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", bodyStyle: { padding: "6px" }, footer: footer, actions: [ui.iconButton("pencil", "Open manual labeling (O)", { size: "sm", onClick: openLabeling }), ui.iconButton("chevron-up", "Hide stroke feed", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "feed", value: false }); persist(); render(); } })] }, children);
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
    // Panel switches are independent controls: density sets the default
    // presentation, while an explicit toggle always wins and reopens a panel.
    if (state.panels.stats) left.appendChild(statsPanel());
    overlay.appendChild(left);
    if (state.panels.map) overlay.appendChild(ui.el("div", { className: "bv-overlay-map" }, [mapPanel()]));
    if (state.panels.feed) overlay.appendChild(ui.el("div", { className: "bv-overlay-stack right" }, [feedPanel()]));
    var actions = ui.el("div", { className: "bv-overlay-actions" }, [ui.button("Density: " + state.density, { size: "sm", icon: "sliders", onClick: cycleDensity }), ui.button("Summary", { size: "sm", icon: "table", onClick: openSummary })]);
    overlay.appendChild(actions);
    return overlay;
  }

  function openLabeling(record) {
    state = window.BVState.reduceExtensionState(state, { type: "OPEN_LABELING" });
    if (record && record.eventId != null) editingEventId = String(record.eventId);
    draft = record ? newDraft(record) : newDraft();
    persist();
    render();
  }
  function commitReviewEvent(record, previousSuggestion, operation) {
    if (!record || !record.eventId || !window.BVReview) return null;
    var previousStroke = strokes.find(function (stroke) { return String(stroke.eventId) === String(record.eventId); });
    var previousLabel = labelForEvent(record.eventId);
    var editNow = new Date().toISOString();
    if (previousLabel) {
      if (record.createdAt == null) record.createdAt = previousLabel.createdAt;
      record.updatedAt = editNow;
    }
    var normalized = window.BVReview.normalizeManualLabel(record, { now: editNow });
    if (!normalized) return null;
    var nextLabels = window.BVReview.upsert(state.manualLabels, normalized);
    var edit = {
      eventId: normalized.eventId,
      operation: operation || (previousLabel ? "update" : "create"),
      source: normalized.source || "manual",
      time: normalized.time,
      previousStroke: previousStroke ? window.BVReview.clone(previousStroke) : null,
      previousLabel: previousLabel ? window.BVReview.clone(previousLabel) : null,
      previousSuggestion: previousSuggestion ? window.BVReview.clone(previousSuggestion) : null
    };
    state = window.BVState.reduceExtensionState(state, { type: "SET_REVIEW_LABELS", videoKey: activeVideoKey, labels: nextLabels, lastEdit: edit });
    strokes = reviewStrokes();
    persist();
    return normalized;
  }
  function acceptSuggestion() {
    if (!suggestion) return;
    var accepted = {
      eventId: suggestion.eventId,
      rallyId: suggestion.rallyId,
      sequence: strokes.length + 1,
      shot: suggestion.shot,
      time: suggestion.time,
      startSec: suggestion.startSec != null ? suggestion.startSec : window.BVReview.mediaSeconds(suggestion.time),
      endSec: suggestion.endSec,
      status: "accepted",
      source: "auto",
      provenance: "suggestion",
      confidence: suggestion.confidence
    };
    if (suggestion.playerId != null) accepted.playerId = suggestion.playerId;
    if (suggestion.player != null) accepted.player = suggestion.player;
    var priorSuggestion = suggestion;
    var saved = commitReviewEvent(accepted, priorSuggestion);
    if (!saved) return;
    send({ type: "ACCEPT_SUGGESTION", eventId: accepted.eventId });
    suggestion = null;
    closeLabeling();
  }
  function undoLastEdit() {
    var edit = state.lastEdit;
    if (!edit || !edit.eventId || !window.BVReview) return;
    state = window.BVState.reduceExtensionState(state, { type: "UNDO_LABEL", videoKey: activeVideoKey, edit: edit, labels: window.BVReview.undoLabelMutation(state.manualLabels, edit) });
    strokes = reviewStrokes();
    suggestion = edit.previousSuggestion ? window.BVReview.clone(edit.previousSuggestion) : null;
    persist();
    send({ type: "UNDO_LABEL", eventId: edit.eventId });
    render();
  }
  function cycleDensity() {
    var values = ["minimal", "balanced", "full"];
    var next = values[(values.indexOf(state.density) + 1) % values.length];
    state = window.BVState.reduceExtensionState(state, { type: "SET_DENSITY", value: next });
    persist();
    send({ type: "SET_DENSITY", value: next });
    render();
  }
  function openSummary() {
    if (hasChrome() && chrome.runtime) send({ type: "OPEN_SUMMARY" });
    else if (window.open) window.open("summary.html?from=" + encodeURIComponent(window.location.href), "_blank");
  }
  function exportCsv() {
    var videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : data.video.url;
    var rows = strokes.map(function (stroke, index) {
      return window.BVReview ? window.BVReview.toShotRow(stroke, videoUrl, index) : { video_url: videoUrl, shot_id: stroke.eventId, label: stroke.shot || "unclassified" };
    });
    var link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([window.BVAnalysis.toShotsCsv(rows)], { type: "text/csv" })); link.download = "badminton-vision-shots.csv"; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
  }
  function manualPanel() {
    // Offline mode has no suggestion source. Fixture suggestions only enter
    // the correction path when the live overlay is explicitly enabled.
    var activeSuggestion = state.enabled ? suggestion : null;
    var saveLabel = draft.shot || (activeSuggestion && activeSuggestion.shot);
    var saveActionLabel = editingEventId ? "Save correction" : draft.shot ? "Save label" : activeSuggestion ? "Accept suggestion" : "Save label";
    var canDelete = Boolean(editingEventId && labelForEvent(editingEventId));
    var panel = ui.panel("Manual labeling", { icon: "pencil", mediaTime: state.time, className: "bv-label-panel", bodyStyle: { flex: "1" }, actions: [ui.kbd("Esc"), ui.iconButton("x", "Close manual labeling", { size: "sm", onClick: closeLabeling })], footer: ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.button("Export CSV", { variant: "ghost", size: "sm", icon: "download", onClick: exportCsv }), state.lastEdit ? ui.button("Undo", { variant: "ghost", size: "sm", onClick: undoLastEdit }) : null, canDelete ? ui.button("Delete label", { variant: "danger", size: "sm", onClick: deleteExistingLabel }) : null, ui.el("span", { style: { marginLeft: "auto", display: "flex", gap: "var(--sp-3)" } }, [ui.button("Cancel", { variant: "ghost", size: "sm", onClick: closeLabeling }), ui.button(saveActionLabel, { variant: "primary", size: "sm", disabled: !saveLabel, onClick: saveDraft })])]) }, []);
    panel.tabIndex = 0;
    var body = panel.querySelector(".bv-panel-body");
    body.appendChild(ui.callout("guide", "Manual / offline mode", "Playback is read-only. No court seed, inference model, or production CV evidence is required."));
    if (state.manualLabels && state.manualLabels.length) {
      var savedLabels = ui.el("div", { className: "bv-manual-saved", "aria-label": "Saved labels for this video" });
      savedLabels.appendChild(ui.el("span", { className: "bv-field-label" }, ["Saved labels for this video"]));
      state.manualLabels.forEach(function (label, index) {
        var savedRow = Object.assign({}, label, { sequence: label.sequence || index + 1 });
        savedLabels.appendChild(ui.strokeFeedItem(savedRow, function () { openExistingLabel(label); }));
      });
      body.appendChild(savedLabels);
    }
    body.appendChild(ui.el("div", { className: "bv-segment-window" }, [ui.el("span", { className: "bv-mono" }, [(draft.start || "current timestamp") + " → " + (draft.end || "—")]), ui.el("span", { className: "bv-segment-controls" }, [ui.button("Start", { variant: "ghost", size: "sm", disabled: currentMediaTimestamp() == null, onClick: function () { if (currentMediaTimestamp() != null) draft.start = formatMediaTime(currentMediaTimestamp()); render(); } }), ui.button("End", { variant: "ghost", size: "sm", disabled: currentMediaTimestamp() == null, onClick: function () { if (currentMediaTimestamp() != null) draft.end = formatMediaTime(currentMediaTimestamp()); render(); } })]) ]));
    if (activeSuggestion) body.appendChild(ui.el("div", { className: "bv-manual-suggestion" }, [ui.badge("auto suggestion", "warn"), ui.el("span", { className: "bv-feed-shot" + (draft.shot ? " replaced" : "") }, [activeSuggestion.shot]), ui.confidence(activeSuggestion.confidence, { showWord: true }), ui.el("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", font: "var(--type-ui-sm)", color: "var(--text-faint)" } }, ["accept", ui.kbd("↵", true)])]));
    body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Shot family"]));
    body.appendChild(ui.shotPicker(draft.shot, activeSuggestion && activeSuggestion.shot, function (shot) { draft.shot = shot; render(); }));
    body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Player identity (optional)"]));
    body.appendChild(ui.segmented([{ value: "", label: "Unknown" }, { value: "A", label: "Player A" }, { value: "B", label: "Player B" }], draft.playerId || "", function (player) { draft.playerId = player || null; render(); }, true));
    body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Dimensions (optional)"]));
    var axisList = ui.el("div", { className: "bv-axis-list" });
    data.axes.forEach(function (axis) { axisList.appendChild(ui.dimensionAxis(axis.label, axis.options, draft.axes[axis.label], function (value) { draft.axes[axis.label] = value; render(); })); });
    body.appendChild(axisList);
    body.appendChild(ui.el("p", { className: "bv-helper" }, ["Manual labels are first-class records. Saving updates the same event id and appends provenance — it never creates a duplicate or invents CV evidence."]));
    setTimeout(function () { panel.focus(); }, 0);
    return panel;
  }
  function saveDraft() {
    if (draft.shot) saveManual(draft.shot);
    else if (state.enabled && suggestion) acceptSuggestion();
  }
  function saveManual(shot) {
    if (!shot || !window.BVReview) return;
    var activeSuggestion = state.enabled ? suggestion : null;
    var existing = editingEventId ? labelForEvent(editingEventId) : null;
    var startSec = window.BVReview.mediaSeconds(draft.start);
    var endSec = window.BVReview.mediaSeconds(draft.end);
    if (startSec == null) startSec = currentMediaTimestamp();
    var eventId = editingEventId || (activeSuggestion && activeSuggestion.eventId) || window.BVState.createManualEventId(activeVideoKey, startSec, state.manualLabels);
    var record = {
      eventId: eventId,
      rallyId: activeSuggestion ? activeSuggestion.rallyId : existing && existing.rallyId != null ? existing.rallyId : state.rally,
      sequence: (strokes.find(function (stroke) { return String(stroke.eventId) === String(eventId); }) || {}).sequence || strokes.length + 1,
      shot: shot,
      time: startSec == null ? draft.start : formatMediaTime(startSec),
      startSec: startSec,
      endSec: endSec,
      axes: Object.keys(draft.axes || {}).reduce(function (result, key) { if (draft.axes[key] != null && draft.axes[key] !== "") result[key] = draft.axes[key]; return result; }, {}),
      status: activeSuggestion || existing ? "corrected" : "accepted",
      source: "manual",
      provenance: activeSuggestion ? "manual-correction" : existing ? "manual-edit" : "manual"
    };
    if (draft.playerId) {
      record.playerId = draft.playerId;
      record.player = draft.playerId;
    } else if (existing && existing.playerId != null) {
      record.playerId = existing.playerId;
      if (existing.player != null) record.player = existing.player;
    } else if (existing && existing.player != null) record.player = existing.player;
    else if (activeSuggestion && activeSuggestion.playerId != null) {
      record.playerId = activeSuggestion.playerId;
      if (activeSuggestion.player != null) record.player = activeSuggestion.player;
    } else if (activeSuggestion && activeSuggestion.player != null) record.player = activeSuggestion.player;
    if (existing) {
      var dimensionFields = { Longitudinal: "longitudinal_position", Lateral: "lateral_position", Timing: "timing", Intention: "intention", Impact: "impact", Direction: "direction" };
      Object.keys(dimensionFields).forEach(function (axis) {
        if (record.axes[axis] != null && existing[dimensionFields[axis]] != null) record[dimensionFields[axis]] = record.axes[axis];
      });
    }
    var priorSuggestion = activeSuggestion;
    var saved = commitReviewEvent(record, priorSuggestion);
    if (!saved) return;
    send({ type: "LABEL_EVENT", eventId: eventId, shot: shot, provenance: "manual", startSec: startSec, endSec: endSec });
    if (activeSuggestion) suggestion = null;
    closeLabeling();
  }
  function deleteExistingLabel() {
    var existing = editingEventId && labelForEvent(editingEventId);
    if (!existing || !window.BVReview) return;
    var edit = {
      eventId: existing.eventId,
      operation: "delete",
      source: "manual",
      time: existing.time,
      previousLabel: window.BVReview.clone(existing),
      previousSuggestion: null
    };
    state = window.BVState.reduceExtensionState(state, { type: "SET_REVIEW_LABELS", videoKey: activeVideoKey, labels: window.BVReview.without(state.manualLabels, existing.eventId), lastEdit: edit });
    strokes = reviewStrokes();
    persist();
    send({ type: "DELETE_LABEL", eventId: existing.eventId, provenance: "manual" });
    editingEventId = null;
    closeLabeling();
  }
  function closeLabeling() {
    state = window.BVState.reduceExtensionState(state, { type: "CLOSE_LABELING" });
    editingEventId = null;
    draft = newDraft();
    persist();
    render();
  }

  function isInteractiveTarget(target) {
    var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    return tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "a" || target && target.isContentEditable || target && target.getAttribute && target.getAttribute("role") === "button";
  }
  function handleKeyboardShortcuts(event) {
    var key = String(event.key || "").toLowerCase();
    // Escape is a global dismiss affordance, including while a shot button is
    // focused. Other shortcuts yield to native controls so Enter/Space do not
    // accidentally save a draft when activating a picker button.
    if (key === "escape" && state.labeling && !state.seeding) {
      event.preventDefault();
      closeLabeling();
      return;
    }
    if (isInteractiveTarget(event.target)) return;
    if (key === "o" && state.enabled && !state.seeding) {
      event.preventDefault();
      if (!state.labeling) openLabeling();
      return;
    }
    if (!state.labeling || state.seeding) return;
    if (key >= "1" && key <= "9") {
      draft.shot = ["Serve", "Clear", "Drop", "Smash", "Half Smash", "Lift", "Net Shot", "Net Kill", "Push"][Number(key) - 1];
      event.preventDefault();
      render();
    } else if (key === "s") {
      draft.start = formatMediaTime(mediaTime);
      event.preventDefault();
      render();
    } else if (key === "e") {
      draft.end = formatMediaTime(mediaTime);
      event.preventDefault();
      render();
    } else if (event.key === "Enter" && (draft.shot || suggestion)) {
      event.preventDefault();
      saveDraft();
    }
  }

  function render() {
    if (!root) return;
    updateDiagnosticsMarkers();
    root.replaceChildren();
    if (!state.enabled && !state.seeding && !state.labeling) return;
    if (state.seeding) root.appendChild(seedFlow());
    else if (state.enabled) root.appendChild(liveOverlay());
    if (state.labeling && !state.seeding) root.appendChild(ui.el("div", { className: "bv-overlay-label" }, [manualPanel()]));
  }
  function applyStoredState(nextState) {
    var key = currentVideoKey();
    state = window.BVState.stateForVideo(nextState, key);
    restoreReviewState();
    if (state.seeded && !state.calibration) {
      state = window.BVState.resetVideoLocalState(state, key);
      state.calibrationError = "This saved court has no fitted calibration. Please seed the four outer corners again.";
      restoreReviewState();
    }
    activeVideoKey = key;
    if (video && Number.isFinite(video.currentTime) && !state.stale) state.time = formatMediaTime(video.currentTime);
    restoreCalibrationState();
    if (state.enabled) startRuntime();
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
      bindVideoState();
      state = window.BVState.reduceExtensionState(state, { type: "START_SEED" });
      state.videoKey = activeVideoKey || currentVideoKey();
      startRuntime();
      seedPoints = [];
      calibration = null;
      persist(); render();
    }
    else if (message.type === "ENABLE" || message.type === "OPEN_OVERLAY") {
      bindVideoState();
      state = window.BVState.reduceExtensionState(state, { type: message.type });
      state.videoKey = activeVideoKey || currentVideoKey();
      startRuntime();
      seedPoints = state.seeding ? state.seedDraftPoints.slice() : [];
      if (state.seeded && state.calibration && !calibration) restoreCalibrationState();
      persist(); render();
    }
    else if (message.type === "DISABLE") {
      state = window.BVState.reduceExtensionState(state, { type: "DISABLE" });
      persist(); render();
    }
    else if (message.type === "OPEN_LABELING") { bindVideoState(); openLabeling(); }
    else if (message.type === "SET_DENSITY") { state = window.BVState.reduceExtensionState(state, { type: "SET_DENSITY", value: message.value }); persist(); render(); }
    else if (message.type === "SET_PANELS") { state = window.BVState.reduceExtensionState(state, { type: "SET_PANELS", panels: message.panels }); persist(); render(); }
    else if (message.type === "SET_TRACKER") { state = window.BVState.reduceExtensionState(state, message); persist(); render(); }
    else if (message.type === "STATE_UPDATE" && message.state) { applyStoredState(message.state); render(); }
    else if (message.type === "CAMERA_CUT") {
      state = window.BVState.reduceExtensionState(state, { type: "CAMERA_CUT" });
      state.videoKey = activeVideoKey || currentVideoKey();
      calibration = null;
      seedCardDrag = null;
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
    window.addEventListener("keydown", handleKeyboardShortcuts);
    ["yt-navigate-start", "yt-navigate-finish", "popstate", "hashchange"].forEach(function (name) {
      var listener = handleNavigation;
      window.addEventListener(name, listener);
      navigationListeners.push([name, listener]);
    });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(positionToVideo).observe(document.documentElement);
    domObserver = new MutationObserver(attachVideo); domObserver.observe(document.documentElement, { childList: true, subtree: true }); attachVideo();
    // Manual/offline labeling intentionally does not start the runtime. It
    // reads the media clock only; live inference begins on ENABLE/OPEN_OVERLAY.
    if (hasChrome() && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(handleMessage);
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState"], function (result) { applyStoredState(result && result.bvState ? result.bvState : state); render(); });
    else { applyStoredState(state); render(); }
  }
  init();
})();
