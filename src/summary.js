(function () {
  var ui = window.BVUI;
  var data = window.BVFixtures;
  var app = document.getElementById("app");
  var filter = "all";
  var mapMode = "call";
  var notice = "";
  var runtimeStatus = null;
  var storedState = window.BVState ? window.BVState.initialExtensionState() : { manualLabels: [] };
  // Keep the raw storage object as well as the current UI-state projection:
  // an older state normalizer only accepts a flat manualLabels array, while a
  // durable worker may persist that field as a per-video map.
  var storedManualSource = storedState;

  function formatTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var remaining = Math.floor(seconds % 60);
    return String(minutes).padStart(2, "0") + ":" + String(remaining).padStart(2, "0");
  }
  function count(predicate) { return data.landings.filter(predicate).length; }
  function currentVideoUrl() {
    var from = "";
    try { from = new URLSearchParams(window.location.search).get("from") || ""; } catch (_) {}
    return storedState.videoUrl || storedManualSource.videoUrl || (from && /^https?:/.test(from) ? from : data.video.url);
  }
  function currentVideoLabel() {
    var url = currentVideoUrl();
    return url === data.video.url ? data.video.title : "selected local video";
  }
  function manualDatasetSummary() {
    var options = { videoUrl: currentVideoUrl(), datasetLabel: currentVideoLabel() };
    if (storedState.videoKey || storedManualSource.videoKey) options.videoKey = storedState.videoKey || storedManualSource.videoKey;
    return window.BVAnalysis.calculateManualDatasetSummary(storedManualSource, options);
  }
  function manualSummaryViewModel(summary) {
    var dataset = summary && summary.dataset || {};
    var identity = dataset.videoKey || dataset.videoUrl || dataset.label || "selected local video";
    var total = summary ? summary.totalLabels : 0;
    var classified = summary && summary.classifiedCount || 0;
    var unclassified = summary && summary.unclassifiedCount || 0;
    return {
      dataset: identity,
      total: total,
      classified: classified,
      unclassified: unclassified,
      classifiedText: summary && summary.classifiedPercentage != null ? classified + " (" + summary.classifiedPercentage + "%)" : classified + " (unknown coverage)",
      unclassifiedText: summary && summary.unclassifiedPercentage != null ? unclassified + " (" + summary.unclassifiedPercentage + "%)" : unclassified + " (unknown coverage)",
      timestampText: summary && summary.timestamps && summary.timestamps.percentage != null ? summary.timestamps.knownCount + " / " + total + " (" + summary.timestamps.percentage + "%)" : "unknown — timestamps unavailable",
      empty: total === 0
    };
  }
  window.BVSummary = Object.freeze({ manualSummaryViewModel: manualSummaryViewModel });
  if (!app) return;
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
    return window.BVReview ? window.BVReview.mergeStrokes(data.strokes, storedState.manualLabels) : data.strokes.slice();
  }
  function shotRows() {
    var videoUrl = currentVideoUrl();
    var manualRecords = manualDatasetSummary().records;
    var rows = reviewStrokes().map(function (stroke, index) {
      return window.BVReview ? window.BVReview.toShotRow(stroke, videoUrl, index) : { video_url: videoUrl, shot_id: stroke.eventId, label: stroke.shot || "unclassified" };
    });
    // The raw durable map may not be representable by the older review/state
    // projection. Overlay manual rows by event id and append new manual events
    // so export does not silently lose a per-video label collection.
    manualRecords.forEach(function (manual, index) {
      var manualRow = window.BVAnalysis.manualRecordToShotRow(manual, videoUrl, index);
      var existing = rows.findIndex(function (row) { return row.shot_id != null && String(row.shot_id) === String(manualRow.shot_id); });
      if (existing < 0) rows.push(manualRow);
      else rows[existing] = Object.assign({}, rows[existing], manualRow);
    });
    return rows;
  }
  function manualDatasetBlock(summary) {
    var model = manualSummaryViewModel(summary);
    var meta = model.total + " manual label" + (model.total === 1 ? "" : "s") + " · selected local dataset";
    if (model.empty) {
      return block("Manual labels", meta, ui.emptyState("No manual labels yet", "No manually saved labels are available for " + model.dataset + ". Fixture rows and unverified model suggestions are excluded from this dataset.", null, "pencil"));
    }
    var shotSegments = Object.keys(summary.shotLabelCounts).map(function (label) {
      return { label: label, value: summary.shotLabelCounts[label], color: label === "Clear" ? "var(--player-a)" : label === "Smash" ? "var(--lime-500)" : "#2f8f77" };
    });
    if (summary.unclassifiedCount) shotSegments.push({ label: "Unclassified", value: summary.unclassifiedCount, color: "var(--signal-unknown)" });
    var details = [
      ui.el("p", { className: "bv-disclaimer" }, ["Dataset: " + model.dataset + ". These statistics use only saved manual labels; fixture rows, auto-accepted results, and suggestions are not counted."]),
      ui.el("div", { className: "bv-overview-grid" }, [
        ui.stat("Total labels", String(model.total)),
        ui.stat("Classified", model.classifiedText),
        ui.stat("Unclassified", model.unclassifiedText),
        ui.stat("Timestamp coverage", model.timestampText)
      ]),
      ui.el("div", { style: { marginTop: "var(--sp-5)" } }, [ui.el("span", { className: "bv-field-label" }, ["Shot labels"]), ui.mixBar(shotSegments)])
    ];
    if (summary.players.knownCount) {
      details.push(ui.el("p", { className: "bv-helper" }, ["Per-player labels: ", Object.keys(summary.players.counts).map(function (player) { return player + " " + summary.players.counts[player] + " (" + summary.players.percentages[player] + "%)"; }).join(" · "), summary.players.unknownCount ? " · " + summary.players.unknownCount + " player unknown" : ""]));
    } else {
      details.push(ui.el("p", { className: "bv-helper" }, ["Per-player counts: unknown — no saved manual label has player identity."]));
    }
    var dimensionNames = Object.keys(summary.dimensions);
    if (dimensionNames.length) {
      details.push(ui.el("p", { className: "bv-helper" }, ["Dimensions: ", dimensionNames.map(function (name) { var dimension = summary.dimensions[name]; return name + " " + Object.keys(dimension.counts).map(function (value) { return value + " " + dimension.counts[value] + " (" + dimension.percentages[value] + "%)"; }).join(", "); }).join(" · ")]));
    } else {
      details.push(ui.el("p", { className: "bv-helper" }, ["Dimension counts: insufficient data — no saved dimension values."]));
    }
    return block("Manual labels", meta, ui.el("div", {}, details));
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
    var ranked = window.BVAnalysis.rankRallies(data.rallies);
    return ranked.map(function (rally) { return { rally_id: rally.rallyId, start_sec: rally.startSec, end_sec: rally.endSec, shot_count: rally.shots, winner: rally.outcome === "winner" ? "true" : "false", lose_reason: rally.outcome === "winner" ? "" : rally.outcome, highlight_index: rally.index, aggregate_confidence: rally.meanTrackingConfidence }; });
  }
  function block(title, meta, body) {
    return ui.el("section", { className: "bv-block" }, [
      ui.el("div", { className: "bv-block-heading" }, [ui.el("h2", {}, [title]), meta ? ui.el("span", {}, [meta]) : null]),
      body
    ]);
  }
  function render() {
    var ranked = window.BVAnalysis.rankRallies(data.rallies).slice(0, 5);
    var header = ui.el("header", { className: "bv-summary-header" }, [
      ui.iconButton("arrow-left", "Back to video", { variant: "solid", size: "md", onClick: backToVideo }),
      ui.el("div", { className: "bv-summary-heading" }, [
        ui.el("h1", {}, ["Match summary"]),
        ui.el("p", {}, ["Video: " + currentVideoLabel() + " · Dataset: " + (storedState.videoKey || currentVideoUrl()) + " · local data only, nothing uploaded"])
      ]),
      ui.el("div", { className: "bv-summary-actions" }, [
        ui.button("Shots CSV", { icon: "download", onClick: function () { download("badminton-vision-shots.csv", window.BVAnalysis.toShotsCsv(shotRows(), { includeManualMetadata: true })); } }),
        ui.button("Rallies CSV", { variant: "primary", icon: "download", onClick: function () { download("badminton-vision-rallies.csv", window.BVAnalysis.toRalliesCsv(rallyRows())); } })
      ])
    ]);
    var runtimeNotice = runtimeStatus && runtimeStatus.phase === "fallback"
      ? ui.callout("warn", "Local analysis fallback", "Playback was unaffected. Manual labels remain available; no production CV result is asserted.")
      : runtimeStatus && runtimeStatus.inference && runtimeStatus.analyzer !== "fixture-probe-v1"
        ? ui.callout("guide", "Local pose runtime active", "Pose tracking runs on-device. Rally shots, shuttle paths, and this summary are deterministic fixture/demo data until production shot analysis is available.")
        : ui.callout("guide", runtimeStatus && runtimeStatus.resultKind === "runtime-integration-probe" ? "Fixture result observed" : "Fixture analyzer boundary", "The deterministic local fixture is an integration probe, not production CV. Player detections remain unknown/partial; manual labels stay local and editable.");
    var reviewedStrokes = reviewStrokes();
    var shotTotal = 249 + Math.max(0, reviewedStrokes.length - data.strokes.length);
    var manualSummary = manualDatasetSummary();
    var reviewMeta = "fixture/demo probe only · not manual statistics · " + shotTotal + " fixture-context shots";
    var overview = block("Fixture/demo context (not manual statistics)", reviewMeta, ui.el("div", { className: "bv-overview-grid" }, [ui.stat("Match duration", "1:12:40"), ui.stat("Rallies", "42"), ui.stat("Shots", String(shotTotal)), ui.stat("Avg rally", "8.4", "shots", "fixture probe"), ui.stat("Longest rally", "31", "shots", "fixture probe · 18:42", true)]));
    var filters = ui.el("div", { className: "bv-filter-row", "aria-label": "Shot mix filters" }, [ui.chip("All", filter === "all", function () { filter = "all"; render(); }), ui.chip("Player A", filter === "player a", function () { filter = "player a"; render(); }), ui.chip("Player B", filter === "player b", function () { filter = "player b"; render(); })]);
    var mixes = ui.el("div", { className: "bv-summary-two-col" }, [block("Fixture/demo shot mix (not manual statistics)", "fixture probe", ui.el("div", {}, [ui.mixBar(data.shotMix), filters])), block("Fixture/demo winner/error probe (not manual statistics)", "fixture probe", ui.el("div", {}, [ui.mixBar(data.outcomeMix), ui.el("p", { className: "bv-disclaimer", style: { marginTop: "var(--sp-6)" } }, ["Attribution needs a known final landing and player identity. Where either is missing the rally stays unclassified rather than being guessed."]) ]))]);
    var rallyList = ui.el("div", { className: "bv-rally-list" }, ranked.map(function (rally, index) { rally.timestamp = formatTime(rally.startSec); return ui.rallyRow(rally, index + 1, copyTimestamp); }));
    var rallyFoot = ui.el("div", { className: "bv-footnote" }, [ui.badge("*partial", "warn"), ui.el("span", {}, ["index = 0.40 length percentile + 0.25 variety + 0.20 outcome pressure + 0.15 mean tracking confidence. Score OCR unavailable on starred rallies, so outcome pressure used the ordinary-state value."]) ]);
    if (notice) rallyFoot.appendChild(ui.el("span", { role: "status", style: { marginLeft: "auto", color: "var(--signal-in)" } }, [notice]));
    var topRallies = block("Fixture/demo top rallies (not manual statistics)", "highlights index · deterministic · 12-rally sample", ui.el("div", {}, [rallyList, rallyFoot]));
    var visibleLandings = data.landings.filter(function (point) { return filter === "all" || point.side === (filter === "player a" ? "a" : "b"); });
    var located = visibleLandings.filter(function (point) { return point.call !== "UNKNOWN"; }).length;
    var visibleCount = function (predicate) { return visibleLandings.filter(predicate).length; };
    var map = ui.el("div", { className: "bv-map-layout" }, [ui.el("div", {}, [ui.courtDiagram({ renderWidth: 190, labels: true, landings: visibleLandings, colorBy: mapMode, ariaLabel: "Court landing map" })]), ui.el("div", { className: "bv-map-copy" }, [ui.segmented([{ value: "call", label: "By line call" }, { value: "player", label: "By player" }, { value: "pro", label: "Compare to pro", disabled: true }], mapMode, function (value) { mapMode = value; render(); }), ui.el("p", {}, ["One dot per shot: the point on the court where the shuttle came down, for every rally in this match. Dots are projected through the court seed onto the canonical 13.40 × 6.10 m court, so they are comparable across camera angles and across videos."]), mapMode === "player" ? ui.legend([{ color: "var(--player-a)", label: "Player A hit it", value: visibleCount(function (point) { return point.side === "a"; }) }, { color: "var(--player-b)", label: "Player B hit it", value: visibleCount(function (point) { return point.side === "b"; }) }]) : ui.legend([{ color: "var(--signal-in)", label: "Landed in", value: visibleCount(function (point) { return point.call === "IN"; }) }, { color: "var(--signal-out)", label: "Landed out", value: visibleCount(function (point) { return point.call === "OUT"; }) }, { color: "var(--signal-unknown)", label: "Not located", value: visibleCount(function (point) { return point.call === "UNKNOWN"; }), dashed: true }]), ui.el("p", { className: "bv-disclaimer" }, ["A 40 mm line belongs to the area it bounds (BWF Law 1.3), so a shuttle touching the line reads IN. Shots the shuttle tracker could not locate stay dashed and are excluded from the counts above."])])]);
    var landingMap = block("Fixture/demo landing probe (not manual statistics)", located + " of " + visibleLandings.length + " shots located · " + (visibleLandings.length - located) + " unknown", map);
    app.replaceChildren(ui.el("div", { className: "bv-summary-inner" }, [header, runtimeNotice, manualDatasetBlock(manualSummary), overview, mixes, topRallies, landingMap]));
  }
  render();
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["bvState", "bvRuntimeStatus"], function (result) {
      if (result && result.bvState) {
        storedManualSource = result.bvState;
        storedState = window.BVState ? window.BVState.initialExtensionState(result.bvState) : result.bvState;
      }
      if (result && result.bvRuntimeStatus) runtimeStatus = result.bvRuntimeStatus;
      render();
    });
    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) chrome.storage.onChanged.addListener(function (changes) {
      if (changes.bvState && changes.bvState.newValue) {
        storedManualSource = changes.bvState.newValue;
        storedState = window.BVState ? window.BVState.initialExtensionState(changes.bvState.newValue) : changes.bvState.newValue;
      }
      if (changes.bvRuntimeStatus && changes.bvRuntimeStatus.newValue) runtimeStatus = changes.bvRuntimeStatus.newValue;
      render();
    });
  }
})();
