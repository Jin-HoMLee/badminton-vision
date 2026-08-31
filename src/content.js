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
  var videoStates = {};
  // Fixture rows are only rendered after an explicit fixture-probe result is
  // received. A real session starts with no automatic stroke claims; manual
  // labels remain first-class and are merged into the current evidence.
  var strokes = [];
  var suggestion = null;
  var draft = newDraft();

  function newDraft() {
    var next = { shot: null, start: "12:03.980", end: "12:04.420", axes: {} };
    data.axes.forEach(function (axis) { next.axes[axis.label] = axis.value; });
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
  var mediaTime = 0;
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
    var key = state.videoKey || activeVideoKey || currentVideoKey();
    if (key) {
      state.videoKey = key;
      if (!state.videoUrl && window.location && /^https?:/.test(window.location.href)) state.videoUrl = window.location.href;
      videoStates = window.BVState.setVideoState(videoStates, state);
    }
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.set({ bvState: state, bvVideoStates: videoStates }, function () { void chrome.runtime.lastError; });
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
    host.setAttribute("data-bso-player-count", String(result && Array.isArray(result.players) ? result.players.filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length : 0));
    host.setAttribute("data-bso-shuttle-confidence", String(result && result.shuttle && result.shuttle.confidence != null ? result.shuttle.confidence : "unknown"));
    host.setAttribute("data-bso-frame-transport", runtimeView.capabilities && runtimeView.capabilities.frameTransport || "unknown");
    host.setAttribute("data-bso-backend", runtimeView.capabilities && runtimeView.capabilities.backend || "unknown");
    host.setAttribute("data-bso-fallback", fallbackReasons.filter(Boolean).join(",") || "none");
  }
  function publishRuntimeView(view) {
    runtimeView = view;
    if (view && view.result && view.result.cameraCut && !state.cameraCut && (state.seeded || calibration)) {
      state = window.BVState.reduceExtensionState(state, { type: "CAMERA_CUT" });
      calibration = null;
      seedPoints = [];
      seedCardDrag = null;
      persist();
    }
    restoreReviewState();
    updateDiagnosticsMarkers();
    var result = view.result;
    var playerCount = result && Array.isArray(result.players)
      ? result.players.filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length
      : null;
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
      // Keep only the model-neutral latest result needed by the summary; no
      // frame pixels or account/page content cross the local storage seam.
      result: result ? {
        kind: result.kind || null,
        state: result.state || "unknown",
        cameraCut: Boolean(result.cameraCut),
        players: Array.isArray(result.players) ? result.players : [],
        tracking: result.tracking || null,
        shuttle: result.shuttle || null,
        strokeEvents: Array.isArray(result.strokeEvents) ? result.strokeEvents : [],
        rally: result.rally || { state: "unknown" },
        rallyEnd: result.rallyEnd || { state: "unknown" },
        winner: result.winner || { state: "unknown" }
      } : null,
      playerCount: playerCount,
      playerState: result && result.tracking ? result.tracking.state : "unknown",
      shuttleState: result && result.shuttle ? result.shuttle.state : "unknown",
      shuttleConfidence: result && result.shuttle && result.shuttle.confidence != null ? result.shuttle.confidence : null,
      backend: view.capabilities && view.capabilities.backend || null,
      sessionId: runtimeController && runtimeController.sessionId ? runtimeController.sessionId : null
    };
    var key = JSON.stringify([status.phase, status.analyzer, status.inference, status.reason, status.frameTransport, status.backend, status.stale, status.resultKind, status.playerCount, status.playerState, status.shuttleState, status.shuttleConfidence]);
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
  function isFixtureRuntime() {
    return Boolean(runtimeView.result && runtimeView.result.kind === "runtime-integration-probe" || runtimeView.analyzer === "fixture-probe-v1");
  }
  function runtimeResult() { return runtimeView && runtimeView.result && typeof runtimeView.result === "object" ? runtimeView.result : null; }
  function runtimeTracking() { var result = runtimeResult(); return result && result.tracking || null; }
  function runtimeShuttle() { var result = runtimeResult(); return result && result.shuttle || null; }
  function runtimeCaption() {
    if (isFixtureRuntime()) return "fixture result observed · not production CV";
    if (runtimeView.phase === "fallback") return "local production analysis unavailable · playback unaffected";
    var shuttle = runtimeShuttle();
    var shuttleState = shuttle && shuttle.state === "tracked" ? "shuttle candidate tracked" : "shuttle unknown";
    return runtimeView.inference ? "local pose + shuttle runtime · " + shuttleState : "local runtime · awaiting analyzer";
  }
  function evidenceState(value) { return value && value.state ? value.state : "unknown"; }
  function imagePointToCourt(point) {
    if (!point || !calibration || !calibrationApi || typeof calibrationApi.projectImagePoint !== "function") return null;
    try {
      var projected = calibrationApi.projectImagePoint(calibration, { x: Number(point.x), y: Number(point.y) });
      if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) return null;
      return { x: projected.x * 6.1, y: projected.y * 13.4 };
    } catch (_) { return null; }
  }
  function playerCourtPoints() {
    var tracking = runtimeTracking();
    if (!tracking || !Array.isArray(tracking.players)) return [];
    return tracking.players.map(function (player, index) {
      if (!player || !player.bbox || player.state === "unknown") return null;
      var imagePoint = { x: player.bbox.x + player.bbox.width / 2, y: player.bbox.y + player.bbox.height / 2 };
      var court = imagePointToCourt(imagePoint);
      return court ? Object.assign(court, { side: index % 2 ? "b" : "a", state: player.state, trackId: player.trackId }) : null;
    }).filter(Boolean);
  }
  function shuttleCourtTrajectory() {
    var shuttle = runtimeShuttle();
    if (!shuttle || !Array.isArray(shuttle.trajectory)) return [];
    return shuttle.trajectory.map(imagePointToCourt).filter(Boolean);
  }
  function shuttleCourtCandidate() {
    var shuttle = runtimeShuttle();
    if (!shuttle || shuttle.state !== "tracked" || !shuttle.candidate || shuttle.candidate.accepted !== true) return null;
    return imagePointToCourt(shuttle.candidate);
  }
  function evidenceStrokes() {
    var result = runtimeResult();
    if (isFixtureRuntime()) return data.strokes.slice();
    if (!result || !Array.isArray(result.strokeEvents)) return [];
    return result.strokeEvents.filter(function (stroke) { return stroke && typeof stroke === "object"; }).map(function (stroke, index) {
      return Object.assign({}, stroke, {
        eventId: stroke.eventId || "auto-" + (stroke.hit_media_time == null ? index : stroke.hit_media_time),
        sequence: stroke.sequence == null ? index + 1 : stroke.sequence,
        player: stroke.player || stroke.player_id || "?",
        shot: stroke.shot || stroke.shot_family || "unclassified",
        time: stroke.time || formatMediaTime(Number(stroke.hit_media_time) || mediaTime),
        status: stroke.status || "unclassified",
        source: stroke.source || "auto",
        confidence: stroke.classification_confidence == null ? null : stroke.classification_confidence
      });
    });
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
    return window.BVReview ? window.BVReview.mergeStrokes(evidenceStrokes(), state.manualLabels) : evidenceStrokes();
  }
  function restoreReviewState() {
    strokes = reviewStrokes();
    suggestion = isFixtureRuntime() && data.suggestion ? Object.assign({}, data.suggestion) : null;
    if (suggestion && strokes.some(function (stroke) { return String(stroke.eventId) === String(suggestion.eventId); })) suggestion = null;
  }
  function resetVideoLocalState(reason) {
    persist();
    activeVideoKey = currentVideoKey();
    state = window.BVState.resetVideoLocalState(state, activeVideoKey);
    state.videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : null;
    calibration = null;
    seedPoints = [];
    seedCardDrag = null;
    strokes = [];
    suggestion = null;
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
    refreshSeedCardPosition();
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
    try {
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
    } catch (error) {
      // A page/runtime integration problem must remain visible without
      // preventing the content UI from serving manual labels.
      runtimeView = {
        phase: "fallback",
        message: "Local runtime unavailable",
        reason: error && error.message ? error.message : String(error),
        analyzer: "none",
        inference: false,
        fallbacks: ["content-runtime-initialization-failed"],
        capabilities: {},
        result: null,
        currentMediaTime: null,
        ageSeconds: null,
        stale: true
      };
      updateDiagnosticsMarkers();
    }
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
  function runtimeEvidenceDrawing() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bv-runtime-evidence");
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", "Live local player and shuttle evidence");
    svg.setAttribute("data-bso-production-evidence", String(!isFixtureRuntime()));
    function add(tag, attrs) {
      var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
      svg.appendChild(node);
    }
    var tracking = runtimeTracking();
    (tracking && Array.isArray(tracking.players) ? tracking.players : []).forEach(function (player, index) {
      if (!player || !player.bbox || player.state === "unknown") return;
      add("rect", {
        x: player.bbox.x, y: player.bbox.y, width: player.bbox.width, height: player.bbox.height,
        class: "bv-player-box " + (index % 2 ? "b" : "a"),
        "stroke-dasharray": player.state === "partial" ? ".012 .008" : "none",
        "data-track-id": player.trackId || "unknown-track",
        "data-player-state": player.state
      });
    });
    var shuttle = runtimeShuttle();
    if (shuttle && Array.isArray(shuttle.trajectory) && shuttle.trajectory.length > 1) {
      add("polyline", { points: shuttle.trajectory.map(function (point) { return point.x + "," + point.y; }).join(" "), class: "bv-shuttle-trajectory", "data-shuttle-state": shuttle.state || "unknown" });
    }
    if (shuttle && shuttle.state === "tracked" && shuttle.candidate && shuttle.candidate.accepted === true) {
      add("circle", { cx: shuttle.candidate.x, cy: shuttle.candidate.y, r: ".012", class: "bv-shuttle-point", "data-shuttle-state": "tracked" });
    }
    return svg;
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
    var result = runtimeResult();
    var tracking = runtimeTracking();
    var shuttle = runtimeShuttle();
    var rally = result && result.rally && result.rally.state !== "unknown" ? result.rally.id || state.rally : "unknown";
    var shotCount = strokes.length || "unknown";
    return ui.panel("Stats", { icon: "activity", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", actions: [ui.iconButton("chevron-up", "Hide stats", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "stats", value: false }); persist(); render(); } })] }, [
      ui.el("div", { className: "bv-stat-grid" }, [ui.stat("Rally", rally), ui.stat("Shots", shotCount), ui.stat("Length", "unknown", "s")]),
      ui.el("div", { className: "bv-evidence-grid" }, [ui.el("span", {}, ["Players", ui.badge(evidenceState(tracking), evidenceState(tracking) === "tracked" ? "in" : "unknown")]), ui.el("span", {}, ["Shuttle", ui.badge(evidenceState(shuttle), evidenceState(shuttle) === "tracked" ? "in" : "unknown")]), ui.el("span", {}, ["Winner", ui.badge(result && result.winner ? evidenceState(result.winner) : "unknown", "unknown")])]),
      ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", margin: "var(--sp-5) 0" } }, [ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-12)", color: "var(--text-muted)" } }, ["score unknown"]), ui.badge("score OCR unavailable", "warn")]),
      ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-5)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-hairline)" } }, [ui.el("span", { className: "bv-muted", style: { fontSize: "var(--fs-11)" } }, ["Rally end"]), ui.badge(result && result.rallyEnd ? evidenceState(result.rallyEnd) : "unknown", "unknown"), ui.confidence(null, { showWord: true })])
    ]);
  }
  function mapPanel() {
    var players = playerCourtPoints();
    var trajectory = shuttleCourtTrajectory();
    var landing = shuttleCourtCandidate();
    var shuttle = runtimeShuttle();
    var shuttleState = evidenceState(shuttle);
    var mapNote = !calibration ? "Seed the court to project live coordinates." : shuttleState === "tracked" && landing ? "Candidate shown; line call remains unknown." : "No accepted shuttle landing evidence.";
    return ui.panel("Court", { icon: "crosshair", mediaTime: state.time, className: "bv-court-panel", bodyStyle: { padding: "10px" }, actions: [ui.iconButton("chevron-down", "Hide court map", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "map", value: false }); persist(); render(); } })] }, [
      ui.courtDiagram({ renderWidth: 154, players: players, trajectory: trajectory, landing: landing, call: "UNKNOWN", ariaLabel: "Current court map; unknown values are not inferred" }),
      ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-4)" } }, [ui.badge(shuttleState === "tracked" ? "candidate" : "UNKNOWN", shuttleState === "tracked" ? "info" : "unknown"), ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-10)", color: "var(--text-faint)" } }, [mapNote])]),
      ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.confidence(null, { label: "geo", showWord: true })])
    ]);
  }
  function feedPanel() {
    var rows = ui.el("div", { className: "bv-feed" });
    strokes.forEach(function (stroke) {
      rows.appendChild(ui.strokeFeedItem(stroke, function () { openLabeling(stroke); }, function () { deleteReviewEvent(stroke); }));
    });
    if (!strokes.length) rows.appendChild(ui.emptyState("No accepted stroke evidence", "Pose and shuttle signals do not establish a hit, shot family, rally end, or winner. Add a manual label while playback continues.", ui.button("Label current segment", { variant: "ghost", size: "sm", onClick: openLabeling }), "help"));
    var children = [];
    if (state.lastEdit) children.push(ui.el("div", { className: "bv-review-undo", role: "status" }, [ui.el("span", {}, [(state.lastEdit.source === "manual" ? "Saved manual review at " : "Accepted fixture suggestion at ") + (state.lastEdit.time || "the current timestamp") + "."]), ui.button("Undo", { variant: "ghost", size: "sm", onClick: undoLastEdit })]));
    children.push(rows);
    if (suggestion) children.push(ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.suggestionRow(suggestion, acceptSuggestion, openLabeling)]));
    var footerLabel = isFixtureRuntime() ? "rally 13 · index 74" : "rally unknown · index unavailable";
    var footer = ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.badge(footerLabel, isFixtureRuntime() ? "accent" : "unknown", false), ui.el("span", { className: "bv-runtime-footnote" }, [isFixtureRuntime() ? "fixture result · not production CV" : "automatic event evidence unknown"]), ui.button("Older rallies", { variant: "ghost", size: "sm", iconRight: "chevron-right", style: { marginLeft: "auto" }, onClick: openSummary })]);
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
    // Evidence is drawn in normalized video coordinates and never intercepts
    // pointer input, so player/shuttle rendering cannot block playback or seed clicks.
    overlay.appendChild(runtimeEvidenceDrawing());
    var stale = runtimeIsStale();
    var statusState = runtimeView.phase === "fallback" ? "stale" : stale ? "stale" : "live";
    var statusLabel = runtimeView.phase === "fallback" ? "Analysis fallback" : stale ? "Analysis behind" : "Rally " + state.rally;
    var statusDetail = stale && Number.isFinite(runtimeView.ageSeconds)
      ? "+" + runtimeView.ageSeconds.toFixed(1) + "s"
      : state.time;
    var left = ui.el("div", { className: "bv-overlay-stack left" }, [
      ui.statusChip(statusState, statusLabel, statusDetail, openLabeling),
      ui.el("div", { className: "bv-runtime-note", role: "status" }, [ui.icon("info", 11), runtimeCaption()]),
      ui.el("div", { className: "bv-runtime-signal", role: "status" }, ["players ", ui.badge(String((runtimeTracking() && runtimeTracking().players || []).filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length), "info"), " · shuttle ", ui.badge(evidenceState(runtimeShuttle()), evidenceState(runtimeShuttle()) === "tracked" ? "in" : "unknown")])
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

  function draftForStroke(stroke) {
    var next = newDraft();
    if (!stroke) return next;
    next.eventId = stroke.eventId == null ? null : String(stroke.eventId);
    next.sequence = stroke.sequence == null ? null : stroke.sequence;
    next.rallyId = stroke.rallyId == null ? null : stroke.rallyId;
    next.player = stroke.player || "A";
    next.shot = stroke.shot && stroke.shot !== "unclassified" ? stroke.shot : null;
    if (stroke.time) next.start = stroke.time;
    if (stroke.endSec != null) next.end = formatMediaTime(Number(stroke.endSec));
    else if (stroke.startSec != null) next.end = formatMediaTime(Number(stroke.startSec) + .4);
    next.axes = Object.assign(next.axes, stroke.axes || {});
    return next;
  }
  function openLabeling(stroke) {
    state = window.BVState.reduceExtensionState(state, { type: "OPEN_LABELING" });
    draft = draftForStroke(stroke);
    persist();
    render();
  }
  function commitReviewEvent(record, previousSuggestion) {
    if (!record || !record.eventId || !window.BVReview) return;
    var previousStroke = strokes.find(function (stroke) { return String(stroke.eventId) === String(record.eventId); });
    var previousLabel = (state.manualLabels || []).find(function (label) { return String(label.eventId) === String(record.eventId); });
    state.lastEdit = {
      eventId: record.eventId,
      source: record.source || "manual",
      time: record.time,
      previousStroke: previousStroke ? window.BVReview.clone(previousStroke) : null,
      previousLabel: previousLabel ? window.BVReview.clone(previousLabel) : null,
      previousSuggestion: previousSuggestion ? window.BVReview.clone(previousSuggestion) : null
    };
    state.manualLabels = window.BVReview.upsert(state.manualLabels, record);
    strokes = reviewStrokes();
    persist();
  }
  function acceptSuggestion() {
    if (!suggestion) return;
    var accepted = {
      eventId: suggestion.eventId,
      rallyId: suggestion.rallyId,
      sequence: strokes.length + 1,
      player: "A",
      shot: suggestion.shot,
      time: suggestion.time,
      startSec: window.BVReview.mediaSeconds(suggestion.time),
      endSec: window.BVReview.mediaSeconds(suggestion.time) + .4,
      status: "accepted",
      source: "auto",
      confidence: suggestion.confidence
    };
    var priorSuggestion = suggestion;
    commitReviewEvent(accepted, priorSuggestion);
    send({ type: "ACCEPT_SUGGESTION", eventId: accepted.eventId });
    suggestion = null;
    closeLabeling();
  }
  function undoLastEdit() {
    var edit = state.lastEdit;
    if (!edit || !edit.eventId || !window.BVReview) return;
    state.manualLabels = window.BVReview.without(state.manualLabels, edit.eventId);
    if (edit.previousLabel) state.manualLabels = window.BVReview.upsert(state.manualLabels, edit.previousLabel);
    strokes = reviewStrokes();
    suggestion = edit.previousSuggestion ? window.BVReview.clone(edit.previousSuggestion) : null;
    state.lastEdit = null;
    persist();
    send({ type: "UNDO_LABEL", eventId: edit.eventId });
    render();
  }
  function deleteReviewEvent(stroke) {
    if (!stroke || !stroke.eventId || !window.BVReview) return;
    var previousLabel = (state.manualLabels || []).find(function (label) { return String(label.eventId) === String(stroke.eventId); });
    if (!previousLabel) return;
    state.lastEdit = {
      eventId: stroke.eventId,
      source: "manual-delete",
      time: stroke.time,
      previousStroke: window.BVReview.clone(stroke),
      previousLabel: window.BVReview.clone(previousLabel),
      previousSuggestion: null
    };
    state.manualLabels = window.BVReview.without(state.manualLabels, stroke.eventId);
    strokes = reviewStrokes();
    persist();
    send({ type: "DELETE_LABEL", eventId: stroke.eventId });
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
    var saveLabel = draft.shot || (suggestion && suggestion.shot);
    var saveActionLabel = draft.shot ? "Save correction" : suggestion ? "Accept suggestion" : "Save shot";
    var panel = ui.panel("Manual labeling", { icon: "pencil", mediaTime: state.time, className: "bv-label-panel", bodyStyle: { flex: "1" }, actions: [ui.kbd("Esc"), ui.iconButton("x", "Close manual labeling", { size: "sm", onClick: closeLabeling })], footer: ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.button("Export CSV", { variant: "ghost", size: "sm", icon: "download", onClick: exportCsv }), ui.el("span", { style: { marginLeft: "auto", display: "flex", gap: "var(--sp-3)" } }, [ui.button("Cancel", { variant: "ghost", size: "sm", onClick: closeLabeling }), ui.button(saveActionLabel, { variant: "primary", size: "sm", disabled: !saveLabel, onClick: saveDraft })])]) }, []);
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
    setTimeout(function () { panel.focus(); }, 0);
    return panel;
  }
  function saveDraft() {
    if (draft.shot) saveManual(draft.shot);
    else if (suggestion) acceptSuggestion();
  }
  function saveManual(shot) {
    if (!shot || !window.BVReview) return;
    var eventId = suggestion ? suggestion.eventId : "r" + state.rally + "-s" + String(strokes.length + 1).padStart(2, "0");
    var startSec = window.BVReview.mediaSeconds(draft.start);
    var endSec = window.BVReview.mediaSeconds(draft.end);
    var record = {
      eventId: eventId,
      rallyId: suggestion ? suggestion.rallyId : (draft.rallyId == null ? state.rally : draft.rallyId),
      sequence: draft.sequence || (strokes.find(function (stroke) { return String(stroke.eventId) === String(eventId); }) || {}).sequence || strokes.length + 1,
      player: draft.player || "A",
      shot: shot,
      time: draft.start,
      startSec: startSec,
      endSec: endSec,
      axes: Object.assign({}, draft.axes),
      status: suggestion ? "corrected" : "accepted",
      source: "manual",
      confidence: null
    };
    var priorSuggestion = suggestion;
    commitReviewEvent(record, priorSuggestion);
    send({ type: "LABEL_EVENT", eventId: eventId, shot: shot, provenance: "manual", startSec: startSec, endSec: endSec });
    suggestion = null;
    closeLabeling();
  }
  function closeLabeling() {
    state = window.BVState.reduceExtensionState(state, { type: "CLOSE_LABELING" });
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
    if (!state.enabled && !state.seeding) return;
    if (state.seeding) root.appendChild(seedFlow());
    else root.appendChild(liveOverlay());
    if (state.labeling && !state.seeding) root.appendChild(ui.el("div", { className: "bv-overlay-label" }, [manualPanel()]));
  }
  function applyStoredState(nextState, fromStorage) {
    var key = currentVideoKey();
    state = fromStorage
      ? window.BVState.stateForVideo(videoStates, key, nextState)
      : window.BVState.initialExtensionState(nextState);
    if (key) {
      state.videoKey = key;
      if (!state.videoUrl && window.location && /^https?:/.test(window.location.href)) state.videoUrl = window.location.href;
    }
    if (state.seeded && !state.calibration) {
      var savedLabels = state.manualLabels;
      var savedLastEdit = state.lastEdit;
      state = window.BVState.resetVideoLocalState(state, key);
      state.videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : null;
      state.manualLabels = savedLabels;
      state.lastEdit = savedLastEdit;
      state.calibrationError = "This saved court has no fitted calibration. Please seed the four outer corners again.";
      restoreReviewState();
    }
    activeVideoKey = key;
    restoreReviewState();
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
    else if (message.type === "ENABLE" || message.type === "OPEN_OVERLAY") {
      bindVideoState();
      state = window.BVState.reduceExtensionState(state, { type: message.type });
      state.videoKey = activeVideoKey || currentVideoKey();
      seedPoints = state.seeding ? state.seedDraftPoints.slice() : [];
      if (state.seeded && state.calibration && !calibration) restoreCalibrationState();
      persist(); render();
    }
    else if (message.type === "DISABLE") {
      state = window.BVState.reduceExtensionState(state, { type: "DISABLE" });
      persist(); render();
    }
    else if (message.type === "OPEN_LABELING") openLabeling();
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
    // Publish a base diagnostic state before asynchronous discovery/storage so
    // a runtime fault cannot leave an indistinguishable empty host behind.
    updateDiagnosticsMarkers();
    window.addEventListener("resize", positionToVideo, { passive: true }); window.addEventListener("scroll", positionToVideo, { passive: true, capture: true });
    window.addEventListener("keydown", handleKeyboardShortcuts);
    ["yt-navigate-start", "yt-navigate-finish", "popstate", "hashchange"].forEach(function (name) {
      var listener = handleNavigation;
      window.addEventListener(name, listener);
      navigationListeners.push([name, listener]);
    });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(positionToVideo).observe(document.documentElement);
    domObserver = new MutationObserver(attachVideo); domObserver.observe(document.documentElement, { childList: true, subtree: true }); attachVideo();
    startRuntime();
    if (hasChrome() && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(handleMessage);
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState", "bvVideoStates"], function (result) {
      videoStates = window.BVState.copyVideoStates(result && result.bvVideoStates);
      var key = currentVideoKey();
      var legacy = result && result.bvState && (!key || !result.bvState.videoKey || result.bvState.videoKey === key) ? result.bvState : null;
      applyStoredState(legacy || state, true);
      render();
    });
    else { applyStoredState(state, false); render(); }
  }
  init();
})();
