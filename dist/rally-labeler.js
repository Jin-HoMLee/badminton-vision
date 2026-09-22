/*
 * Pure developer rally-review model. The content widget consumes this module,
 * but it deliberately owns no DOM, storage, player, or media APIs.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BVRallyLabeler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA = "badminton-vision.rally-review";
  var VERSION = 1;
  var MIN_INTERVAL_SECONDS = 0.001;
  var ACTIONS = ["unresolved", "approve", "correction", "addition", "removal"];
  var CONTROL_STATES = ["unresolved", "confirmed", "rejected"];
  var CONTROL_KINDS = ["empty-set", "inactive"];
  var MAX_ZOOM = 32;

  function clone(value) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }

  function roundSeconds(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return null;
    var rounded = Math.round(number * 1000) / 1000;
    return Math.abs(rounded) < .0005 ? 0 : rounded;
  }

  function parseSeconds(value) {
    if (typeof value === "number") return roundSeconds(value);
    if (typeof value !== "string" || !value.trim()) return null;
    var text = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return roundSeconds(Number(text));
    var parts = text.split(":");
    if (parts.length < 2 || parts.length > 3 || parts.some(function (part) { return !/^\d+(?:\.\d+)?$/.test(part); })) return null;
    var seconds = Number(parts.pop());
    var minutes = Number(parts.pop());
    var hours = parts.length ? Number(parts.pop()) : 0;
    if (minutes >= 60 || seconds >= 60) return null;
    return roundSeconds(hours * 3600 + minutes * 60 + seconds);
  }

  function formatSeconds(value) {
    var seconds = roundSeconds(value);
    if (seconds == null) return "";
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds - hours * 3600) / 60);
    var remainder = seconds - hours * 3600 - minutes * 60;
    var body = String(minutes).padStart(hours ? 2 : 1, "0") + ":" + remainder.toFixed(3).padStart(6, "0");
    return hours ? String(hours) + ":" + body : body;
  }

  function requiredText(value, field) {
    var result = String(value == null ? "" : value).trim();
    if (!result) throw new TypeError(field + " is required");
    return result;
  }

  function optionalText(value) { return String(value == null ? "" : value).trim(); }

  function clearEvidence(item) {
    item.comment = "";
    item.verifier = "";
    item.verifiedAt = "";
  }

  function evidenceMatches(item, fields) {
    return fields && Object.prototype.hasOwnProperty.call(fields, "comment") &&
      Object.prototype.hasOwnProperty.call(fields, "verifier") &&
      Object.prototype.hasOwnProperty.call(fields, "verifiedAt") &&
      optionalText(fields.comment) === optionalText(item.comment) &&
      optionalText(fields.verifier) === optionalText(item.verifier) &&
      optionalText(fields.verifiedAt) === optionalText(item.verifiedAt);
  }

  function normalizedDate(value) {
    var text = optionalText(value);
    if (!text) return "";
    var match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z)?$/.exec(text);
    var year = match && Number(match[1]);
    var month = match && Number(match[2]);
    var day = match && Number(match[3]);
    var daysInMonth = year && month >= 1 && month <= 12
      ? [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
      : 0;
    var validTime = match && (!match[4] || (Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60));
    if (!match || day < 1 || day > daysInMonth || !validTime) {
      throw new TypeError("verifiedAt must be an ISO date or UTC timestamp");
    }
    return text;
  }

  function normalizeBounds(startValue, endValue, field) {
    var startSec = parseSeconds(startValue);
    var endSec = parseSeconds(endValue);
    if (startSec == null || endSec == null) throw new TypeError(field + " needs finite start/end seconds");
    if (startSec < 0) throw new RangeError(field + " start must be non-negative");
    if (endSec - startSec < MIN_INTERVAL_SECONDS - 1e-12) throw new RangeError(field + " must satisfy start < end");
    return { startSec: startSec, endSec: endSec };
  }

  function nestedBounds(raw, prefix) {
    var nested = raw && raw[prefix];
    if (nested && typeof nested === "object") {
      var nestedStart = nested.startSec != null ? nested.startSec : nested.start;
      var nestedEnd = nested.endSec != null ? nested.endSec : nested.end;
      if (nestedStart != null || nestedEnd != null) return normalizeBounds(nestedStart, nestedEnd, prefix);
    }
    var capitalized = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    var start = raw && (raw[prefix + "StartSec"] != null ? raw[prefix + "StartSec"] : raw[prefix + "Start"]);
    var end = raw && (raw[prefix + "EndSec"] != null ? raw[prefix + "EndSec"] : raw[prefix + "End"]);
    if (start == null && raw && prefix === "original") start = raw.startSec != null ? raw.startSec : raw.start;
    if (end == null && raw && prefix === "original") end = raw.endSec != null ? raw.endSec : raw.end;
    if (start == null && raw) start = raw[capitalized + "StartSec"];
    if (end == null && raw) end = raw[capitalized + "EndSec"];
    if (start == null && end == null) return null;
    return normalizeBounds(start, end, prefix);
  }

  function normalizeAction(value, original) {
    var action = optionalText(value || "unresolved").toLowerCase();
    var aliases = { approved: "approve", corrected: "correction", add: "addition", added: "addition", remove: "removal", removed: "removal" };
    action = aliases[action] || action;
    if (ACTIONS.indexOf(action) < 0) throw new TypeError("unknown interval action: " + action);
    if (!original && action === "unresolved") return "addition";
    return action;
  }

  function normalizeInterval(raw, index, sourceId) {
    raw = raw || {};
    var id = optionalText(raw.id != null ? raw.id : raw.intervalId != null ? raw.intervalId : raw.rallyId);
    if (!id) id = sourceId + ":rally-" + String(index + 1).padStart(3, "0");
    var original = nestedBounds(raw, "original");
    var provisionalAction = raw.action != null ? raw.action : raw.status;
    if (!original && provisionalAction == null && (raw.start != null || raw.startSec != null)) {
      original = normalizeBounds(raw.startSec != null ? raw.startSec : raw.start, raw.endSec != null ? raw.endSec : raw.end, "original");
    }
    var action = normalizeAction(provisionalAction, original);
    var corrected = nestedBounds(raw, "corrected");
    if (!corrected && action === "addition") {
      var additionStart = raw.startSec != null ? raw.startSec : raw.start;
      var additionEnd = raw.endSec != null ? raw.endSec : raw.end;
      if (additionStart != null || additionEnd != null) corrected = normalizeBounds(additionStart, additionEnd, "corrected");
    }
    if (!corrected && action === "approve" && original) corrected = clone(original);
    if (!corrected && (action === "correction" || action === "removal")) corrected = original ? clone(original) : null;
    if (!original && !corrected) throw new TypeError("interval " + id + " has no original or corrected seconds");
    if (action === "addition" && original) throw new TypeError("addition " + id + " must not have original proposed seconds");
    if (!original && action !== "addition" && action !== "removal") throw new TypeError("interval " + id + " needs original proposed seconds");
    if (action !== "removal" && !corrected && action !== "unresolved") throw new TypeError("interval " + id + " needs corrected seconds");
    return {
      id: id,
      sourceId: sourceId,
      original: original,
      corrected: corrected,
      action: action,
      comment: optionalText(raw.comment != null ? raw.comment : raw.reason),
      verifier: optionalText(raw.verifier),
      verifiedAt: normalizedDate(raw.verifiedAt != null ? raw.verifiedAt : raw.date)
    };
  }

  function normalizeControl(raw, index, sourceId) {
    raw = raw || {};
    var kind = optionalText(raw.kind || raw.type).toLowerCase();
    var kindAliases = { empty: "empty-set", "empty_set": "empty-set", "rally-inactive": "inactive" };
    kind = kindAliases[kind] || kind;
    if (CONTROL_KINDS.indexOf(kind) < 0) throw new TypeError("unknown control kind: " + kind);
    var id = optionalText(raw.id) || sourceId + ":control-" + kind + "-" + (index + 1);
    var state = optionalText(raw.state || "unresolved").toLowerCase();
    var stateAliases = { yes: "confirmed", no: "rejected", true: "confirmed", false: "rejected", "not-applicable": "rejected" };
    state = stateAliases[state] || state;
    if (CONTROL_STATES.indexOf(state) < 0) throw new TypeError("unknown control state: " + state);
    return {
      id: id,
      sourceId: sourceId,
      kind: kind,
      label: optionalText(raw.label) || (kind === "empty-set" ? "No rallies in the review window" : "Rally state stays inactive"),
      state: state,
      comment: optionalText(raw.comment != null ? raw.comment : raw.reason),
      verifier: optionalText(raw.verifier),
      verifiedAt: normalizedDate(raw.verifiedAt != null ? raw.verifiedAt : raw.date)
    };
  }

  function intervalTime(interval) {
    var bounds = interval && (interval.corrected || interval.original);
    return bounds ? bounds.startSec : Infinity;
  }

  function sourceFromInput(input) {
    var raw = input && input.source;
    if (typeof raw === "string") raw = { id: raw };
    raw = raw && typeof raw === "object" ? raw : {};
    var id = requiredText(raw.id != null ? raw.id : input && input.sourceId, "source.id");
    var videoKey = optionalText(raw.videoKey != null ? raw.videoKey : input && input.videoKey);
    var videoUrl = optionalText(raw.videoUrl != null ? raw.videoUrl : raw.url != null ? raw.url : input && (input.videoUrl || input.url));
    return {
      id: id,
      label: optionalText(raw.label != null ? raw.label : raw.name) || id,
      videoKey: videoKey,
      videoUrl: videoUrl,
      rawWindow: raw.reviewWindow || input && (input.reviewWindow || input.window)
    };
  }

  function canonicalVideoIdentity(value) {
    var text = optionalText(value);
    var parsed = null;
    try {
      if (typeof URL !== "function") throw new Error("URL is unavailable");
      parsed = new URL(text);
    } catch (_) {
      throw new TypeError("source.videoUrl must be an absolute HTTP(S) URL");
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new TypeError("source.videoUrl must be an absolute HTTP(S) URL");
    var host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    var id = null;
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || null;
      try { id = id || parsed.searchParams.get("v"); } catch (_) {}
      if (!id) {
        var pathMatch = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
        if (pathMatch) id = pathMatch[1];
      }
    }
    if (id) {
      try { id = decodeURIComponent(id); } catch (_) {}
      return "youtube:" + id;
    }
    var query = [];
    try { parsed.searchParams.forEach(function (valuePart, key) { query.push([key, valuePart]); }); } catch (_) {}
    query.sort(function (a, b) { return a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]); });
    var search = query.map(function (pair) { return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]); }).join("&");
    return "url:" + parsed.origin + parsed.pathname + (search ? "?" + search : "");
  }

  function inferredWindow(rawWindow, intervals, fallbackEnd) {
    if (rawWindow != null) {
      if (!rawWindow || typeof rawWindow !== "object" || Array.isArray(rawWindow)) throw new TypeError("source.reviewWindow must be an object");
      var declaredStart = parseSeconds(rawWindow.startSec != null ? rawWindow.startSec : rawWindow.start);
      var declaredEnd = parseSeconds(rawWindow.endSec != null ? rawWindow.endSec : rawWindow.end);
      return normalizeBounds(declaredStart, declaredEnd, "source.reviewWindow");
    }
    rawWindow = {};
    var start = parseSeconds(rawWindow.startSec != null ? rawWindow.startSec : rawWindow.start);
    var end = parseSeconds(rawWindow.endSec != null ? rawWindow.endSec : rawWindow.end);
    var bounds = intervals.map(function (interval) { return interval.corrected || interval.original; }).filter(Boolean);
    if (start == null) start = bounds.length ? Math.min.apply(Math, bounds.map(function (value) { return value.startSec; })) : 0;
    if (end == null) end = bounds.length ? Math.max.apply(Math, bounds.map(function (value) { return value.endSec; })) : parseSeconds(fallbackEnd);
    if (end == null || end <= start) end = roundSeconds(start + 60);
    return normalizeBounds(start, end, "source.reviewWindow");
  }

  function normalizeDocument(input, options) {
    options = options || {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("rally review must be a JSON object");
    if (input.schema != null && input.schema !== SCHEMA) throw new TypeError("unsupported rally review schema");
    if (input.version != null && Number(input.version) !== VERSION) throw new TypeError("unsupported rally review version");
    var source = sourceFromInput(input);
    var rows = Array.isArray(input.intervals) ? input.intervals : Array.isArray(input.rallies) ? input.rallies : [];
    var intervals = rows.map(function (row, index) { return normalizeInterval(row, index, source.id); });
    var seen = Object.create(null);
    intervals.forEach(function (interval) {
      if (seen[interval.id]) throw new TypeError("duplicate interval id: " + interval.id);
      seen[interval.id] = true;
    });
    intervals.sort(function (a, b) { return intervalTime(a) - intervalTime(b) || a.id.localeCompare(b.id); });
    var controls = (Array.isArray(input.controls) ? input.controls : []).map(function (control, index) { return normalizeControl(control, index, source.id); });
    controls.forEach(function (control) {
      if (seen[control.id]) throw new TypeError("duplicate item id: " + control.id);
      seen[control.id] = true;
    });
    controls.sort(function (a, b) { return a.id.localeCompare(b.id); });
    var reviewWindow = inferredWindow(source.rawWindow, intervals, options.fallbackEndSec);
    intervals.forEach(function (interval) {
      [interval.original, interval.corrected].filter(Boolean).forEach(function (bounds) {
        if (bounds.startSec < reviewWindow.startSec || bounds.endSec > reviewWindow.endSec) {
          throw new RangeError("interval " + interval.id + " falls outside the review window");
        }
      });
    });
    var expectedVideoKey = optionalText(options.videoKey);
    if (expectedVideoKey && source.videoKey && source.videoKey !== expectedVideoKey) throw new TypeError("import source belongs to a different video");
    if (!source.videoKey && source.videoUrl) {
      var sourceVideoIdentity = canonicalVideoIdentity(source.videoUrl);
      var expectedVideoIdentity = expectedVideoKey || (options.videoUrl ? canonicalVideoIdentity(options.videoUrl) : "");
      if (expectedVideoIdentity && sourceVideoIdentity !== expectedVideoIdentity) throw new TypeError("import source belongs to a different video");
      source.videoKey = expectedVideoKey || sourceVideoIdentity;
    }
    if (!source.videoKey && expectedVideoKey) source.videoKey = expectedVideoKey;
    if (!source.videoUrl && options.videoUrl) source.videoUrl = optionalText(options.videoUrl);
    return {
      schema: SCHEMA,
      version: VERSION,
      source: {
        id: source.id,
        label: source.label,
        videoKey: source.videoKey,
        videoUrl: source.videoUrl,
        reviewWindow: reviewWindow
      },
      intervals: intervals,
      controls: controls
    };
  }

  function createDocument(options) {
    options = options || {};
    var sourceId = requiredText(options.sourceId || options.videoKey, "sourceId");
    var windowStart = parseSeconds(options.startSec);
    var windowEnd = parseSeconds(options.endSec);
    if (windowStart == null) windowStart = 0;
    if (windowEnd == null || windowEnd <= windowStart) windowEnd = roundSeconds(windowStart + 60);
    return normalizeDocument({
      source: {
        id: sourceId,
        label: options.label || sourceId,
        videoKey: options.videoKey || "",
        videoUrl: options.videoUrl || "",
        reviewWindow: { startSec: windowStart, endSec: windowEnd }
      },
      intervals: [],
      controls: options.controls || []
    });
  }

  function effectiveBounds(interval) {
    if (!interval || interval.action === "removal") return null;
    return clone(interval.corrected || interval.original);
  }

  function replaceInterval(document, id, mutate) {
    var next = clone(document);
    var index = next.intervals.findIndex(function (interval) { return interval.id === String(id); });
    if (index < 0) throw new TypeError("unknown interval id: " + id);
    var changed = mutate(clone(next.intervals[index]));
    next.intervals[index] = changed;
    return normalizeDocument(next);
  }

  function editableInterval(document, id) {
    var interval = document.intervals.find(function (item) { return item.id === String(id); });
    if (!interval) throw new TypeError("unknown interval id: " + id);
    if (interval.action === "removal") throw new TypeError("removed interval must be restored before editing");
    return interval;
  }

  function setBounds(document, id, bounds, action) {
    editableInterval(document, id);
    var windowBounds = document.source.reviewWindow;
    var normalized = normalizeBounds(bounds.startSec, bounds.endSec, "interval");
    if (normalized.startSec < windowBounds.startSec || normalized.endSec > windowBounds.endSec) throw new RangeError("interval falls outside the review window");
    return replaceInterval(document, id, function (interval) {
      var previous = interval.corrected || interval.original;
      var boundsChanged = !previous || previous.startSec !== normalized.startSec || previous.endSec !== normalized.endSec;
      var nextAction = boundsChanged ? action || (interval.original ? "correction" : "addition") : interval.action;
      interval.corrected = normalized;
      interval.action = nextAction;
      // A prior approval/addition comment is not evidence for newly changed
      // seconds. Editing either edge reopens the evidence fields explicitly.
      if (boundsChanged) {
        interval.comment = "";
        interval.verifier = "";
        interval.verifiedAt = "";
      }
      return interval;
    });
  }

  function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

  function resizeInterval(document, id, edge, nextSeconds) {
    var interval = document.intervals.find(function (item) { return item.id === String(id); });
    if (!interval) throw new TypeError("unknown interval id: " + id);
    var current = effectiveBounds(interval) || interval.corrected || interval.original;
    var windowBounds = document.source.reviewWindow;
    var value = roundSeconds(nextSeconds);
    if (value == null) throw new TypeError("edge seconds must be finite");
    var next = clone(current);
    if (edge === "start") next.startSec = roundSeconds(clamp(value, windowBounds.startSec, next.endSec - MIN_INTERVAL_SECONDS));
    else if (edge === "end") next.endSec = roundSeconds(clamp(value, next.startSec + MIN_INTERVAL_SECONDS, windowBounds.endSec));
    else throw new TypeError("edge must be start or end");
    return setBounds(document, id, next, interval.original ? "correction" : "addition");
  }

  function moveInterval(document, id, deltaSeconds) {
    var interval = document.intervals.find(function (item) { return item.id === String(id); });
    if (!interval) throw new TypeError("unknown interval id: " + id);
    var current = effectiveBounds(interval) || interval.corrected || interval.original;
    var windowBounds = document.source.reviewWindow;
    var duration = current.endSec - current.startSec;
    var start = clamp(roundSeconds(current.startSec + Number(deltaSeconds || 0)), windowBounds.startSec, windowBounds.endSec - duration);
    return setBounds(document, id, { startSec: start, endSec: roundSeconds(start + duration) }, interval.original ? "correction" : "addition");
  }

  function nextAdditionId(document) {
    var prefix = document.source.id + ":addition-";
    var used = Object.create(null);
    document.intervals.forEach(function (interval) { used[interval.id] = true; });
    var index = 1;
    while (used[prefix + String(index).padStart(3, "0")]) index += 1;
    return prefix + String(index).padStart(3, "0");
  }

  function addInterval(document, startValue, endValue, fields) {
    fields = fields || {};
    var bounds = normalizeBounds(startValue, endValue, "addition");
    var windowBounds = document.source.reviewWindow;
    if (bounds.startSec < windowBounds.startSec || bounds.endSec > windowBounds.endSec) throw new RangeError("addition falls outside the review window");
    var next = clone(document);
    next.intervals.push({
      id: optionalText(fields.id) || nextAdditionId(next),
      sourceId: next.source.id,
      original: null,
      corrected: bounds,
      action: "addition",
      comment: optionalText(fields.comment),
      verifier: optionalText(fields.verifier),
      verifiedAt: normalizedDate(fields.verifiedAt)
    });
    return normalizeDocument(next);
  }

  function removeInterval(document, id, fields) {
    fields = fields || {};
    if (!optionalText(fields.comment)) throw new TypeError("comment is required before removing a false positive");
    var existing = document.intervals.find(function (item) { return item.id === String(id); });
    if (!existing) throw new TypeError("unknown interval id: " + id);
    return replaceInterval(document, id, function (interval) {
      var previousAction = interval.action;
      interval.corrected = interval.corrected || interval.original;
      interval.action = "removal";
      // Removals keep explicit comment/verifier/date so a false-positive reason
      // remains available for later analysis. Empty field bags still clear prior
      // approval evidence so a bare remove cannot silently reuse it. An already
      // removed tombstone can receive evidence updates without restoration.
      if (previousAction !== "removal") clearEvidence(interval);
      if (fields.comment != null) interval.comment = optionalText(fields.comment);
      if (fields.verifier != null) interval.verifier = optionalText(fields.verifier);
      if (fields.verifiedAt != null) interval.verifiedAt = normalizedDate(fields.verifiedAt);
      return interval;
    });
  }

  function restoreInterval(document, id) {
    return replaceInterval(document, id, function (interval) {
      interval.action = interval.original ? "unresolved" : "addition";
      clearEvidence(interval);
      return interval;
    });
  }

  function reviewInterval(document, id, fields) {
    fields = fields || {};
    editableInterval(document, id);
    return replaceInterval(document, id, function (interval) {
      var action = normalizeAction(fields.action || interval.action, interval.original);
      if ((action === "correction" || action === "removal") && !optionalText(fields.comment)) {
        throw new TypeError("comment is required before saving a " + (action === "correction" ? "correction" : "false-positive removal"));
      }
      if (action === "approve") {
        if (!interval.original) throw new TypeError("an added interval cannot be approved as an original proposal");
        interval.corrected = clone(interval.original);
      } else if (action === "correction") {
        if (!interval.original) throw new TypeError("an added interval uses the addition action");
        interval.corrected = interval.corrected || clone(interval.original);
      } else if (action === "addition") {
        if (interval.original) throw new TypeError("a proposed interval cannot use the addition action");
      } else if (action === "removal") {
        interval.corrected = interval.corrected || interval.original;
      }
      var sameAction = interval.action === action;
      if (!sameAction) clearEvidence(interval);
      interval.action = action;
      // Explicit form commits always write through. Callers that need a clean
      // slate omit fields or pass empty strings after an action change.
      if (fields.comment != null) interval.comment = optionalText(fields.comment);
      if (fields.verifier != null) interval.verifier = optionalText(fields.verifier);
      if (fields.verifiedAt != null) interval.verifiedAt = normalizedDate(fields.verifiedAt);
      return interval;
    });
  }

  function addControl(document, kind, fields) {
    fields = fields || {};
    var next = clone(document);
    var base = next.source.id + ":control-" + kind;
    var id = optionalText(fields.id) || base;
    var suffix = 2;
    while (next.controls.some(function (control) { return control.id === id; })) id = base + "-" + suffix++;
    next.controls.push({ id: id, kind: kind, label: fields.label, state: "unresolved" });
    return normalizeDocument(next);
  }

  function reviewControl(document, id, fields) {
    fields = fields || {};
    var next = clone(document);
    var index = next.controls.findIndex(function (control) { return control.id === String(id); });
    if (index < 0) throw new TypeError("unknown control id: " + id);
    var control = next.controls[index];
    var previousState = control.state;
    if (fields.state != null) control.state = fields.state;
    var sameState = previousState === control.state;
    var staleEvidence = !sameState && evidenceMatches(control, fields);
    if (!sameState) clearEvidence(control);
    if (!staleEvidence) {
      if (fields.comment != null) control.comment = fields.comment;
      if (fields.verifier != null) control.verifier = fields.verifier;
      if (fields.verifiedAt != null) control.verifiedAt = fields.verifiedAt;
    }
    return normalizeDocument(next);
  }

  function missingMetadataFields(item) {
    var missing = [];
    var action = item && item.action;
    // Approval records may intentionally have no explanatory comment; the
    // reviewer/date pair still proves who made the decision and when.
    if (action !== "approve" && !optionalText(item && item.comment)) missing.push("comment");
    if (!optionalText(item && item.verifier)) missing.push("Reviewed by");
    if (!optionalText(item && item.verifiedAt)) missing.push("review date");
    return missing;
  }
  function completeMetadata(item) {
    return missingMetadataFields(item).length === 0;
  }

  function completion(document) {
    var unresolved = [];
    var contradictions = [];
    document.intervals.forEach(function (interval) {
      if (interval.action === "unresolved") unresolved.push(interval.id + ":action");
      else {
        var missing = missingMetadataFields(interval);
        if (missing.length) unresolved.push(interval.id + ":" + missing.join(", "));
      }
    });
    var activeCount = document.intervals.filter(function (interval) { return Boolean(effectiveBounds(interval)); }).length;
    // An empty interval collection is not self-approving. A reviewer must
    // explicitly add and confirm the empty-set control before a fresh empty
    // video can pass completion.
    if (document.intervals.length === 0) {
      var emptySetControl = document.controls.find(function (control) { return control.kind === "empty-set"; });
      if (!emptySetControl || emptySetControl.state === "rejected") unresolved.push("empty-set:confirmation");
    }
    document.controls.forEach(function (control) {
      if (control.state === "unresolved") unresolved.push(control.id + ":state");
      else {
        var missingControl = missingMetadataFields(control);
        if (missingControl.length) unresolved.push(control.id + ":" + missingControl.join(", "));
      }
      if (control.state === "confirmed" && activeCount > 0 && (control.kind === "empty-set" || control.kind === "inactive")) {
        contradictions.push(control.id + ":active-intervals");
      }
    });
    return {
      complete: unresolved.length === 0 && contradictions.length === 0,
      unresolved: unresolved,
      contradictions: contradictions,
      intervalCount: document.intervals.length,
      activeIntervalCount: activeCount,
      controlCount: document.controls.length
    };
  }

  function serialize(document) {
    return JSON.stringify(normalizeDocument(document), null, 2) + "\n";
  }

  function parse(text, options) {
    try {
      var value = typeof text === "string" ? JSON.parse(text) : text;
      return { ok: true, document: normalizeDocument(value, options) };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  }

  function displayBounds(interval) {
    if (!interval) return null;
    if (interval.action === "removal") return clone(interval.corrected || interval.original);
    return effectiveBounds(interval) || clone(interval.corrected || interval.original);
  }

  // Pack intervals onto the fewest horizontal lanes that avoid time overlap.
  // Non-overlapping rallies share one lane; a second row opens only when two
  // active ranges would collide. Removals keep their original range for packing.
  function packTimelineLanes(document) {
    var laneEnds = [];
    var lanesById = Object.create(null);
    var ordered = (document && Array.isArray(document.intervals) ? document.intervals.slice() : []).map(function (interval, index) {
      return { interval: interval, index: index, bounds: displayBounds(interval) };
    }).sort(function (a, b) {
      var aStart = a.bounds ? a.bounds.startSec : Infinity;
      var bStart = b.bounds ? b.bounds.startSec : Infinity;
      if (aStart !== bStart) return aStart - bStart;
      return a.index - b.index || String(a.interval.id).localeCompare(String(b.interval.id));
    });
    ordered.forEach(function (entry) {
      var bounds = entry.bounds;
      if (!bounds) {
        lanesById[entry.interval.id] = 0;
        return;
      }
      var lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] > bounds.startSec + 1e-9) lane += 1;
      if (lane === laneEnds.length) laneEnds.push(bounds.endSec);
      else laneEnds[lane] = bounds.endSec;
      lanesById[entry.interval.id] = lane;
    });
    return {
      laneCount: Math.max(1, laneEnds.length || 1),
      lanesById: lanesById
    };
  }

  function createTimelineView(document, viewportWidth, zoom, scrollLeft) {
    var windowBounds = document.source.reviewWindow;
    var width = Math.max(1, Number(viewportWidth) || 1);
    var scale = clamp(Number(zoom) || 1, 1, MAX_ZOOM);
    var contentWidth = Math.max(width, width * scale);
    var maxScroll = Math.max(0, contentWidth - width);
    return {
      startSec: windowBounds.startSec,
      endSec: windowBounds.endSec,
      durationSec: windowBounds.endSec - windowBounds.startSec,
      viewportWidth: width,
      zoom: scale,
      contentWidth: contentWidth,
      scrollLeft: clamp(Number(scrollLeft) || 0, 0, maxScroll),
      maxScroll: maxScroll,
      pixelsPerSecond: contentWidth / (windowBounds.endSec - windowBounds.startSec)
    };
  }

  function secondsToPixels(view, seconds) {
    return (Number(seconds) - view.startSec) * view.pixelsPerSecond;
  }

  function pixelsToSeconds(view, pixels) {
    return roundSeconds(view.startSec + Number(pixels) / view.pixelsPerSecond);
  }

  function zoomTimeline(document, view, nextZoom, anchorX) {
    var anchor = clamp(Number(anchorX) || 0, 0, view.viewportWidth);
    var ratio = (view.scrollLeft + anchor) / view.contentWidth;
    var next = createTimelineView(document, view.viewportWidth, nextZoom, 0);
    next.scrollLeft = clamp(ratio * next.contentWidth - anchor, 0, next.maxScroll);
    return next;
  }

  function scrollTimeline(document, view, deltaPixels) {
    return createTimelineView(document, view.viewportWidth, view.zoom, view.scrollLeft + Number(deltaPixels || 0));
  }

  function snapSeconds(value, guideSeconds, thresholdSeconds) {
    var seconds = roundSeconds(value);
    var guide = roundSeconds(guideSeconds);
    var threshold = Number(thresholdSeconds);
    if (seconds == null) return null;
    if (guide == null || !Number.isFinite(threshold) || threshold < 0) return seconds;
    return Math.abs(seconds - guide) <= threshold + 1e-12 ? guide : seconds;
  }

  function pointerEdit(document, id, mode, deltaPixels, view, options) {
    options = options || {};
    var deltaSeconds = Number(deltaPixels || 0) / view.pixelsPerSecond;
    var interval = document.intervals.find(function (item) { return item.id === String(id); });
    if (!interval) throw new TypeError("unknown interval id: " + id);
    var bounds = effectiveBounds(interval) || interval.corrected || interval.original;
    if (mode === "move") return moveInterval(document, id, deltaSeconds);
    var edgeSeconds = mode === "start"
      ? bounds.startSec + deltaSeconds
      : mode === "end"
        ? bounds.endSec + deltaSeconds
        : null;
    if (edgeSeconds == null) throw new TypeError("pointer edit mode must be move, start, or end");
    var threshold = options.snapThresholdSec;
    if (threshold == null && options.snapThresholdPx != null && view && view.pixelsPerSecond) {
      threshold = Number(options.snapThresholdPx) / view.pixelsPerSecond;
    }
    if (threshold == null) threshold = view && view.pixelsPerSecond ? 8 / view.pixelsPerSecond : 0.1;
    edgeSeconds = snapSeconds(edgeSeconds, options.snapGuideSec, threshold);
    return resizeInterval(document, id, mode, edgeSeconds);
  }

  function setEdgeFromPlayhead(document, id, edge, playheadSeconds) {
    var seconds = roundSeconds(playheadSeconds);
    if (seconds == null) throw new TypeError("playhead seconds must be finite");
    return resizeInterval(document, id, edge, seconds);
  }

  function clampPlayheadSeconds(document, seconds) {
    var value = roundSeconds(seconds);
    if (value == null) return null;
    if (!document || !document.source || !document.source.reviewWindow) return value;
    return roundSeconds(clamp(value, document.source.reviewWindow.startSec, document.source.reviewWindow.endSec));
  }

  function isEditableKeyboardTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    var tag = target.tagName ? String(target.tagName).toLowerCase() : "";
    if (tag === "textarea") return true;
    if (tag === "select") return true;
    if (tag !== "input") return false;
    var type = String(target.type || "text").toLowerCase();
    return type !== "button" && type !== "submit" && type !== "reset" && type !== "checkbox" && type !== "radio" && type !== "file" && type !== "range" && type !== "color" && type !== "image";
  }

  return {
    SCHEMA: SCHEMA,
    VERSION: VERSION,
    MIN_INTERVAL_SECONDS: MIN_INTERVAL_SECONDS,
    ACTIONS: ACTIONS.slice(),
    CONTROL_STATES: CONTROL_STATES.slice(),
    CONTROL_KINDS: CONTROL_KINDS.slice(),
    MAX_ZOOM: MAX_ZOOM,
    clone: clone,
    parseSeconds: parseSeconds,
    roundSeconds: roundSeconds,
    formatSeconds: formatSeconds,
    normalizeDocument: normalizeDocument,
    createDocument: createDocument,
    effectiveBounds: effectiveBounds,
    resizeInterval: resizeInterval,
    moveInterval: moveInterval,
    addInterval: addInterval,
    removeInterval: removeInterval,
    restoreInterval: restoreInterval,
    reviewInterval: reviewInterval,
    addControl: addControl,
    reviewControl: reviewControl,
    completion: completion,
    missingMetadataFields: missingMetadataFields,
    serialize: serialize,
    parse: parse,
    createTimelineView: createTimelineView,
    secondsToPixels: secondsToPixels,
    pixelsToSeconds: pixelsToSeconds,
    zoomTimeline: zoomTimeline,
    scrollTimeline: scrollTimeline,
    pointerEdit: pointerEdit,
    snapSeconds: snapSeconds,
    setEdgeFromPlayhead: setEdgeFromPlayhead,
    clampPlayheadSeconds: clampPlayheadSeconds,
    isEditableKeyboardTarget: isEditableKeyboardTarget,
    completeMetadata: completeMetadata,
    displayBounds: displayBounds,
    packTimelineLanes: packTimelineLanes
  };
});
