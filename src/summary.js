(function () {
  var ui = window.BVUI;
  var data = window.BVFixtures;
  var app = document.getElementById("app");
  var filter = "all";
  var mapMode = "call";
  var notice = "";

  function formatTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var remaining = Math.floor(seconds % 60);
    return String(minutes).padStart(2, "0") + ":" + String(remaining).padStart(2, "0");
  }
  function count(predicate) { return data.landings.filter(predicate).length; }
  function copyTimestamp(rally) {
    var text = formatTime(rally.startSec);
    notice = "Timestamp " + text + " copied. Playback was not changed.";
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () {});
    render();
  }
  function download(name, content) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
  }
  function shotRows() {
    return data.strokes.map(function (stroke, index) {
      return {
        video_url: data.video.url,
        shot_id: stroke.eventId,
        start_sec: 721 + index * .7,
        end_sec: 721 + index * .7 + .4,
        label: stroke.shot || "unclassified",
        longitudinal_position: "",
        lateral_position: "",
        timing: "",
        intention: "",
        impact: "",
        direction: ""
      };
    });
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
      ui.iconButton("arrow-left", "Back to video", { variant: "solid", size: "md", onClick: function () { if (window.close) window.close(); } }),
      ui.el("div", { className: "bv-summary-heading" }, [
        ui.el("h1", {}, ["Match summary"]),
        ui.el("p", {}, [data.video.title + " · local data only, nothing uploaded"])
      ]),
      ui.el("div", { className: "bv-summary-actions" }, [
        ui.button("Shots CSV", { icon: "download", onClick: function () { download("badminton-vision-shots.csv", window.BVAnalysis.toShotsCsv(shotRows())); } }),
        ui.button("Rallies CSV", { variant: "primary", icon: "download", onClick: function () { download("badminton-vision-rallies.csv", window.BVAnalysis.toRalliesCsv(rallyRows())); } })
      ])
    ]);
    var overview = block("Overview", "42 rallies · 249 shots · analysed locally", ui.el("div", { className: "bv-overview-grid" }, [ui.stat("Match duration", "1:12:40"), ui.stat("Rallies", "42"), ui.stat("Shots", "249"), ui.stat("Avg rally", "8.4", "shots", "42 rallies"), ui.stat("Longest rally", "31", "shots", "rally 23 · 18:42", true)]));
    var filters = ui.el("div", { className: "bv-filter-row", "aria-label": "Shot mix filters" }, [ui.chip("All", filter === "all", function () { filter = "all"; render(); }), ui.chip("Player A", filter === "player a", function () { filter = "player a"; render(); }), ui.chip("Player B", filter === "player b", function () { filter = "player b"; render(); })]);
    var mixes = ui.el("div", { className: "bv-summary-two-col" }, [block("Shot mix", "18 unclassified", ui.el("div", {}, [ui.mixBar(data.shotMix), filters])), block("Winner / error attribution", "12 unclassified", ui.el("div", {}, [ui.mixBar(data.outcomeMix), ui.el("p", { className: "bv-disclaimer", style: { marginTop: "var(--sp-6)" } }, ["Attribution needs a known final landing and player identity. Where either is missing the rally stays unclassified rather than being guessed."]) ]))]);
    var rallyList = ui.el("div", { className: "bv-rally-list" }, ranked.map(function (rally, index) { rally.timestamp = formatTime(rally.startSec); return ui.rallyRow(rally, index + 1, copyTimestamp); }));
    var rallyFoot = ui.el("div", { className: "bv-footnote" }, [ui.badge("*partial", "warn"), ui.el("span", {}, ["index = 0.40 length percentile + 0.25 variety + 0.20 outcome pressure + 0.15 mean tracking confidence. Score OCR unavailable on starred rallies, so outcome pressure used the ordinary-state value."]) ]);
    if (notice) rallyFoot.appendChild(ui.el("span", { role: "status", style: { marginLeft: "auto", color: "var(--signal-in)" } }, [notice]));
    var topRallies = block("Top rallies", "highlights index · deterministic · 12-rally sample", ui.el("div", {}, [rallyList, rallyFoot]));
    var located = count(function (point) { return point.call !== "UNKNOWN"; });
    var map = ui.el("div", { className: "bv-map-layout" }, [ui.el("div", {}, [ui.courtDiagram({ renderWidth: 190, labels: true, landings: data.landings, colorBy: mapMode, ariaLabel: "Court landing map" })]), ui.el("div", { className: "bv-map-copy" }, [ui.segmented([{ value: "call", label: "By line call" }, { value: "player", label: "By player" }, { value: "pro", label: "Compare to pro", disabled: true }], mapMode, function (value) { mapMode = value; render(); }), ui.el("p", {}, ["One dot per shot: the point on the court where the shuttle came down, for every rally in this match. Dots are projected through the court seed onto the canonical 13.40 × 6.10 m court, so they are comparable across camera angles and across videos."]), mapMode === "player" ? ui.legend([{ color: "var(--player-a)", label: "Player A hit it", value: count(function (point) { return point.side === "a"; }) }, { color: "var(--player-b)", label: "Player B hit it", value: count(function (point) { return point.side === "b"; }) }]) : ui.legend([{ color: "var(--signal-in)", label: "Landed in", value: count(function (point) { return point.call === "IN"; }) }, { color: "var(--signal-out)", label: "Landed out", value: count(function (point) { return point.call === "OUT"; }) }, { color: "var(--signal-unknown)", label: "Not located", value: count(function (point) { return point.call === "UNKNOWN"; }), dashed: true }]), ui.el("p", { className: "bv-disclaimer" }, ["A 40 mm line belongs to the area it bounds (BWF Law 1.3), so a shuttle touching the line reads IN. Shots the shuttle tracker could not locate stay dashed and are excluded from the counts above."])])]);
    var landingMap = block("Where the shuttle landed", located + " of " + data.landings.length + " shots located · " + (data.landings.length - located) + " unknown", map);
    app.replaceChildren(ui.el("div", { className: "bv-summary-inner" }, [header, overview, mixes, topRallies, landingMap]));
  }
  render();
})();
