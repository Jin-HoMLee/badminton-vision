/* Rights-first source records and portable manual-label packages. */
(function (root) {
  "use strict";

  var SOURCE_SCHEMA = "bv-source-provenance/v1";
  var PACKAGE_SCHEMA = "bv-manual-label-package/v1";
  var SPLIT_STRATEGY = "fnv1a-match-key-v1";
  var RIGHTS_BASES = ["unknown", "owner-recorded", "explicit-license", "contributor-grant", "public-url-reference"];
  var RIGHTS_STATUSES = ["not-cleared", "pending", "cleared"];
  var CAPTURE_METHODS = ["unknown", "self-recorded", "synthetic", "third-party-upload", "public-url-reference"];
  var CONSENT_STATUSES = ["unknown", "not-required", "pending", "obtained", "declined"];
  var SHAREABILITY = ["not-determined", "private", "reference-only", "shareable"];
  var SPLITS = ["train", "validation", "test"];
  var TRAINING_COMPATIBLE_MEDIA_LICENSES = ["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"];
  var ANNOTATION_LICENSES = ["", "CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0"];

  function clone(value) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    var copy = {};
    Object.keys(value).forEach(function (key) { copy[key] = clone(value[key]); });
    return copy;
  }

  function text(value) { return value == null ? "" : String(value).trim(); }
  function choice(value, allowed, fallback) { return allowed.indexOf(value) >= 0 ? value : fallback; }
  function nullableText(value) { var result = text(value); return result || null; }
  function nowIso(options) {
    var value = options && options.now;
    if (typeof value === "function") value = value();
    if (value instanceof Date) return value.toISOString();
    return typeof value === "string" && value ? value : new Date().toISOString();
  }

  function hash32(value) {
    var hash = 2166136261;
    var input = String(value || "");
    for (var index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function splitForMatch(unitKey) {
    var key = text(unitKey);
    if (!key) return null;
    var bucket = hash32(key) % 100;
    return bucket < 80 ? "train" : bucket < 90 ? "validation" : "test";
  }

  function normalizeSourceRecord(input, options) {
    input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    options = options || {};
    var media = input.media && typeof input.media === "object" && !Array.isArray(input.media) ? input.media : {};
    var consent = input.consent && typeof input.consent === "object" && !Array.isArray(input.consent) ? input.consent : {};
    var split = input.split && typeof input.split === "object" && !Array.isArray(input.split) ? input.split : {};
    var videoKey = text(options.videoKey != null ? options.videoKey : input.videoKey);
    var unitKey = text(split.unitKey) || videoKey;
    var createdAt = text(input.createdAt) || nowIso(options);
    var record = {
      schema: SOURCE_SCHEMA,
      videoKey: videoKey,
      media: {
        owner: text(media.owner),
        rightsBasis: choice(media.rightsBasis, RIGHTS_BASES, "unknown"),
        rightsStatus: choice(media.rightsStatus, RIGHTS_STATUSES, "not-cleared"),
        license: nullableText(media.license),
        licenseUrl: nullableText(media.licenseUrl),
        mediaIncluded: media.mediaIncluded === true,
        captureMethod: choice(media.captureMethod, CAPTURE_METHODS, "unknown"),
        recordedAt: nullableText(media.recordedAt)
      },
      contributor: text(input.contributor),
      consent: {
        status: choice(consent.status, CONSENT_STATUSES, "unknown"),
        evidenceReference: nullableText(consent.evidenceReference)
      },
      annotationLicense: choice(input.annotationLicense, ANNOTATION_LICENSES, ""),
      intendedShareability: choice(input.intendedShareability, SHAREABILITY, "not-determined"),
      split: {
        strategy: SPLIT_STRATEGY,
        unitKey: unitKey,
        assignment: splitForMatch(unitKey)
      },
      createdAt: createdAt,
      updatedAt: text(input.updatedAt) || createdAt
    };

    // Public URLs without an affirmative rights basis are reference-only.
    // Normalization can only make this class more conservative, never clear it.
    if (record.media.rightsBasis === "public-url-reference" || record.media.captureMethod === "public-url-reference") {
      record.media.rightsBasis = "public-url-reference";
      record.media.captureMethod = "public-url-reference";
      record.media.rightsStatus = "not-cleared";
      record.media.mediaIncluded = false;
      record.intendedShareability = "reference-only";
    }
    return record;
  }

  function isIsoDateOrTime(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)?$/.test(value)) return false;
    return !Number.isNaN(Date.parse(value.length === 10 ? value + "T00:00:00Z" : value));
  }

  function isWebUrl(value) {
    return typeof value === "string" && /^https:\/\/[^\s]+$/i.test(value);
  }

  function validateSourceRecord(input, options) {
    options = options || {};
    var record = normalizeSourceRecord(input, { videoKey: input && input.videoKey, now: input && input.createdAt || options.now });
    var errors = [];
    var isObject = input && typeof input === "object" && !Array.isArray(input);
    var rawMedia = isObject && input.media && typeof input.media === "object" && !Array.isArray(input.media) ? input.media : null;
    var rawConsent = isObject && input.consent && typeof input.consent === "object" && !Array.isArray(input.consent) ? input.consent : null;
    var rawSplit = isObject && input.split && typeof input.split === "object" && !Array.isArray(input.split) ? input.split : null;
    function has(object, key) { return Boolean(object && Object.prototype.hasOwnProperty.call(object, key)); }
    if (!isObject) errors.push("source record must be an object");
    if (!isObject || input.schema !== SOURCE_SCHEMA) errors.push("schema must be " + SOURCE_SCHEMA);
    if (!record.videoKey) errors.push("videoKey is required");
    if (options.videoKey != null && record.videoKey !== String(options.videoKey)) errors.push("videoKey does not match the active video");
    ["owner", "rightsBasis", "rightsStatus", "license", "licenseUrl", "mediaIncluded", "captureMethod", "recordedAt"].forEach(function (key) {
      if (!has(rawMedia, key)) errors.push("media." + key + " is required");
    });
    if (rawMedia && RIGHTS_BASES.indexOf(rawMedia.rightsBasis) < 0) errors.push("media.rightsBasis is invalid");
    if (rawMedia && RIGHTS_STATUSES.indexOf(rawMedia.rightsStatus) < 0) errors.push("media.rightsStatus is invalid");
    if (rawMedia && CAPTURE_METHODS.indexOf(rawMedia.captureMethod) < 0) errors.push("media.captureMethod is invalid");
    if (rawMedia && typeof rawMedia.mediaIncluded !== "boolean") errors.push("media.mediaIncluded must be boolean");
    if (!record.media.owner) errors.push("media.owner is required");
    if (record.media.recordedAt && !isIsoDateOrTime(record.media.recordedAt)) errors.push("media.recordedAt must be an ISO date or UTC timestamp");
    if (record.media.licenseUrl && !isWebUrl(record.media.licenseUrl)) errors.push("media.licenseUrl must be an https URL");
    if (!has(input, "contributor") || !record.contributor) errors.push("contributor is required");
    ["status", "evidenceReference"].forEach(function (key) { if (!has(rawConsent, key)) errors.push("consent." + key + " is required"); });
    if (rawConsent && CONSENT_STATUSES.indexOf(rawConsent.status) < 0) errors.push("consent.status is invalid");
    if (!has(input, "annotationLicense") || !record.annotationLicense) errors.push("annotationLicense is required");
    if (!has(input, "intendedShareability") || SHAREABILITY.indexOf(input.intendedShareability) < 0) errors.push("intendedShareability is invalid");
    ["strategy", "unitKey", "assignment"].forEach(function (key) { if (!has(rawSplit, key)) errors.push("split." + key + " is required"); });
    if (!record.split.unitKey) errors.push("split.unitKey is required");
    if (rawSplit && rawSplit.strategy !== SPLIT_STRATEGY) errors.push("split strategy is invalid");
    if (rawSplit && rawSplit.assignment !== splitForMatch(record.split.unitKey)) errors.push("split assignment is not deterministic");
    if (SPLITS.indexOf(record.split.assignment) < 0) errors.push("split assignment is required");
    if (!has(input, "createdAt") || !isIsoDateOrTime(input.createdAt)) errors.push("createdAt must be an ISO UTC timestamp");
    if (!has(input, "updatedAt") || !isIsoDateOrTime(input.updatedAt)) errors.push("updatedAt must be an ISO UTC timestamp");
    if (record.media.rightsStatus === "cleared") {
      if (["owner-recorded", "explicit-license", "contributor-grant"].indexOf(record.media.rightsBasis) < 0) errors.push("cleared media needs an affirmative rights basis");
      if (record.media.captureMethod === "self-recorded" && !record.media.recordedAt) errors.push("self-recorded media needs recordedAt");
      if (record.media.rightsBasis === "explicit-license" && (!record.media.license || !record.media.licenseUrl)) errors.push("explicit-license media needs license and licenseUrl");
      if (record.media.rightsBasis === "contributor-grant" && !record.media.license) errors.push("contributor-grant media needs a recorded license or release reference");
    }
    if (record.consent.status === "obtained" && !record.consent.evidenceReference) errors.push("obtained consent needs an evidence reference");
    if (record.consent.status === "not-required" && record.media.captureMethod !== "synthetic") errors.push("consent may be not-required only for synthetic media");
    return { valid: errors.length === 0, errors: errors, record: record };
  }

  function sourceGate(input, options) {
    var validated = validateSourceRecord(input, options);
    var record = validated.record;
    var reasons = validated.errors.slice();
    if (record.media.rightsStatus !== "cleared") reasons.push("media rights are not cleared");
    if (!record.media.mediaIncluded) reasons.push("media is not included");
    if (record.intendedShareability !== "shareable") reasons.push("source is not intended to be shareable");
    if (["obtained", "not-required"].indexOf(record.consent.status) < 0) reasons.push("identifiable-player consent is not resolved");
    if (record.media.captureMethod !== "synthetic" && record.consent.status !== "obtained") reasons.push("non-synthetic media needs obtained consent");
    if (!record.annotationLicense) reasons.push("annotation license is missing");
    if (record.media.rightsBasis === "explicit-license" && TRAINING_COMPATIBLE_MEDIA_LICENSES.indexOf(record.media.license) < 0) reasons.push("media license is not recorded as training-compatible");
    if (record.media.rightsBasis === "public-url-reference" || record.media.captureMethod === "public-url-reference") reasons.push("public URL references are evaluation-only");
    reasons = reasons.filter(function (reason, index) { return reasons.indexOf(reason) === index; });
    return {
      shareable: reasons.length === 0,
      trainingSourceEligible: reasons.length === 0,
      trainingAuthorized: false,
      reasons: reasons,
      record: record
    };
  }

  function createLabelPackage(source, labels, options) {
    options = options || {};
    var normalized = normalizeSourceRecord(source, { videoKey: source && source.videoKey, now: source && source.createdAt || options.now });
    return {
      schema: PACKAGE_SCHEMA,
      exportedAt: nowIso(options),
      source: normalized,
      labels: Array.isArray(labels) ? clone(labels) : []
    };
  }

  function parseLabelPackage(value, options) {
    options = options || {};
    var document = value;
    if (typeof value === "string") {
      try { document = JSON.parse(value); } catch (_) { return { ok: false, error: "Dataset JSON is not valid JSON." }; }
    }
    if (!document || typeof document !== "object" || Array.isArray(document) || document.schema !== PACKAGE_SCHEMA) {
      return { ok: false, error: "Unrecognized dataset JSON schema." };
    }
    if (!Array.isArray(document.labels)) return { ok: false, error: "Dataset JSON labels must be an array." };
    var validated = validateSourceRecord(document.source, { videoKey: options.videoKey });
    if (!validated.valid) return { ok: false, error: "Invalid source record: " + validated.errors.join("; "), errors: validated.errors };
    return { ok: true, source: validated.record, labels: clone(document.labels), exportedAt: text(document.exportedAt) || null };
  }

  root.BVProvenance = Object.freeze({
    SOURCE_SCHEMA: SOURCE_SCHEMA,
    PACKAGE_SCHEMA: PACKAGE_SCHEMA,
    SPLIT_STRATEGY: SPLIT_STRATEGY,
    RIGHTS_BASES: RIGHTS_BASES.slice(),
    RIGHTS_STATUSES: RIGHTS_STATUSES.slice(),
    CAPTURE_METHODS: CAPTURE_METHODS.slice(),
    CONSENT_STATUSES: CONSENT_STATUSES.slice(),
    SHAREABILITY: SHAREABILITY.slice(),
    ANNOTATION_LICENSES: ANNOTATION_LICENSES.slice(),
    splitForMatch: splitForMatch,
    normalizeSourceRecord: normalizeSourceRecord,
    validateSourceRecord: validateSourceRecord,
    sourceGate: sourceGate,
    createLabelPackage: createLabelPackage,
    parseLabelPackage: parseLabelPackage
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
