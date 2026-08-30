/* Pure, deterministic adapters for fixture data and future inference results. */
(function (root) {
  var SHOT_FIELDS = [
    "video_url", "shot_id", "start_sec", "end_sec", "label",
    "longitudinal_position", "lateral_position", "timing", "intention", "impact", "direction"
  ];

  function percentile(value, values) {
    if (!values.length) return 0;
    var below = values.filter(function (entry) { return entry <= value; }).length;
    return below / values.length;
  }

  function calculateHighlightsIndex(rally, completedRallies) {
    var history = (completedRallies || []).filter(function (entry) { return entry && entry.shots > 0; });
    var shotCounts = history.map(function (entry) { return entry.shots; });
    var lengthPercentile = percentile(rally.shots, shotCounts);
    var uniqueFamilies = Array.isArray(rally.shotFamilies) ? new Set(rally.shotFamilies).size : 0;
    var variety = Math.min(uniqueFamilies / 4, 1);
    var outcomePressure = rally.outcome === "winner" || rally.outcome === "forced error" ? (rally.tightScore ? 1 : 0.7) : rally.outcome === "unclassified" ? 0 : 0.4;
    var confidence = typeof rally.meanTrackingConfidence === "number" ? Math.max(0, Math.min(1, rally.meanTrackingConfidence)) : 0;
    var available = history.length >= 10;
    var score = available ? Math.round(100 * (0.4 * lengthPercentile + 0.25 * variety + 0.2 * outcomePressure + 0.15 * confidence)) : null;
    return {
      score: score,
      lengthPercentile: lengthPercentile,
      variety: variety,
      outcomePressure: outcomePressure,
      meanTrackingConfidence: confidence,
      sampleSize: history.length,
      available: available,
      partial: Boolean(rally.scoreOcrUnavailable)
    };
  }

  function rankRallies(rallies) {
    var completed = (rallies || []).filter(function (rally) { return rally.completed !== false; });
    return completed.map(function (rally) {
      var components = calculateHighlightsIndex(rally, completed);
      return Object.assign({}, rally, { index: components.score, partial: components.partial, indexComponents: components });
    }).sort(function (a, b) { return (b.index == null ? -1 : b.index) - (a.index == null ? -1 : a.index) || String(a.rallyId).localeCompare(String(b.rallyId)); });
  }

  function escapeCsv(value) {
    var text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCsv(rows, fields) {
    return [fields.join(",")].concat((rows || []).map(function (row) {
      return fields.map(function (field) { return escapeCsv(row[field]); }).join(",");
    })).join("\n") + "\n";
  }

  function toShotsCsv(rows) { return toCsv(rows, SHOT_FIELDS); }

  function toRalliesCsv(rows) {
    return toCsv(rows, ["rally_id", "start_sec", "end_sec", "shot_count", "winner", "lose_reason", "highlight_index", "aggregate_confidence"]);
  }

  root.BVAnalysis = {
    shotFields: SHOT_FIELDS,
    calculateHighlightsIndex: calculateHighlightsIndex,
    rankRallies: rankRallies,
    toShotsCsv: toShotsCsv,
    toRalliesCsv: toRalliesCsv,
    escapeCsv: escapeCsv
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
