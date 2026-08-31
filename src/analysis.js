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

  function toRalliesCsv(rows) {
    return toCsv(rows, ["rally_id", "start_sec", "end_sec", "shot_count", "winner", "lose_reason", "highlight_index", "aggregate_confidence"]);
  }

  /*
   * Manual-label input contract
   * ----------------------------
   * The current UI stores a flat `bvState.manualLabels` array.  The durable
   * labeling store may instead provide a state/object containing
   * `manualLabelsByVideo` (or `labelsByVideo`/`videos`) whose values are
   * arrays or `{ labels: [...] }` records.  A video container supplies its
   * video key/url to child labels.  A direct array is treated as the selected
   * local manual dataset, unless an item explicitly says it is an automatic,
   * suggested, model, fixture, or demo result.  This adapter intentionally
   * never reads fixture rows or suggestions unless they are explicitly passed
   * as data; exact `fixtureRows` (or explicit `fixtureEventIds`) can be supplied
   * when a caller is adapting a mixed review feed.
   *
   * The functions below are deliberately dependency-free so they can run in
   * the summary page, an extension worker, or a Node test VM without DOM,
   * storage, network, or playback access.
   */
  var MANUAL_DIMENSIONS = [
    { key: "longitudinal_position", label: "Longitudinal", aliases: ["longitudinal_position", "longitudinal", "Longitudinal", "Longitudinal Position"] },
    { key: "lateral_position", label: "Lateral", aliases: ["lateral_position", "lateral", "Lateral", "Lateral Position"] },
    { key: "timing", label: "Timing", aliases: ["timing", "Timing"] },
    { key: "intention", label: "Intention", aliases: ["intention", "Intention"] },
    { key: "impact", label: "Impact", aliases: ["impact", "Impact"] },
    { key: "direction", label: "Direction", aliases: ["direction", "Direction"] }
  ];
  var UNKNOWN_LABELS = { "": true, unknown: true, unclassified: true, "not classified": true, "n/a": true, na: true, none: true, null: true };
  var NON_MANUAL_SOURCES = { auto: true, automatic: true, model: true, inference: true, predicted: true, suggestion: true, suggested: true, fixture: true, demo: true, "fixture-probe": true, "fixture-probe-v1": true };

  function cloneAnalysisValue(value) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(cloneAnalysisValue);
    var copy = {};
    Object.keys(value).forEach(function (key) { copy[key] = cloneAnalysisValue(value[key]); });
    return copy;
  }

  function textValue(value) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    var text = String(value).trim();
    return text ? text : null;
  }

  function manualMediaSeconds(value) {
    if (typeof value === "number") return isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== "string") return null;
    var text = value.trim();
    if (!text) return null;
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    var parts = text.split(":");
    if (parts.length === 2 || parts.length === 3) {
      var seconds = Number(parts.pop());
      var minutes = Number(parts.pop());
      var hours = parts.length ? Number(parts.pop()) : 0;
      if (isFinite(hours) && isFinite(minutes) && isFinite(seconds) && hours >= 0 && minutes >= 0 && seconds >= 0 && minutes < 60 && seconds < 60) return hours * 3600 + minutes * 60 + seconds;
    }
    return null;
  }

  function firstValue(record, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      if (record && record[keys[i]] != null && record[keys[i]] !== "") return record[keys[i]];
    }
    return null;
  }

  function identityFrom(value, inherited) {
    var identity = {
      videoKey: inherited && inherited.videoKey != null ? inherited.videoKey : null,
      videoUrl: inherited && inherited.videoUrl != null ? inherited.videoUrl : null
    };
    if (!value || typeof value !== "object") return identity;
    var key = firstValue(value, ["videoKey", "video_key", "videoId", "video_id"]);
    var url = firstValue(value, ["videoUrl", "video_url", "url"]);
    var nestedVideo = firstValue(value, ["video", "videoInfo", "video_info"]);
    if (nestedVideo && typeof nestedVideo === "object") {
      if (key == null) key = firstValue(nestedVideo, ["videoKey", "video_key", "videoId", "video_id", "id", "key"]);
      if (url == null) url = firstValue(nestedVideo, ["videoUrl", "video_url", "url", "href"]);
    }
    if (key && typeof key === "object") key = firstValue(key, ["id", "key", "videoKey"]);
    if (url && typeof url === "object") url = firstValue(url, ["url", "href"]);
    if (key != null) identity.videoKey = textValue(key);
    if (url != null) identity.videoUrl = textValue(url);
    return identity;
  }

  function hasAny(value, keys) {
    return keys.some(function (key) { return value && Object.prototype.hasOwnProperty.call(value, key); });
  }

  function isLabelRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    // Containers are checked before this predicate so a per-video record with
    // `{ videoKey, labels }` is not mistaken for one label.
    if (hasAny(value, ["labels", "manualLabels", "manual_labels", "records", "items", "annotations"])) return false;
    return hasAny(value, ["eventId", "event_id", "shotId", "shot_id", "id", "shot", "label", "shot_family", "shotFamily", "startSec", "start_sec", "startTime", "start_media_time", "hit_media_time", "media_time", "endSec", "end_sec", "endTime", "end_media_time", "time", "timestamp", "player", "playerId", "player_id", "source", "provenance", "status"]);
  }

  function collectManualCandidates(value, inheritedIdentity, inheritedManual, output, seen) {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(function (entry) { collectManualCandidates(entry, inheritedIdentity, inheritedManual, output, seen); });
      return;
    }
    if (typeof value !== "object") return;
    if (seen.indexOf(value) >= 0) return;
    seen.push(value);
    var identity = identityFrom(value, inheritedIdentity);
    var manualContainers = ["manualLabels", "manual_labels", "manualRecords", "manual_records", "manualLabelRecords", "manual_label_records", "labelRecords", "label_records", "manualLabelsByVideo", "manual_labels_by_video", "labelsByVideo", "labels_by_video", "labelsByVideoId", "labels_by_video_id", "manualByVideo", "manual_by_video", "byVideo", "by_video"];
    var foundContainer = false;
    manualContainers.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        foundContainer = true;
        collectManualCandidates(value[key], identity, true, output, seen);
      }
    });
    ["videos", "videoRecords", "video_records", "datasets"].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        foundContainer = true;
        collectManualCandidates(value[key], identity, true, output, seen);
      }
    });
    if (foundContainer) {
      // A state object can have both the fallback array and a durable map. Do
      // not descend into unrelated fields such as fixture strokes.
      return;
    }
    if (hasAny(value, ["labels", "records", "items", "annotations"])) {
      ["labels", "records", "items", "annotations"].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(value, key)) collectManualCandidates(value[key], identity, true, output, seen);
      });
      return;
    }
    if (isLabelRecord(value)) {
      output.push({ record: value, identity: identity, inheritedManual: inheritedManual });
      return;
    }
    // A durable map is commonly keyed by video id. It has no fixed property
    // name, so only descend into object values that look like label containers.
    Object.keys(value).forEach(function (key) {
      var child = value[key];
      if (isLabelRecord(child)) {
        // An object keyed by event id is a label map, not a video map.
        collectManualCandidates(child, identity, inheritedManual, output, seen);
      } else if (Array.isArray(child) || (child && typeof child === "object" && hasAny(child, ["labels", "manualLabels", "records", "items", "annotations"]))) {
        var childIdentity = identityFrom({ videoKey: key }, identity);
        collectManualCandidates(child, childIdentity, inheritedManual, output, seen);
      }
    });
  }

  function provenanceSource(record) {
    var candidates = [record && record.source, record && record.origin, record && record.labelSource, record && record.provenance];
    function find(value) {
      if (typeof value === "string") return value.toLowerCase().replace(/[ _]+/g, "-");
      if (Array.isArray(value)) {
        for (var i = value.length - 1; i >= 0; i -= 1) { var found = find(value[i]); if (found) return found; }
      }
      if (value && typeof value === "object") return find(value.source != null ? value.source : value.origin != null ? value.origin : value.type != null ? value.type : value.kind);
      return null;
    }
    for (var i = 0; i < candidates.length; i += 1) {
      var source = find(candidates[i]);
      if (source) return source;
    }
    return null;
  }

  function hasManualProvenance(record) {
    var source = provenanceSource(record);
    if (source === "manual" || source === "corrected" || source === "human" || source === "user") return true;
    if (source && NON_MANUAL_SOURCES[source]) return false;
    var status = textValue(record && record.status);
    if (status && ["suggested", "predicted", "model"].indexOf(status.toLowerCase()) >= 0) return false;
    return null;
  }

  function fixtureEventIds(rows) {
    var ids = Object.create(null);
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || typeof row !== "object") return;
      var id = firstValue(row, ["eventId", "event_id", "shotId", "shot_id", "id"]);
      if (id != null) {
        var key = String(id);
        if (!ids[key]) ids[key] = [];
        ids[key].push(JSON.stringify(row));
      }
    });
    return ids;
  }

  function explicitlyFixture(record, options, ids) {
    if (!record || typeof record !== "object") return false;
    if (record.fixture === true || record.isFixture === true || record.demo === true || record.isDemo === true) return true;
    var dataset = textValue(firstValue(record, ["dataset", "datasetType", "recordType"]));
    if (dataset && ["fixture", "demo", "fixture-probe", "fixture-probe-v1"].indexOf(dataset.toLowerCase()) >= 0) return true;
    var source = provenanceSource(record);
    if (source && ["fixture", "demo", "fixture-probe", "fixture-probe-v1"].indexOf(source) >= 0) return true;
    var id = firstValue(record, ["eventId", "event_id", "shotId", "shot_id", "id"]);
    if (id != null && ids[String(id)] && ids[String(id)].indexOf(JSON.stringify(record)) >= 0) return true;
    return Boolean(options && options.fixtureEventIds && options.fixtureEventIds[String(id)]);
  }

  function valueFromDimension(record, dimension) {
    var axes = record && (record.axes || record.dimensions);
    for (var i = 0; i < dimension.aliases.length; i += 1) {
      var alias = dimension.aliases[i];
      if (record && record[alias] != null) return textValue(record[alias]);
      if (axes && typeof axes === "object" && axes[alias] != null) return textValue(axes[alias]);
    }
    return null;
  }

  function normalizeManualRecord(candidate, index) {
    var record = candidate.record || {};
    var identity = candidate.identity || {};
    var eventId = firstValue(record, ["eventId", "event_id", "shotId", "shot_id", "id"]);
    var label = firstValue(record, ["shot", "label", "shot_family", "shotFamily", "classification"]);
    label = textValue(label);
    if (label && UNKNOWN_LABELS[label.toLowerCase()]) label = null;
    var startValue = firstValue(record, ["startSec", "start_sec", "startTime", "start_time", "start_media_time", "hit_media_time", "media_time", "start", "time"]);
    var endValue = firstValue(record, ["endSec", "end_sec", "endTime", "end_time", "end_media_time", "end"]);
    var timestamp = record.timestamp;
    if (timestamp && typeof timestamp === "object") {
      if (startValue == null) startValue = firstValue(timestamp, ["startSec", "start_sec", "start", "time"]);
      if (endValue == null) endValue = firstValue(timestamp, ["endSec", "end_sec", "end"]);
    } else if (startValue == null && timestamp != null) startValue = timestamp;
    var startSec = manualMediaSeconds(startValue);
    var endSec = manualMediaSeconds(endValue);
    if (endSec == null && startSec != null && record.endSec == null && record.end_sec == null && record.endTime == null && record.end_time == null && record.end == null) endSec = null;
    var player = firstValue(record, ["player", "playerId", "player_id", "playerIdentity", "player_identity", "hitter", "side"]);
    if (player && typeof player === "object") player = firstValue(player, ["id", "name", "label", "side"]);
    player = textValue(player);
    var dimensions = {};
    MANUAL_DIMENSIONS.forEach(function (dimension) {
      var value = valueFromDimension(record, dimension);
      if (value != null && !UNKNOWN_LABELS[value.toLowerCase()]) dimensions[dimension.label] = value;
    });
    var normalizedEventId = eventId == null ? null : String(eventId);
    var normalizedShotId = normalizedEventId == null ? "local-s" + String(index + 1).padStart(2, "0") : normalizedEventId;
    var normalizedVideoKey = identity.videoKey || textValue(firstValue(record, ["videoKey", "video_key", "videoId", "video_id"]));
    var normalizedVideoUrl = identity.videoUrl || textValue(firstValue(record, ["videoUrl", "video_url"]));
    return {
      eventId: normalizedEventId,
      event_id: normalizedEventId,
      shotId: normalizedShotId,
      shot_id: normalizedShotId,
      videoKey: normalizedVideoKey,
      video_key: normalizedVideoKey,
      videoUrl: normalizedVideoUrl,
      video_url: normalizedVideoUrl,
      startSec: startSec,
      start_sec: startSec,
      endSec: endSec,
      end_sec: endSec,
      time: firstValue(record, ["time", "startTime", "start_time"]) == null ? null : String(firstValue(record, ["time", "startTime", "start_time"])),
      label: label,
      shot: label,
      player: player,
      playerId: player,
      player_id: player,
      dimensions: dimensions,
      axes: cloneAnalysisValue(record.axes || record.dimensions || {}),
      source: provenanceSource(record) || "manual",
      status: textValue(record.status) || (label ? "accepted" : "unclassified"),
      provenance: cloneAnalysisValue(record.provenance != null ? record.provenance : record.correction_provenance != null ? record.correction_provenance : record.source != null ? record.source : "manual"),
      original: cloneAnalysisValue(record)
    };
  }

  function videoMatches(record, options) {
    if (!options) return true;
    var targetKey = textValue(options.videoKey || options.video_id || options.videoId);
    var targetUrl = textValue(options.videoUrl || options.video_url);
    if (!targetKey && !targetUrl) return true;
    // A flat fallback label has no identity because the current state is
    // already video-local. Keep it when selecting the current video.
    if (!record.videoKey && !record.videoUrl) return true;
    if (targetKey && record.videoKey && String(record.videoKey) === String(targetKey)) return true;
    if (targetUrl && record.videoUrl && String(record.videoUrl) === String(targetUrl)) return true;
    return false;
  }

  function normalizeManualLabels(input, options) {
    options = options || {};
    // Selection options are filters, not identities to stamp onto every
    // child. This matters when a durable map has multiple video buckets and
    // a bucket omits a redundant URL/key on its child records.
    var inherited = identityFrom(input, { videoKey: null, videoUrl: null });
    var candidates = [];
    collectManualCandidates(input, inherited, Array.isArray(input), candidates, []);
    var fixtureIds = fixtureEventIds(options.fixtureRows);
    var result = [];
    var positions = Object.create(null);
    candidates.forEach(function (candidate, index) {
      var record = candidate.record;
      if (explicitlyFixture(record, options, fixtureIds)) return;
      var manual = hasManualProvenance(record);
      if (manual === false) return;
      if (manual !== true && candidate.inheritedManual !== true && !Array.isArray(input) && !isLabelRecord(input)) return;
      var normalized = normalizeManualRecord(candidate, index);
      if (!videoMatches(normalized, options)) return;
      var key = normalized.eventId == null ? "index:" + String(index) : "event:" + normalized.eventId;
      if (positions[key] == null) {
        positions[key] = result.length;
        result.push(normalized);
      } else {
        // Correction/upsert semantics: the later manual record replaces the
        // same event while retaining collection order and no duplicate.
        result[positions[key]] = normalized;
      }
    });
    return result;
  }

  function metric(value, reason) {
    if (value == null || !isFinite(value)) return { known: false, status: "insufficient-data", value: null, reason: reason || "insufficient data" };
    return { known: true, status: "known", value: value, reason: null };
  }

  function percent(count, total) {
    return total > 0 ? Math.round(count / total * 1000) / 10 : null;
  }

  function coverageMetric(count, total, reason) {
    var result = metric(total > 0 ? percent(count, total) : null, reason || (total ? null : "no manual labels"));
    result.count = count;
    result.total = total;
    result.percentage = result.value;
    result.ratio = result.value == null ? null : result.value / 100;
    return result;
  }

  function countsFor(records, getter) {
    var counts = Object.create(null);
    var known = 0;
    records.forEach(function (record) {
      var value = textValue(getter(record));
      if (!value || UNKNOWN_LABELS[value.toLowerCase()]) return;
      counts[value] = (counts[value] || 0) + 1;
      known += 1;
    });
    return { counts: counts, known: known };
  }

  function publicCounts(counts, known) {
    var result = {};
    Object.keys(counts).sort().forEach(function (key) { result[key] = counts[key]; });
    var percentages = {};
    Object.keys(result).forEach(function (key) { percentages[key] = percent(result[key], known); });
    return { counts: result, percentages: percentages };
  }

  function calculateManualDatasetSummary(input, options) {
    options = options || {};
    var records = normalizeManualLabels(input, options);
    var total = records.length;
    var classified = records.filter(function (record) { return record.label != null; }).length;
    var unclassified = total - classified;
    var labels = countsFor(records, function (record) { return record.label; });
    var shots = publicCounts(labels.counts, labels.known);
    var players = countsFor(records, function (record) { return record.player; });
    var playerPublic = publicCounts(players.counts, players.known);
    var dimensions = {};
    var dimensionCounts = {};
    var dimensionPercentages = {};
    MANUAL_DIMENSIONS.forEach(function (dimension) {
      var values = countsFor(records, function (record) { return record.dimensions[dimension.label]; });
      if (!values.known) return;
      var publicValue = publicCounts(values.counts, values.known);
      var dimensionResult = {
        counts: publicValue.counts,
        percentages: publicValue.percentages,
        knownCount: values.known,
        unknownCount: total - values.known,
        coverage: coverageMetric(values.known, total, null),
        status: "known"
      };
      dimensions[dimension.label] = dimensionResult;
      dimensionCounts[dimension.label] = publicValue.counts;
      dimensionPercentages[dimension.label] = publicValue.percentages;
    });
    var timestamped = records.filter(function (record) { return record.startSec != null || record.endSec != null; }).length;
    var completeTimestamps = records.filter(function (record) { return record.startSec != null && record.endSec != null; }).length;
    var starts = records.map(function (record) { return record.startSec; }).filter(function (value) { return value != null; });
    var ends = records.map(function (record) { return record.endSec; }).filter(function (value) { return value != null; });
    var startSec = starts.length ? Math.min.apply(Math, starts) : null;
    var endSec = ends.length ? Math.max.apply(Math, ends) : null;
    var durationSec = startSec != null && endSec != null && endSec >= startSec ? endSec - startSec : null;
    var timestampMetric = timestamped ? coverageMetric(timestamped, total, null) : coverageMetric(0, total, total ? "manual labels have no timestamps" : "no manual labels");
    var durationMetric = durationSec != null ? metric(durationSec, null) : metric(null, total ? "at least one timestamp boundary is missing" : "no manual labels");
    var classificationCoverage = {
      classified: coverageMetric(classified, total, total ? null : "no manual labels"),
      unclassified: coverageMetric(unclassified, total, total ? null : "no manual labels")
    };
    var playerCoverage = players.known ? coverageMetric(players.known, total, null) : coverageMetric(0, total, total ? "manual labels have no player identity" : "no manual labels");
    var shotStatus = labels.known ? "known" : total ? "insufficient-data" : "insufficient-data";
    var dataset = {
      videoKey: textValue(options.videoKey || (input && input.videoKey)),
      videoUrl: textValue(options.videoUrl || (input && (input.videoUrl || input.video_url))),
      label: textValue(options.datasetLabel || options.dataset || "selected local video") || "selected local video"
    };
    return {
      dataset: dataset,
      records: records,
      totalLabels: total,
      total: total,
      classifiedCount: classified,
      unclassifiedCount: unclassified,
      classified: classified,
      unclassified: unclassified,
      classifiedPercentage: percent(classified, total),
      unclassifiedPercentage: percent(unclassified, total),
      coverage: classificationCoverage,
      classificationCoverage: classificationCoverage,
      shotLabels: {
        counts: shots.counts,
        percentages: shots.percentages,
        knownCount: labels.known,
        unknownCount: total - labels.known,
        status: shotStatus,
        coverage: coverageMetric(labels.known, total, total ? "no classified shot labels" : "no manual labels")
      },
      shotLabelCounts: shots.counts,
      shotLabelPercentages: shots.percentages,
      shotCounts: shots.counts,
      shotPercentages: shots.percentages,
      labelCounts: shots.counts,
      labelPercentages: shots.percentages,
      players: {
        counts: playerPublic.counts,
        percentages: playerPublic.percentages,
        knownCount: players.known,
        unknownCount: total - players.known,
        status: players.known ? "known" : "insufficient-data",
        coverage: playerCoverage
      },
      perPlayerCounts: playerPublic.counts,
      perPlayerPercentages: playerPublic.percentages,
      playerCounts: playerPublic.counts,
      playerPercentages: playerPublic.percentages,
      dimensions: dimensions,
      dimensionCounts: dimensionCounts,
      dimensionPercentages: dimensionPercentages,
      dimensionsStatus: Object.keys(dimensions).length ? "known" : "insufficient-data",
      timestamps: {
        knownCount: timestamped,
        completeCount: completeTimestamps,
        missingCount: total - timestamped,
        coverage: timestampMetric,
        percentage: percent(timestamped, total),
        startSec: startSec,
        endSec: endSec,
        durationSec: durationSec,
        durationSeconds: durationSec,
        duration: durationMetric,
        status: timestamped ? "known" : "insufficient-data"
      },
      timestampCoverage: timestampMetric,
      timestampCoveragePercentage: percent(timestamped, total),
      durationSec: durationSec,
      durationSeconds: durationSec,
      duration: durationMetric,
      insufficientData: total === 0 ? "No manual labels are saved for this video." : null,
      status: total === 0 ? "empty" : "known"
    };
  }

  function manualRecordToShotRow(record, videoUrl, index) {
    var normalized = record && Object.prototype.hasOwnProperty.call(record, "shotId") && Object.prototype.hasOwnProperty.call(record, "dimensions") ? record : normalizeManualLabels([record])[0];
    normalized = normalized || {};
    var dimensions = normalized.dimensions || {};
    function dimension(name) { return dimensions[name] == null ? "" : dimensions[name]; }
    return {
      video_url: normalized.videoUrl || videoUrl || "",
      shot_id: normalized.shotId || normalized.eventId || "local-s" + String(index + 1).padStart(2, "0"),
      start_sec: normalized.startSec == null ? "" : normalized.startSec,
      end_sec: normalized.endSec == null ? "" : normalized.endSec,
      label: normalized.label || "unclassified",
      longitudinal_position: dimension("Longitudinal"),
      lateral_position: dimension("Lateral"),
      timing: dimension("Timing"),
      intention: dimension("Intention"),
      impact: dimension("Impact"),
      direction: dimension("Direction"),
      player: normalized.player || "",
      provenance: normalized.provenance == null ? "" : typeof normalized.provenance === "string" ? normalized.provenance : JSON.stringify(normalized.provenance)
    };
  }

  function toShotsCsv(rows, options) {
    options = options || {};
    var fields = options.includeManualMetadata ? SHOT_FIELDS.concat(["player", "provenance"]) : SHOT_FIELDS;
    return toCsv(rows, fields);
  }

  root.BVAnalysis = {
    shotFields: SHOT_FIELDS,
    manualShotFields: SHOT_FIELDS.concat(["player", "provenance"]),
    manualDimensions: MANUAL_DIMENSIONS.map(function (dimension) { return dimension.label; }),
    calculateHighlightsIndex: calculateHighlightsIndex,
    rankRallies: rankRallies,
    rankHighlights: rankRallies,
    scoreRallyHighlights: rankRallies,
    normalizeManualLabels: normalizeManualLabels,
    normalizeManualLabelCollection: normalizeManualLabels,
    calculateManualDatasetSummary: calculateManualDatasetSummary,
    calculateManualStats: calculateManualDatasetSummary,
    manualDatasetSummary: calculateManualDatasetSummary,
    summarizeManualLabels: calculateManualDatasetSummary,
    summarizeManualDataset: calculateManualDatasetSummary,
    manualRecordToShotRow: manualRecordToShotRow,
    toShotsCsv: toShotsCsv,
    toRalliesCsv: toRalliesCsv,
    escapeCsv: escapeCsv
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
