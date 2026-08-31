/* Pure, deterministic adapters for fixture data and future inference results. */
(function (root) {
  var SHOT_FIELDS = [
    "video_url", "shot_id", "start_sec", "end_sec", "label",
    "longitudinal_position", "lateral_position", "timing", "intention", "impact", "direction"
  ];
  var COARSE_FAMILIES = ["clear", "drop", "smash", "net"];
  var WEIGHTS = {
    lengthPercentile: 0.40,
    variety: 0.25,
    outcomePressure: 0.20,
    meanTrackingConfidence: 0.15
  };

  function numberOrNull(value) {
    return typeof value === "number" && isFinite(value) ? value : null;
  }

  function shotCount(rally) {
    var value = rally && rally.shot_count != null ? rally.shot_count : rally && rally.shots;
    return numberOrNull(value) == null ? 0 : Math.max(0, value);
  }

  function coarseFamily(value) {
    if (typeof value !== "string") return null;
    var normalized = value.toLowerCase().replace(/[ _-]+/g, "");
    if (normalized === "clear") return "clear";
    if (normalized === "drop") return "drop";
    if (normalized === "smash" || normalized === "halfsmash") return "smash";
    if (normalized === "net" || normalized === "netshot" || normalized === "netkill") return "net";
    return null;
  }

  function families(rally) {
    var values = rally && (rally.coarse_shot_families || rally.shotFamilies);
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(coarseFamily).filter(Boolean)));
  }

  function outcome(rally) {
    var value = rally && (rally.winner_state && rally.winner_state.label || rally.outcome || rally.lose_reason);
    if (typeof value !== "string") return "unclassified";
    var normalized = value.toLowerCase().replace(/[ -]+/g, "_");
    return normalized === "forcederror" ? "forced_error" : normalized === "unforcederror" ? "unforced_error" : normalized;
  }

  function scoreContext(rally) {
    var context = rally && rally.score_context;
    if (context && typeof context === "object") {
      var state = context.state || "unknown";
      var gamePoint = typeof context.game_point === "boolean" ? context.game_point : null;
      var score = context.score;
      if (score && typeof score === "object") {
        var left = score.player_a != null ? score.player_a : score.a;
        var right = score.player_b != null ? score.player_b : score.b;
        if (typeof left === "number" && typeof right === "number" && isFinite(left) && isFinite(right)) {
          if (state === "unknown") state = Math.abs(left - right) <= 2 && Math.max(left, right) >= 18 ? "tight" : "ordinary";
          if (gamePoint == null) gamePoint = Math.max(left, right) >= 20 && Math.abs(left - right) <= 1;
        }
      }
      if (state === "unknown" && gamePoint !== true) return { known: false, tight: false, gamePoint: null, reason: "score-unavailable-ordinary-fallback" };
      return { known: state !== "unknown" || gamePoint === true, tight: state === "tight" || gamePoint === true, gamePoint: gamePoint, reason: state === "tight" || gamePoint === true ? "tight-or-game-point" : "ordinary-score-state" };
    }
    if (rally && rally.scoreOcrUnavailable) return { known: false, tight: false, gamePoint: null, reason: "score-unavailable-ordinary-fallback" };
    if (rally && typeof rally.tightScore === "boolean") return { known: true, tight: rally.tightScore, gamePoint: null, reason: rally.tightScore ? "tight-or-game-point" : "ordinary-score-state" };
    return { known: false, tight: false, gamePoint: null, reason: "score-unavailable-ordinary-fallback" };
  }

  function percentile(value, values) {
    if (!values.length) return 0;
    return values.filter(function (entry) { return entry <= value; }).length / values.length;
  }

  function confidence(rally) {
    var value = rally && rally.meanTrackingConfidence;
    if (value == null && rally && rally.aggregate_confidence && rally.aggregate_confidence.status === "known") value = rally.aggregate_confidence.value;
    value = numberOrNull(value);
    return value == null ? 0 : Math.max(0, Math.min(1, value));
  }

  function isCompleted(rally) {
    if (!rally) return false;
    if (rally.status != null) return rally.status === "completed" && rally.end_media_time != null;
    return rally.completed !== false;
  }

  function calculateHighlightsIndex(rally, completedRallies) {
    var history = (completedRallies || []).filter(isCompleted);
    var currentId = rally && (rally.rally_id != null ? rally.rally_id : rally.rallyId);
    if (!history.some(function (entry) { return (entry.rally_id != null ? entry.rally_id : entry.rallyId) === currentId; }) && rally && isCompleted(rally)) history = history.concat([rally]);
    var shotCounts = history.map(shotCount);
    var lengthPercentile = percentile(shotCount(rally), shotCounts);
    var uniqueFamilies = families(rally).length;
    var variety = Math.min(uniqueFamilies / COARSE_FAMILIES.length, 1);
    var resultOutcome = outcome(rally);
    var score = scoreContext(rally);
    var outcomePressure = resultOutcome === "winner" || resultOutcome === "forced_error" ? (score.tight ? 1 : 0.7) : resultOutcome === "unclassified" ? 0 : 0.4;
    var meanTrackingConfidence = confidence(rally);
    var partialComponents = [];
    if ((resultOutcome === "winner" || resultOutcome === "forced_error") && !score.known) partialComponents.push("outcome_pressure");
    if (!rally || (rally.meanTrackingConfidence == null && !(rally.aggregate_confidence && rally.aggregate_confidence.status === "known"))) partialComponents.push("mean_tracking_confidence");
    var available = history.length >= 10;
    var scoreValue = available ? Math.round(100 * (
      WEIGHTS.lengthPercentile * lengthPercentile +
      WEIGHTS.variety * variety +
      WEIGHTS.outcomePressure * outcomePressure +
      WEIGHTS.meanTrackingConfidence * meanTrackingConfidence
    )) : null;
    return {
      score: scoreValue,
      index: scoreValue,
      lengthPercentile: lengthPercentile,
      variety: variety,
      outcomePressure: outcomePressure,
      meanTrackingConfidence: meanTrackingConfidence,
      sampleSize: history.length,
      minimumSampleSize: 10,
      available: available,
      partial: partialComponents.length > 0,
      partialComponents: partialComponents,
      components: {
        length_percentile: lengthPercentile,
        variety: variety,
        outcome_pressure: outcomePressure,
        mean_tracking_confidence: meanTrackingConfidence
      },
      weights: {
        length_percentile: WEIGHTS.lengthPercentile,
        variety: WEIGHTS.variety,
        outcome_pressure: WEIGHTS.outcomePressure,
        mean_tracking_confidence: WEIGHTS.meanTrackingConfidence
      },
      componentReasons: {
        outcome_pressure: score.reason,
        mean_tracking_confidence: partialComponents.indexOf("mean_tracking_confidence") >= 0 ? "missing confidence contributed 0" : "confidence supplied"
      },
      scoreContext: rally && rally.score_context || null,
      outcomeEvidence: rally && rally.winner_state || null,
      sourceTimestamp: {
        start_media_time: rally && (rally.start_media_time != null ? rally.start_media_time : rally.startSec),
        end_media_time: rally && (rally.end_media_time != null ? rally.end_media_time : rally.endSec)
      }
    };
  }

  function rankRallies(rallies) {
    var completed = (rallies || []).filter(isCompleted);
    if (completed.length < 10) return [];
    return completed.map(function (rally) {
      var components = calculateHighlightsIndex(rally, completed);
      return Object.assign({}, rally, {
        index: components.score,
        partial: components.partial,
        indexComponents: components
      });
    }).sort(function (a, b) {
      var aIndex = a.index == null ? -1 : a.index;
      var bIndex = b.index == null ? -1 : b.index;
      var aEnd = a.end_media_time != null ? a.end_media_time : a.endSec;
      var bEnd = b.end_media_time != null ? b.end_media_time : b.endSec;
      aEnd = numberOrNull(aEnd); bEnd = numberOrNull(bEnd);
      return bIndex - aIndex || (aEnd == null ? Infinity : aEnd) - (bEnd == null ? Infinity : bEnd) || String(a.rally_id != null ? a.rally_id : a.rallyId).localeCompare(String(b.rally_id != null ? b.rally_id : b.rallyId));
    });
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
    rankHighlights: rankRallies,
    scoreRallyHighlights: rankRallies,
    toShotsCsv: toShotsCsv,
    toRalliesCsv: toRalliesCsv,
    escapeCsv: escapeCsv
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
