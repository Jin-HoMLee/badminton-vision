(function () {
  var ui = window.BVUI;
  var root = document.getElementById("app");
  var state = window.BVState.initialExtensionState();
  var expanded = false;
  var disclosureFocusTarget = null;
  var detected = false;
  var runtimeStatus = null;
  var actionError = null;
  var messageSequence = 0;
  var stateHydrated = false;
  var pendingDispatches = [];
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
    { id: "racket", label: "Racket evidence", health: "unavailable", note: "not in MVP", on: false, disabled: true }
  ];

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

  function render() {
    var fixture = window.BVFixtures;
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
        poseTracker.note = runtimeStatus.backend ? "local pose model · " + runtimeStatus.backend : "local pose model";
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
    var header = ui.el("header", { className: "bv-popup-header" }, [ui.el("span", { className: "bv-logo" }, [ui.el("img", { src: "design-system/assets/logo-mark.svg", alt: "" }), ui.el("strong", { className: "bv-logo-name" }, ["Badminton Vision"])]), ui.el("span", { className: "bv-popup-head-actions" }, [ui.iconButton("settings", "Settings unavailable in local demo", { size: "sm", disabled: true }), ui.iconButton("x", "Close", { size: "sm", onClick: closePopup })])]);
    var statusState = state.enabled ? (runtimeFallback || runtimeStale ? "stale" : "live") : "ready";
    var statusLabel = state.seeding ? "Court setup in progress" : state.enabled ? (runtimeFallback ? "Analysis fallback" : runtimeStale ? "Analysis behind" : "Rally " + state.rally) : detected ? "Badminton match found" : "No YouTube match";
    var statusDetail = state.enabled ? (runtimeStale && runtimeStatus && Number.isFinite(runtimeStatus.ageSeconds) ? "+" + runtimeStatus.ageSeconds.toFixed(1) + "s" : productionReady ? (runtimeStatus.backend || "local") : fixtureReady ? "fixture probe · not production CV" : state.time) : null;
    var backendDetail = runtimeFallback
      ? (function () {
        var parts = [];
        if (runtimeStatus && runtimeStatus.backend) parts.push('backend ' + runtimeStatus.backend);
        if (runtimeStatus && runtimeStatus.reason && runtimeStatus.reason !== 'runtime-fallback') parts.push(runtimeStatus.reason);
        if (runtimeStatus && Array.isArray(runtimeStatus.fallbacks)) {
          runtimeStatus.fallbacks.forEach(function (fallback) { if (parts.indexOf(fallback) < 0) parts.push(fallback); });
        }
        return parts.length ? ' The reported cause: ' + parts.join(', ') + '.' : '';
      })()
      : '';
    var backendNotice = runtimeFallback
      ? ui.callout("warn", "Production inference unavailable", "This build could not start its local computer-vision runtime. Playback is unaffected and manual labeling remains available." + backendDetail)
      : productionReady
        ? ui.callout("guide", "Local pose + shuttle runtime active", "Pose tracking stays on-device. The shuttle signal is a bounded candidate proposal; shot, rally-end, and winner fields remain unknown until evidence supports them.")
        : fixtureReady
          ? ui.callout("guide", "Local fixture demo", "Any fixture result is an integration probe, not production CV. Nothing is uploaded; labels and corrections stay local.")
          : ui.callout("guide", "Local runtime pending", "The local pose model is starting. Until evidence arrives, player, shuttle, shot, rally-end, and winner fields remain unknown.");
    var intro = ui.el("div", { className: "bv-popup-intro" }, [ui.statusChip(statusState, statusLabel, statusDetail), ui.el("div", { className: "bv-detected" }, [ui.el("span", { className: "bv-detected-icon" }, [ui.icon(detected ? "check" : "info", 15)]), ui.el("span", { className: "bv-detected-copy" }, detectedChildren)]), actionError ? ui.callout("warn", "Could not reach the YouTube tab", actionError + " Reload the tab and try again.") : null, !detected ? ui.callout("info", "Overlay unavailable here", "Open a youtube.com/watch page to use live overlay, court setup, or manual labeling. The summary remains available locally.") : backendNotice, !state.enabled && detected ? ui.callout("guide", "Inference starts independently", "Turn on the overlay to run body pose, shuttle, and racket evidence. Court setup is optional and only enables court-map projection.") : state.enabled && courtConfiguration === "recalibrating" ? ui.callout("info", "Court map recalibration in progress", "Raw video detections stay live. Finish the four-corner setup to replace the previous court-relative mapping.") : state.enabled && courtConfiguration !== "calibrated" ? ui.callout("info", "Court map not set up", "Raw video detections stay live without calibration. Set up the court only when you want projected court-relative coordinates.") : null, state.cameraCut ? ui.callout("warn", "Camera cut", "The court projection is stale. Re-seed the court; raw inference continues while the video keeps playing.") : null]);

    var barNodes = visibilityTrackers.map(function (t) { return ui.el("i", { className: t.on ? (t.health === "degraded" ? "warn" : "") : "off" }); }).concat([ui.el("i", { className: projectionVisible ? "" : "off" })]);
    var trackerHeader = ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" } }, ["Evidence visibility", ui.el("span", { className: "bv-tracker-bars" }, barNodes)]);
    var trackerAside = ui.el("button", { className: "bv-link-button", type: "button", "aria-expanded": expanded, "aria-controls": "bv-evidence-visibility-controls", "aria-label": (expanded ? "Collapse" : "Expand") + " Evidence visibility controls", "data-bso-evidence-disclosure-toggle": "true", onClick: toggleEvidenceDisclosure }, [visibleEvidenceCount + " of " + evidenceControlCount + " visible", ui.icon(expanded ? "chevron-up" : "chevron-down", 12)]);
    var runtimeSummary = fixtureReady || runtimeStatus && runtimeStatus.resultKind === "runtime-integration-probe"
      ? "fixture result observed · not production CV"
      : productionReady ? "local pose + bounded shuttle candidate · " + (runtimeStatus.backend || "backend pending") : runtimeFallback ? "local analysis unavailable · playback unaffected" : "local runtime starting · nothing uploaded";
    var trackerSummary = ui.el("div", { className: "bv-tracker-summary" }, [ui.badge(degraded ? "some parts unsure" : "all working", degraded ? "warn" : "in"), ui.el("small", {}, [runtimeSummary])]);
    var evidenceRows = expanded ? visibilityTrackers.map(trackerRow).concat([ui.el("p", { className: "bv-helper bv-evidence-disclosure-help" }, ["Choose which live signals are drawn over the video. Automatic output remains local and unknown values are never guessed."]), courtProjectionToggle()]) : [];
    var trackerBody = ui.el("div", { className: "bv-evidence-section-body" }, [trackerSummary, ui.el("div", { className: "bv-tracker-list bv-evidence-disclosure", id: "bv-evidence-visibility-controls", role: "region", "aria-label": "Evidence visibility controls", "data-bso-evidence-disclosure": "true", hidden: !expanded }, evidenceRows)]);
    var trackerSection = section(trackerHeader, trackerBody, trackerAside);

    var densitySection = section(ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" } }, ["How much to show", ui.infoTip("How much to show", "Changes only what appears on the video. Everything is still analysed either way.")]), ui.segmented([{ value: "minimal", label: "Minimal" }, { value: "balanced", label: "Balanced" }, { value: "full", label: "Full" }], state.density, function (value) { dispatch({ type: "SET_DENSITY", value: value }, { type: "SET_DENSITY", value: value }); }, true));
    var panelSection = section("On-video controls", ui.el("div", { className: "bv-panel-toggles" }, [ui.el("p", { className: "bv-helper", style: { marginTop: "0" } }, ["The default video layer is detection-only. Choose a panel here when you want it over the video; these choices are saved for this video."]), panelToggle("Shots this rally", "Every stroke as it happens", "feed"), panelToggle("Rally stats", null, "stats"), panelToggle("Court map", "Where players and the shuttle are", "map"), panelToggle("Live controls", "Quick density and summary shortcuts", "controls"), ui.toggle("Compare with the pros", "Coming later — needs a licensed benchmark", false, null, { disabled: true, id: "panel-pro" })]));

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
    root.replaceChildren(header, intro, trackerSection, densitySection, panelSection, actions);
    restoreDisclosureFocus();
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
      if (chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState", "bvRuntimeStatus", "bvVideoInfo"], function (result) {
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
        stateHydrated = true;
        persist();
        render();
        replayPendingDispatches();
      }); else {
        state.videoKey = activeVideoKey;
        stateHydrated = true;
        render();
        replayPendingDispatches();
      }
    });
  }
  render();
  load();
})();
