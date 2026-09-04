(function () {
  var ui = window.BVUI;
  var root = document.getElementById("app");
  var state = window.BVState.initialExtensionState();
  var fixtureDefaultTime = state.time;
  var expanded = false;
  var panelControlsExpanded = false;
  var disclosureFocusTarget = null;
  var panelControlsFocusTarget = null;
  var detected = false;
  var runtimeStatus = null;
  var actionError = null;
  var messageSequence = 0;
  var stateHydrated = false;
  var pendingDispatches = [];
  var poseModelReport = null;
  var modelSwitchNotice = null;
  // The detected block shows the real current tab: title/channel/duration come
  // from the tab and the content script's published bvVideoInfo. The demo
  // fixture stays available only as a clearly labeled fallback.
  var tabTitle = null;
  var videoInfo = null;
  var activeTabUrl = null;
  var badmintonDetection = null;
  function tabUrlForInfo() { return activeTabUrl; }
  var trackers = [
    // Court is a map-only capability, not an inference prerequisite. Keep it
    // visible as a separate status row without counting it as a detector.
    { id: "court", label: "Court map", health: "degraded", note: "optional · not set up", on: false, noSwitch: true },
    { id: "players", label: "Player boxes", health: "degraded", note: "off by default · detection still runs", on: false },
    { id: "body", label: "Pose keypoints + skeleton", health: "degraded", note: "starting · local pose model", on: true, disabled: false },
    { id: "shuttle", label: "Shuttle path + candidate", health: "degraded", note: "unknown · awaiting local runtime", on: true },
    { id: "score", label: "Score OCR", health: "degraded", note: "partial", on: true },
    { id: "racket", label: "Racket evidence", health: "unavailable", note: "unavailable · awaiting runtime racket output", on: false, disabled: true }
  ];

  // Pose-model selector catalog, mirrored from the offscreen selector's
  // AVAILABLE_MODELS ids. Entries marked wip stay listed in the menu but are
  // grayed out and cannot be chosen: switching to them can freeze pose
  // detection until the extension or the tab is reloaded, so they remain
  // disabled until that defect is fixed.
  var POSE_MODEL_ENTRIES = [
    { value: "lightweight-openpose-lite-256-v1", label: "Lightweight OpenPose (Production)" },
    { value: "movenet-multipose-lightning-v1", label: "MoveNet MultiPose Lightning" },
    { value: "blazepose-tfjs-heavy-v1", label: "BlazePose Heavy", wip: true }
  ];
  var POSE_MODEL_WIP_REASON = "pose-model-work-in-progress";
  var DEFAULT_POSE_MODEL = "lightweight-openpose-lite-256-v1";
  function poseModelEntry(value) {
    for (var index = 0; index < POSE_MODEL_ENTRIES.length; index += 1) {
      if (POSE_MODEL_ENTRIES[index].value === value) return POSE_MODEL_ENTRIES[index];
    }
    return null;
  }
  function isWipPoseModel(value) {
    var entry = poseModelEntry(value);
    return Boolean(entry && entry.wip);
  }
  // A stored pose-model preference naming a work-in-progress model must never
  // re-select it; it falls back to the production default model.
  function selectablePoseModel(value) {
    return isWipPoseModel(value) ? DEFAULT_POSE_MODEL : value;
  }

  function chromeAvailable() { return typeof chrome !== "undefined"; }
  function persist() {
    if (!chromeAvailable() || !chrome.storage || !chrome.storage.local) return;
    var write = chrome.storage.local.set({ bvState: state });
    if (write && typeof write.catch === "function") write.catch(function () {});
  }
  function contentScriptFiles() {
    if (!chromeAvailable() || !chrome.runtime || typeof chrome.runtime.getManifest !== "function") return [];
    var manifest = chrome.runtime.getManifest();
    var entry = (manifest.content_scripts || []).find(function (candidate) {
      return Array.isArray(candidate.matches) && candidate.matches.some(function (match) { return match.indexOf("youtube.com/watch") >= 0; });
    });
    return entry && Array.isArray(entry.js) ? entry.js.slice() : [];
  }
  function injectContentScript(tabId, message, finish) {
    if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
      finish({ ok: false, reason: "Chrome cannot inject the content bundle into this tab." });
      return;
    }
    var files = contentScriptFiles();
    if (!files.length) {
      finish({ ok: false, reason: "The extension has no declared content entrypoint." });
      return;
    }
    chrome.scripting.executeScript({ target: { tabId: tabId }, files: files }, function () {
      var injectionError = chrome.runtime.lastError;
      if (injectionError) {
        finish({ ok: false, reason: injectionError.message || "Chrome rejected content bundle injection." });
        return;
      }
      chrome.tabs.sendMessage(tabId, message, function () {
        var sendError = chrome.runtime.lastError;
        finish(sendError
          ? { ok: false, reason: sendError.message || "The injected content bundle did not respond." }
          : { ok: true });
      });
    });
  }
  function sendToTab(message, onDone) {
    var finish = typeof onDone === "function" ? onDone : function () {};
    if (!chromeAvailable() || !chrome.tabs) { finish({ ok: false, reason: "Chrome tab messaging is unavailable." }); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || tab.id == null) { finish({ ok: false, reason: "No active YouTube tab is available." }); return; }
      chrome.tabs.sendMessage(tab.id, message, function () {
        var sendError = chrome.runtime.lastError;
        if (sendError) {
          // Installing/reloading an unpacked extension does not inject its
          // declared content scripts into an already-open YouTube tab. Make
          // the first Live action repair that boundary instead of silently
          // discarding the user's click.
          injectContentScript(tab.id, message, finish);
          return;
        }
        finish({ ok: true });
      });
    });
  }
  function finishAction(result) {
    if (result && result.ok === false) {
      actionError = result.reason || "Chrome could not reach the YouTube tab.";
      render();
      return;
    }
    actionError = null;
    closePopup();
  }
  function dispatch(action, message, onDone) {
    if (!stateHydrated) {
      pendingDispatches.push({ action: action, message: message, onDone: onDone });
      return;
    }
    state = window.BVState.reduceExtensionState(state, action);
    actionError = null;
    persist();
    var outbound = Object.assign({}, message || { type: "STATE_UPDATE", state: state }, {
      requestId: "popup-" + Date.now() + "-" + (++messageSequence)
    });
    sendToTab(outbound, onDone);
    render();
  }
  function writePoseModelPreference(modelId) {
    if (!chromeAvailable() || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.set !== "function") return;
    try { chrome.storage.local.set({ bvSelectedPoseModel: String(modelId) }); } catch (_) {}
  }
  // Ask the offscreen analyzer which pose models can actually run here and
  // which one is active, then reflect that in the model selector. The probe
  // only reports models whose adapter, runtime, and local artifact exist.
  function refreshPoseModelReport() {
    if (!chromeAvailable() || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") return;
    chrome.runtime.sendMessage({ action: "getAvailablePoseModels" }, function (response) {
      if (!response || !Array.isArray(response.models)) return;
      poseModelReport = response;
      if (response.ok && response.currentModel && state.selectedPoseModel !== response.currentModel) {
        state.selectedPoseModel = response.currentModel;
        persist();
        writePoseModelPreference(response.currentModel);
      }
      render();
    });
  }
  function summaryUrl(originUrl) {
    var url = chromeAvailable() && chrome.runtime ? chrome.runtime.getURL("summary.html") : "summary.html";
    return originUrl ? url + "?from=" + encodeURIComponent(originUrl) : url;
  }
  function openSummary() {
    var finish = function () { closePopup(); };
    if (chromeAvailable() && chrome.tabs && chrome.runtime) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var origin = tabs && tabs[0] && tabs[0].url;
        chrome.tabs.create({ url: summaryUrl(origin) }, finish);
      });
    } else if (window.open) {
      window.open(summaryUrl(window.location && window.location.href), "_blank");
      finish();
    } else finish();
  }
  function closePopup() { if (window.close) window.close(); }
  // The runtime reports raw accelerator tokens (webgpu/webgl/wasm) that are
  // machine labels, not user-facing capabilities. Spell out what each means
  // wherever a backend name reaches the popup; a missing backend stays
  // "local" (the old default label).
  function backendLabel(backend) {
    if (backend === "webgpu") return "WebGPU acceleration";
    if (backend === "webgl") return "WebGL (fallback)";
    if (backend === "wasm") return "WASM (software)";
    return backend || "local";
  }
  function isWatchPage(url) { return /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch(?:[?#]|$)/i.test(url || ""); }
  function replayPendingDispatches() {
    var queued = pendingDispatches;
    pendingDispatches = [];
    queued.forEach(function (item) { dispatch(item.action, item.message, item.onDone); });
  }

  function section(title, content, aside) {
    return ui.el("section", { className: "bv-section" }, [ui.el("div", { className: "bv-section-title" }, [title, aside ? ui.el("span", { className: "bv-section-aside" }, [aside]) : null]), content]);
  }
  function trackerRow(tracker) {
    var dotClass = tracker.disabled ? "off" : tracker.health === "degraded" ? "warn" : tracker.on ? "" : "off";
    var colorHealth = tracker.health === "degraded" ? "warn" : "";
    var switchButton = null;
    if (!tracker.noSwitch) {
      switchButton = ui.el("button", { className: "bv-mini-switch", type: "button", role: "switch", "aria-checked": tracker.on, disabled: tracker.disabled, title: tracker.disabled ? tracker.note : "Toggle " + tracker.label, "aria-label": "Toggle " + tracker.label, onClick: function () { setEvidenceTracker(tracker.id, !tracker.on); } }, [ui.el("i")]);
    }
    var row = ui.el("div", { className: "bv-tracker-row" + (tracker.disabled ? " unavailable" : "") }, [ui.el("i", { className: "bv-tracker-dot " + dotClass }), ui.el("span", { className: "bv-tracker-label" }, [tracker.label]), ui.el("span", { className: "bv-tracker-meta" }, [ui.el("span", { className: "bv-tracker-note " + colorHealth }, [tracker.on ? tracker.note : "off"]), switchButton])]);
    if (["body", "players", "racket", "shuttle"].indexOf(tracker.id) >= 0) {
      row.setAttribute("data-bso-evidence-control", tracker.id);
      row.setAttribute("data-bso-evidence-state", tracker.evidenceState || "unknown");
    }
    return row;
  }
  function panelToggle(label, description, key, disabled) {
    return ui.toggle(label, description, state.panels[key], function (next) { dispatch({ type: "TOGGLE_PANEL", panel: key, value: next }, { type: "SET_PANELS", panels: Object.assign({}, state.panels, { [key]: next }) }); }, { disabled: disabled, id: "panel-" + key });
  }
  function evidenceVideoKey() {
    return state.videoKey || window.BVState.videoKeyForUrl(activeTabUrl);
  }
  function setEvidenceTracker(tracker, value) {
    dispatch({ type: "SET_TRACKER", tracker: tracker, value: value }, { type: "SET_TRACKER", tracker: tracker, value: value });
  }
  function toggleEvidenceDisclosure() {
    expanded = !expanded;
    disclosureFocusTarget = expanded ? "first-control" : "toggle";
    render();
  }
  function togglePanelControlsDisclosure() {
    panelControlsExpanded = !panelControlsExpanded;
    panelControlsFocusTarget = panelControlsExpanded ? "first-panel-control" : "panel-toggle";
    dispatch({ type: "TOGGLE_PANEL_CONTROLS_EXPANDED", value: panelControlsExpanded }, { type: "TOGGLE_PANEL_CONTROLS_EXPANDED", value: panelControlsExpanded });
    render();
  }
  function courtProjectionToggle() {
    var visible = window.BVState.courtLinesForVideo(state, evidenceVideoKey());
    var toggle = ui.toggle("Court projection", visible ? "calibrated court polygon over the video" : "hidden until re-enabled", visible, function (next) {
      dispatch({ type: "SET_COURT_LINES", videoKey: evidenceVideoKey(), value: next }, { type: "SET_COURT_LINES", videoKey: evidenceVideoKey(), value: next });
    }, { id: "court-lines" });
    toggle.setAttribute("data-bso-court-projection-toggle", "true");
    toggle.setAttribute("data-bso-evidence-state", "available");
    return toggle;
  }
  function restoreDisclosureFocus() {
    if (!disclosureFocusTarget) return;
    var target = null;
    if (disclosureFocusTarget === "toggle") {
      target = root.querySelector("[data-bso-evidence-disclosure-toggle]");
    } else {
      var disclosure = root.querySelector("[data-bso-evidence-disclosure]");
      // Keep focus in the actual evidence controls (rather than the read-only
      // Court/Score status rows) and use a stable, meaningful order.
      var evidenceOrder = ["body", "players", "shuttle", "racket"];
      for (var index = 0; disclosure && index < evidenceOrder.length; index += 1) {
        var row = disclosure.querySelector('[data-bso-evidence-control="' + evidenceOrder[index] + '"]');
        var control = row && row.querySelector("button");
        if (control && !control.disabled) { target = control; break; }
      }
      if (!target) target = root.querySelector("[data-bso-evidence-disclosure-toggle]");
    }
    disclosureFocusTarget = null;
    if (target && typeof target.focus === "function") target.focus();
  }
  function restorePanelControlsFocus() {
    if (!panelControlsFocusTarget) return;
    var target = null;
    if (panelControlsFocusTarget === "panel-toggle") {
      target = root.querySelector("[data-bso-panel-controls-toggle]");
    } else {
      var disclosure = root.querySelector("[data-bso-panel-controls-disclosure]");
      // Focus on the first visible panel control toggle
      var panelOrder = ["feed", "stats", "map", "controls"];
      for (var index = 0; disclosure && index < panelOrder.length; index += 1) {
        var button = disclosure.querySelector("#panel-" + panelOrder[index]);
        if (button && !button.disabled) { target = button; break; }
      }
      if (!target) target = root.querySelector("[data-bso-panel-controls-toggle]");
    }
    panelControlsFocusTarget = null;
    if (target && typeof target.focus === "function") target.focus();
  }

  function render() {
    var fixture = window.BVFixtures;
    // Restore panel controls expansion state from persisted state
    panelControlsExpanded = Boolean(state.panelControlsExpanded);
    var poseTracker = trackers.find(function (tracker) { return tracker.id === "body"; });
    var playerTracker = trackers.find(function (tracker) { return tracker.id === "players"; });
    var shuttleTracker = trackers.find(function (tracker) { return tracker.id === "shuttle"; });
    var racketTracker = trackers.find(function (tracker) { return tracker.id === "racket"; });
    var productionReady = Boolean(runtimeStatus && runtimeStatus.inference && runtimeStatus.analyzer && runtimeStatus.analyzer !== "fixture-probe-v1");
    var fixtureReady = Boolean(runtimeStatus && runtimeStatus.inference && runtimeStatus.analyzer === "fixture-probe-v1");
    if (poseTracker) {
      poseTracker.disabled = false;
      poseTracker.health = "degraded";
      poseTracker.note = "starting · local pose model";
      if (runtimeStatus && runtimeStatus.phase === "fallback" && !runtimeStatus.inference) {
        poseTracker.disabled = true;
        poseTracker.on = false;
        poseTracker.note = "unavailable · local pose runtime fallback";
      } else if (fixtureReady) {
        poseTracker.disabled = true;
        poseTracker.on = false;
        poseTracker.note = "unavailable · fixture has no pose model";
      } else if (productionReady) {
        poseTracker.health = "ok";
        poseTracker.note = runtimeStatus.backend ? "local pose model · " + backendLabel(runtimeStatus.backend) : "local pose model";
      }
    }
    if (playerTracker) {
      // Player-box visibility stays an enabled preference even before the
      // runtime supplies a box; the renderer simply has nothing to draw yet.
      playerTracker.disabled = false;
      playerTracker.on = productionReady;
      playerTracker.health = productionReady && runtimeStatus.playerState === "tracked" ? "ok" : "degraded";
      playerTracker.note = productionReady ? ((runtimeStatus.playerCount || 0) + " visible · " + (runtimeStatus.playerState || "unknown")) : fixtureReady ? "unknown · fixture probe" : "unknown · local runtime";
    }
    if (shuttleTracker) {
      shuttleTracker.disabled = fixtureReady;
      shuttleTracker.health = fixtureReady ? "unavailable" : productionReady && runtimeStatus.shuttleState === "tracked" ? "ok" : "degraded";
      shuttleTracker.note = fixtureReady ? "unavailable · fixture has no shuttle signal" : productionReady ? (runtimeStatus.shuttleState || "unknown") + " · bounded local candidate" : "unknown · awaiting local runtime";
    }
    if (racketTracker) {
      var racketSupported = Boolean(runtimeStatus && runtimeStatus.racketSupported);
      racketTracker.disabled = !racketSupported;
      racketTracker.health = racketSupported && runtimeStatus.racketState === "tracked" ? "ok" : racketSupported ? "degraded" : "unavailable";
      racketTracker.on = racketSupported ? racketTracker.on : false;
      racketTracker.note = racketSupported ? (runtimeStatus.racketState || "unknown") + " · runtime signal" : "unavailable · no runtime racket output";
    }
    trackers.forEach(function (tracker) {
      // Keep the remembered visibility value visible even when a signal is
      // currently unavailable; disabling the switch must not erase a
      // video-local preference that the content renderer will reuse later.
      if (state.trackerSettings && state.trackerSettings[tracker.id] != null) tracker.on = Boolean(state.trackerSettings[tracker.id]);
    });
    var visibilityTrackers = trackers.filter(function (tracker) { return ["body", "players", "racket", "shuttle"].indexOf(tracker.id) >= 0; });
    var projectionVisible = window.BVState.courtLinesForVideo(state, evidenceVideoKey());
    var visibleEvidenceCount = visibilityTrackers.filter(function (tracker) { return tracker.on; }).length + (projectionVisible ? 1 : 0);
    var evidenceControlCount = visibilityTrackers.length + 1;
    var degraded = trackers.some(function (t) { return t.on && t.health === "degraded"; });
    var runtimeFallback = runtimeStatus && (runtimeStatus.phase === "fallback" || runtimeStatus.inference === false && runtimeStatus.analyzer === "none");
    var runtimeStale = Boolean(state.stale || runtimeStatus && runtimeStatus.stale);
    // These status values mirror the former on-video evidence controls. The
    // popup now owns their one visible control surface, while the content
    // script remains the read-only renderer for the selected layers.
    if (poseTracker) poseTracker.evidenceState = runtimeFallback || fixtureReady ? "unavailable" : productionReady ? "available" : "unknown";
    if (playerTracker) playerTracker.evidenceState = productionReady && runtimeStatus && runtimeStatus.playerCount > 0 ? "available" : "unknown";
    if (shuttleTracker) shuttleTracker.evidenceState = fixtureReady ? "unavailable" : productionReady && runtimeStatus && runtimeStatus.shuttleState === "tracked" ? "available" : "unknown";
    if (racketTracker) racketTracker.evidenceState = racketTracker.disabled ? "unavailable" : runtimeStatus && runtimeStatus.racketState === "tracked" ? "available" : "unknown";
    var runtimeReady = Boolean(runtimeStatus && runtimeStatus.inference && runtimeStatus.analyzer && runtimeStatus.analyzer !== "none");
    var courtConfiguration = window.BVState && typeof window.BVState.courtConfigurationState === "function"
      ? window.BVState.courtConfigurationState(state)
      : state.seeded && state.calibration ? (state.seeding ? "recalibrating" : "calibrated") : state.seeding ? "setup" : "uncalibrated";
    var courtSeeded = courtConfiguration === "calibrated";
    root.setAttribute("data-bso-popup", "true");
    root.setAttribute("data-bso-youtube-detected", String(Boolean(detected)));
    root.setAttribute("data-bso-badminton-detected", badmintonDetection == null ? "unknown" : String(Boolean(badmintonDetection)));
    root.setAttribute("data-bso-enabled", String(Boolean(state.enabled)));
    root.setAttribute("data-bso-court-state", courtSeeded ? "seeded" : state.seeding ? "seeding" : "not-seeded");
    root.setAttribute("data-bso-court-map-state", courtConfiguration);
    root.setAttribute("data-bso-runtime-phase", runtimeStatus && runtimeStatus.phase || (state.enabled ? "starting" : "idle"));
    root.setAttribute("data-bso-runtime-analyzer", runtimeStatus && runtimeStatus.analyzer || "none");
    root.setAttribute("data-bso-inference", String(Boolean(runtimeStatus && runtimeStatus.inference)));
    root.setAttribute("data-bso-frame-transport", runtimeStatus && runtimeStatus.frameTransport || "unknown");
    root.setAttribute("data-bso-backend", runtimeStatus && runtimeStatus.backend || "unknown");
    root.setAttribute("data-bso-fallback", runtimeFallback ? (runtimeStatus.reason || "runtime-fallback") : "none");
    trackers[0].note = courtConfiguration === "calibrated" ? "optional · map ready" : courtConfiguration === "recalibrating" ? "optional · replacing map" : courtConfiguration === "setup" ? "optional · setup required" : "optional · map unavailable";
    trackers[0].health = courtConfiguration === "calibrated" ? "ok" : "degraded";
    // Unlike body pose, shuttle, and racket evidence, court setup has no
    // inference switch and must never make the detector count look blocked.
    trackers[0].on = false;
    // The detected block shows the real current tab when one is open. Title,
    // channel, and duration come from the tab plus the content script's
    // published bvVideoInfo; the demo fixture appears only as a labeled
    // fallback outside a watch page.
    var currentTabTitle = tabTitle ? String(tabTitle).replace(/\s*-\s*YouTube\s*$/, "").trim() : null;
    var realTitle = detected && (videoInfo && videoInfo.url === (tabUrlForInfo() || null) ? videoInfo.title : null) || (detected ? currentTabTitle : null);
    var realDetail = detected && videoInfo && videoInfo.url === tabUrlForInfo()
      ? [videoInfo.channel, videoInfo.duration].filter(Boolean).join(" · ")
      : null;
    var detectedTitle = detected ? (realTitle || "Detecting video…") : fixture.video.title;
    var detectedDetail = detected ? (realDetail || "reading video metadata…") : fixture.video.channel + " · " + fixture.video.duration;
    var detectedChildren = [ui.el("strong", {}, [detectedTitle])];
    if (!detected) detectedChildren.push(ui.badge("fixture preview", "neutral", false));
    if (detected && badmintonDetection === true) detectedChildren.push(ui.badge("badminton detected", "in", false));
    if (detected && badmintonDetection === false) detectedChildren.push(ui.badge("sport unconfirmed", "neutral", false));
    detectedChildren.push(ui.el("span", {}, [detectedDetail]));
    // Keep the explicit Close affordance: the popup also dismisses on an
    // outside click or Esc, but a labeled X keeps dismissal discoverable and
    // is the accessible path (UI audit 2026-09: keep, no code change).
    var header = ui.el("header", { className: "bv-popup-header" }, [ui.el("span", { className: "bv-logo" }, [ui.el("img", { src: "design-system/assets/logo-mark.svg", alt: "" }), ui.el("strong", { className: "bv-logo-name" }, ["Badminton Vision"])]), ui.el("span", { className: "bv-popup-head-actions" }, [ui.iconButton("settings", "Settings unavailable in local demo", { size: "sm", disabled: true }), ui.iconButton("x", "Close", { size: "sm", onClick: closePopup })])]);
    var statusState = state.enabled ? (runtimeFallback || runtimeStale ? "stale" : "live") : "ready";
    // The local runtime has no rally segmentation (it reports
    // rally-segmentation-not-available) and nothing in the live path writes
    // state.rally, whose value is a fixture-era default; state.time holds a
    // real media clock only once the content script's writer has run. The
    // chip therefore never passes either default off as live state: the
    // count renders as "Rally #N" only for a runtime-reported rally id, a
    // production session reads as "Live analysis", the fixture-probe
    // analyzer reads as the fixture analysis it is, and a starting or
    // fallback session shows no count and no timestamp unless the media
    // clock produced one. The detail spells out the accelerator as the
    // capability it provides.
    var knownRallyId = runtimeStatus && runtimeStatus.result && runtimeStatus.result.rally && runtimeStatus.result.rally.state !== "unknown" && runtimeStatus.result.rally.id != null ? String(runtimeStatus.result.rally.id) : null;
    var mediaClockWritten = typeof state.time === "string" && state.time !== fixtureDefaultTime;
    var statusLabel = state.seeding ? "Court setup in progress" : state.enabled ? (runtimeFallback ? "Analysis fallback" : runtimeStale ? "Analysis behind" : knownRallyId != null ? "Rally #" + knownRallyId : fixtureReady ? "Fixture analysis" : productionReady ? "Live analysis" : "Analysis starting") : detected ? "Badminton match found" : "No YouTube match";
    var statusDetail = state.enabled ? (runtimeStale && runtimeStatus && Number.isFinite(runtimeStatus.ageSeconds) ? "+" + runtimeStatus.ageSeconds.toFixed(1) + "s" : productionReady ? backendLabel(runtimeStatus.backend) : fixtureReady ? "fixture probe · not production CV" : mediaClockWritten ? state.time : null) : null;
    var backendDetail = runtimeFallback
      ? (function () {
        var parts = [];
        if (runtimeStatus && runtimeStatus.backend) parts.push(backendLabel(runtimeStatus.backend));
        if (runtimeStatus && runtimeStatus.reason && runtimeStatus.reason !== 'runtime-fallback') parts.push(runtimeStatus.reason);
        if (runtimeStatus && Array.isArray(runtimeStatus.fallbacks)) {
          runtimeStatus.fallbacks.forEach(function (fallback) { if (parts.indexOf(fallback) < 0) parts.push(fallback); });
        }
        return parts.length ? ' The reported cause: ' + parts.join(', ') + '.' : '';
      })()
      : '';
    var backendNotice = runtimeFallback
      ? ui.callout("warn", "Production inference unavailable", "This build could not start its local computer-vision runtime. Playback is unaffected and manual labeling remains available." + backendDetail, { tooltip: true })
      : productionReady
        ? ui.callout("guide", "Local pose + shuttle runtime active", "Pose tracking stays on-device. The shuttle signal is a bounded candidate proposal; shot, rally-end, and winner fields remain unknown until evidence supports them.", { tooltip: true })
        : fixtureReady
          ? ui.callout("guide", "Local fixture demo", "Any fixture result is an integration probe, not production CV. Nothing is uploaded; labels and corrections stay local.", { tooltip: true })
          : ui.callout("guide", "Local runtime pending", "The local pose model is starting. Until evidence arrives, player, shuttle, shot, rally-end, and winner fields remain unknown.", { tooltip: true });
    var intro = ui.el("div", { className: "bv-popup-intro" }, [ui.statusChip(statusState, statusLabel, statusDetail), ui.el("div", { className: "bv-detected" }, [ui.el("span", { className: "bv-detected-icon" }, [ui.icon(detected ? "check" : "info", 15)]), ui.el("span", { className: "bv-detected-copy" }, detectedChildren)]), actionError ? ui.callout("warn", "Could not reach the YouTube tab", actionError + " Reload the tab and try again.", { tooltip: true }) : null, !detected ? ui.callout("info", "Overlay unavailable here", "Open a youtube.com/watch page to use live overlay, court setup, or manual labeling. The summary remains available locally.", { tooltip: true }) : backendNotice, !state.enabled && detected ? ui.callout("guide", "Inference starts independently", "Turn on the overlay to run body pose, shuttle, and racket evidence. Court setup is optional and only enables court-map projection.", { tooltip: true }) : state.enabled && courtConfiguration === "recalibrating" ? ui.callout("info", "Court map recalibration in progress", "Raw video detections stay live. Finish the four-corner setup to replace the previous court-relative mapping.", { tooltip: true }) : state.enabled && courtConfiguration !== "calibrated" ? ui.callout("info", "Court map not set up", "Raw video detections stay live without calibration. Set up the court only when you want projected court-relative coordinates.", { tooltip: true }) : null, state.cameraCut ? ui.callout("warn", "Camera cut", "The court projection is stale. Re-seed the court; raw inference continues while the video keeps playing.", { tooltip: true }) : null]);

    var barNodes = visibilityTrackers.map(function (t) { return ui.el("i", { className: t.on ? (t.health === "degraded" ? "warn" : "") : "off" }); }).concat([ui.el("i", { className: projectionVisible ? "" : "off" })]);
    var trackerHeader = ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" } }, ["Evidence visibility", ui.el("span", { className: "bv-tracker-bars" }, barNodes)]);
    var trackerAside = ui.el("button", { className: "bv-link-button", type: "button", "aria-expanded": expanded, "aria-controls": "bv-evidence-visibility-controls", "aria-label": (expanded ? "Collapse" : "Expand") + " Evidence visibility controls", "data-bso-evidence-disclosure-toggle": "true", onClick: toggleEvidenceDisclosure }, [visibleEvidenceCount + " of " + evidenceControlCount + " visible", ui.icon(expanded ? "chevron-up" : "chevron-down", 12)]);
    var runtimeSummary = fixtureReady || runtimeStatus && runtimeStatus.resultKind === "runtime-integration-probe"
      ? "fixture result observed · not production CV"
      : productionReady ? "local pose + bounded shuttle candidate · " + (runtimeStatus.backend ? backendLabel(runtimeStatus.backend) : "backend pending") : runtimeFallback ? "local analysis unavailable · playback unaffected" : "local runtime starting · nothing uploaded";
    var trackerSummary = ui.el("div", { className: "bv-tracker-summary" }, [ui.badge(degraded ? "some parts unsure" : "all working", degraded ? "warn" : "in"), ui.el("small", {}, [runtimeSummary])]);
    var evidenceRows = expanded ? visibilityTrackers.map(trackerRow).concat([ui.el("p", { className: "bv-helper bv-evidence-disclosure-help" }, ["Choose which live signals are drawn over the video. Automatic output remains local and unknown values are never guessed."]), courtProjectionToggle()]) : [];
    var trackerBody = ui.el("div", { className: "bv-evidence-section-body" }, [trackerSummary, ui.el("div", { className: "bv-tracker-list bv-evidence-disclosure", id: "bv-evidence-visibility-controls", role: "region", "aria-label": "Evidence visibility controls", "data-bso-evidence-disclosure": "true", hidden: !expanded }, evidenceRows)]);
    var trackerSection = section(trackerHeader, trackerBody, trackerAside);

    var densitySection = section(ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" } }, ["How much to show", ui.infoTip("How much to show", "Changes only what appears on the video. Everything is still analysed either way.")]), ui.segmented([{ value: "minimal", label: "Minimal" }, { value: "balanced", label: "Balanced" }, { value: "full", label: "Full" }], state.density, function (value) { dispatch({ type: "SET_DENSITY", value: value }, { type: "SET_DENSITY", value: value }); }, true));

    var panelItems = ["feed", "stats", "map", "controls"];
    var visiblePanelCount = panelItems.filter(function (key) { return state.panels[key]; }).length;
    var panelControlHeader = ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" } }, ["Panel Controls"]);
    var panelControlAside = ui.el("button", { className: "bv-link-button", type: "button", "aria-expanded": panelControlsExpanded, "aria-controls": "bv-panel-controls-list", "aria-label": (panelControlsExpanded ? "Collapse" : "Expand") + " Panel Controls", "data-bso-panel-controls-toggle": "true", onClick: togglePanelControlsDisclosure }, [visiblePanelCount + " of " + panelItems.length + " visible", ui.icon(panelControlsExpanded ? "chevron-up" : "chevron-down", 12)]);
    var panelControlRows = panelControlsExpanded ? [ui.el("p", { className: "bv-helper", style: { marginTop: "0" } }, ["The default video layer is detection-only. This popup sets which panels appear over the video, saved for this video; while watching, the Panels button over the video offers the same panels as quick shortcuts."]), panelToggle("Shots this rally", "Every stroke as it happens", "feed"), panelToggle("Rally stats", null, "stats"), panelToggle("Court map", "Where players and the shuttle are", "map"), panelToggle("Live controls", "Quick density and summary shortcuts", "controls")] : [];
    var panelControlsBody = ui.el("div", { className: "bv-panel-toggles" }, [ui.el("div", { className: "bv-panel-controls-disclosure", id: "bv-panel-controls-list", role: "region", "aria-label": "Panel Controls options", "data-bso-panel-controls-disclosure": "true", hidden: !panelControlsExpanded }, panelControlRows)]);
    var panelSection = section(panelControlHeader, panelControlsBody, panelControlAside);

    // Model selector section for pose detection
    var modelSelectHandler = function (event) {
      var previousModel = state.selectedPoseModel || DEFAULT_POSE_MODEL;
      var selectedModel = event.target.value;
      if (!selectedModel || selectedModel === previousModel) return;
      if (isWipPoseModel(selectedModel)) return; // Work-in-progress options are disabled; refuse programmatic selections too.
      state.selectedPoseModel = selectedModel;
      modelSwitchNotice = null;
      persist();
      writePoseModelPreference(selectedModel);
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage({ action: 'switchPoseModel', modelId: selectedModel }, function (response) {
          if (!response) return; // Offscreen analyzer not reachable; the stored preference applies when analysis starts.
          if (response.ok) {
            console.log('Model switched to:', selectedModel);
          } else {
            // The offscreen analyzer stayed on its previous model, so the
            // selector and the stored preference converge back to it.
            console.warn('Model switch failed:', response.reason);
            modelSwitchNotice = { error: response.reason || 'model-unavailable', modelId: selectedModel };
            state.selectedPoseModel = previousModel;
            persist();
            writePoseModelPreference(previousModel);
            render();
          }
        });
      }
    };
    var availabilityById = {};
    if (poseModelReport && Array.isArray(poseModelReport.models)) {
      poseModelReport.models.forEach(function (model) { availabilityById[model.id] = model; });
    }
    var modelOptions = POSE_MODEL_ENTRIES.map(function (opt) {
      var known = availabilityById[opt.value];
      var wip = isWipPoseModel(opt.value) || Boolean(known && known.reason === POSE_MODEL_WIP_REASON);
      // Work-in-progress entries are always disabled; otherwise an option is
      // disabled only when the offscreen probe reports it unavailable (the
      // currently active model stays selectable).
      var disabled = wip || Boolean(known && !known.available && state.selectedPoseModel !== opt.value);
      var title = null;
      var label = opt.label;
      if (wip) {
        label = opt.label + " (work in progress)";
        title = "Work in progress: switching to " + opt.label + " can freeze pose detection until the extension or the tab is reloaded. Disabled until it is fixed.";
      } else if (disabled && known && known.reason) {
        title = "Unavailable: " + known.reason;
      }
      return ui.el('option', { value: opt.value, disabled: disabled, title: title }, [label]);
    });
    var modelSelect = ui.el('select', {
      className: 'bv-model-selector',
      value: state.selectedPoseModel || DEFAULT_POSE_MODEL,
      onChange: modelSelectHandler,
      "data-bso-model-selector": "true"
    }, modelOptions);
    modelSelect.value = state.selectedPoseModel || DEFAULT_POSE_MODEL;
    var modelHelper = ui.el('p', { className: 'bv-helper' }, ['Select the pose detection model. Lightweight OpenPose is the bundled production default. BlazePose is work in progress: switching to it can freeze pose detection until the extension or the tab reloads, so it stays grayed out until fixed.']);
    if (modelSwitchNotice && modelSwitchNotice.error) {
      modelHelper = ui.callout('warn', 'Pose model not switched', 'The selected model could not start here. The reported cause: ' + modelSwitchNotice.error + '. The previous model remains active.', { tooltip: true });
    } else if (poseModelReport && poseModelReport.ok) {
      var activeModel = poseModelReport.currentModel ? availabilityById[poseModelReport.currentModel] : null;
      modelHelper = ui.el('p', { className: 'bv-helper' }, [activeModel ? 'Active model: ' + activeModel.label + '.' : 'Model choices update when analysis is running.']);
    }
    var modelSectionContent = ui.el('div', { className: 'bv-model-section-body' }, [modelHelper, modelSelect]);
    var modelSection = section(ui.el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-4)' } }, ['Pose Detection Model']), modelSectionContent);

    var primaryLabel = state.enabled ? "Open overlay" : "Turn on inference";
    var primary = ui.button(primaryLabel, { variant: "primary", full: true, icon: state.enabled ? "layout" : "play", disabled: !detected, title: !detected ? "Open a YouTube watch page first" : null, onClick: function () { dispatch({ type: state.enabled ? "OPEN_OVERLAY" : "ENABLE" }, { type: state.enabled ? "OPEN_OVERLAY" : "ENABLE" }, finishAction); } });
    primary.setAttribute("data-bso-action", state.enabled ? "open-overlay" : "enable");
    var seedButton = ui.button(courtSeeded ? "Recalibrate court" : "Set up court", { icon: "crosshair", disabled: !detected, title: !detected ? "Court setup needs a YouTube watch page" : courtSeeded ? "Replace the saved court mapping" : "Enable the court map; inference does not depend on setup", onClick: function () { dispatch({ type: "START_SEED" }, { type: "START_SEED" }, finishAction); } });
    seedButton.setAttribute("data-bso-action", "seed-court");
    var manualButton = ui.button("Label it myself", { icon: "pencil", disabled: !detected, title: !detected ? "Manual labeling needs a YouTube watch page" : null, onClick: function () { dispatch({ type: "OPEN_LABELING" }, { type: "OPEN_LABELING" }, finishAction); } });
    manualButton.setAttribute("data-bso-action", "manual-only");
    var disableButton = state.enabled ? ui.button("Disable overlay", { variant: "ghost", icon: "pause", onClick: function () { dispatch({ type: "DISABLE" }, { type: "DISABLE" }, finishAction); } }) : null;
    if (disableButton) disableButton.setAttribute("data-bso-action", "disable");
    var summaryButton = ui.button("See match summary · download data", { variant: "ghost", icon: "table", onClick: openSummary });
    summaryButton.setAttribute("data-bso-action", "export");
    var actions = ui.el("div", { className: "bv-footer-actions" }, [primary, ui.el("div", { className: "bv-footer-row" }, [seedButton, manualButton]), disableButton, summaryButton]);
    // Panel Controls precedes Evidence visibility: panels are the containers
    // a viewer picks first, evidence layers are the finer-grained content
    // drawn over the video; density and pose model stay below both.
    root.replaceChildren(header, intro, panelSection, trackerSection, densitySection, modelSection, actions);
    restoreDisclosureFocus();
    restorePanelControlsFocus();
  }

  function load() {
    if (!chromeAvailable() || !chrome.tabs) {
      detected = true;
      stateHydrated = true;
      render();
      replayPendingDispatches();
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tabUrl = tabs && tabs[0] && tabs[0].url;
      activeTabUrl = tabUrl || null;
      tabTitle = tabs && tabs[0] && tabs[0].title ? tabs[0].title : null;
      detected = isWatchPage(tabUrl);
      badmintonDetection = null;
      var activeVideoKey = window.BVState.videoKeyForUrl(tabUrl);
      // Expose the detected page before storage hydration completes. Any
      // action in this small window is queued and replayed against the stored
      // video-local state rather than being overwritten by the read callback.
      render();
      if (chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState", "bvRuntimeStatus", "bvVideoInfo", "bvSelectedPoseModel"], function (result) {
        if (result && result.bvState) {
          state = detected
            ? window.BVState.stateForVideo(result.bvState, activeVideoKey)
            : window.BVState.initialExtensionState(result.bvState);
          if (detected && state.seeded && !state.calibration) {
            // Invalidate only the malformed court record. Labels, panel
            // choices, and an enabled inference session are unrelated to the
            // court map and must survive this repair state.
            state = window.BVState.initialExtensionState(Object.assign({}, state, {
              seeded: false,
              seeding: false,
              calibration: null,
              seedPoints: [],
              seedDraftPoints: [],
              calibrationError: "This saved court has no fitted calibration. Set up the four outer corners to enable the court map."
            }));
          }
        } else if (detected) {
          state = window.BVState.stateForVideo(state, activeVideoKey);
        }
        if (result && result.bvRuntimeStatus) runtimeStatus = result.bvRuntimeStatus;
        if (result && result.bvVideoInfo) {
          videoInfo = result.bvVideoInfo;
          badmintonDetection = typeof videoInfo.badmintonDetected === "boolean" ? videoInfo.badmintonDetected : null;
        }
        if (result && result.bvSelectedPoseModel) state.selectedPoseModel = selectablePoseModel(result.bvSelectedPoseModel);
        // A work-in-progress selection persisted inside bvState (older builds
        // could store BlazePose before the entry was disabled) must not
        // re-select it either: the same filter guards both preference stores.
        state.selectedPoseModel = selectablePoseModel(state.selectedPoseModel);
        stateHydrated = true;
        persist();
        render();
        refreshPoseModelReport();
        replayPendingDispatches();
      }); else {
        state.videoKey = activeVideoKey;
        stateHydrated = true;
        render();
        refreshPoseModelReport();
        replayPendingDispatches();
      }
    });
  }
  render();
  load();
})();
