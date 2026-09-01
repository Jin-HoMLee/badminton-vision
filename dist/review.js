/* Shared local review records used by the fixture and manual-only frontend. */
(function (root) {
  "use strict";

  function clone(value) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }

  function mediaSeconds(value) {
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value !== "string") return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
    var parts = trimmed.split(":");
    if (parts.length !== 2) return null;
    var minutes = Number(parts[0]);
    var seconds = Number(parts[1]);
    return isFinite(minutes) && isFinite(seconds) ? minutes * 60 + seconds : null;
  }

  function formatMediaTime(seconds) {
    if (!isFinite(seconds)) return "";
    var minutes = Math.floor(seconds / 60);
    var remaining = seconds - minutes * 60;
    return String(minutes).padStart(2, "0") + ":" + remaining.toFixed(3).padStart(6, "0");
  }

  function nowIso(options) {
    var value = options && options.now;
    if (typeof value === "function") value = value();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" && value) return value;
    return new Date().toISOString();
  }

  // This is deliberately a record normalizer, not an inference adapter. It
  // only copies supplied evidence and media timestamps; it never adds a
  // confidence, player, geometry, or inferred end time.
  function normalizeManualLabel(record, options) {
    options = options || {};
    var value = clone(record || {});
    if (value.eventId == null && options.eventId != null) value.eventId = options.eventId;
    if (value.eventId == null) return null;
    value.eventId = String(value.eventId);
    var start = mediaSeconds(value.startSec != null ? value.startSec : (value.start_media_time != null ? value.start_media_time : value.startTime != null ? value.startTime : value.time));
    var end = mediaSeconds(value.endSec != null ? value.endSec : (value.end_media_time != null ? value.end_media_time : value.endTime));
    if (start != null && start >= 0) {
      value.startSec = start;
      if (value.time == null) value.time = formatMediaTime(start);
    }
    if (end != null && end >= 0) value.endSec = end;
    if (value.shot == null && value.label != null) value.shot = value.label;
    if (value.source == null) value.source = value.provenance || "manual";
    if (value.provenance == null) value.provenance = value.source;
    var created = value.createdAt || nowIso(options);
    value.createdAt = created;
    value.updatedAt = value.updatedAt || created;
    return value;
  }

  function undoLabelMutation(records, edit) {
    var result = without(records, edit && edit.eventId);
    if (edit && edit.previousLabel) result = upsert(result, edit.previousLabel);
    return result;
  }

  function mutateLabels(records, record, operation, options) {
    var previous = record && record.eventId != null
      ? (Array.isArray(records) ? records.find(function (item) { return item && String(item.eventId) === String(record.eventId); }) : null)
      : null;
    var normalized = operation === "delete" ? null : normalizeManualLabel(record, options);
    if (previous && normalized) {
      normalized.createdAt = previous.createdAt || normalized.createdAt;
      normalized.updatedAt = nowIso(options);
    }
    var next = operation === "delete" ? without(records, record && record.eventId) : upsert(records, normalized);
    return {
      records: next,
      edit: {
        eventId: record && record.eventId != null ? String(record.eventId) : normalized && normalized.eventId,
        operation: operation || (previous ? "update" : "create"),
        source: normalized && normalized.source || previous && previous.source || "manual",
        time: normalized && normalized.time || previous && previous.time,
        previousLabel: previous ? clone(previous) : null
      }
    };
  }

  function strokeId(stroke, index) {
    return stroke && stroke.eventId != null ? String(stroke.eventId) : "local-s" + String(index + 1).padStart(2, "0");
  }

  function sortStrokes(strokes) {
    return strokes.map(function (stroke, index) {
      var value = clone(stroke || {});
      value.__reviewIndex = index;
      return value;
    }).sort(function (a, b) {
      var aTime = mediaSeconds(a.startSec != null ? a.startSec : a.time);
      var bTime = mediaSeconds(b.startSec != null ? b.startSec : b.time);
      return (aTime == null ? Infinity : aTime) - (bTime == null ? Infinity : bTime) ||
        (Number(a.sequence) || Infinity) - (Number(b.sequence) || Infinity) ||
        a.__reviewIndex - b.__reviewIndex;
    }).map(function (stroke, index) {
      delete stroke.__reviewIndex;
      if (stroke.sequence == null) stroke.sequence = index + 1;
      return stroke;
    });
  }

  function mergeStrokes(base, overrides) {
    var merged = [];
    var positions = Object.create(null);
    (Array.isArray(base) ? base : []).forEach(function (stroke, index) {
      var value = clone(stroke || {});
      var id = strokeId(value, index);
      value.eventId = value.eventId == null ? id : value.eventId;
      positions[id] = merged.length;
      merged.push(value);
    });
    (Array.isArray(overrides) ? overrides : []).forEach(function (stroke, index) {
      if (!stroke) return;
      var value = clone(stroke);
      var id = strokeId(value, index);
      value.eventId = value.eventId == null ? id : value.eventId;
      if (positions[id] == null) {
        positions[id] = merged.length;
        merged.push(value);
      } else {
        var prior = merged[positions[id]];
        merged[positions[id]] = Object.assign({}, prior, value);
        if (value.source === "manual") {
          // A human correction does not inherit an automatic confidence just
          // because it replaces an automatic/fixture row in the feed.
          ["confidence", "classification_confidence", "geometry_confidence"].forEach(function (field) {
            if (!Object.prototype.hasOwnProperty.call(value, field)) delete merged[positions[id]][field];
          });
        }
      }
    });
    return sortStrokes(merged);
  }

  function upsert(records, record) {
    var next = (Array.isArray(records) ? records : []).map(clone);
    var id = record && record.eventId != null ? String(record.eventId) : null;
    var index = id == null ? -1 : next.findIndex(function (item) { return item && String(item.eventId) === id; });
    if (index < 0) next.push(clone(record));
    else {
      var incoming = clone(record);
      next[index] = Object.assign({}, next[index], incoming);
      if (incoming && incoming.source === "manual") {
        ["confidence", "classification_confidence", "geometry_confidence"].forEach(function (field) {
          if (!Object.prototype.hasOwnProperty.call(incoming, field)) delete next[index][field];
        });
      }
    }
    return next;
  }

  function without(records, eventId) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
      return !record || String(record.eventId) !== String(eventId);
    }).map(clone);
  }

  function toShotRow(stroke, videoUrl, index) {
    stroke = stroke || {};
    var start = stroke.startSec != null ? stroke.startSec : mediaSeconds(stroke.startTime != null ? stroke.startTime : stroke.time);
    // A manual point without an explicit end stays open in exports. The
    // legacy fixture presentation may retain its short display window, but
    // user labels must not acquire an invented timestamp.
    var end = stroke.endSec != null ? stroke.endSec : stroke.source === "manual" ? null : (start == null ? null : start + 0.4);
    var axes = stroke.axes || {};
    function field(name) { return stroke[name] != null ? stroke[name] : axes[name] != null ? axes[name] : ""; }
    return {
      video_url: stroke.video_url || videoUrl || "",
      shot_id: stroke.eventId == null ? "local-s" + String(index + 1).padStart(2, "0") : stroke.eventId,
      start_sec: start == null ? "" : start,
      end_sec: end == null ? "" : end,
      label: stroke.shot || "unclassified",
      longitudinal_position: field("longitudinal_position") || field("Longitudinal"),
      lateral_position: field("lateral_position") || field("Lateral"),
      timing: field("timing") || field("Timing"),
      intention: field("intention") || field("Intention"),
      impact: field("impact") || field("Impact"),
      direction: field("direction") || field("Direction"),
      player: stroke.player != null ? stroke.player : stroke.playerId != null ? stroke.playerId : "",
      provenance: stroke.provenance != null ? (typeof stroke.provenance === "string" ? stroke.provenance : JSON.stringify(stroke.provenance)) : stroke.source || "manual"
    };
  }

  root.BVReview = Object.freeze({
    clone: clone,
    mediaSeconds: mediaSeconds,
    formatMediaTime: formatMediaTime,
    normalizeManualLabel: normalizeManualLabel,
    mutateLabels: mutateLabels,
    mergeStrokes: mergeStrokes,
    upsert: upsert,
    without: without,
    undoLabelMutation: undoLabelMutation,
    toShotRow: toShotRow
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
