(function () {
  var ui = window.BVUI;
  var data = window.BVFixtures;
  var app = document.getElementById("app");
  var filter = "all";
  var mapMode = "call";
  var notice = "";
  var runtimeStatus = null;
  var storedState = window.BVState ? window.BVState.initialExtensionState() : { manualLabels: [] };

  function fixtureRuntime() {
    return Boolean(runtimeStatus && (runtimeStatus.resultKind === "runtime-integration-probe" || runtimeStatus.analyzer === "fixture-probe-v1"));
  }
  function runtimeResult() {
    return runtimeStatus && runtimeStatus.result && typeof runtimeStatus.result === "object" ? runtimeStatus.result : null;
  }
  function evidenceStrokes() {
    var result = runtimeResult();
    if (fixtureRuntime()) return data.strokes.slice();
    return result && Array.isArray(result.strokeEvents) ? result.strokeEvents : [];
  }

  function formatTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var remaining = Math.floor(seconds % 60);
    return String(minutes).padStart(2, "0") + ":" + String(remaining).padStart(2, "0");
  }
  function count(predicate) { return data.landings.filter(predicate).length; }
  function copyTimestamp(rally) {
    var text = formatTime(rally.startSec);
    notice = "Timestamp " + text + " ready. Playback was not changed.";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        notice = "Timestamp " + text + " copied. Playback was not changed.";
        render();
      }).catch(function () { render(); });
    } else render();
  }
  function download(name, content) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
  }
  function reviewStrokes() {
    return window.BVReview ? window.BVReview.mergeStrokes(evidenceStrokes(), storedState.manualLabels) : evidenceStrokes();
  }
  function shotRows() {
    var videoUrl = storedState.videoUrl || data.video.url;
    return reviewStrokes().map(function (stroke, index) {
      return window.BVReview ? window.BVReview.toShotRow(stroke, videoUrl, index) : { video_url: videoUrl, shot_id: stroke.eventId, label: stroke.shot || "unclassified" };
    });
  }
  function backToVideo() {
    var from = "";
    try { from = new URLSearchParams(window.location.search).get("from") || ""; } catch (_) {}
    if (from && typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (tab && tab.id != null && chrome.tabs.update) chrome.tabs.update(tab.id, { url: from });
        else if (window.location) window.location.href = from;
      });
    } else if (from && window.location) {
      window.location.href = from;
    } else if (window.close) {
      window.close();
      // window.close() is a no-op for a tab not opened by script. History is
      // the local fallback for a summary opened without a source URL.
      if (window.history && window.history.back) window.history.back();
    } else if (window.history && window.history.back) window.history.back();
  }
  function rallyRows() {
    var result = runtimeResult();
    var rallies = fixtureRuntime() ? data.rallies : result && Array.isArray(result.rallies) ? result.rallies : [];
    var ranked = window.BVAnalysis.rankRallies(rallies);
    return ranked.map(function (rally) { return { rally_id: rally.rallyId, start_sec: rally.startSec, end_sec: rally.endSec, shot_count: rally.shots, winner: rally.outcome === "winner" ? "true" : "false", lose_reason: rally.outcome === "winner" ? "" : rally.outcome, highlight_index: rally.index, aggregate_confidence: rally.meanTrackingConfidence }; });
  }
  function block(title, meta, body) {
    return ui.el("section", { className: "bv-block" }, [
      ui.el("div", { className: "bv-block-heading" }, [ui.el("h2", {}, [title]), meta ? ui.el("span", {}, [meta]) : null]),
      body
    ]);
  }
  function render() {
    var result = runtimeResult();
    var diagnostic = fixtureRuntime();
    var ranked = window.BVAnalysis.rankRallies(diagnostic ? data.rallies : result && Array.isArray(result.rallies) ? result.rallies : []).slice(0, 5);
    var header = ui.el("header", { className: "bv-summary-header" }, [
      ui.iconButton("arrow-left", "Back to video", { variant: "solid", size: "md", onClick: backToVideo }),
      ui.el("div", { className: "bv-summary-heading" }, [
        ui.el("h1", {}, ["Match summary"]),
        ui.el("p", {}, [data.video.title + " · local data only, nothing uploaded"])
      ]),
      ui.el("div", { className: "bv-summary-actions" }, [
        ui.button("Shots CSV", { icon: "download", onClick: function () { download("badminton-vision-shots.csv", window.BVAnalysis.toShotsCsv(shotRows())); } }),
        ui.button("Rallies CSV", { variant: "primary", icon: "download", onClick: function () { download("badminton-vision-rallies.csv", window.BVAnalysis.toRalliesCsv(rallyRows())); } })
      ])
    ]);
    var runtimeNotice = runtimeStatus && runtimeStatus.phase === "fallback"
      ? ui.callout("warn", "Local analysis fallback", "Playback was unaffected. Manual labels remain available; no production CV result is asserted.")
      : runtimeStatus && runtimeStatus.inference && runtimeStatus.analyzer !== "fixture-probe-v1"
        ? ui.callout("guide", "Local pose runtime active", "Pose tracking runs on-device and the bounded shuttle candidate stays local. Rally shots, rally ends, and winner attribution remain unknown unless evidence supports them.")
        : ui.callout("guide", runtimeStatus && runtimeStatus.resultKind === "runtime-integration-probe" ? "Fixture result observed" : "Fixture analyzer boundary", "The deterministic local fixture is an integration probe, not production CV. Player detections remain unknown/partial; manual labels stay local and editable.");
    var reviewedStrokes = reviewStrokes();
    var shotTotal = reviewedStrokes.length;
    var rallyCount = diagnostic ? "42" : "unknown";
    var manualCount = storedState.manualLabels.filter(function (label) { return label && label.source === "manual"; }).length;
    var reviewMeta = diagnostic
      ? (manualCount ? "42 rallies · " + shotTotal + " shots · " + manualCount + " manual review" + (manualCount === 1 ? "" : "s") + " · fixture probe" : "42 rallies · " + shotTotal + " shots · manual + fixture probe")
      : manualCount + " manual label" + (manualCount === 1 ? "" : "s") + " · automatic rally analysis unknown";
    var overview = block("Overview", reviewMeta, ui.el("div", { className: "bv-overview-grid" }, [ui.stat("Match duration", diagnostic ? "1:12:40" : "unknown"), ui.stat("Rallies", rallyCount), ui.stat("Shots", shotTotal || "unknown"), ui.stat("Avg rally", diagnostic ? "8.4" : "unknown", diagnostic ? "shots" : "", diagnostic ? "42 rallies" : "not segmented"), ui.stat("Longest rally", diagnostic ? "31" : "unknown", diagnostic ? "shots" : "", diagnostic ? "rally 23 · 18:42" : "no accepted rally end", true)]));
    var filters = ui.el("div", { className: "bv-filter-row", "aria-label": "Shot mix filters" }, [ui.chip("All", filter === "all", function () { filter = "all"; render(); }), ui.chip("Player A", filter === "player a", function () { filter = "player a"; render(); }), ui.chip("Player B", filter === "player b", function () { filter = "player b"; render(); })]);
    var mixes = diagnostic
      ? ui.el("div", { className: "bv-summary-two-col" }, [block("Shot mix", "18 unclassified", ui.el("div", {}, [ui.mixBar(data.shotMix), filters])), block("Winner / error attribution", "12 unclassified", ui.el("div", {}, [ui.mixBar(data.outcomeMix), ui.el("p", { className: "bv-disclaimer", style: { marginTop: "var(--sp-6)" } }, ["Attribution needs a known final landing and player identity. Where either is missing the rally stays unclassified rather than being guessed."]) ]))])
      : ui.el("div", { className: "bv-summary-two-col" }, [block("Shot mix", "unknown", ui.callout("guide", "No classified shots", "The local pose and shuttle signals do not establish a shot family. Add editable manual labels to build this mix.")), block("Winner / error attribution", "unknown", ui.callout("guide", "Unclassified", "A winner or error requires a known final landing, rally termination, and player identity; this runtime has not established those fields."))]);
    var rallyList = ui.el("div", { className: "bv-rally-list" }, ranked.map(function (rally, index) { rally.timestamp = formatTime(rally.startSec); return ui.rallyRow(rally, index + 1, copyTimestamp); }));
    if (!ranked.length) rallyList.appendChild(ui.emptyState("No completed rallies", "Rally end and highlight index remain unknown until accepted event evidence is available.", null, "help"));
    var rallyFoot = ui.el("div", { className: "bv-footnote" }, [ui.badge(diagnostic ? "*partial" : "unknown", diagnostic ? "warn" : "unknown"), ui.el("span", {}, [diagnostic ? "index = 0.40 length percentile + 0.25 variety + 0.20 outcome pressure + 0.15 mean tracking confidence. Score OCR unavailable on starred rallies, so outcome pressure used the ordinary-state value." : "Highlights index is unavailable until at least ten completed rallies have accepted event evidence."]) ]);
    if (notice) rallyFoot.appendChild(ui.el("span", { role: "status", style: { marginLeft: "auto", color: "var(--signal-in)" } }, [notice]));
    var topRallies = block("Top rallies", diagnostic ? "highlights index · deterministic · 12-rally sample" : "highlights index · unavailable", ui.el("div", {}, [rallyList, rallyFoot]));
    var visibleLandings = diagnostic ? data.landings.filter(function (point) { return filter === "all" || point.side === (filter === "player a" ? "a" : "b"); }) : [];
    var located = visibleLandings.filter(function (point) { return point.call !== "UNKNOWN"; }).length;
    var visibleCount = function (predicate) { return visibleLandings.filter(predicate).length; };
    var map = ui.el("div", { className: "bv-map-layout" }, [ui.el("div", {}, [ui.courtDiagram({ renderWidth: 190, labels: true, landings: visibleLandings, colorBy: mapMode, ariaLabel: "Court landing map" })]), ui.el("div", { className: "bv-map-copy" }, [ui.segmented([{ value: "call", label: "By line call" }, { value: "player", label: "By player" }, { value: "pro", label: "Compare to pro", disabled: true }], mapMode, function (value) { mapMode = value; render(); }), ui.el("p", {}, [diagnostic ? "One dot per shot: the point on the court where the shuttle came down, for every rally in this match. Dots are projected through the court seed onto the canonical 13.40 × 6.10 m court, so they are comparable across camera angles and across videos." : "No accepted landing evidence is available from the local runtime. The bounded shuttle candidate is not a line call or landing claim."]), mapMode === "player" ? ui.legend([{ color: "var(--player-a)", label: "Player A hit it", value: visibleCount(function (point) { return point.side === "a"; }) }, { color: "var(--player-b)", label: "Player B hit it", value: visibleCount(function (point) { return point.side === "b"; }) }]) : ui.legend([{ color: "var(--signal-in)", label: "Landed in", value: visibleCount(function (point) { return point.call === "IN"; }) }, { color: "var(--signal-out)", label: "Landed out", value: visibleCount(function (point) { return point.call === "OUT"; }) }, { color: "var(--signal-unknown)", label: "Not located", value: visibleCount(function (point) { return point.call === "UNKNOWN"; }), dashed: true }]), ui.el("p", { className: "bv-disclaimer" }, [diagnostic ? "A 40 mm line belongs to the area it bounds (BWF Law 1.3), so a shuttle touching the line reads IN. Shots the shuttle tracker could not locate stay dashed and are excluded from the counts above." : "A 40 mm line belongs to the area it bounds (BWF Law 1.3), but this runtime has no accepted landing or line-call evidence."])])]);
    var landingMap = block("Where the shuttle landed", located + " of " + visibleLandings.length + " shots located · " + (visibleLandings.length - located) + " unknown", map);
    app.replaceChildren(ui.el("div", { className: "bv-summary-inner" }, [header, runtimeNotice, overview, mixes, topRallies, landingMap]));
  }
  render();
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["bvState", "bvRuntimeStatus"], function (result) {
      if (result && result.bvState && window.BVState) storedState = window.BVState.initialExtensionState(result.bvState);
      if (result && result.bvRuntimeStatus) runtimeStatus = result.bvRuntimeStatus;
      render();
    });
    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) chrome.storage.onChanged.addListener(function (changes) {
      if (changes.bvState && changes.bvState.newValue && window.BVState) storedState = window.BVState.initialExtensionState(changes.bvState.newValue);
      if (changes.bvRuntimeStatus && changes.bvRuntimeStatus.newValue) runtimeStatus = changes.bvRuntimeStatus.newValue;
      render();
    });
  }
})();
