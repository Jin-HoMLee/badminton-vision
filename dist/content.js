/*
 * YouTube sibling overlay. It reads the active video and anchors to its client
 * rectangle; it never calls a playback mutator or writes to the video element.
 */
(function () {
  // All MV3 page actions enter through this one bundled content script. Keep
  // the guard in this source file too: it protects direct recovery/tests and
  // makes a second evaluation a no-op before any DOM or listener is created.
  var singletonKey = "__BV_CONTENT_SINGLETON_V1__";
  if (window[singletonKey]) return;
  var singleton = window[singletonKey] = { version: 1, active: true };

  var ui = window.BVUI;
  var data = window.BVFixtures;
  var calibrationApi = window.BVCalibration;
  var seedCardApi = window.BVSeedCard;
  // The packed MV3 bundle loads this pure helper before the content entrypoint.
  // Keep direct-source recovery/tests tolerant of an older partial bundle.
  var panelLayoutApi = window.BVPanelLayout || null;
  var state = window.BVState.initialExtensionState();
  // Popup actions can arrive while the initial storage read is still pending.
  // Hold them until the stored video-local state is applied so hydration cannot
  // overwrite a just-enabled live session and leave an empty overlay behind.
  var storageHydrated = false;
  var pendingMessages = [];
  var seenMessageIds = [];
  // Fixture rows are only rendered after an explicit fixture-probe result is
  // received. A real session starts with no automatic stroke claims; manual
  // labels remain first-class and are merged into the current evidence.
  var strokes = [];
  var suggestion = null;
  var mediaTime = 0;
  var editingEventId = null;
  var draft = newDraft();
  var importResult = null;
  var csvInput = null;

  function currentMediaTimestamp() {
    // Prefer live video.currentTime to avoid stale cached mediaTime from prior playback events
    if (video && Number.isFinite(video.currentTime) && video.currentTime >= 0) {
      return video.currentTime;
    }
    return Number.isFinite(mediaTime) && mediaTime >= 0 ? mediaTime : null;
  }
  function newDraft(record) {
    var start = record && record.startSec != null ? record.startSec : currentMediaTimestamp();
    var end = record && record.endSec != null ? record.endSec : null;
    var next = {
      eventId: record && record.eventId != null ? String(record.eventId) : null,
      sequence: record && record.sequence != null ? record.sequence : null,
      rallyId: record && record.rallyId != null ? record.rallyId : null,
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
  var overlayCanvas = null;
  var domObserver = null;
  var navigationListeners = [];
  var mediaTimeListener = null;
  var videoGeometryListener = null;
  var videoResizeObserver = null;
  var layoutResizeObserver = null;
  var runtimeController = null;
  var runtimeView = {
    phase: "idle", message: "Local runtime starting", reason: "", analyzer: "none",
    inference: false, fallbacks: [], capabilities: {}, result: null,
    currentMediaTime: null, ageSeconds: null, stale: true
  };
  var publishedRuntimeKey = null;
  var lastRuntimeRenderAt = 0;
  var positionFrameHandle = null;
  var panelGesture = null;
  // The live video keeps one compact access point visible. Its on-demand menu
  // is intentionally transient; durable panel/evidence choices live in the
  // popup-backed, video-local state.
  var overlayMenuOpen = false;

  function hasSeenMessage(message) {
    var requestId = message && message.requestId;
    if (!requestId) return false;
    requestId = String(requestId);
    if (seenMessageIds.indexOf(requestId) >= 0) return true;
    seenMessageIds.push(requestId);
    if (seenMessageIds.length > 64) seenMessageIds.shift();
    return false;
  }
  function hasChrome() { return typeof chrome !== "undefined"; }
  function persist() {
    var key = state.videoKey || activeVideoKey || currentVideoKey();
    if (key) {
      state.videoKey = key;
      if (!state.videoUrl && window.location && /^https?:/.test(window.location.href)) state.videoUrl = window.location.href;
    }
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.set({ bvState: state }, function () { void chrome.runtime.lastError; });
  }
  function send(message) {
    if (hasChrome() && chrome.runtime) chrome.runtime.sendMessage(message, function () { void chrome.runtime.lastError; });
  }
  function courtConfigurationState() {
    if (window.BVState && typeof window.BVState.courtConfigurationState === "function") {
      return window.BVState.courtConfigurationState(Object.assign({}, state, { calibration: state.seeding ? state.calibration : calibration }));
    }
    if (state.seeding) return state.seeded && state.calibration ? "recalibrating" : "setup";
    return state.seeded && calibration ? "calibrated" : "uncalibrated";
  }
  function courtDiagnosticState() {
    var configuration = courtConfigurationState();
    if (configuration === "setup" || configuration === "recalibrating") return "seeding";
    return configuration === "calibrated" ? "seeded" : "not-seeded";
  }
  function courtMappingAvailable() {
    // A draft fit belongs to setup feedback only. Until Lock court commits it,
    // map output must stay empty so an old calibration cannot leak through.
    return Boolean(calibration && !state.seeding);
  }
  function updateDiagnosticsMarkers() {
    if (!host) return;
    var result = runtimeView.result;
    var fallbacks = Array.isArray(runtimeView.fallbacks) ? runtimeView.fallbacks : [];
    var fallbackReasons = runtimeView.phase === "fallback"
      ? fallbacks.concat(runtimeView.reason || [])
      : [];
    host.setAttribute("data-bso-enabled", String(Boolean(state.enabled)));
    host.setAttribute("data-bso-youtube-detected", String(Boolean(window.BSOVideoDiscovery && window.BSOVideoDiscovery.isYouTubeWatchUrl && window.BSOVideoDiscovery.isYouTubeWatchUrl(window.location && window.location.href))));
    var info = currentVideoInfo();
    host.setAttribute("data-bso-badminton-detected", info ? (info.badmintonDetected ? "true" : "false") : "unknown");
    host.setAttribute("data-bso-badminton-detection", info && info.badmintonDetectionState || "unknown");
    host.setAttribute("data-bso-court-state", courtDiagnosticState());
    host.setAttribute("data-bso-court-map-state", courtConfigurationState());
    host.setAttribute("data-bso-seed-count", String(state.seeding ? seedPoints.length : (state.seedPoints || []).length));
    host.setAttribute("data-bso-runtime-phase", runtimeView.phase || "unknown");
    host.setAttribute("data-bso-runtime-analyzer", runtimeView.analyzer || "none");
    host.setAttribute("data-bso-inference", String(Boolean(runtimeView.inference)));
    host.setAttribute("data-bso-analysis-state", result && result.state ? result.state : "unknown");
    host.setAttribute("data-bso-player-state", result && result.tracking && result.tracking.state || "unknown");
    host.setAttribute("data-bso-shuttle-state", result && result.shuttle && result.shuttle.state || "unknown");
    host.setAttribute("data-bso-player-count", String(runtimePlayers().filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length));
    host.setAttribute("data-bso-racket-state", runtimeRacketEvidence().state);
    host.setAttribute("data-bso-shuttle-confidence", String(result && result.shuttle && result.shuttle.confidence != null ? result.shuttle.confidence : "unknown"));
    host.setAttribute("data-bso-frame-transport", runtimeView.capabilities && runtimeView.capabilities.frameTransport || "unknown");
    host.setAttribute("data-bso-backend", runtimeView.capabilities && runtimeView.capabilities.backend || "unknown");
    host.setAttribute("data-bso-fallback", fallbackReasons.filter(Boolean).join(",") || "none");
  }
  function publishRuntimeView(view) {
    var previousResult = runtimeView && runtimeView.result;
    var previousStrokesKey = runtimeStrokesKey(strokes);
    runtimeView = view;
    var resultChanged = Boolean(view && view.result !== previousResult);
    if (view && view.result && view.result.cameraCut && !state.cameraCut && (state.seeded || calibration)) {
      state = window.BVState.reduceExtensionState(state, { type: "CAMERA_CUT" });
      calibration = null;
      seedPoints = [];
      clearPanelGesture();
      persist();
      if (!state.labeling) render();
    }
    restoreReviewState();
    var strokesChanged = previousStrokesKey !== runtimeStrokesKey(strokes);
    updateDiagnosticsMarkers();
    var result = view.result;
    var playerCount = result ? runtimePlayers().filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length : null;
    var racketEvidence = runtimeRacketEvidence();
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
        players: runtimePlayers(),
        tracking: result.tracking || null,
        shuttle: result.shuttle || null,
        racket: result.racket || null,
        rackets: Array.isArray(result.rackets) ? result.rackets : [],
        strokeEvents: Array.isArray(result.strokeEvents) ? result.strokeEvents : [],
        rally: result.rally || { state: "unknown" },
        rallyEnd: result.rallyEnd || { state: "unknown" },
        winner: result.winner || { state: "unknown" }
      } : null,
      playerCount: playerCount,
      playerState: result && result.tracking ? result.tracking.state : "unknown",
      shuttleState: result && result.shuttle ? result.shuttle.state : "unknown",
      shuttleConfidence: result && result.shuttle && result.shuttle.confidence != null ? result.shuttle.confidence : null,
      racketSupported: racketEvidence.supported,
      racketState: racketEvidence.state,
      backend: view.capabilities && view.capabilities.backend || null,
      sessionId: runtimeController && runtimeController.sessionId ? runtimeController.sessionId : null
    };
    var key = JSON.stringify([status.phase, status.analyzer, status.inference, status.reason, status.frameTransport, status.backend, status.stale, status.resultKind, status.playerCount, status.playerState, status.shuttleState, status.shuttleConfidence, status.racketSupported, status.racketState]);
    var now = Date.now();
    var statusChanged = key !== publishedRuntimeKey;
    if (hasChrome() && chrome.storage && chrome.storage.local && statusChanged) {
      publishedRuntimeKey = key;
      chrome.storage.local.set({ bvRuntimeStatus: status }, function () { void chrome.runtime.lastError; });
    }
    // Synchronization is driven by every observed video frame, but the
    // design-system DOM only needs a modest refresh cadence for age/time labels.
    // Every newly synchronized result gets one immediate evidence refresh.
    // Age-only frame ticks remain bounded so labels do not rebuild at rVFC rate.
    if (resultChanged || statusChanged || now - lastRuntimeRenderAt >= 250) {
      lastRuntimeRenderAt = now;
      // Runtime/media updates can land between pointerdown and pointerup. Do
      // not replace the manual form under an in-flight user gesture; its
      // controls read the latest clock when invoked and only need the visible
      // timestamp patched in place.
      if (state.labeling) refreshLabelingClock();
      else if (!state.seeding && !refreshRuntimePresentation({ resultChanged: resultChanged, strokesChanged: strokesChanged })) render();
    }
  }
  function runtimeIsStale() { return Boolean(state.stale || runtimeView.stale); }
  function isFixtureRuntime() {
    return Boolean(runtimeView.result && runtimeView.result.kind === "runtime-integration-probe" || runtimeView.analyzer === "fixture-probe-v1");
  }
  function runtimeResult() { return runtimeView && runtimeView.result && typeof runtimeView.result === "object" ? runtimeView.result : null; }
  function runtimeTracking() { var result = runtimeResult(); return result && result.tracking || null; }
  function runtimePlayers() {
    var result = runtimeResult();
    var tracking = runtimeTracking();
    if (tracking && tracking.accepted === false) return [];
    // Older/runtime-compatible envelopes may put the accepted tracks only in
    // tracking.players. Prefer the top-level projection when it is populated,
    // but do not hide real tracks behind an empty compatibility array.
    if (result && Array.isArray(result.players) && result.players.length) return result.players;
    return tracking && Array.isArray(tracking.players)
      ? tracking.players
      : result && Array.isArray(result.players) ? result.players : [];
  }
  function runtimeShuttle() { var result = runtimeResult(); return result && result.shuttle || null; }
  function runtimeRacketEvidence() {
    var result = runtimeResult();
    if (!result) return { supported: false, state: "unavailable", items: [] };
    // Consume only an explicit runtime field. The production composition
    // emits a pose-derived wrist/elbow proxy; expand its hands into drawable
    // evidence without inventing a detector result from keypoints here.
    var fields = ["racket", "rackets", "racketSignal", "racketSignals"];
    var suppliedField = fields.find(function (field) { return Object.prototype.hasOwnProperty.call(result, field); });
    if (!suppliedField) return { supported: false, state: "unavailable", items: [] };
    var supplied = result[suppliedField];
    var suppliedItems = Array.isArray(supplied) ? supplied.filter(Boolean) : supplied ? [supplied] : [];
    var items = [];
    suppliedItems.forEach(function (item) {
      if (item && Array.isArray(item.hands) && item.hands.length) {
        item.hands.forEach(function (hand) {
          if (!hand || typeof hand !== "object") return;
          var expanded = Object.assign({}, hand, { state: hand.state || item.state || "available" });
          if (!expanded.segment && hand.elbow && hand.wrist) expanded.segment = { start: hand.elbow, end: hand.wrist };
          if (!expanded.point && hand.wrist) expanded.point = hand.wrist;
          items.push(expanded);
        });
      } else items.push(item);
    });
    var visible = items.filter(function (item) { return item && typeof item === "object" && item.state !== "unknown"; });
    var stateValue = visible.some(function (item) { return item.state === "tracked" || item.accepted === true; })
      ? "tracked"
      : visible.length ? "available" : "unknown";
    return { supported: true, state: stateValue, items: items };
  }
  function evidenceVisible(name, fallback) {
    return state.trackerSettings && state.trackerSettings[name] != null ? Boolean(state.trackerSettings[name]) : fallback !== false;
  }
  function panelCollapsed(panelId) {
    return Boolean(state.collapsedPanels && state.collapsedPanels[panelId]);
  }
  function togglePanelCollapsed(panelId, value) {
    state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL_COLLAPSE", panel: panelId, videoKey: activeVideoKey || currentVideoKey(), value: value });
    persist();
    render();
  }
  function courtLinesVisible() {
    return window.BVState.courtLinesForVideo(state, activeVideoKey || currentVideoKey());
  }
  function runtimeCaption() {
    if (isFixtureRuntime()) return "fixture result observed · not production CV";
    if (runtimeView.phase === "fallback") return "local production analysis unavailable · playback unaffected";
    var shuttle = runtimeShuttle();
    var shuttleState = shuttle && shuttle.state === "tracked" ? "shuttle candidate tracked" : "shuttle unknown";
    return runtimeView.inference ? "local pose + shuttle runtime · " + shuttleState : "local runtime · awaiting analyzer";
  }
  function runtimeSignalKey() {
    return [runtimePlayers().filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length, evidenceState(runtimeShuttle())].join("\u001f");
  }
  function runtimeSignalNode() {
    var node = ui.el("div", { className: "bv-runtime-signal", role: "status" }, ["players ", ui.badge(String(runtimePlayers().filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length), "info"), " · shuttle ", ui.badge(evidenceState(runtimeShuttle()), evidenceState(runtimeShuttle()) === "tracked" ? "in" : "unknown")]);
    node.setAttribute("data-bso-runtime-signal-key", runtimeSignalKey());
    return node;
  }
  function evidenceState(value) { return value && value.state ? value.state : "unknown"; }
  function imagePointToCourt(point) {
    if (!point || !courtMappingAvailable() || !calibrationApi || typeof calibrationApi.projectImagePoint !== "function") return null;
    try {
      var projected = calibrationApi.projectImagePoint(calibration, { x: Number(point.x), y: Number(point.y) });
      if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) return null;
      return { x: projected.x * 6.1, y: projected.y * 13.4 };
    } catch (_) { return null; }
  }
  function playerCourtPoints() {
    var players = runtimePlayers();
    return players.map(function (player, index) {
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
  function formatDuration(seconds) {
    if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return null;
    var total = Math.round(Number(seconds));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor(total % 3600 / 60);
    var secs = total % 60;
    return hours > 0
      ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
      : minutes + ":" + String(secs).padStart(2, "0");
  }
  // The popup shows the real current tab's video identity. The content script
  // publishes only page-visible metadata (tab title, media duration, channel
  // meta tag) so the popup never falls back to the demo fixture for a real tab.
  var publishedVideoInfoKey = null;
  function currentVideoInfo() {
    if (!video) return null;
    var extracted = window.BSOVideoDiscovery && typeof window.BSOVideoDiscovery.extractVideoMetadata === "function"
      ? window.BSOVideoDiscovery.extractVideoMetadata(document, video, window)
      : null;
    if (extracted) {
      return Object.assign({}, extracted, { duration: formatDuration(extracted.duration) });
    }
    var title = document && document.title ? String(document.title).replace(/\s*-\s*YouTube\s*$/, "").trim() : null;
    var channelNode = document && document.querySelector ? document.querySelector('meta[itemprop="channelName"], meta[name="channelName"]') : null;
    var channel = channelNode && channelNode.getAttribute && channelNode.getAttribute("content") ? channelNode.getAttribute("content").trim() : null;
    return {
      url: window.location && /^https?:/.test(window.location.href) ? window.location.href : null,
      title: title || null,
      channel: channel || null,
      duration: formatDuration(video.duration),
      badmintonDetected: false,
      badmintonDetectionState: "unconfirmed",
      badmintonConfidence: 0,
      badmintonSignals: []
    };
  }
  function publishVideoInfo() {
    if (!hasChrome() || !chrome.storage || !chrome.storage.local) return;
    var info = currentVideoInfo();
    var key = JSON.stringify(info);
    if (key === publishedVideoInfoKey) return;
    publishedVideoInfoKey = key;
    chrome.storage.local.set({ bvVideoInfo: info }, function () { void chrome.runtime.lastError; });
  }
  function updateState(next) { state = window.BVState.initialExtensionState(next); persist(); render(); }
  function currentVideoKey() {
    return window.BVState.videoKeyForUrl(window.location && window.location.href);
  }
  function reviewStrokes() {
    var merged = window.BVReview ? window.BVReview.mergeStrokes(evidenceStrokes(), state.manualLabels) : evidenceStrokes();
    return merged.map(function (stroke) {
      var isFixture = data.strokes.some(function (fixture) { return String(fixture.eventId) === String(stroke.eventId); });
      var hasSavedReview = labelForEvent(stroke.eventId);
      return isFixture && !hasSavedReview ? Object.assign({}, stroke, { fixtureRow: true }) : stroke;
    });
  }
  function restoreReviewState() {
    strokes = reviewStrokes();
    suggestion = isFixtureRuntime() && data.suggestion ? Object.assign({}, data.suggestion) : null;
    if (suggestion && strokes.some(function (stroke) { return String(stroke.eventId) === String(suggestion.eventId); })) suggestion = null;
  }
  function runtimeStrokeKey(stroke) {
    return [stroke && stroke.eventId, stroke && stroke.sequence, stroke && stroke.shot, stroke && stroke.time, stroke && stroke.status, stroke && stroke.source, stroke && stroke.player, stroke && stroke.playerId, stroke && stroke.confidence, stroke && stroke.fixtureRow].map(function (value) { return JSON.stringify(value); }).join("\u001f");
  }
  function runtimeStrokesKey(items) {
    return (Array.isArray(items) ? items : []).map(runtimeStrokeKey).join("\u001e");
  }
  function replaceRuntimeNode(current, next) {
    if (!current || !next || !current.parentNode) return false;
    if (typeof current.replaceWith === "function") {
      current.replaceWith(next);
      return true;
    }
    var parent = current.parentNode;
    if (typeof parent.replaceChild === "function") {
      parent.replaceChild(next, current);
      return true;
    }
    var children = parent.children;
    var index = children && typeof children.indexOf === "function" ? children.indexOf(current) : -1;
    if (index < 0) return false;
    children[index] = next;
    next.parentNode = parent;
    current.parentNode = null;
    return true;
  }
  function replaceRuntimePanelBody(panel, createPanel) {
    if (!panel || typeof createPanel !== "function") return false;
    var body = panel.querySelector && panel.querySelector(".bv-panel-body");
    if (!body) return false;
    var replacement = createPanel();
    var nextBody = replacement && replacement.querySelector && replacement.querySelector(".bv-panel-body");
    if (!nextBody) return false;
    var scrollTop = Number(body.scrollTop) || 0;
    if (!replaceRuntimeNode(body, nextBody)) return false;
    nextBody.scrollTop = scrollTop;
    return replacement;
  }
  function runtimeFeedItem(stroke) {
    var row = ui.strokeFeedItem(stroke, function () { openExistingLabel(stroke); });
    row.setAttribute("data-bso-runtime-row-key", runtimeStrokeKey(stroke));
    return row;
  }
  function refreshRuntimeFeed(panel) {
    if (!panel || !panel.querySelector) return false;
    var feed = panel.querySelector(".bv-feed");
    if (!feed) return false;
    var rows = feed.querySelectorAll ? feed.querySelectorAll("[data-bso-event-id]") : [];
    var byId = Object.create(null);
    Array.prototype.forEach.call(rows, function (row) { byId[row.getAttribute("data-bso-event-id")] = row; });
    var wanted = Object.create(null);
    strokes.forEach(function (stroke) { wanted[String(stroke.eventId)] = true; });
    Array.prototype.forEach.call(rows, function (row) {
      if (wanted[row.getAttribute("data-bso-event-id")]) return;
      if (typeof row.remove === "function") row.remove();
      else if (row.parentNode && typeof row.parentNode.removeChild === "function") row.parentNode.removeChild(row);
    });
    var empty = panel.querySelector(".bv-empty");
    if (strokes.length) {
      if (empty) {
        if (typeof empty.remove === "function") empty.remove();
        else if (empty.parentNode && typeof empty.parentNode.removeChild === "function") empty.parentNode.removeChild(empty);
      }
      strokes.forEach(function (stroke) {
        var id = String(stroke.eventId);
        var row = byId[id];
        var key = runtimeStrokeKey(stroke);
        if (row && row.getAttribute("data-bso-runtime-row-key") !== key) {
          var replacement = runtimeFeedItem(stroke);
          if (!replaceRuntimeNode(row, replacement)) return;
          row = replacement;
        }
        if (!row) row = runtimeFeedItem(stroke);
        row.setAttribute("data-bso-runtime-row-key", key);
        feed.appendChild(row);
      });
    } else if (!empty) {
      feed.appendChild(ui.emptyState("No accepted stroke evidence", "Pose and shuttle signals do not establish a hit, shot family, rally end, or winner. Add a manual label while playback continues.", ui.button("Label current segment", { variant: "ghost", size: "sm", onClick: openLabeling }), "help"));
    }
    return true;
  }
  function refreshRuntimePresentation(options) {
    options = options || {};
    // A synchronized frame is not a structural UI change. Rebuilding the
    // overlay root here used to retire the node that owned a drag, scroll, or
    // focused control every ~250 ms while playback was running. Keep those
    // surfaces alive and patch only frame evidence and runtime-owned text.
    if (!root || !root.querySelector || !state.enabled || state.seeding || state.labeling) return false;
    var overlay = root;
    var evidence = overlay.querySelector(".bv-runtime-evidence");
    if (options.resultChanged) {
      if (!evidence || !replaceRuntimeNode(evidence, runtimeEvidenceDrawing())) return false;
      if (host && typeof host.getBoundingClientRect === "function") {
        var rect = host.getBoundingClientRect();
        resizeOverlayCanvas(rect.width, rect.height);
      }
    }
    overlay.setAttribute("data-bso-overlay-state", runtimeView.phase === "fallback" ? "fallback" : runtimeIsStale() ? "stale" : "live");
    overlay.setAttribute("data-bso-runtime-phase", runtimeView.phase || "unknown");
    overlay.setAttribute("data-bso-analysis-state", runtimeView.result && runtimeView.result.state || "unknown");
    overlay.setAttribute("data-bso-player-state", runtimeView.result && runtimeView.result.tracking && runtimeView.result.tracking.state || "unknown");
    overlay.setAttribute("data-bso-shuttle-state", runtimeView.result && runtimeView.result.shuttle && runtimeView.result.shuttle.state || "unknown");
    overlay.setAttribute("data-bso-court-state", courtDiagnosticState());
    overlay.setAttribute("data-bso-density", state.density);
    var displayTime = state.time;
    if (!displayTime && Number.isFinite(runtimeView.currentMediaTime)) displayTime = formatMediaTime(runtimeView.currentMediaTime);
    overlay.querySelectorAll(".bv-panel-time").forEach(function (node) {
      var suffix = runtimeIsStale() ? " · stale" : "";
      node.textContent = (displayTime || "") + suffix;
      var classes = String(node.className || "").split(/\s+/).filter(Boolean).filter(function (name) { return name !== "stale"; });
      if (runtimeIsStale()) classes.push("stale");
      node.className = classes.join(" ");
    });
    var note = overlay.querySelector(".bv-runtime-note");
    var noteChildren = note && (note.childNodes || note.children);
    if (noteChildren && noteChildren.length) {
      var noteText = Array.prototype.slice.call(noteChildren).find(function (child) { return child.nodeType === 3; });
      if (noteText) noteText.textContent = runtimeCaption();
    }
    if (options.strokesChanged) {
      var feedPanel = overlay.querySelector('[data-bso-panel="feed"]');
      refreshRuntimeFeed(feedPanel);
    }
    var runtimeSignal = overlay.querySelector(".bv-runtime-signal");
    if (runtimeSignal && runtimeSignal.getAttribute("data-bso-runtime-signal-key") !== runtimeSignalKey()) replaceRuntimeNode(runtimeSignal, runtimeSignalNode());
    if (options.resultChanged || options.strokesChanged) {
      // Ensure calibration is available for map panel rendering
      if (!calibration && state.seeded && state.calibration && calibrationApi && typeof calibrationApi.restoreCalibration === "function") {
        try {
          calibration = calibrationApi.restoreCalibration(state.calibration);
        } catch (_) {}
      }
      var statsPanelNode = overlay.querySelector('[data-bso-panel="stats"]');
      if (statsPanelNode) replaceRuntimePanelBody(statsPanelNode, statsPanel);
      var mapPanelNode = overlay.querySelector('[data-bso-panel="map"]');
      if (mapPanelNode) {
        var freshMapPanel = replaceRuntimePanelBody(mapPanelNode, mapPanel);
        if (freshMapPanel) {
          ["data-bso-court-map-state", "data-bso-mapped-player-count", "data-bso-mapped-trajectory-count"].forEach(function (name) {
            var value = freshMapPanel.getAttribute(name);
            if (value != null) mapPanelNode.setAttribute(name, value);
          });
        }
      }
    }
    return true;
  }
  function resetVideoLocalState(reason) {
    persist();
    activeVideoKey = currentVideoKey();
    state = window.BVState.resetVideoLocalState(state, activeVideoKey);
    state.videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : null;
    calibration = null;
    seedPoints = [];
    clearPanelGesture();
    overlayMenuOpen = false;
    editingEventId = null;
    strokes = [];
    suggestion = null;
    draft = newDraft();
    importResult = null;
    persist();
    render();
  }
  function restoreCalibrationState() {
    calibration = null;
    if (state.seeded && state.calibration && calibrationApi && calibrationApi.restoreCalibration) {
      try {
        calibration = calibrationApi.restoreCalibration(state.calibration);
      } catch (error) {
        // Corrupt storage must not become a silently accepted court or wipe
        // unrelated inference/manual state. Court setup is optional, so keep
        // the live session available and expose the repair action in the map.
        state = window.BVState.initialExtensionState(Object.assign({}, state, {
          seeded: false,
          seeding: false,
          calibration: null,
          seedPoints: [],
          seedDraftPoints: [],
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

  function resizeOverlayCanvas(width, height) {
    if (!overlayCanvas) return;
    var cssWidth = Math.max(0, Number(width) || 0);
    var cssHeight = Math.max(0, Number(height) || 0);
    var dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    var pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    var pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (overlayCanvas.width !== pixelWidth) overlayCanvas.width = pixelWidth;
    if (overlayCanvas.height !== pixelHeight) overlayCanvas.height = pixelHeight;
    overlayCanvas.style.width = cssWidth + "px";
    overlayCanvas.style.height = cssHeight + "px";
    var context = typeof overlayCanvas.getContext === "function" ? overlayCanvas.getContext("2d") : null;
    if (!context || !cssWidth || !cssHeight) return;
    if (typeof context.setTransform === "function") context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (typeof context.clearRect !== "function") return;
    context.clearRect(0, 0, cssWidth, cssHeight);
    // Keep a real canvas rendering surface in the sibling layer. The SVG
    // evidence remains the accessible/vector surface; this canvas is reserved
    // for bounded frame-local marks and is deliberately never interactive.
    var shuttle = runtimeShuttle();
    if (shuttle && shuttle.state === "tracked" && shuttle.candidate && shuttle.candidate.accepted === true && normalizedPoint(shuttle.candidate) && typeof context.beginPath === "function" && typeof context.arc === "function" && typeof context.stroke === "function") {
      context.beginPath();
      context.arc(shuttle.candidate.x * cssWidth, shuttle.candidate.y * cssHeight, Math.max(3, Math.min(cssWidth, cssHeight) * .009), 0, Math.PI * 2);
      context.strokeStyle = "rgba(200, 240, 74, .75)";
      context.lineWidth = 1.5;
      context.stroke();
    }
  }

  function positionToVideo() {
    positionFrameHandle = null;
    if (!host || !video || typeof video.getBoundingClientRect !== "function") return;
    var rect = window.BVRuntime && typeof window.BVRuntime.videoContentRect === "function"
      ? window.BVRuntime.videoContentRect(video, window)
      : video.getBoundingClientRect();
    var visible = video.isConnected !== false && rect.width > 0 && rect.height > 0;
    host.style.display = visible ? "block" : "none";
    if (!visible) return;
    host.style.left = rect.left + "px";
    host.style.top = rect.top + "px";
    host.style.width = rect.width + "px";
    host.style.height = rect.height + "px";
    host.style.clipPath = rect.clipped && rect.clipInsets
      ? "inset(" + rect.clipInsets.top + "px " + rect.clipInsets.right + "px " + rect.clipInsets.bottom + "px " + rect.clipInsets.left + "px)"
      : "none";
    host.setAttribute("data-bso-video-geometry", "rendered-content-box");
    resizeOverlayCanvas(rect.width, rect.height);
    refreshPanelLayouts();
  }
  function scheduleVideoPosition() {
    if (positionFrameHandle !== null) return;
    var schedule = window && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : function (callback) { return setTimeout(callback, 0); };
    positionFrameHandle = schedule(function () { positionToVideo(); });
  }
  function isVideoLayoutAncestor(target) {
    if (!video || !target || target === video) return false;
    var ancestor = video.parentNode;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      if (ancestor === target) return true;
      ancestor = ancestor.parentNode;
    }
    return false;
  }
  function mutationNodeContainsVideo(node) {
    return Boolean(node && (node === video || node.matches && node.matches("video") || node.querySelector && node.querySelector("video") || node.contains && video && node.contains(video)));
  }
  function resetVideoResizeObserver() {
    if (videoResizeObserver) videoResizeObserver.disconnect();
    videoResizeObserver = null;
    var ResizeObserverImpl = window.ResizeObserver || (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
    if (video && ResizeObserverImpl) {
      videoResizeObserver = new ResizeObserverImpl(positionToVideo);
      videoResizeObserver.observe(video);
    }
  }
  function attachVideo() {
    var next = document.querySelector("video");
    if (next === video) { positionToVideo(); publishVideoInfo(); return; }
    if (video && next !== video) {
      if (mediaTimeListener) video.removeEventListener("timeupdate", mediaTimeListener);
      if (videoGeometryListener) {
        video.removeEventListener("loadedmetadata", videoGeometryListener);
        video.removeEventListener("resize", videoGeometryListener);
      }
      mediaTimeListener = null;
      videoGeometryListener = null;
      resetVideoResizeObserver();
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
          if (state.labeling) refreshLabelingClock();
        }
        // Duration becomes known once metadata loads; publish only on change.
        publishVideoInfo();
      };
      videoGeometryListener = function () { positionToVideo(); publishVideoInfo(); };
      video.addEventListener("timeupdate", mediaTimeListener);
      video.addEventListener("loadedmetadata", videoGeometryListener);
      video.addEventListener("resize", videoGeometryListener);
    }
    resetVideoResizeObserver();
    positionToVideo();
    publishVideoInfo();
  }

  function stopRuntime(reason) {
    var controller = runtimeController;
    runtimeController = null;
    publishedRuntimeKey = null;
    if (controller && typeof controller.stop === "function") {
      try { controller.stop(); } catch (_) {}
    }
    runtimeView = {
      phase: "idle",
      message: "Local runtime stopped",
      reason: reason || "runtime-stopped",
      analyzer: "none",
      inference: false,
      fallbacks: [],
      capabilities: {},
      result: null,
      currentMediaTime: null,
      ageSeconds: null,
      stale: true
    };
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
  // YouTube's bottom control strip (progress bar, play/pause, volume, settings)
  // overlays the video's bottom edge. Panels reserve this strip so the native
  // player controls stay clickable with the overlay active.
  var PLAYER_CONTROLS_RESERVE = 72;
  var PANEL_LAYOUT_CONSTRAINTS = {
    courtSetup: { minWidth: 280, minHeight: 170, maxWidth: 560, maxHeight: 680, bottomReserve: PLAYER_CONTROLS_RESERVE },
    stats: { minWidth: 220, minHeight: 128, maxWidth: 460, maxHeight: 420, bottomReserve: PLAYER_CONTROLS_RESERVE },
    map: { minWidth: 176, minHeight: 190, maxWidth: 360, maxHeight: 520, bottomReserve: PLAYER_CONTROLS_RESERVE },
    feed: { minWidth: 280, minHeight: 128, maxWidth: 560, maxHeight: 520, bottomReserve: PLAYER_CONTROLS_RESERVE },
    manual: { minWidth: 320, minHeight: 300, maxWidth: 620, maxHeight: 690, bottomReserve: PLAYER_CONTROLS_RESERVE },
    controls: { minWidth: 180, minHeight: 84, maxWidth: 360, maxHeight: 220, bottomReserve: PLAYER_CONTROLS_RESERVE }
  };
  function panelConstraints(panelId) { return PANEL_LAYOUT_CONSTRAINTS[panelId] || {}; }
  function panelMetrics(container, panel) {
    var containerRect = container && typeof container.getBoundingClientRect === "function" ? container.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var panelRect = panel && typeof panel.getBoundingClientRect === "function" ? panel.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    return {
      viewport: { width: Math.max(0, Number(containerRect.width) || 0), height: Math.max(0, Number(containerRect.height) || 0) },
      rendered: {
        left: (Number(panelRect.left) || 0) - (Number(containerRect.left) || 0),
        top: (Number(panelRect.top) || 0) - (Number(containerRect.top) || 0),
        width: Math.max(0, Number(panelRect.width) || 0),
        height: Math.max(0, Number(panelRect.height) || 0)
      }
    };
  }
  function panelContainer(panel) { return panel && panel.parentNode ? panel.parentNode : root; }
  function panelLayoutFor(panelId, container, panel) {
    var metrics = panelMetrics(container, panel);
    // A collapsed panel is a header-only bar. Keep its drag/saved geometry at
    // a usable size so moving it cannot shrink the expanded panel later.
    if (panel && panel.getAttribute && panel.getAttribute("data-bso-panel-collapsed") === "true") {
      var collapsedConstraints = panelConstraints(panelId);
      if (collapsedConstraints.minHeight) metrics.rendered.height = Math.max(metrics.rendered.height, collapsedConstraints.minHeight);
      if (collapsedConstraints.minWidth) metrics.rendered.width = Math.max(metrics.rendered.width, collapsedConstraints.minWidth);
    }
    return { layout: state.panelLayouts && state.panelLayouts[panelId] || null, viewport: metrics.viewport, rendered: metrics.rendered };
  }
  function applyPanelLayout(container, panel, panelId, layout) {
    if (!panel || !panelLayoutApi || typeof panelLayoutApi.pixelPanelLayout !== "function") return null;
    var metrics = panelMetrics(container, panel);
    // Resolve the CSS default once into the same bounded pixel contract used
    // by saved layouts. This keeps a newly rendered panel inside the video on
    // small players without persisting a viewport-specific default.
    var collapsed = panel.getAttribute && panel.getAttribute("data-bso-panel-collapsed") === "true";
    if (collapsed) metrics.rendered.height = 32;
    var result = panelLayoutApi.pixelPanelLayout(layout, metrics.viewport, metrics.rendered, panelConstraints(panelId));
    panel.style.left = result.left + "px"; panel.style.top = result.top + "px";
    panel.style.right = "auto"; panel.style.bottom = "auto";
    panel.style.width = result.width + "px";
    // A collapsed panel keeps only its header bar; height is governed by the
    // header so the panel cannot re-cover the video while collapsed.
    panel.style.height = collapsed ? "auto" : result.height + "px";
    panel.style.transform = "none";
    panel.setAttribute("data-bso-panel-bounds", "clamped");
    return result;
  }
  function refreshPanelLayouts() {
    if (!root || !root.querySelectorAll || !panelLayoutApi) return;
    root.querySelectorAll("[data-bso-panel-layout]").forEach(function (panel) {
      var panelId = panel.getAttribute("data-bso-panel");
      if (panelId) applyPanelLayout(panelContainer(panel), panel, panelId, state.panelLayouts && state.panelLayouts[panelId]);
    });
  }
  function storePanelLayout(panelId, layout) {
    state = window.BVState.reduceExtensionState(state, { type: "SET_PANEL_LAYOUT", panel: panelId, videoKey: activeVideoKey || currentVideoKey(), layout: layout });
    persist();
  }
  function panelEventId(event) { return event && event.pointerId == null ? 0 : event && event.pointerId; }
  function eventHasInteractiveAncestor(target, boundary) {
    var node = target;
    while (node && node !== boundary) {
      if (isInteractiveTarget(node) || node.className && String(node.className).split(/\s+/).indexOf("bv-panel-actions") >= 0) return true;
      node = node.parentNode;
    }
    return false;
  }
  function setPanelGestureState(gesture, active) {
    if (!gesture) return;
    if (gesture.surface && gesture.surface.setAttribute) gesture.surface.setAttribute("aria-grabbed", active ? "true" : "false");
    if (gesture.panel && gesture.panel.classList) gesture.panel.classList.toggle("is-dragging", active);
  }
  function clearPanelGesture() {
    var gesture = panelGesture;
    if (!gesture) return;
    try {
      if (gesture.surface && gesture.surface.releasePointerCapture && gesture.surface.hasPointerCapture && gesture.surface.hasPointerCapture(gesture.pointerId)) gesture.surface.releasePointerCapture(gesture.pointerId);
    } catch (_) {}
    setPanelGestureState(gesture, false);
    panelGesture = null;
  }
  function panelPointerMove(event) {
    var gesture = panelGesture;
    if (!gesture || panelEventId(event) !== gesture.pointerId || !panelLayoutApi) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    var delta = { x: (Number(event.clientX) || 0) - gesture.clientX, y: (Number(event.clientY) || 0) - gesture.clientY };
    var next = gesture.kind === "resize"
      ? panelLayoutApi.resizePanelLayout(gesture.layout, delta, gesture.viewport, gesture.rendered, panelConstraints(gesture.panelId))
      : panelLayoutApi.movePanelLayout(gesture.layout, delta, gesture.viewport, gesture.rendered, panelConstraints(gesture.panelId));
    applyPanelLayout(gesture.container, gesture.panel, gesture.panelId, next);
    gesture.current = next;
  }
  function finishPanelGesture(event, cancelled) {
    var gesture = panelGesture;
    if (!gesture || panelEventId(event) !== gesture.pointerId) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    clearPanelGesture();
    if (!cancelled && gesture.current) storePanelLayout(gesture.panelId, gesture.current);
  }
  function beginPanelGesture(event, container, panel, panelId, surface, kind) {
    if (event.button != null && event.button !== 0) return;
    if (kind === "move" && eventHasInteractiveAncestor(event.target, surface)) return;
    if (panelGesture) finishPanelGesture({ pointerId: panelGesture.pointerId, preventDefault: function () {}, stopPropagation: function () {} }, true);
    var current = panelLayoutFor(panelId, container, panel);
    var layout = current.layout || {
      x: current.viewport.width ? current.rendered.left / current.viewport.width : 0,
      y: current.viewport.height ? current.rendered.top / current.viewport.height : 0,
      width: current.viewport.width ? current.rendered.width / current.viewport.width : 0,
      height: current.viewport.height ? current.rendered.height / current.viewport.height : 0
    };
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    panelGesture = { pointerId: panelEventId(event), clientX: Number(event.clientX) || 0, clientY: Number(event.clientY) || 0, panelId: panelId, panel: panel, container: container, surface: surface, kind: kind, layout: layout, current: layout, viewport: current.viewport, rendered: current.rendered };
    setPanelGestureState(panelGesture, true);
    if (surface.setPointerCapture) surface.setPointerCapture(panelGesture.pointerId);
  }
  function resetPanelLayout(panelId, keepPosition) {
    var current = state.panelLayouts && state.panelLayouts[panelId] || null;
    var next = keepPosition && current ? { x: current.x, y: current.y } : null;
    storePanelLayout(panelId, next); render();
    setTimeout(function () {
      var panel = root && root.querySelector && root.querySelector('[data-bso-panel="' + panelId + '"]');
      var focusTarget = panel && panel.querySelector && panel.querySelector("[data-bso-panel-drag-handle]");
      if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
    }, 0);
  }
  function keyboardPanelInteraction(event, container, panel, panelId, surface, kind) {
    // The resize surface is an intentional button, so its own key events must
    // remain available even though descendant controls are excluded from drag
    // handling on ordinary headers.
    if (event.target !== surface && eventHasInteractiveAncestor(event.target, surface)) return;
    var key = event.key;
    if (key !== "Home" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(key) < 0) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    if (key === "Home") { resetPanelLayout(panelId, kind === "resize"); return; }
    var current = panelLayoutFor(panelId, container, panel);
    var layout = current.layout || {
      x: current.viewport.width ? current.rendered.left / current.viewport.width : 0,
      y: current.viewport.height ? current.rendered.top / current.viewport.height : 0,
      width: current.viewport.width ? current.rendered.width / current.viewport.width : 0,
      height: current.viewport.height ? current.rendered.height / current.viewport.height : 0
    };
    if (!panelLayoutApi) return;
    var next = kind === "resize"
      ? panelLayoutApi.nudgePanelSize(layout, key, current.viewport, current.rendered, panelConstraints(panelId))
      : panelLayoutApi.nudgePanelLayout(layout, key, current.viewport, current.rendered, panelConstraints(panelId));
    applyPanelLayout(container, panel, panelId, next); storePanelLayout(panelId, next);
  }
  function installPanelInteractions(container, panel, panelId) {
    var header = panel && panel.querySelector && panel.querySelector("[data-bso-panel-drag-handle]");
    var resize = panel && panel.querySelector && panel.querySelector("[data-bso-panel-resize-handle]");
    if (!header) return;
    header.addEventListener("pointerdown", function (event) { beginPanelGesture(event, container, panel, panelId, header, "move"); });
    header.addEventListener("pointermove", panelPointerMove); header.addEventListener("pointerup", function (event) { finishPanelGesture(event, false); }); header.addEventListener("pointercancel", function (event) { finishPanelGesture(event, true); });
    header.addEventListener("keydown", function (event) { keyboardPanelInteraction(event, container, panel, panelId, header, "move"); });
    if (resize) {
      resize.addEventListener("pointerdown", function (event) { beginPanelGesture(event, container, panel, panelId, resize, "resize"); });
      resize.addEventListener("pointermove", panelPointerMove); resize.addEventListener("pointerup", function (event) { finishPanelGesture(event, false); }); resize.addEventListener("pointercancel", function (event) { finishPanelGesture(event, true); });
      resize.addEventListener("keydown", function (event) { keyboardPanelInteraction(event, container, panel, panelId, resize, "resize"); });
    }
  }
  function installPanelInteractionsInRoot() {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("[data-bso-panel-layout]").forEach(function (panel) {
      var panelId = panel.getAttribute("data-bso-panel");
      if (panelId) installPanelInteractions(panelContainer(panel), panel, panelId);
    });
  }
  function resetSeedCardPosition() { resetPanelLayout("courtSetup", false); }
  function protectSeedCardFromCornerClicks(card) {
    // The card is above the seed layer. Keep card controls/gestures from
    // bubbling into the layer's deliberate target===layer click contract.
    card.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    card.addEventListener("pointermove", function (event) { event.stopPropagation(); });
    card.addEventListener("pointerup", function (event) { event.stopPropagation(); });
    card.addEventListener("click", function (event) { event.stopPropagation(); });
  }
  function seedDrawing(points, fittedCalibration) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bv-seed-drawing"); svg.setAttribute("viewBox", "0 0 1 1"); svg.setAttribute("preserveAspectRatio", "none");
    function add(tag, attrs) { var node = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); }); svg.appendChild(node); }
    if (points.length > 1) add("polyline", { points: points.map(function (item) { return item.x + "," + item.y; }).join(" ") + (points.length === 4 ? " " + points[0].x + "," + points[0].y : ""), fill: "none", stroke: "var(--court-setup-line)", "stroke-width": ".3", "vector-effect": "non-scaling-stroke" });
    if (fittedCalibration && Array.isArray(fittedCalibration.lines)) {
      fittedCalibration.lines.forEach(function (line) {
        var attrs = {
          x1: line.start.x, y1: line.start.y, x2: line.end.x, y2: line.end.y,
          // The setup projection uses the bright lime highlight so the drawn
          // court reads clearly against live footage; it stays distinct from
          // the muted diagram tokens used by the court map panel.
          stroke: line.role === "net" ? "var(--court-setup-net)" : "var(--court-setup-line)",
          "stroke-width": line.role === "net" ? ".35" : line.boundary ? ".3" : ".2",
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
  var SKELETON_EDGES = [
    ["nose", "neck"], ["nose", "left_eye"], ["nose", "right_eye"], ["left_eye", "left_ear"], ["right_eye", "right_ear"],
    ["neck", "left_shoulder"], ["neck", "right_shoulder"], ["left_shoulder", "right_shoulder"],
    ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"], ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
    ["neck", "left_hip"], ["neck", "right_hip"], ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"], ["left_hip", "right_hip"],
    ["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"]
  ];
  function normalizedPoint(point) {
    return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && Number(point.x) >= 0 && Number(point.x) <= 1 && Number(point.y) >= 0 && Number(point.y) <= 1;
  }
  function runtimeEvidenceDrawing() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bv-runtime-evidence");
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", "Live local player, racket, and shuttle evidence");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("pointer-events", "none");
    svg.setAttribute("data-bso-production-evidence", String(!isFixtureRuntime()));
    svg.style.pointerEvents = "none";
    function add(tag, attrs) {
      var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
      node.setAttribute("pointer-events", "none");
      svg.appendChild(node);
      return node;
    }
    runtimePlayers().forEach(function (player, index) {
      if (!player || player.state === "unknown") return;
      var trackId = player.trackId || "unknown-track";
      var side = index % 2 ? "b" : "a";
      var pointsByName = Object.create(null);
      (Array.isArray(player.keypoints) ? player.keypoints : []).forEach(function (point) {
        if (normalizedPoint(point) && point.name) pointsByName[String(point.name).toLowerCase().replace(/-/g, "_")] = point;
      });
      if (evidenceVisible("body", true)) {
        SKELETON_EDGES.forEach(function (edge) {
          var start = pointsByName[edge[0]];
          var end = pointsByName[edge[1]];
          if (!start || !end) return;
          add("line", {
            x1: start.x, y1: start.y, x2: end.x, y2: end.y,
            class: "bv-pose-bone " + side,
            "data-track-id": trackId,
            "data-keypoints": edge.join("|")
          });
        });
        Object.keys(pointsByName).forEach(function (name) {
          var point = pointsByName[name];
          add("circle", {
            cx: point.x, cy: point.y, r: ".0065",
            class: "bv-pose-keypoint " + side,
            "data-track-id": trackId,
            "data-keypoint": name,
            "data-keypoint-confidence": point.confidence == null ? "unknown" : point.confidence
          });
        });
      }
      // Never synthesize a box from keypoints. A rect appears only when the
      // selected runtime player explicitly supplies a normalized bbox.
      if (evidenceVisible("players", true) && player.bbox && normalizedPoint(player.bbox) && Number(player.bbox.width) > 0 && Number(player.bbox.height) > 0) {
        add("rect", {
          x: player.bbox.x, y: player.bbox.y, width: player.bbox.width, height: player.bbox.height,
          class: "bv-player-box " + side,
          "stroke-dasharray": player.state === "partial" ? "6 5" : "none",
          "data-track-id": trackId,
          "data-player-state": player.state,
          "data-box-source": "runtime"
        });
      }
    });
    var racket = runtimeRacketEvidence();
    if (evidenceVisible("racket", false) && racket.supported) {
      racket.items.forEach(function (item, index) {
        if (!item || item.state === "unknown") return;
        var segment = item.segment || item.line;
        if (segment && normalizedPoint(segment.start) && normalizedPoint(segment.end)) {
          add("line", { x1: segment.start.x, y1: segment.start.y, x2: segment.end.x, y2: segment.end.y, class: "bv-racket-signal", "data-racket-index": index, "data-racket-state": item.state || "available" });
        }
        if (Array.isArray(item.points) && item.points.length > 1 && item.points.every(normalizedPoint)) {
          add("polyline", { points: item.points.map(function (point) { return point.x + "," + point.y; }).join(" "), class: "bv-racket-signal", "data-racket-index": index, "data-racket-state": item.state || "available" });
        }
        if (item.bbox && normalizedPoint(item.bbox) && Number(item.bbox.width) > 0 && Number(item.bbox.height) > 0) {
          add("rect", { x: item.bbox.x, y: item.bbox.y, width: item.bbox.width, height: item.bbox.height, class: "bv-racket-box", "data-racket-index": index, "data-racket-state": item.state || "available", "data-box-source": "runtime" });
        }
        if (normalizedPoint(item)) add("circle", { cx: item.x, cy: item.y, r: ".007", class: "bv-racket-point", "data-racket-index": index, "data-racket-state": item.state || "available" });
      });
    }
    var shuttle = runtimeShuttle();
    if (evidenceVisible("shuttle", true) && shuttle && Array.isArray(shuttle.trajectory)) {
      var trajectory = shuttle.trajectory.filter(normalizedPoint);
      if (trajectory.length > 1) add("polyline", { points: trajectory.map(function (point) { return point.x + "," + point.y; }).join(" "), class: "bv-shuttle-trajectory", "data-shuttle-state": shuttle.state || "unknown" });
    }
    if (evidenceVisible("shuttle", true) && shuttle && shuttle.state === "tracked" && shuttle.accepted === true && shuttle.candidate && shuttle.candidate.accepted === true && normalizedPoint(shuttle.candidate)) {
      add("circle", { cx: shuttle.candidate.x, cy: shuttle.candidate.y, r: ".009", class: "bv-shuttle-point", "data-shuttle-state": "tracked", "data-candidate-source": "runtime" });
    }
    return svg;
  }
  function startCourtSetup() {
    state = window.BVState.reduceExtensionState(state, { type: "START_SEED" });
    state.videoKey = activeVideoKey || currentVideoKey();
    panelGesture = null;
    seedPoints = [];
    calibration = null;
    persist();
    render();
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
    clearPanelGesture();
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
    // Court setup is optional. Cancelling first-use setup must leave the live
    // inference overlay running, just as cancelling a recalibration restores
    // the prior mapping without touching raw detections.
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
    // The seed layer keeps full-click capture only above the native player
    // control strip: the strip itself passes pointer events through so pause,
    // seek, the time bar, and settings stay reachable during setup. On small
    // players the near-corner guide markers would fall inside the strip, so
    // they are clamped above the reserve where they stay clickable.
    var layerHeight = host && typeof host.getBoundingClientRect === "function" ? Number(host.getBoundingClientRect().height) || 0 : 0;
    var maxGuideY = layerHeight > 0 ? 1 - (PLAYER_CONTROLS_RESERVE + 24) / layerHeight : 1;
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
    if (seedPoints.length < 4) {
      var guide = targets[seedPoints.length];
      layer.appendChild(ui.el("span", { className: "bv-seed-target", "data-bso-seed-guide": String(seedPoints.length), style: { left: guide.x + "%", top: Math.min(guide.y / 100, Math.max(0, maxGuideY)) * 100 + "%" } }));
    }
    seedPoints.forEach(function (point, index) { layer.appendChild(ui.el("span", { className: "bv-seed-point", style: seedPointStyle(point) }, [index + 1])); });
    var card = ui.el("section", { className: "bv-seed-card bv-panel-layout", role: "group", "aria-label": "Court setup instructions", "data-bso-seed-card": "true", "data-bso-contrast": "high", "data-bso-panel": "courtSetup", "data-bso-panel-layout": "true", "data-bso-panel-resizable": "true" });
    var title = fitted ? "Court ready to lock" : invalid ? "Court needs correction" : "Click the " + corners[seedPoints.length].toLowerCase() + " outer corner";
    var help = ui.el("span", { className: "bv-sr-only", id: "bv-seed-card-help" }, ["Use the court setup header to move the instructions inside the video. Use the arrow keys to nudge it. Press Home to reset the position."]);
    // The whole header is the drag surface. It has no visible grip or drag
    // copy, keeping the four corner targets unobstructed while retaining an
    // explicit keyboard and native-tooltip affordance for assistive users.
    var handle = ui.el("header", { className: "bv-seed-card-top bv-panel-header", tabindex: "0", role: "group", "aria-label": "Move court setup instructions", "aria-describedby": "bv-seed-card-help", "aria-grabbed": "false", "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home", title: "Move court setup instructions. Use arrow keys to nudge. Home resets the position.", "data-bso-seed-card-handle": "true", "data-bso-panel-drag-handle": "true" }, [ui.stepDots(Math.min(seedPoints.length, 4), corners), ui.el("span", { className: "bv-seed-card-title" }, [title]), fitted ? ui.badge("homography ok", "in") : invalid ? ui.badge("not accepted", "warn") : null, ui.el("span", { className: "bv-seed-card-actions" }, [ui.button("Reset position", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); resetSeedCardPosition(); } }), ui.button("Undo", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0, onClick: function (event) { event.stopPropagation(); undoSeedPoint(); } }), ui.button("Reset court", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0 && !state.seeded, onClick: function (event) { event.stopPropagation(); resetSeed(); } }), ui.button("Skip to manual", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); openLabeling(); } }), ui.button("Lock court", { variant: "primary", size: "sm", disabled: !fitted, onClick: function (event) { event.stopPropagation(); lockSeed(); } })])]);
    handle.appendChild(help);
    card.appendChild(handle);
    if (state.calibrationError) card.appendChild(ui.callout("warn", "Calibration not accepted", state.calibrationError));
    card.appendChild(ui.el("p", {}, ["Your four clicks are the outer doubles corners only. Service lines, centre lines and the net come from the official 13.40 × 6.10 m court and are projected in — they never adapt to the image."]));
    card.appendChild(ui.el("div", { className: "bv-seed-note" }, [ui.icon("info", 13), ui.el("span", {}, ["Playback keeps running. A camera cut past tolerance pauses analysis, not the video."]), ui.button("Cancel", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); cancelSeeding(); } })]));
    card.appendChild(ui.el("button", { className: "bv-panel-resize-handle", type: "button", "aria-label": "Resize court setup panel", "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home", title: "Drag to resize. Use arrow keys for precise sizing; Home resets the size.", "data-bso-panel-resize-handle": "true" }, [ui.icon("grip", 12)]));
    layer.appendChild(card);
    applyPanelLayout(layer, card, "courtSetup", state.panelLayouts && state.panelLayouts.courtSetup);
    protectSeedCardFromCornerClicks(card);
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

  // The saved manual label dataset is the honest source for rally-level
  // statistics until a CV backend supplies real evidence. It reuses the same
  // analysis core as the summary/CSV path, so the panels and the export never
  // disagree about serve counts, rally duration, or shot mix.
  function manualSummary() {
    if (!state.manualLabels || !state.manualLabels.length || !window.BVAnalysis) return null;
    var videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : data.video.url;
    var options = { videoUrl: videoUrl };
    var key = activeVideoKey || state.videoKey;
    if (key) options.videoKey = key;
    return window.BVAnalysis.calculateManualDatasetSummary(state.manualLabels, options);
  }
  function statsPanel() {
    var result = runtimeResult();
    var tracking = runtimeTracking();
    var shuttle = runtimeShuttle();
    var manual = manualSummary();
    var manualCount = manual ? manual.totalLabels : 0;
    // A production CV result with strokes or a known rally state is preferred
    // over the manual dataset. Fixture rows are explicitly not production CV,
    // so they never mask the honest manual statistics.
    var cvEvidence = !isFixtureRuntime() && Boolean(result) && (Array.isArray(result.strokeEvents) && result.strokeEvents.length > 0 || result.rally && result.rally.state !== "unknown");
    var rally = result && result.rally && result.rally.state !== "unknown" ? result.rally.id || state.rally : "unknown";
    var shotCount = strokes.length || "unknown";
    var duration = null;
    if (cvEvidence && result.rally) {
      var rallyStart = result.rally.start_media_time != null ? result.rally.start_media_time : result.rally.startSec;
      var rallyEnd = result.rally.end_media_time != null ? result.rally.end_media_time : result.rally.endSec;
      if (Number.isFinite(Number(rallyStart)) && Number.isFinite(Number(rallyEnd)) && Number(rallyEnd) >= Number(rallyStart)) duration = Number(rallyEnd) - Number(rallyStart);
    }
    if (duration == null && manual && manual.durationSec != null) duration = manual.durationSec;
    var statsSource = cvEvidence ? "cv" : manualCount ? "manual" : "none";
    var sourceLabel = statsSource === "cv" ? "live evidence" : statsSource === "manual" ? "manual labels" : "no evidence";
    var sourceNote = statsSource === "cv" ? "real evidence preferred · manual labels kept as seed" : statsSource === "manual" ? "statistics derived from saved manual labels only" : "no CV evidence and no saved labels";
    var children = [
      ui.el("div", { className: "bv-stat-grid" }, [ui.stat("Rally", rally), ui.stat("Shots", shotCount), ui.stat("Length", duration == null ? "unknown" : duration.toFixed(1), duration == null ? null : "s")]),
      ui.el("div", { className: "bv-evidence-grid" }, [ui.el("span", {}, ["Players", ui.badge(evidenceState(tracking), evidenceState(tracking) === "tracked" ? "in" : "unknown")]), ui.el("span", {}, ["Shuttle", ui.badge(evidenceState(shuttle), evidenceState(shuttle) === "tracked" ? "in" : "unknown")]), ui.el("span", {}, ["Winner", ui.badge(result && result.winner ? evidenceState(result.winner) : "unknown", "unknown")])]),
      ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", margin: "var(--sp-5) 0" } }, [ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-12)", color: "var(--text-muted)" } }, ["score unknown"]), ui.badge("score OCR unavailable", "warn")]),
      ui.el("div", { className: "bv-stats-source", "data-bso-stats-source": statsSource }, [ui.badge(sourceLabel, statsSource === "cv" ? "in" : statsSource === "manual" ? "info" : "unknown"), ui.el("span", { className: "bv-muted", style: { fontSize: "var(--fs-11)" } }, [sourceNote])]),
      ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-5)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-hairline)" } }, [ui.el("span", { className: "bv-muted", style: { fontSize: "var(--fs-11)" } }, ["Rally end"]), ui.badge(result && result.rallyEnd ? evidenceState(result.rallyEnd) : "unknown", "unknown"), ui.confidence(null, { showWord: true })])
    ];
    if (manualCount) {
      var segments = Object.keys(manual.shotLabelCounts).map(function (label) {
        return { label: label, value: manual.shotLabelCounts[label], color: label === "Clear" ? "var(--player-a)" : label === "Smash" ? "var(--lime-500)" : "#2f8f77" };
      });
      if (manual.unclassifiedCount) segments.push({ label: "Unclassified", value: manual.unclassifiedCount, color: "var(--signal-unknown)" });
      children.push(ui.el("div", { className: "bv-manual-stats", "data-bso-manual-stats": String(manualCount) }, [
        ui.el("div", { className: "bv-stat-grid" }, [ui.stat("Serves", manual.shotLabelCounts.Serve || 0), ui.stat("Labels", manualCount)]),
        ui.mixBar(segments)
      ]));
    }
    return ui.panel("Stats", { layoutId: "stats", icon: "activity", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", collapsed: panelCollapsed("stats"), onToggleCollapse: function (value) { togglePanelCollapsed("stats", value); }, actions: [ui.iconButton("x", "Hide stats", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "stats", value: false }); persist(); render(); } })] }, children);
  }
  function mapPanel() {
    // Ensure calibration is restored from state before checking availability
    if (!calibration && state.seeded && state.calibration && calibrationApi && typeof calibrationApi.restoreCalibration === "function") {
      try {
        calibration = calibrationApi.restoreCalibration(state.calibration);
      } catch (_) {
        // If restoration fails, fall back to using state.calibration directly for mapping checks
      }
    }
    var configuration = courtConfigurationState();
    var mapped = calibration && !state.seeding;
    // Mapping is the only consumer that depends on calibration. Keep the
    // canonical diagram useful before setup, but never pass raw image
    // detections into court-relative rendering until a committed fit exists.
    var players = mapped ? playerCourtPoints() : [];
    var trajectory = mapped ? shuttleCourtTrajectory() : [];
    var landing = mapped ? shuttleCourtCandidate() : null;
    var shuttle = runtimeShuttle();
    var shuttleState = evidenceState(shuttle);
    var mapState = mapped ? "calibrated" : configuration === "recalibrating" ? "recalibrating" : configuration === "setup" ? "setup" : "uncalibrated";
    var mapNote = mapState === "uncalibrated"
      ? "Set up the court to project live coordinates."
      : mapState === "recalibrating"
        ? "Finish setup to replace the previous court mapping."
        : shuttleState === "tracked" && landing ? "Candidate shown; line call remains unknown." : "No accepted shuttle landing evidence.";
    var setupAction = ui.button(mapState === "calibrated" ? "Recalibrate court" : "Set up court", {
      variant: mapState === "calibrated" ? "ghost" : "primary",
      size: "sm",
      icon: "crosshair",
      disabled: mapState === "recalibrating",
      title: mapState === "calibrated" ? "Replace the saved court mapping" : "Set up the court before using mapped coordinates",
      onClick: startCourtSetup
    });
    setupAction.setAttribute("data-bso-court-map-action", mapState === "calibrated" ? "recalibrate" : "setup");
    var panel = ui.panel("Court map", { layoutId: "map", icon: "crosshair", mediaTime: state.time, className: "bv-court-panel bv-overlay-map", bodyStyle: { padding: "10px" }, collapsed: panelCollapsed("map"), onToggleCollapse: function (value) { togglePanelCollapsed("map", value); }, actions: [ui.iconButton("x", "Hide court map", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "map", value: false }); persist(); render(); } })] }, [
      ui.el("div", { className: "bv-court-map-status", "data-bso-court-map-state": mapState }, [
        ui.badge(mapState === "calibrated" ? "CALIBRATED" : mapState === "recalibrating" ? "RECALIBRATING" : "NOT SET UP", mapState === "calibrated" ? "in" : "warn"),
        ui.el("span", { className: "bv-mono" }, [mapNote]),
        setupAction
      ]),
      ui.courtDiagram({ renderWidth: 154, players: players, trajectory: trajectory, landing: landing, call: "UNKNOWN", ariaLabel: mapState === "calibrated" ? "Calibrated court map; unknown values are not inferred" : "Canonical court map; set up the court to project live coordinates" }),
      ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-4)" } }, [ui.badge(mapped && shuttleState === "tracked" ? "candidate" : "UNKNOWN", mapped && shuttleState === "tracked" ? "info" : "unknown"), ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-10)", color: "var(--text-faint)" } }, [mapNote])]),
      ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.confidence(null, { label: "geo", showWord: true })])
    ]);
    panel.setAttribute("data-bso-court-map-state", mapState);
    panel.setAttribute("data-bso-mapped-player-count", String(players.length));
    panel.setAttribute("data-bso-mapped-trajectory-count", String(trajectory.length));
    return panel;
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
    strokes.forEach(function (stroke) { rows.appendChild(runtimeFeedItem(stroke)); });
    if (!strokes.length) rows.appendChild(ui.emptyState("No accepted stroke evidence", "Pose and shuttle signals do not establish a hit, shot family, rally end, or winner. Add a manual label while playback continues.", ui.button("Label current segment", { variant: "ghost", size: "sm", onClick: openLabeling }), "help"));
    var children = [];
    if (state.lastEdit) children.push(ui.el("div", { className: "bv-review-undo", role: "status" }, [ui.el("span", {}, [(state.lastEdit.source === "manual" ? "Saved manual label at " : "Saved review suggestion at ") + (state.lastEdit.time || "the current timestamp") + "."]), ui.button("Undo", { variant: "ghost", size: "sm", onClick: undoLastEdit })]));
    children.push(rows);
    if (suggestion) children.push(ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.suggestionRow(suggestion, acceptSuggestion, function () { openLabeling(); })]));
    var footerLabel = isFixtureRuntime() ? "rally 13 · index 74" : "rally unknown · index unavailable";
    var footer = ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.badge(footerLabel, isFixtureRuntime() ? "accent" : "unknown", false), ui.el("span", { className: "bv-runtime-footnote" }, [isFixtureRuntime() ? "fixture result · not production CV" : "automatic event evidence unknown"]), ui.button("Older rallies", { variant: "ghost", size: "sm", iconRight: "chevron-right", style: { marginLeft: "auto" }, onClick: openSummary })]);
    return ui.panel("Stroke feed", { layoutId: "feed", icon: "list", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", bodyStyle: { padding: "6px" }, footer: footer, collapsed: panelCollapsed("feed"), onToggleCollapse: function (value) { togglePanelCollapsed("feed", value); }, actions: [ui.iconButton("pencil", "Open manual labeling (O)", { size: "sm", onClick: openLabeling }), ui.iconButton("x", "Hide stroke feed", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "feed", value: false }); persist(); render(); } })] }, children);
  }
  function controlsPanel() {
    return ui.panel("Live controls", { layoutId: "controls", className: "bv-controls-panel", bodyStyle: { display: "flex", gap: "var(--sp-3)" }, collapsed: panelCollapsed("controls"), onToggleCollapse: function (value) { togglePanelCollapsed("controls", value); } }, [
      ui.button("Density: " + state.density, { size: "sm", icon: "sliders", onClick: cycleDensity }),
      ui.button("Summary", { size: "sm", icon: "table", onClick: openSummary })
    ]);
  }
  function overlayPanelShortcut(label, panel, icon, description) {
    var button = ui.button(label, {
      variant: state.panels[panel] ? "secondary" : "ghost",
      size: "sm",
      icon: icon,
      pressed: state.panels[panel],
      title: description || "Show " + label.toLowerCase() + " on the video",
      onClick: function () {
        state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: panel, value: true });
        overlayMenuOpen = false;
        persist();
        render();
      }
    });
    button.setAttribute("data-bso-overlay-shortcut", panel);
    return button;
  }
  function overlayAccessPoint() {
    var access = ui.el("div", { className: "bv-overlay-access" });
    var button = ui.button("Panels", {
      variant: "ghost",
      size: "sm",
      icon: overlayMenuOpen ? "x" : "layout",
      pressed: overlayMenuOpen,
      title: overlayMenuOpen ? "Close overlay shortcuts" : "Open overlay shortcuts",
      onClick: function () { overlayMenuOpen = !overlayMenuOpen; render(); }
    });
    button.setAttribute("aria-expanded", String(overlayMenuOpen));
    button.setAttribute("aria-controls", "bv-overlay-shortcuts");
    button.setAttribute("data-bso-overlay-access", "true");
    access.appendChild(button);
    var manualShortcut = ui.button("Label it myself", { variant: "ghost", size: "sm", icon: "pencil", onClick: function () { overlayMenuOpen = false; openLabeling(); } });
    manualShortcut.setAttribute("data-bso-overlay-shortcut", "manual");
    var menu = ui.el("div", {
      className: "bv-overlay-menu",
      id: "bv-overlay-shortcuts",
      role: "menu",
      "aria-label": "Overlay shortcuts",
      "data-bso-overlay-menu": "true",
      hidden: !overlayMenuOpen
    }, [
      ui.el("strong", { className: "bv-overlay-menu-title" }, ["Overlay shortcuts"]),
      ui.el("span", { className: "bv-overlay-menu-help" }, ["Choose what to open over the video."]),
      overlayPanelShortcut("Shots this rally", "feed", "list", "Show the live stroke feed"),
      overlayPanelShortcut("Rally stats", "stats", "activity", "Show rally statistics"),
      overlayPanelShortcut("Court map", "map", "crosshair", "Show the court map"),
      overlayPanelShortcut("Live controls", "controls", "sliders", "Show density and summary shortcuts"),
      manualShortcut,
      ui.button("Density: " + state.density, { variant: "ghost", size: "sm", icon: "sliders", onClick: cycleDensity }),
      ui.button("Summary", { variant: "ghost", size: "sm", icon: "table", onClick: openSummary })
    ]);
    access.appendChild(menu);
    return access;
  }
  function liveOverlay() {
    var overlay = ui.el("div", {
      className: "bv-overlay-root",
      "data-bso-overlay-state": runtimeView.phase === "fallback" ? "fallback" : runtimeIsStale() ? "stale" : "live",
      "data-bso-runtime-phase": runtimeView.phase || "unknown",
      "data-bso-analysis-state": runtimeView.result && runtimeView.result.state || "unknown",
      "data-bso-player-state": runtimeView.result && runtimeView.result.tracking && runtimeView.result.tracking.state || "unknown",
      "data-bso-shuttle-state": runtimeView.result && runtimeView.result.shuttle && runtimeView.result.shuttle.state || "unknown",
      "data-bso-court-state": courtDiagnosticState(),
      "data-bso-court-map-state": courtConfigurationState(),
      "data-bso-density": state.density
    });
    if (courtMappingAvailable()) {
      if (courtLinesVisible()) overlay.appendChild(calibrationDrawing());
    }
    // Keep a canvas sibling anchored to the same video-local root. It is a
    // bounded frame-local rendering surface, while the vector layer below
    // preserves inspectable evidence and hit testing remains pass-through.
    if (overlayCanvas) {
      overlayCanvas.setAttribute("data-bso-overlay-canvas", "true");
      overlay.appendChild(overlayCanvas);
    }
    // Evidence is drawn in normalized video coordinates and never intercepts
    // pointer input, so player/shuttle rendering cannot block playback or seed clicks.
    overlay.appendChild(runtimeEvidenceDrawing());
    var leftChildren = [];
    if (state.density !== "minimal") leftChildren.push(ui.el("div", { className: "bv-runtime-note", role: "status" }, [ui.icon("info", 11), runtimeCaption()]));
    if (state.density === "full") leftChildren.push(runtimeSignalNode());
    if (leftChildren.length) overlay.appendChild(ui.el("div", { className: "bv-overlay-stack left" }, leftChildren));
    // The access point is the only default interactive surface. The popup is
    // canonical for durable visibility choices; this menu is a small shortcut
    // for opening an already-supported panel while watching.
    overlay.appendChild(overlayAccessPoint());
    if (state.panels.stats) overlay.appendChild(statsPanel());
    if (state.panels.map) overlay.appendChild(mapPanel());
    if (state.panels.feed) overlay.appendChild(feedPanel());
    if (state.panels.controls) overlay.appendChild(controlsPanel());
    return overlay;
  }

  function openLabeling(record) {
    var wasSeeding = state.seeding;
    state = window.BVState.reduceExtensionState(state, { type: "OPEN_LABELING" });
    if (wasSeeding) restoreCalibrationState();
    // Opening a fresh draft must never inherit the id of a previously edited
    // row. Existing-label mode is entered only through an explicit record.
    editingEventId = record && record.eventId != null ? String(record.eventId) : null;
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
    if (state.labeling) {
      editingEventId = null;
      draft = newDraft();
      persist();
    }
    render();
  }
  function undoLastEdit() {
    var edit = state.lastEdit;
    if (!edit || !edit.eventId || !window.BVReview) return;
    state = window.BVState.reduceExtensionState(state, { type: "UNDO_LABEL", videoKey: activeVideoKey, edit: edit, labels: window.BVReview.undoLabelMutation(state.manualLabels, edit) });
    strokes = reviewStrokes();
    suggestion = edit.previousSuggestion ? window.BVReview.clone(edit.previousSuggestion) : null;
    if (state.labeling) {
      editingEventId = null;
      draft = newDraft();
    }
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
    var csvText = window.BVAnalysis.toShotsCsv(rows, { includeManualMetadata: true });
    // Test/recovery seam: the latest export text stays on the singleton so the
    // CSV round trip can be asserted without reading a blob URL.
    if (singleton) singleton.lastExportCsv = csvText;
    var link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csvText], { type: "text/csv" })); link.download = "badminton-vision-shots.csv"; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
  }
  function setImportResult(result) {
    importResult = result;
    if (state.labeling) render();
  }
  function importCsvText(text) {
    if (!window.BVAnalysis || !window.BVReview || !window.BVState) return;
    var parsed = window.BVAnalysis.parseShotsCsv(text);
    if (!parsed || !parsed.ok) { setImportResult({ error: parsed && parsed.error ? parsed.error : "Could not parse the selected CSV file." }); return; }
    var existing = (state.manualLabels || []).slice();
    var normalized = window.BVAnalysis.normalizeImportedShots(parsed.rows, { existing: existing, now: new Date().toISOString() });
    if (normalized.records.length) {
      var merged = existing.slice();
      normalized.records.forEach(function (record) { merged = window.BVReview.upsert(merged, record); });
      state = window.BVState.reduceExtensionState(state, { type: "SET_REVIEW_LABELS", videoKey: activeVideoKey, labels: merged });
      strokes = reviewStrokes();
      persist();
      send({ type: "IMPORT_LABELS", count: normalized.records.length });
    }
    setImportResult({ imported: normalized.records.length, skipped: normalized.skipped + normalized.invalid, total: parsed.rows.length });
  }
  function readCsvFile(file) {
    function handle(text) { importCsvText(String(text || "")); }
    if (file && typeof file.text === "function") {
      var reading = file.text();
      if (reading && typeof reading.then === "function") reading.then(handle, function () { setImportResult({ error: "Could not read the selected CSV file." }); });
      else handle(reading);
    } else if (file && typeof FileReader !== "undefined") {
      var reader = new FileReader();
      reader.onload = function () { handle(reader.result); };
      reader.onerror = function () { setImportResult({ error: "Could not read the selected CSV file." }); };
      reader.readAsText(file);
    } else setImportResult({ error: "This browser cannot read the selected CSV file." });
  }
  function importCsv() {
    if (!csvInput) {
      csvInput = document.createElement("input");
      csvInput.type = "file";
      csvInput.accept = ".csv,text/csv";
      csvInput.setAttribute("data-bso-import-csv-input", "true");
      csvInput.style.display = "none";
      (document.body || document.documentElement || document).appendChild(csvInput);
      csvInput.addEventListener("change", function () {
        var file = csvInput.files && csvInput.files[0];
        csvInput.value = "";
        if (!file) return;
        readCsvFile(file);
      });
    }
    csvInput.click();
  }
  function refreshLabelingClock() {
    if (!state.labeling || !root || typeof root.querySelector !== "function") return false;
    var panel = root.querySelector(".bv-label-panel");
    if (!panel) return false;
    var time = panel.querySelector(".bv-panel-time");
    if (time) time.textContent = state.time || "";
    panel.setAttribute("data-bso-media-time", state.time || "");
    return true;
  }
  function syncManualDraft() {
    if (!state.labeling || !root || typeof root.querySelector !== "function") return false;
    var panel = root.querySelector(".bv-label-panel");
    if (!panel) return false;
    var activeSuggestion = state.enabled ? suggestion : null;
    var saveLabel = draft.shot || (activeSuggestion && activeSuggestion.shot);
    var windowLabel = panel.querySelector("[data-bso-label-window]");
    if (windowLabel) windowLabel.textContent = (draft.start || "current timestamp") + " → " + (draft.end || "—");
    panel.querySelectorAll("[data-bso-shot]").forEach(function (button) {
      var shot = button.getAttribute("data-bso-shot");
      var selected = draft.shot === shot;
      button.className = "bv-shot" + (selected ? " selected" : activeSuggestion && activeSuggestion.shot === shot ? " suggested" : "");
      button.setAttribute("aria-pressed", String(selected));
      var shortcut = button.querySelector(".bv-kbd");
      if (shortcut) shortcut.className = "bv-kbd" + (selected ? " accent" : "");
    });
    panel.querySelectorAll("[data-bso-player-id]").forEach(function (button) {
      button.setAttribute("aria-checked", String(button.getAttribute("data-bso-player-id") === (draft.playerId || "")));
    });
    panel.querySelectorAll("[data-bso-axis]").forEach(function (axis) {
      var value = draft.axes[axis.getAttribute("data-bso-axis")];
      axis.querySelectorAll("[data-bso-axis-option]").forEach(function (button) {
        var selected = button.getAttribute("data-bso-axis-option") === value;
        button.className = "bv-axis-option" + (selected ? " selected" : "");
        button.setAttribute("aria-pressed", String(selected));
      });
    });
    var save = panel.querySelector("[data-bso-label-save]");
    if (save) {
      var actionLabel = editingEventId ? "Save correction" : draft.shot ? "Save label" : activeSuggestion ? "Accept suggestion" : "Save label";
      save.disabled = !saveLabel;
      if (save.textContent !== actionLabel) save.replaceChildren(document.createTextNode(actionLabel));
    }
    panel.setAttribute("data-bso-label-mode", editingEventId ? "edit" : "create");
    panel.setAttribute("data-bso-draft-state", saveLabel ? "dirty" : "ready");
    refreshLabelingClock();
    return true;
  }
  function manualPanel() {
    // Offline mode has no suggestion source. Fixture suggestions only enter
    // the correction path when the live overlay is explicitly enabled.
    var activeSuggestion = state.enabled ? suggestion : null;
    var saveLabel = draft.shot || (activeSuggestion && activeSuggestion.shot);
    var saveActionLabel = editingEventId ? "Save correction" : draft.shot ? "Save label" : activeSuggestion ? "Accept suggestion" : "Save label";
    var canDelete = Boolean(editingEventId && labelForEvent(editingEventId));
    var saveButton = ui.button(saveActionLabel, { variant: "primary", size: "sm", disabled: !saveLabel, onClick: saveDraft });
    saveButton.setAttribute("data-bso-label-save", "true");
    var panel = ui.panel("Manual labeling", { layoutId: "manual", icon: "pencil", mediaTime: state.time, className: "bv-label-panel bv-overlay-label", bodyStyle: { flex: "1" }, collapsed: panelCollapsed("manual"), onToggleCollapse: function (value) { togglePanelCollapsed("manual", value); }, actions: [ui.kbd("Esc"), ui.iconButton("x", "Close manual labeling", { size: "sm", onClick: closeLabeling })], footer: ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.button("Export CSV", { variant: "ghost", size: "sm", icon: "download", onClick: exportCsv }), ui.button("Import CSV", { variant: "ghost", size: "sm", icon: "upload", onClick: importCsv }), state.lastEdit ? ui.button("Undo", { variant: "ghost", size: "sm", onClick: undoLastEdit }) : null, canDelete ? ui.button("Delete label", { variant: "danger", size: "sm", onClick: deleteExistingLabel }) : null, ui.el("span", { style: { marginLeft: "auto", display: "flex", gap: "var(--sp-3)" } }, [ui.button("Close", { variant: "ghost", size: "sm", onClick: closeLabeling }), saveButton])]) }, []);
    panel.tabIndex = 0;
    panel.setAttribute("data-bso-label-mode", editingEventId ? "edit" : "create");
    panel.setAttribute("data-bso-draft-state", saveLabel ? "dirty" : "ready");
    panel.setAttribute("data-bso-media-time", state.time || "");
    var body = panel.querySelector(".bv-panel-body");
    // A collapsed panel renders only its header bar; the form is rebuilt when
    // the panel is expanded again, so nothing is lost by skipping the body.
    if (body) {
      body.appendChild(ui.callout("guide", "Manual / offline mode", "Playback is read-only. No court seed, inference model, or production CV evidence is required."));
      body.appendChild(ui.el("div", { className: "bv-segment-window" }, [ui.el("span", { className: "bv-mono", "data-bso-label-window": "true" }, [(draft.start || "current timestamp") + " → " + (draft.end || "—")]), ui.el("span", { className: "bv-segment-controls" }, [ui.button("Start", { variant: "ghost", size: "sm", disabled: currentMediaTimestamp() == null, onClick: function () { if (currentMediaTimestamp() != null) draft.start = formatMediaTime(currentMediaTimestamp()); syncManualDraft(); } }), ui.button("End", { variant: "ghost", size: "sm", disabled: currentMediaTimestamp() == null, onClick: function () { if (currentMediaTimestamp() != null) draft.end = formatMediaTime(currentMediaTimestamp()); syncManualDraft(); } })]) ]));
      if (activeSuggestion) body.appendChild(ui.el("div", { className: "bv-manual-suggestion" }, [ui.badge("auto suggestion", "warn"), ui.el("span", { className: "bv-feed-shot" + (draft.shot ? " replaced" : "") }, [activeSuggestion.shot]), ui.confidence(activeSuggestion.confidence, { showWord: true }), ui.el("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", font: "var(--type-ui-sm)", color: "var(--text-faint)" } }, ["accept", ui.kbd("↵", true)])]));
      body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Shot family"]));
      body.appendChild(ui.shotPicker(draft.shot, activeSuggestion && activeSuggestion.shot, function (shot) { draft.shot = shot; syncManualDraft(); }));
      body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Player identity (optional)"]));
      body.appendChild(ui.segmented([{ value: "", label: "Unknown" }, { value: "A", label: "Player A" }, { value: "B", label: "Player B" }], draft.playerId || "", function (player) { draft.playerId = player || null; syncManualDraft(); }, true, "data-bso-player-id"));
      body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Dimensions (optional)"]));
      var axisList = ui.el("div", { className: "bv-axis-list" });
      data.axes.forEach(function (axis) { axisList.appendChild(ui.dimensionAxis(axis.label, axis.options, draft.axes[axis.label], function (value) { draft.axes[axis.label] = value; syncManualDraft(); })); });
      body.appendChild(axisList);
      body.appendChild(ui.el("p", { className: "bv-helper" }, ["Manual labels are first-class records. Saving updates the same event id and appends provenance — it never creates a duplicate or invents CV evidence."]));
      if (importResult) {
        var resultText = importResult.error
          ? "Import failed: " + importResult.error
          : "Imported " + importResult.imported + " label" + (importResult.imported === 1 ? "" : "s") + (importResult.skipped ? " · skipped " + importResult.skipped + " duplicate" + (importResult.skipped === 1 ? "" : "s") : "") + ".";
        body.appendChild(ui.el("p", { className: "bv-helper bv-import-result" + (importResult.error ? " error" : ""), role: "status", "data-bso-import-result": "true" }, [importResult.error ? ui.badge("failed", "warn") : ui.badge("ok", "in"), " " + resultText]));
      }
      if (state.manualLabels && state.manualLabels.length) {
        var savedLabels = ui.el("div", { className: "bv-manual-saved", "aria-label": "Saved labels for this video" });
        savedLabels.appendChild(ui.el("span", { className: "bv-field-label" }, ["Saved labels for this video"]));
        // Saved rows share the bounded, scrollable feed list contract so a
        // long manual session stays navigable without growing over the video.
        var savedFeed = ui.el("div", { className: "bv-feed" });
        state.manualLabels.forEach(function (label, index) {
          var savedRow = Object.assign({}, label, { sequence: label.sequence || index + 1 });
          savedFeed.appendChild(ui.strokeFeedItem(savedRow, function () { openExistingLabel(label); }));
        });
        savedLabels.appendChild(savedFeed);
        body.appendChild(savedLabels);
      }
    }
    setTimeout(function () {
      if (panel.isConnected && state.labeling && root && root.querySelector(".bv-label-panel") === panel) panel.focus();
    }, 0);
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
      rallyId: activeSuggestion ? activeSuggestion.rallyId : draft.rallyId != null ? draft.rallyId : existing && existing.rallyId != null ? existing.rallyId : state.rally,
      sequence: draft.sequence || (strokes.find(function (stroke) { return String(stroke.eventId) === String(eventId); }) || {}).sequence || strokes.length + 1,
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
    // A save completes this draft, not the labeling session. Keep the panel
    // open with a fresh event id and freshly bound controls for the next shot.
    editingEventId = null;
    draft = newDraft();
    persist();
    render();
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
    draft = newDraft();
    persist();
    render();
  }
  function closeLabeling() {
    state = window.BVState.reduceExtensionState(state, { type: "CLOSE_LABELING" });
    editingEventId = null;
    draft = newDraft();
    importResult = null;
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
    if (key === "escape" && overlayMenuOpen) {
      event.preventDefault();
      overlayMenuOpen = false;
      render();
      return;
    }
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
      syncManualDraft();
    } else if (key === "s") {
      draft.start = formatMediaTime(currentMediaTimestamp());
      event.preventDefault();
      syncManualDraft();
    } else if (key === "e") {
      draft.end = formatMediaTime(currentMediaTimestamp());
      event.preventDefault();
      syncManualDraft();
    } else if (event.key === "Enter" && (draft.shot || suggestion)) {
      event.preventDefault();
      saveDraft();
    }
  }

  function render() {
    if (!root) return;
    // Structural state updates replace the panel DOM. Never leave a pointer
    // gesture attached to a retired node or let it write stale geometry.
    clearPanelGesture();
    updateDiagnosticsMarkers();
    root.replaceChildren();
    if (!state.enabled && !state.seeding && !state.labeling) return;
    // Court setup is an optional mapping flow layered over the same live
    // inference surface. Never replace raw pose/shuttle/racket evidence with
    // the setup card just because calibration is missing or being changed.
    // However, when a camera cut triggers seeding, the old evidence is stale
    // and must not be shown frozen over the new camera angle.
    if (state.enabled && !(state.seeding && state.cameraCut)) root.appendChild(liveOverlay());
    if (state.seeding) root.appendChild(seedFlow());
    if (state.labeling && !state.seeding) root.appendChild(manualPanel());
    refreshPanelLayouts();
    installPanelInteractionsInRoot();
  }
  function applyStoredState(nextState) {
    var key = currentVideoKey();
    var wasLabeling = state.labeling;
    state = window.BVState.stateForVideo(nextState, key);
    if (key) {
      state.videoKey = key;
      if (!state.videoUrl && window.location && /^https?:/.test(window.location.href)) state.videoUrl = window.location.href;
    }
    restoreReviewState();
    if (state.seeded && !state.calibration) {
      // A malformed old court record invalidates mapping only. Do not reset
      // video-local labels, panel choices, or the independent inference
      // session while presenting the first-use setup action in the map.
      state = window.BVState.initialExtensionState(Object.assign({}, state, {
        seeded: false,
        seeding: false,
        calibration: null,
        seedPoints: [],
        seedDraftPoints: [],
        calibrationError: "This saved court has no fitted calibration. Set up the four outer corners to enable the court map."
      }));
      restoreReviewState();
    }
    activeVideoKey = key;
    if (video && Number.isFinite(video.currentTime) && !state.stale) state.time = formatMediaTime(video.currentTime);
    // A restored open panel starts a new draft at the actual media clock. Do
    // not carry the module's pre-video 00:00 draft into a reloaded page, while
    // preserving an in-progress draft when an external state update arrives
    // during an already-open labeling session.
    if (state.labeling && !wasLabeling) {
      editingEventId = null;
      draft = newDraft();
    }
    restoreCalibrationState();
    if (state.enabled) startRuntime();
    persist();
  }
  function handleNavigation() {
    // Navigation is a hard video-local boundary even if YouTube reuses the
    // same HTMLVideoElement for its next watch page.
    resetVideoLocalState("navigation");
  }
  function handleMessageAfterStorage(message) {
    if (!message) return;
    if (message.type === "START_SEED") {
      bindVideoState();
      startCourtSetup();
      startRuntime();
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
      overlayMenuOpen = false;
      stopRuntime("disabled");
      state = window.BVState.reduceExtensionState(state, { type: "DISABLE" });
      persist(); render();
    }
    else if (message.type === "OPEN_LABELING") { bindVideoState(); openLabeling(); }
    else if (message.type === "SET_DENSITY") { state = window.BVState.reduceExtensionState(state, { type: "SET_DENSITY", value: message.value }); persist(); render(); }
    else if (message.type === "SET_PANELS") { state = window.BVState.reduceExtensionState(state, { type: "SET_PANELS", panels: message.panels }); persist(); render(); }
    else if (message.type === "SET_TRACKER") { state = window.BVState.reduceExtensionState(state, message); persist(); render(); }
    else if (message.type === "TOGGLE_PANEL_COLLAPSE") { state = window.BVState.reduceExtensionState(state, message); persist(); render(); }
    else if (message.type === "SET_COURT_LINES") { state = window.BVState.reduceExtensionState(state, message); persist(); render(); }
    else if (message.type === "STATE_UPDATE" && message.state) { applyStoredState(message.state); render(); }
    else if (message.type === "CAMERA_CUT") {
      state = window.BVState.reduceExtensionState(state, { type: "CAMERA_CUT" });
      state.videoKey = activeVideoKey || currentVideoKey();
      calibration = null;
      clearPanelGesture();
      seedPoints = [];
      persist(); render();
    }
  }
  function handleMessage(message) {
    if (!message || hasSeenMessage(message)) return;
    if (!storageHydrated) {
      pendingMessages.push(message);
      return;
    }
    handleMessageAfterStorage(message);
  }
  function releasePendingMessages() {
    storageHydrated = true;
    var queued = pendingMessages;
    pendingMessages = [];
    queued.forEach(handleMessageAfterStorage);
  }
  function removeRetiredRuntimeOverlays() {
    if (!document || typeof document.querySelectorAll !== "function") return;
    document.querySelectorAll("[data-bso-runtime-overlay]").forEach(function (node) {
      if (node && typeof node.remove === "function") node.remove();
      else if (node && node.parentNode && typeof node.parentNode.removeChild === "function") node.parentNode.removeChild(node);
    });
  }
  function removeRetiredContentHosts() {
    if (!document || typeof document.querySelectorAll !== "function") return;
    // Extension reloads invalidate the old isolated world but leave its DOM
    // host behind. Remove that stale instance before mounting the new one;
    // this is cleanup, not a second hidden panel or event-handler workaround.
    document.querySelectorAll("[data-badminton-vision]").forEach(function (node) {
      if (node && typeof node.remove === "function") node.remove();
      else if (node && node.parentNode && typeof node.parentNode.removeChild === "function") node.parentNode.removeChild(node);
    });
  }
  function init() {
    // An extension reload can leave the old plain-text runtime node in the
    // page after its isolated world is invalidated. Remove that retired node
    // before mounting the boxed design-system overlay.
    removeRetiredRuntimeOverlays();
    removeRetiredContentHosts();
    host = document.createElement("div"); host.className = "bv-overlay-anchor"; host.setAttribute("data-badminton-vision", "overlay");
    singleton.host = host;
    host.style.position = "fixed"; host.style.zIndex = "2147483640"; host.style.pointerEvents = "none";
    shadow = host.attachShadow({ mode: "open" });
    overlayCanvas = document.createElement("canvas");
    overlayCanvas.className = "bv-overlay-canvas";
    overlayCanvas.setAttribute("aria-hidden", "true");
    overlayCanvas.setAttribute("data-bso-overlay-canvas", "true");
    overlayCanvas.style.pointerEvents = "none";
    var link = document.createElement("link"); link.rel = "stylesheet"; link.href = hasChrome() && chrome.runtime ? chrome.runtime.getURL("styles.css") : "styles.css"; shadow.appendChild(link);
    // The stylesheet loads asynchronously; a panel measured before it applies
    // has block-layout geometry. Re-anchor and re-clamp once it is live so a
    // first render can never keep stale full-size panel rects over the video.
    link.addEventListener("load", positionToVideo);
    root = document.createElement("div"); root.className = "bv-overlay-root"; shadow.appendChild(root); document.documentElement.appendChild(host);
    // Publish a base diagnostic state before asynchronous discovery/storage so
    // a runtime fault cannot leave an indistinguishable empty host behind.
    updateDiagnosticsMarkers();
    window.addEventListener("resize", positionToVideo, { passive: true }); window.addEventListener("scroll", positionToVideo, { passive: true, capture: true });
    window.addEventListener("orientationchange", positionToVideo, { passive: true });
    window.addEventListener("transitionend", positionToVideo, { passive: true, capture: true });
    document.addEventListener("fullscreenchange", positionToVideo);
    document.addEventListener("webkitfullscreenchange", positionToVideo);
    window.addEventListener("keydown", handleKeyboardShortcuts);
    // Pointer capture covers normal browsers; the window listeners keep a
    // gesture alive in embedded/recovery DOMs that do not implement capture.
    window.addEventListener("pointermove", panelPointerMove);
    window.addEventListener("pointerup", function (event) { finishPanelGesture(event, false); });
    window.addEventListener("pointercancel", function (event) { finishPanelGesture(event, true); });
    ["yt-navigate-start", "yt-navigate-finish", "popstate", "hashchange"].forEach(function (name) {
      var listener = handleNavigation;
      window.addEventListener(name, listener);
      navigationListeners.push([name, listener]);
    });
    var LayoutResizeObserver = window.ResizeObserver || (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
    if (LayoutResizeObserver) {
      layoutResizeObserver = new LayoutResizeObserver(positionToVideo);
      layoutResizeObserver.observe(document.documentElement);
    }
    // YouTube toggles theater/fullscreen mostly through ancestor class/style
    // mutations. Pair those signals with ResizeObserver so the final measured
    // rendered video content box wins after layout settles.
    domObserver = new MutationObserver(function (records) {
      var needsAttach = false;
      var needsPosition = false;
      (records || []).forEach(function (record) {
        var target = record && record.target;
        // Ignore this host's own positioning writes. The old broad callback
        // remeasured every panel after unrelated YouTube DOM churn, competing
        // with active gestures during playback.
        if (host && (target === host || host.contains && host.contains(target))) return;
        if (record.type === "attributes") {
          if (video && (target === video || isVideoLayoutAncestor(target))) needsPosition = true;
          return;
        }
        if (isVideoLayoutAncestor(target)) needsPosition = true;
        var nodes = [];
        if (record.addedNodes) nodes = nodes.concat(Array.prototype.slice.call(record.addedNodes));
        if (record.removedNodes) nodes = nodes.concat(Array.prototype.slice.call(record.removedNodes));
        if (nodes.some(mutationNodeContainsVideo)) needsAttach = true;
      });
      if (needsAttach) attachVideo();
      else if (needsPosition) scheduleVideoPosition();
    });
    domObserver.observe(document.documentElement, { childList: true, attributes: true, attributeFilter: ["class", "style"], subtree: true }); attachVideo();
    // Manual/offline labeling intentionally does not start the runtime. It
    // reads the media clock only; live inference begins on ENABLE/OPEN_OVERLAY.
    if (hasChrome() && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(handleMessage);
    if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState"], function (result) {
      applyStoredState(result && result.bvState ? result.bvState : state);
      releasePendingMessages();
      render();
    });
    else {
      applyStoredState(state);
      releasePendingMessages();
      render();
    }
  }
  init();
})();
