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
        merged[positions[id]] = Object.assign({}, merged[positions[id]], value);
      }
    });
    return sortStrokes(merged);
  }

  function upsert(records, record) {
    var next = (Array.isArray(records) ? records : []).map(clone);
    var id = record && record.eventId != null ? String(record.eventId) : null;
    var index = id == null ? -1 : next.findIndex(function (item) { return item && String(item.eventId) === id; });
    if (index < 0) next.push(clone(record));
    else next[index] = Object.assign({}, next[index], clone(record));
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
    var end = stroke.endSec != null ? stroke.endSec : (start == null ? null : start + 0.4);
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
      direction: field("direction") || field("Direction")
    };
  }

  root.BVReview = Object.freeze({
    clone: clone,
    mediaSeconds: mediaSeconds,
    mergeStrokes: mergeStrokes,
    upsert: upsert,
    without: without,
    toShotRow: toShotRow
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
