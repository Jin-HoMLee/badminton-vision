(function () {
  var ui = window.BVUI;
  var root = document.getElementById("app");
  var state = window.BVState.initialExtensionState();
  var expanded = false;
  var detected = false;
  var runtimeStatus = null;
  var messageSequence = 0;
  var stateHydrated = false;
  var pendingDispatches = [];
  var trackers = [
    { id: "court", label: "Court", health: "degraded", note: "not seeded", on: true },
    { id: "players", label: "Players", health: "degraded", note: "unknown · awaiting local runtime", on: true },
    { id: "body", label: "Body pose", health: "degraded", note: "starting · local pose model", on: true, disabled: false },
    { id: "shuttle", label: "Shuttle", health: "degraded", note: "unknown · awaiting local runtime", on: true },
    { id: "score", label: "Score OCR", health: "degraded", note: "partial", on: true },
    { id: "racket", label: "Racket", health: "unavailable", note: "not in MVP", on: false, disabled: true }
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
    if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") { finish(); return; }
    var files = contentScriptFiles();
    if (!files.length) { finish(); return; }
    chrome.scripting.executeScript({ target: { tabId: tabId }, files: files }, function () {
      var injectionError = chrome.runtime.lastError;
      if (injectionError) { finish(); return; }
      chrome.tabs.sendMessage(tabId, message, function () {
        void chrome.runtime.lastError;
        finish();
      });
    });
  }
  function sendToTab(message, onDone) {
    var finish = typeof onDone === "function" ? onDone : function () {};
    if (!chromeAvailable() || !chrome.tabs) { finish(); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || tab.id == null) { finish(); return; }
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
        finish();
      });
    });
  }
  function dispatch(action, message, onDone) {
    if (!stateHydrated) {
      pendingDispatches.push({ action: action, message: message, onDone: onDone });
      return;
    }
    state = window.BVState.reduceExtensionState(state, action);
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
  function isWatchPage(url) { return /^https?:\/\/(www\.)?youtube\.com\/watch(?:\?|$)/.test(url || ""); }
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
    var switchButton = ui.el("button", { className: "bv-mini-switch", type: "button", role: "switch", "aria-checked": tracker.on, disabled: tracker.disabled, title: tracker.disabled ? tracker.note : "Toggle " + tracker.label, "aria-label": "Toggle " + tracker.label, onClick: function () { dispatch({ type: "SET_TRACKER", tracker: tracker.id, value: !tracker.on }, { type: "SET_TRACKER", tracker: tracker.id, value: !tracker.on }); } }, [ui.el("i")]);
    return ui.el("div", { className: "bv-tracker-row" + (tracker.disabled ? " unavailable" : "") }, [ui.el("i", { className: "bv-tracker-dot " + dotClass }), ui.el("span", { className: "bv-tracker-label" }, [tracker.label]), ui.el("span", { className: "bv-tracker-meta" }, [ui.el("span", { className: "bv-tracker-note " + colorHealth }, [tracker.on ? tracker.note : "off"]), switchButton])]);
  }
  function panelToggle(label, description, key, disabled) {
    return ui.toggle(label, description, state.panels[key], function (next) { dispatch({ type: "TOGGLE_PANEL", panel: key, value: next }, { type: "SET_PANELS", panels: Object.assign({}, state.panels, { [key]: next }) }); }, { disabled: disabled, id: "panel-" + key });
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
      playerTracker.disabled = !productionReady;
      playerTracker.on = productionReady;
      playerTracker.health = productionReady && runtimeStatus.playerState === "tracked" ? "ok" : "degraded";
      playerTracker.note = productionReady ? ((runtimeStatus.playerCount || 0) + " visible · " + (runtimeStatus.playerState || "unknown")) : fixtureReady ? "unknown · fixture probe" : "unknown · local runtime";
    }
    if (shuttleTracker) {
      shuttleTracker.disabled = false;
      shuttleTracker.health = productionReady && runtimeStatus.shuttleState === "tracked" ? "ok" : "degraded";
      shuttleTracker.note = productionReady ? (runtimeStatus.shuttleState || "unknown") + " · bounded local candidate" : fixtureReady ? "unknown · fixture probe" : "unknown · awaiting local runtime";
    }
    if (racketTracker) {
      var racketSupported = Boolean(runtimeStatus && runtimeStatus.racketSupported);
      racketTracker.disabled = !racketSupported;
      racketTracker.health = racketSupported && runtimeStatus.racketState === "tracked" ? "ok" : racketSupported ? "degraded" : "unavailable";
      racketTracker.on = racketSupported ? racketTracker.on : false;
      racketTracker.note = racketSupported ? (runtimeStatus.racketState || "unknown") + " · runtime signal" : "unavailable · no runtime racket output";
    }
    trackers.forEach(function (tracker) {
      if (state.trackerSettings && state.trackerSettings[tracker.id] != null && !tracker.disabled) tracker.on = Boolean(state.trackerSettings[tracker.id]);
    });
    var trackerCount = trackers.filter(function (t) { return t.on; }).length;
    var degraded = trackers.some(function (t) { return t.on && t.health === "degraded"; });
    var runtimeFallback = runtimeStatus && (runtimeStatus.phase === "fallback" || runtimeStatus.inference === false && runtimeStatus.analyzer === "none");
    var runtimeStale = Boolean(state.stale || runtimeStatus && runtimeStatus.stale);
    var runtimeReady = Boolean(runtimeStatus && runtimeStatus.inference && runtimeStatus.analyzer && runtimeStatus.analyzer !== "none");
    var courtSeeded = Boolean(state.seeded && state.calibration && state.seedPoints && state.seedPoints.length === 4);
    root.setAttribute("data-bso-popup", "true");
    root.setAttribute("data-bso-youtube-detected", String(Boolean(detected)));
    root.setAttribute("data-bso-enabled", String(Boolean(state.enabled)));
    root.setAttribute("data-bso-court-state", courtSeeded ? "seeded" : state.seeding ? "seeding" : "not-seeded");
    root.setAttribute("data-bso-runtime-phase", runtimeStatus && runtimeStatus.phase || (state.enabled ? "starting" : "idle"));
    root.setAttribute("data-bso-runtime-analyzer", runtimeStatus && runtimeStatus.analyzer || "none");
    root.setAttribute("data-bso-inference", String(Boolean(runtimeStatus && runtimeStatus.inference)));
    root.setAttribute("data-bso-frame-transport", runtimeStatus && runtimeStatus.frameTransport || "unknown");
    root.setAttribute("data-bso-backend", runtimeStatus && runtimeStatus.backend || "unknown");
    root.setAttribute("data-bso-fallback", runtimeFallback ? (runtimeStatus.reason || "runtime-fallback") : "none");
    trackers[0].note = courtSeeded ? "seeded" : "not seeded";
    trackers[0].health = courtSeeded ? "ok" : "degraded";
    var header = ui.el("header", { className: "bv-popup-header" }, [ui.el("span", { className: "bv-logo" }, [ui.el("img", { src: "design-system/assets/logo-mark.svg", alt: "" }), ui.el("strong", { className: "bv-logo-name" }, ["Badminton Vision"])]), ui.el("span", { className: "bv-popup-head-actions" }, [ui.iconButton("settings", "Settings unavailable in local demo", { size: "sm", disabled: true }), ui.iconButton("x", "Close", { size: "sm", onClick: closePopup })])]);
    var statusState = state.enabled ? (runtimeFallback || runtimeStale ? "stale" : "live") : "ready";
    var statusLabel = state.seeding ? "Court setup in progress" : state.enabled ? (runtimeFallback ? "Analysis fallback" : runtimeStale ? "Analysis behind" : "Rally " + state.rally) : detected ? "Badminton match found" : "No YouTube match";
    var statusDetail = state.enabled ? (runtimeStale && runtimeStatus && Number.isFinite(runtimeStatus.ageSeconds) ? "+" + runtimeStatus.ageSeconds.toFixed(1) + "s" : productionReady ? (runtimeStatus.backend || "local") : fixtureReady ? "fixture probe · not production CV" : state.time) : null;
    var backendNotice = runtimeFallback
      ? ui.callout("warn", "Production inference unavailable", "This build could not start its local computer-vision runtime. Playback is unaffected and manual labeling remains available.")
      : productionReady
        ? ui.callout("guide", "Local pose + shuttle runtime active", "Pose tracking stays on-device. The shuttle signal is a bounded candidate proposal; shot, rally-end, and winner fields remain unknown until evidence supports them.")
        : fixtureReady
          ? ui.callout("guide", "Local fixture demo", "Any fixture result is an integration probe, not production CV. Nothing is uploaded; labels and corrections stay local.")
          : ui.callout("guide", "Local runtime pending", "The local pose model is starting. Until evidence arrives, player, shuttle, shot, rally-end, and winner fields remain unknown.");
    var intro = ui.el("div", { className: "bv-popup-intro" }, [ui.statusChip(statusState, statusLabel, statusDetail), ui.el("div", { className: "bv-detected" }, [ui.el("span", { className: "bv-detected-icon" }, [ui.icon(detected ? "check" : "info", 15)]), ui.el("span", { className: "bv-detected-copy" }, [ui.el("strong", {}, [detected ? fixture.video.title : "Open a YouTube match"]), ui.el("span", {}, [detected ? fixture.video.channel + " · " + fixture.video.duration : "Badminton Vision runs on youtube.com/watch pages only."])])]), !detected ? ui.callout("info", "Overlay unavailable here", "Open a youtube.com/watch page to use live overlay, court setup, or manual labeling. The summary remains available locally.") : backendNotice, !state.enabled && detected ? ui.callout("guide", "Three steps to get going", "Turn the overlay on, click the four court corners once, then keep watching — the video is never paused or moved.") : null, state.cameraCut ? ui.callout("warn", "Camera cut", "The court projection is stale. Re-seed the court; analysis stays paused while the video keeps playing.") : null]);

    var barNodes = trackers.map(function (t) { return ui.el("i", { className: t.on ? (t.health === "degraded" ? "warn" : "") : "off" }); });
    var trackerHeader = ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" } }, ["What's being tracked", ui.el("span", { className: "bv-tracker-bars" }, barNodes)]);
    var trackerAside = ui.el("button", { className: "bv-link-button", type: "button", onClick: function () { expanded = !expanded; render(); } }, [trackerCount + " of " + trackers.length + " on", ui.icon(expanded ? "chevron-up" : "chevron-down", 12)]);
    var runtimeSummary = fixtureReady || runtimeStatus && runtimeStatus.resultKind === "runtime-integration-probe"
      ? "fixture result observed · not production CV"
      : productionReady ? "local pose + bounded shuttle candidate · " + (runtimeStatus.backend || "backend pending") : runtimeFallback ? "local analysis unavailable · playback unaffected" : "local runtime starting · nothing uploaded";
    var trackerBody = expanded ? ui.el("div", { className: "bv-tracker-list" }, trackers.map(trackerRow).concat([ui.el("p", { className: "bv-helper" }, ["Automatic output stays evidence-aware. If a signal is unknown, dependent values stay blank rather than being guessed."])])) : ui.el("div", { className: "bv-tracker-summary" }, [ui.badge(degraded ? "some parts unsure" : "all working", degraded ? "warn" : "in"), ui.el("small", {}, [runtimeSummary]) ]);
    var trackerSection = section(trackerHeader, trackerBody, trackerAside);

    var densitySection = section(ui.el("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" } }, ["How much to show", ui.infoTip("How much to show", "Changes only what appears on the video. Everything is still analysed either way.")]), ui.segmented([{ value: "minimal", label: "Minimal" }, { value: "balanced", label: "Balanced" }, { value: "full", label: "Full" }], state.density, function (value) { dispatch({ type: "SET_DENSITY", value: value }, { type: "SET_DENSITY", value: value }); }, true));
    var panelSection = section("Panels on the video", ui.el("div", { className: "bv-panel-toggles" }, [panelToggle("Shots this rally", "Every stroke as it happens", "feed"), panelToggle("Rally stats", null, "stats"), panelToggle("Court map", "Where players and the shuttle are", "map"), ui.toggle("Compare with the pros", "Coming later — needs a licensed benchmark", false, null, { disabled: true, id: "panel-pro" })]));

    var primaryLabel = state.enabled ? "Open overlay" : "Turn on — step 1 of 3";
    var primary = ui.button(primaryLabel, { variant: "primary", full: true, icon: state.enabled ? "layout" : "play", disabled: !detected, title: !detected ? "Open a YouTube watch page first" : null, onClick: function () { dispatch({ type: state.enabled ? "OPEN_OVERLAY" : "ENABLE" }, { type: state.enabled ? "OPEN_OVERLAY" : "ENABLE" }, closePopup); } });
    primary.setAttribute("data-bso-action", state.enabled ? "open-overlay" : "enable");
    var seedButton = ui.button(courtSeeded ? "Set up court again" : "Set up court", { icon: "crosshair", disabled: !detected, title: !detected ? "Court setup needs a YouTube watch page" : null, onClick: function () { dispatch({ type: "START_SEED" }, { type: "START_SEED" }, closePopup); } });
    seedButton.setAttribute("data-bso-action", "seed-court");
    var manualButton = ui.button("Label it myself", { icon: "pencil", disabled: !detected, title: !detected ? "Manual labeling needs a YouTube watch page" : null, onClick: function () { dispatch({ type: "OPEN_LABELING" }, { type: "OPEN_LABELING" }, closePopup); } });
    manualButton.setAttribute("data-bso-action", "manual-only");
    var disableButton = state.enabled ? ui.button("Disable overlay", { variant: "ghost", icon: "pause", onClick: function () { dispatch({ type: "DISABLE" }, { type: "DISABLE" }, closePopup); } }) : null;
    if (disableButton) disableButton.setAttribute("data-bso-action", "disable");
    var summaryButton = ui.button("See match summary · download data", { variant: "ghost", icon: "table", onClick: openSummary });
    summaryButton.setAttribute("data-bso-action", "export");
    var actions = ui.el("div", { className: "bv-footer-actions" }, [primary, ui.el("div", { className: "bv-footer-row" }, [seedButton, manualButton]), disableButton, summaryButton]);
    root.replaceChildren(header, intro, trackerSection, densitySection, panelSection, actions);
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
      detected = isWatchPage(tabUrl);
      var activeVideoKey = window.BVState.videoKeyForUrl(tabUrl);
      // Expose the detected page before storage hydration completes. Any
      // action in this small window is queued and replayed against the stored
      // video-local state rather than being overwritten by the read callback.
      render();
      if (chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState", "bvRuntimeStatus"], function (result) {
        if (result && result.bvState) {
          state = detected
            ? window.BVState.stateForVideo(result.bvState, activeVideoKey)
            : window.BVState.initialExtensionState(result.bvState);
          if (detected && state.seeded && !state.calibration) {
            state = window.BVState.resetVideoLocalState(state, activeVideoKey);
          }
        } else if (detected) {
          state = window.BVState.stateForVideo(state, activeVideoKey);
        }
        if (result && result.bvRuntimeStatus) runtimeStatus = result.bvRuntimeStatus;
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
