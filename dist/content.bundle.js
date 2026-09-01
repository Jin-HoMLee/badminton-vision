/* Generated single-entry MV3 content script. Do not edit dist directly. */
(function (root) {
  if (root.__BV_CONTENT_BUNDLE_LOADED__) return;
  root.__BV_CONTENT_BUNDLE_LOADED__ = true;
  /* src/extension/common/protocol.js */
  /* global globalThis */
  (function installProtocol(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BSOProtocol = api;
  }(typeof globalThis === 'object' ? globalThis : self, function protocolFactory() {
    'use strict';
  
    const PROTOCOL = 'bso.runtime.v1';
    const VERSION = 1;
    const TYPES = Object.freeze({
      SESSION_START: 'runtime.session.start',
      SESSION_END: 'runtime.session.end',
      FRAME_SAMPLE: 'capture.frame.sample',
      ANALYZER_RESULT: 'analysis.result',
      CAPABILITY_REPORT: 'runtime.capabilities',
      RUNTIME_STATUS: 'runtime.status'
    });
    const STALE_RESULT_POLICY = Object.freeze({
      name: 'media-time-watermark',
      summary: 'Display only the newest result at or before current mediaTime; retain it with an age marker while inference is behind; never block playback or seek.',
      futureResults: 'hold-until-current-media-time-reaches-result',
      oldSessionResults: 'discard',
      olderThanDisplayed: 'discard',
      missingInference: 'show-fallback-status-and-unknown-analysis'
    });
  
    function isObject(value) {
      return value !== null && typeof value === 'object';
    }
  
    function finite(value) {
      return typeof value === 'number' && Number.isFinite(value);
    }
  
    function nonEmptyString(value) {
      return typeof value === 'string' && value.length > 0;
    }
  
    // Model-neutral result envelope. A production adapter may populate the
    // players array with zero or more session-local tracks; the fixture probe
    // deliberately leaves it empty and marks tracking unknown/partial.
    function unknownAnalysisResult({ sessionId = 'unknown-session', requestId = 'unknown-request', mediaTime = 0 } = {}) {
      return {
        schema: 'bso.analysis.result.v1',
        state: 'partial',
        players: [],
        tracking: {
          schema: 'bso.player-tracking.result.v1',
          version: 1,
          sessionId,
          requestId,
          mediaTime,
          state: 'unknown',
          players: [],
          observations: [],
          duplicateObservations: [],
          invalidObservations: [],
          detector: { id: 'unknown-detector', version: 0, kind: 'pose-detector' },
          source: { id: 'unknown-source', version: 0, kind: 'frame-source' },
          association: { method: 'gated-motion-box-keypoint-v1', maxTracks: 4, identityRisk: 'none' },
          accepted: true,
          reason: 'no-detector-observations'
        },
        shuttle: { state: 'unknown', confidence: null },
        strokeEvents: [],
        rally: { state: 'unknown', confidence: null, reason: 'rally-segmentation-not-available' },
        rallyEnd: { state: 'unknown', confidence: null, reason: 'rally-end-evidence-not-available' },
        winner: { state: 'unknown', confidence: null, reason: 'winner-evidence-not-available' },
        outcome: 'unclassified',
        shotFamily: 'unclassified',
        classificationConfidence: 0,
        geometryConfidence: 0
      };
    }
  
    function base(type, sessionId) {
      if (!Object.values(TYPES).includes(type)) throw new TypeError(`Unknown BSO message type: ${type}`);
      if (!nonEmptyString(sessionId)) throw new TypeError('sessionId must be a non-empty string');
      return { protocol: PROTOCOL, version: VERSION, type, sessionId };
    }
  
    function createSessionStart({ sessionId, pageUrl, capabilities = {} }) {
      return {
        ...base(TYPES.SESSION_START, sessionId),
        pageUrl: typeof pageUrl === 'string' ? pageUrl : '',
        capabilities,
        stalePolicy: STALE_RESULT_POLICY
      };
    }
  
    function createSessionEnd({ sessionId, reason = 'detached' }) {
      return { ...base(TYPES.SESSION_END, sessionId), reason };
    }
  
    /**
     * Return a wire message and the object(s) that must be transferred with it.
     * ImageBitmap and VideoFrame are intentionally kept out of JSON/base64. A
     * structured-clone transport may use the returned transferables; stable
     * Chrome supplies a bounded plain RGBA frame instead. The runtime fixture
     * analyzer consumes either snapshot locally.
     */
    function createFrameSample({
      sessionId,
      requestId,
      mediaTime,
      capturedAt = Date.now(),
      width,
      height,
      frame,
      frameFormat = 'image-bitmap'
    }) {
      if (!nonEmptyString(requestId)) throw new TypeError('requestId must be a non-empty string');
      if (!finite(mediaTime) || mediaTime < 0) throw new TypeError('mediaTime must be a non-negative number');
      if (!finite(capturedAt)) throw new TypeError('capturedAt must be finite');
      if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        throw new TypeError('frame dimensions must be positive integers');
      }
      if (!isObject(frame)) throw new TypeError('frame must be a transferable frame object');
      const message = {
        ...base(TYPES.FRAME_SAMPLE, sessionId),
        requestId,
        mediaTime,
        capturedAt,
        dimensions: { width, height },
        frameFormat,
        frame
      };
      return { message, transferables: frameFormat === 'image-bitmap' ? [frame] : [] };
    }
  
    function createAnalyzerResult({
      sessionId,
      requestId,
      mediaTime,
      analyzedAt = Date.now(),
      status = 'ok',
      analyzer = 'mock',
      analyzerIdentity = analyzer,
      inferenceAvailable = false,
      capabilities = {},
      capabilityState = capabilities,
      result = null
    }) {
      if (!nonEmptyString(requestId)) throw new TypeError('requestId must be a non-empty string');
      if (!finite(mediaTime) || mediaTime < 0) throw new TypeError('mediaTime must be a non-negative number');
      if (!nonEmptyString(analyzer)) throw new TypeError('analyzer must be a non-empty string');
      const state = isObject(capabilityState) ? capabilityState : {};
      const analysisResult = result || unknownAnalysisResult({ sessionId, requestId, mediaTime });
      return {
        ...base(TYPES.ANALYZER_RESULT, sessionId),
        requestId,
        mediaTime,
        analyzedAt,
        status,
        analyzer,
        analyzerIdentity,
        inferenceAvailable: Boolean(inferenceAvailable),
        // Results carry the capability snapshot that was true when they were
        // produced. This keeps a late result from being mistaken for a current
        // production-model result after a fallback or session change.
        capabilities: state,
        capabilityState: state,
        result: analysisResult,
        stalePolicy: STALE_RESULT_POLICY
      };
    }
  
    function createCapabilityReport({
      sessionId,
      capture = 'unavailable',
      transferableFrames = false,
      offscreen = false,
      inference = false,
      analyzer = 'none',
      fallbacks = [],
      reason = '',
      transport = 'mv3-runtime-messaging',
      frameTransport = 'unknown',
      backend = null,
      components = null
    }) {
      return {
        ...base(TYPES.CAPABILITY_REPORT, sessionId),
        capabilities: {
          capture,
          transferableFrames: Boolean(transferableFrames),
          offscreen: Boolean(offscreen),
          inference: Boolean(inference),
          analyzer,
          backend,
          components,
          transport,
          frameTransport
        },
        fallbacks: Array.isArray(fallbacks) ? fallbacks : [],
        reason,
        stalePolicy: STALE_RESULT_POLICY
      };
    }
  
    function createRuntimeStatus({ sessionId, phase, message = '', capabilities = {}, reason = '' }) {
      if (!nonEmptyString(phase)) throw new TypeError('phase must be a non-empty string');
      return {
        ...base(TYPES.RUNTIME_STATUS, sessionId),
        phase,
        message,
        capabilities,
        reason,
        stalePolicy: STALE_RESULT_POLICY
      };
    }
  
    function hasBase(message, type) {
      return isObject(message) && message.protocol === PROTOCOL && message.version === VERSION &&
        message.type === type && nonEmptyString(message.sessionId);
    }
  
    function isFrameSample(message) {
      return hasBase(message, TYPES.FRAME_SAMPLE) && nonEmptyString(message.requestId) &&
        finite(message.mediaTime) && message.mediaTime >= 0 && finite(message.capturedAt) &&
        isObject(message.dimensions) && Number.isInteger(message.dimensions.width) && message.dimensions.width > 0 &&
        Number.isInteger(message.dimensions.height) && message.dimensions.height > 0 && isObject(message.frame) &&
        (!message.frameFormat || typeof message.frameFormat === 'string');
    }
  
    function isTrackingEnvelope(value) {
      const trackingApi = typeof globalThis === 'object' ? globalThis.BSOPlayerTracking : null;
      if (trackingApi && typeof trackingApi.isTrackingResult === 'function') return trackingApi.isTrackingResult(value);
      if (!isObject(value) || value.schema !== 'bso.player-tracking.result.v1' || value.version !== 1 ||
          !nonEmptyString(value.sessionId) || !nonEmptyString(value.requestId) || !finite(value.mediaTime) || value.mediaTime < 0 ||
          !['tracked', 'partial', 'unknown'].includes(value.state) || !Array.isArray(value.players) ||
          !Array.isArray(value.observations)) return false;
      return value.players.every((player) => isObject(player) && nonEmptyString(player.trackId) &&
        ['tracked', 'partial', 'unknown'].includes(player.state));
    }
  
    function isAnalyzerResult(message) {
      return hasBase(message, TYPES.ANALYZER_RESULT) && nonEmptyString(message.requestId) &&
        finite(message.mediaTime) && message.mediaTime >= 0 && nonEmptyString(message.analyzer) &&
        isObject(message.result) && (message.result.tracking == null || isTrackingEnvelope(message.result.tracking)) &&
        isObject(message.capabilities || message.capabilityState);
    }
  
    function isCapabilityReport(message) {
      return hasBase(message, TYPES.CAPABILITY_REPORT) && isObject(message.capabilities);
    }
  
    function isRuntimeMessage(message) {
      return isObject(message) && message.protocol === PROTOCOL && message.version === VERSION &&
        Object.values(TYPES).includes(message.type) && nonEmptyString(message.sessionId);
    }
  
    return Object.freeze({
      PROTOCOL,
      VERSION,
      TYPES,
      STALE_RESULT_POLICY,
      createSessionStart,
      createSessionEnd,
      createFrameSample,
      createAnalyzerResult,
      createCapabilityReport,
      createRuntimeStatus,
      unknownAnalysisResult,
      isTrackingEnvelope,
      isFrameSample,
      isAnalyzerResult,
      isCapabilityReport,
      isRuntimeMessage
    });
  }));
  
  /* src/extension/common/player-tracking.js */
  /* global globalThis */
  (function installPlayerTracking(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BSOPlayerTracking = api;
  }(typeof globalThis === 'object' ? globalThis : self, function playerTrackingFactory() {
    'use strict';
  
    // This file is deliberately model-neutral. It consumes detector output and
    // never loads a model, chooses a detector, or uses court half as identity.
    const OBSERVATION_SCHEMA = 'bso.pose.observation.v1';
    const TRACKING_SCHEMA = 'bso.player-tracking.result.v1';
    const VERSION = 1;
    const STATES = Object.freeze({ TRACKED: 'tracked', PARTIAL: 'partial', UNKNOWN: 'unknown' });
    const DEFAULT_GATES = Object.freeze({
      maxTracks: 4,
      maxCenterDistance: 0.24,
      maxCost: 0.82,
      unmatchedCost: 0.9,
      ambiguityMargin: 0.08,
      minNewTrackConfidence: 0.25,
      minTrackedConfidence: 0.5,
      maxMissedFrames: 2,
      retireAfterMissedFrames: 8,
      duplicateIoU: 0.97,
      crossoverDistance: 0.12,
      crossoverIoU: 0.2,
      keypointGate: 0.45
    });
  
    function isObject(value) {
      return value !== null && typeof value === 'object';
    }
  
    function finite(value) {
      return typeof value === 'number' && Number.isFinite(value);
    }
  
    function nonEmptyString(value) {
      return typeof value === 'string' && value.length > 0;
    }
  
    function clamp(value, minimum = 0, maximum = 1) {
      return Math.max(minimum, Math.min(maximum, value));
    }
  
    function copy(value) {
      if (value == null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(copy);
      const result = {};
      Object.keys(value).forEach((key) => { result[key] = copy(value[key]); });
      return result;
    }
  
    function identity(value, fallbackId, fallbackKind) {
      if (typeof value === 'string' && value.length) return { id: value, version: 1, kind: fallbackKind };
      if (!isObject(value)) return { id: fallbackId, version: 0, kind: fallbackKind };
      const id = value.id || value.detectorId || value.sourceId || value.name || fallbackId;
      const result = { id: String(id), version: Number.isInteger(value.version) ? value.version : 0 };
      if (value.kind || fallbackKind) result.kind = value.kind || fallbackKind;
      if (value.label) result.label = String(value.label);
      return result;
    }
  
    function dimensionsFrom(raw, options) {
      const frame = (raw && (raw.frame || raw.dimensions)) || {};
      const opts = options || {};
      return {
        width: frame.width || raw?.frameWidth || opts.width || opts.frameWidth,
        height: frame.height || raw?.frameHeight || opts.height || opts.frameHeight
      };
    }
  
    function coordinateSpace(raw, options) {
      const explicit = raw?.coordinateSpace || raw?.bboxSpace || options?.coordinateSpace || options?.bboxSpace;
      if (explicit) return explicit;
      const rawBox = raw?.bbox || raw?.boundingBox || raw?.box;
      const hasDimensions = dimensionsFrom(raw, options).width > 0 && dimensionsFrom(raw, options).height > 0;
      // Most browser pose adapters report pixels. Infer that form only when a
      // coordinate is necessarily outside normalized space; otherwise default to
      // normalized so a 0..1 detector remains unambiguous.
      if (hasDimensions && rawBox && [rawBox.x, rawBox.y, rawBox.width, rawBox.height, rawBox.xMin, rawBox.yMin, rawBox.xMax, rawBox.yMax]
        .some((value) => finite(value) && value > 1)) return 'pixel';
      return 'normalized';
    }
  
    function coordinate(value, dimension, space) {
      if (!finite(value)) return null;
      if (space === 'pixel' || space === 'pixels') {
        if (!finite(dimension) || dimension <= 0) return null;
        return value / dimension;
      }
      return value;
    }
  
    function normalizedNumber(value) {
      return Number(value.toFixed(6));
    }
  
    function normalizeBox(rawBox, dimensions, space) {
      if (!isObject(rawBox)) return null;
      let x;
      let y;
      let width;
      let height;
      if (finite(rawBox.xMin) && finite(rawBox.yMin) && finite(rawBox.xMax) && finite(rawBox.yMax)) {
        x = rawBox.xMin;
        y = rawBox.yMin;
        width = rawBox.xMax - rawBox.xMin;
        height = rawBox.yMax - rawBox.yMin;
      } else {
        x = rawBox.x;
        y = rawBox.y;
        width = rawBox.width;
        height = rawBox.height;
      }
      const nx = coordinate(x, dimensions.width, space);
      const ny = coordinate(y, dimensions.height, space);
      const nw = coordinate(width, dimensions.width, space);
      const nh = coordinate(height, dimensions.height, space);
      if (![nx, ny, nw, nh].every(finite) || nw <= 0 || nh <= 0) return null;
      // Detectors occasionally return a box a few pixels beyond the image. Clip
      // it here; a fully outside box is invalid and is represented as missing.
      const left = Math.max(0, nx);
      const top = Math.max(0, ny);
      const right = Math.min(1, nx + nw);
      const bottom = Math.min(1, ny + nh);
      if (right <= left || bottom <= top) return null;
      return { x: normalizedNumber(left), y: normalizedNumber(top), width: normalizedNumber(right - left), height: normalizedNumber(bottom - top) };
    }
  
    function normalizeKeypoints(rawKeypoints, dimensions, space, issues) {
      if (!Array.isArray(rawKeypoints)) return [];
      const names = new Set();
      const result = [];
      rawKeypoints.forEach((raw, index) => {
        if (!isObject(raw)) {
          issues.push(`keypoint[${index}] is not an object`);
          return;
        }
        const name = raw.name || raw.id || raw.part || `keypoint-${index}`;
        const x = coordinate(raw.x, dimensions.width, space);
        const y = coordinate(raw.y, dimensions.height, space);
        if (!finite(x) || !finite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
          issues.push(`keypoint[${index}] is outside normalized frame`);
          return;
        }
        const confidence = raw.confidence == null ? (raw.score == null ? null : raw.score) : raw.confidence;
        if (confidence !== null && (!finite(confidence) || confidence < 0 || confidence > 1)) {
          issues.push(`keypoint[${index}] confidence is outside [0,1]`);
          return;
        }
        if (names.has(String(name))) {
          issues.push(`duplicate keypoint name: ${name}`);
          return;
        }
        names.add(String(name));
        result.push({ name: String(name), x: normalizedNumber(x), y: normalizedNumber(y), confidence });
      });
      return result;
    }
  
    function normalizedConfidence(raw) {
      const value = raw?.confidence == null ? raw?.score : raw.confidence;
      return value == null ? null : (finite(value) && value >= 0 && value <= 1 ? value : null);
    }
  
    function stateFor(raw, bbox, keypoints, confidence, issues) {
      if (raw?.state === STATES.UNKNOWN) return STATES.UNKNOWN;
      if (raw?.state === STATES.PARTIAL) return STATES.PARTIAL;
      if (raw?.state === STATES.TRACKED && bbox && confidence !== null && confidence >= 0.5 && !issues.length) return STATES.TRACKED;
      if (bbox || keypoints.length) return STATES.PARTIAL;
      return STATES.UNKNOWN;
    }
  
    /**
     * Normalize one detector pose into the wire contract. Pixel coordinates are
     * accepted with frame dimensions and are inferred when a coordinate exceeds
     * normalized space; coordinateSpace can be supplied explicitly. Invalid
     * keypoints are omitted and listed   * in issues so a partial pose is never promoted to a full pose silently.
     */
    function normalizePoseObservation(raw = {}, options = {}) {
      const issues = [];
      if (!isObject(raw)) {
        issues.push('observation is not an object');
        raw = {};
      }
      const dimensions = dimensionsFrom(raw, options);
      const space = coordinateSpace(raw, options);
      const rawBox = raw.bbox || raw.boundingBox || raw.box;
      const bbox = normalizeBox(rawBox, dimensions, space);
      if (rawBox && !bbox) issues.push('bounding box is invalid or outside frame');
      const keypoints = normalizeKeypoints(raw.keypoints || raw.pose || [], dimensions, space, issues);
      const confidence = normalizedConfidence(raw);
      if ((raw.confidence != null || raw.score != null) && confidence === null) issues.push('confidence is outside [0,1]');
      const requestId = raw.requestId || options.requestId || 'unknown-request';
      const mediaTime = raw.mediaTime == null ? options.mediaTime : raw.mediaTime;
      const result = {
        schema: OBSERVATION_SCHEMA,
        version: VERSION,
        observationId: String(raw.observationId || raw.id || options.observationId || `${requestId}:pose-0`),
        sessionId: String(raw.sessionId || options.sessionId || 'unknown-session'),
        requestId: String(requestId),
        mediaTime: finite(mediaTime) && mediaTime >= 0 ? mediaTime : null,
        detector: identity(raw.detector || options.detector, 'unknown-detector', 'pose-detector'),
        source: identity(raw.source || options.source, 'unknown-source', 'frame-source'),
        state: stateFor(raw, bbox, keypoints, confidence, issues),
        confidence,
        bbox,
        keypoints
      };
      if (raw.label != null) result.label = String(raw.label);
      if (issues.length) result.issues = issues;
      return result;
    }
  
    function validateBox(box) {
      return box === null || (isObject(box) && finite(box.x) && finite(box.y) && finite(box.width) && finite(box.height) &&
        box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1 && box.y + box.height <= 1);
    }
  
    function validateIdentity(value) {
      return isObject(value) && nonEmptyString(value.id) && Number.isInteger(value.version) && value.version >= 0;
    }
  
    /** Validate the normalized, versioned pose shape at an adapter boundary. */
    function isPoseObservation(value) {
      if (!isObject(value) || value.schema !== OBSERVATION_SCHEMA || value.version !== VERSION ||
          !nonEmptyString(value.observationId) || !nonEmptyString(value.sessionId) || !nonEmptyString(value.requestId) ||
          !finite(value.mediaTime) || value.mediaTime < 0 || !validateIdentity(value.detector) || !validateIdentity(value.source) ||
          !Object.values(STATES).includes(value.state) || !validateBox(value.bbox) || !Array.isArray(value.keypoints)) return false;
      if (value.confidence !== null && (!finite(value.confidence) || value.confidence < 0 || value.confidence > 1)) return false;
      const names = new Set();
      return value.keypoints.every((point) => {
        if (!isObject(point) || !nonEmptyString(point.name) || names.has(point.name) ||
            !finite(point.x) || !finite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
        if (point.confidence !== null && (!finite(point.confidence) || point.confidence < 0 || point.confidence > 1)) return false;
        names.add(point.name);
        return true;
      }) && (value.state !== STATES.TRACKED || (value.bbox !== null && value.confidence !== null));
    }
  
    function boxArea(box) {
      return box ? box.width * box.height : 0;
    }
  
    function boxCenter(box) {
      return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    }
  
    function boxIoU(a, b) {
      if (!a || !b) return 0;
      const left = Math.max(a.x, b.x);
      const top = Math.max(a.y, b.y);
      const right = Math.min(a.x + a.width, b.x + b.width);
      const bottom = Math.min(a.y + a.height, b.y + b.height);
      const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
      return intersection / Math.max(1e-9, boxArea(a) + boxArea(b) - intersection);
    }
  
    function distance(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
  
    function keypointEvidence(trackKeypoints, observationKeypoints) {
      if (!Array.isArray(trackKeypoints) || !Array.isArray(observationKeypoints)) return null;
      const observed = new Map(observationKeypoints.map((point) => [point.name, point]));
      const common = trackKeypoints.filter((point) => observed.has(point.name));
      if (!common.length) return null;
      const mean = common.reduce((sum, point) => sum + distance(point, observed.get(point.name)), 0) / common.length;
      return { distance: mean, count: common.length };
    }
  
    function predictedBox(track, mediaTime) {
      const dt = Math.max(0, Math.min(1.5, mediaTime - track.lastMediaTime));
      const box = track.bbox;
      const predicted = {
        x: box.x + track.velocity.x * dt,
        y: box.y + track.velocity.y * dt,
        width: box.width + track.velocity.width * dt,
        height: box.height + track.velocity.height * dt
      };
      const width = Math.max(0.001, Math.min(1, predicted.width));
      const height = Math.max(0.001, Math.min(1, predicted.height));
      return {
        x: clamp(predicted.x, 0, 1 - width),
        y: clamp(predicted.y, 0, 1 - height),
        width,
        height
      };
    }
  
    function sameObservationGeometry(a, b, threshold) {
      if (!a.bbox || !b.bbox) return !a.bbox && !b.bbox;
      return boxIoU(a.bbox, b.bbox) >= threshold &&
        (keypointEvidence(a.keypoints, b.keypoints)?.distance || 0) <= 0.025;
    }
  
    function deduplicateObservations(observations, threshold) {
      const unique = [];
      const duplicates = [];
      observations.forEach((observation) => {
        const existingById = unique.find((item) => item.observationId === observation.observationId);
        const existingByGeometry = unique.find((item) => sameObservationGeometry(item, observation, threshold));
        const existing = existingById || existingByGeometry;
        if (!existing) {
          unique.push(observation);
          return;
        }
        const incumbentConfidence = existing.confidence == null ? -1 : existing.confidence;
        const candidateConfidence = observation.confidence == null ? -1 : observation.confidence;
        const replace = candidateConfidence > incumbentConfidence ||
          (candidateConfidence === incumbentConfidence && observation.observationId < existing.observationId);
        if (replace) {
          const index = unique.indexOf(existing);
          unique[index] = observation;
        }
        duplicates.push({
          duplicateObservationId: replace ? existing.observationId : observation.observationId,
          keptObservationId: replace ? observation.observationId : existing.observationId
        });
      });
      return {
        observations: unique.sort((a, b) => a.observationId.localeCompare(b.observationId)),
        duplicates: duplicates.sort((a, b) => a.duplicateObservationId.localeCompare(b.duplicateObservationId) || a.keptObservationId.localeCompare(b.keptObservationId))
      };
    }
  
    function orientation(a, b, c) {
      const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      return Math.abs(value) < 1e-9 ? 0 : value > 0 ? 1 : -1;
    }
  
    function segmentsIntersect(a, b, c, d) {
      const ab1 = orientation(a, b, c);
      const ab2 = orientation(a, b, d);
      const cd1 = orientation(c, d, a);
      const cd2 = orientation(c, d, b);
      return ab1 !== ab2 && cd1 !== cd2;
    }
  
    function pathCrosses(first, second, firstObservation, secondObservation) {
      const a = boxCenter(first.predicted);
      const b = boxCenter(firstObservation.bbox);
      const c = boxCenter(second.predicted);
      const d = boxCenter(secondObservation.bbox);
      return Boolean(a && b && c && d && segmentsIntersect(a, b, c, d));
    }
  
    function validTrackState(state) {
      return state === STATES.TRACKED || state === STATES.PARTIAL || state === STATES.UNKNOWN;
    }
  
    function trackingState(players, observationCount) {
      if (!players.length && !observationCount) return STATES.UNKNOWN;
      if (players.length && players.every((player) => player.state === STATES.UNKNOWN) && !observationCount) return STATES.UNKNOWN;
      if (players.length && players.every((player) => player.state === STATES.TRACKED)) return STATES.TRACKED;
      return STATES.PARTIAL;
    }
  
    function resultShape({ sessionId, requestId, mediaTime, state, players, observations, duplicates, invalidObservations = [], association, accepted = true, reason = '' }) {
      return {
        schema: TRACKING_SCHEMA,
        version: VERSION,
        sessionId,
        requestId,
        mediaTime,
        state,
        players,
        observations,
        duplicateObservations: duplicates,
        invalidObservations,
        association: {
          method: 'gated-motion-box-keypoint-v1',
          maxTracks: DEFAULT_GATES.maxTracks,
          gates: copy(DEFAULT_GATES),
          ...(association || {})
        },
        accepted,
        reason
      };
    }
  
    class SessionPlayerTracker {
      constructor({ sessionId, maxTracks = DEFAULT_GATES.maxTracks, gates = {} } = {}) {
        if (!nonEmptyString(sessionId)) throw new TypeError('sessionId must be a non-empty string');
        if (!Number.isInteger(maxTracks) || maxTracks < 2 || maxTracks > 4) throw new RangeError('maxTracks must be an integer from 2 through 4');
        this.sessionId = sessionId;
        this.gates = Object.assign({}, DEFAULT_GATES, gates, { maxTracks });
        this.tracks = new Map();
        this.nextTrackNumber = 1;
        this.generation = 0;
        this.lastMediaTime = -Infinity;
        this.seenRequests = new Set();
      }
  
      reset(reason = 'session-reset') {
        if (isObject(reason)) reason = reason.reason || 'session-reset';
        this.tracks.clear();
        this.nextTrackNumber = 1;
        this.generation += 1;
        this.lastMediaTime = -Infinity;
        this.seenRequests.clear();
        return { reason, generation: this.generation };
      }
  
      newTrackId() {
        const id = `${this.sessionId}:s${this.generation}:player-${this.nextTrackNumber}`;
        this.nextTrackNumber += 1;
        return id;
      }
  
      normalize(input) {
        const values = Array.isArray(input) ? input : (Array.isArray(input?.observations) ? input.observations : []);
        const context = Array.isArray(input) ? {} : input || {};
        const normalized = values.map((raw, index) => normalizePoseObservation(raw, Object.assign({}, context, {
          sessionId: this.sessionId,
          requestId: context.requestId || 'unknown-request',
          observationId: raw?.observationId || raw?.id || `${context.requestId || 'unknown-request'}:pose-${index}`,
          mediaTime: context.mediaTime,
          detector: context.detector,
          source: context.source
        })));
        const valid = normalized.filter((observation) => isPoseObservation(observation));
        return Object.assign(deduplicateObservations(valid, this.gates.duplicateIoU), {
          invalid: normalized.filter((observation) => !isPoseObservation(observation))
        });
      }
  
      candidate(track, observation, mediaTime) {
        if (!observation.bbox || observation.state === STATES.UNKNOWN) return null;
        const predicted = predictedBox(track, mediaTime);
        const predictedCenter = boxCenter(predicted);
        const observedCenter = boxCenter(observation.bbox);
        const motionDistance = distance(predictedCenter, observedCenter);
        const iou = boxIoU(predicted, observation.bbox);
        const widthRatio = observation.bbox.width / predicted.width;
        const heightRatio = observation.bbox.height / predicted.height;
        const keypoints = keypointEvidence(track.keypoints, observation.keypoints);
        const keypointDistance = keypoints ? keypoints.distance : 0.2;
        const hasBoxGate = iou >= 0.01 || motionDistance <= this.gates.maxCenterDistance;
        const sizeGate = widthRatio >= 0.25 && widthRatio <= 4 && heightRatio >= 0.25 && heightRatio <= 4;
        if (!hasBoxGate || !sizeGate || (keypoints && keypoints.count >= 2 && keypointDistance > this.gates.keypointGate)) return null;
        const motionCost = Math.min(1, motionDistance / this.gates.maxCenterDistance);
        const boxCost = 1 - iou;
        const keypointCost = Math.min(1, keypointDistance / this.gates.keypointGate);
        const confidencePenalty = observation.confidence == null ? 0.08 : (1 - observation.confidence) * 0.12;
        const cost = 0.45 * motionCost + 0.3 * boxCost + 0.25 * keypointCost + confidencePenalty;
        if (cost > this.gates.maxCost) return null;
        return { trackId: track.trackId, observationId: observation.observationId, cost, predicted, iou, motionDistance, keypoints };
      }
  
      assignments(tracks, observations, mediaTime) {
        const candidates = tracks.map((track) => observations.map((observation) => this.candidate(track, observation, mediaTime)));
        const all = [];
        function visit(trackIndex, used, matches, cost) {
          if (trackIndex >= tracks.length) {
            const signature = tracks.map((track) => matches.find((match) => match.trackId === track.trackId)?.observationId || '~').join('|');
            all.push({ matches: matches.slice(), cost, signature });
            return;
          }
          visit(trackIndex + 1, used, matches, cost + this.gates.unmatchedCost);
          observations.forEach((observation, observationIndex) => {
            if (used.has(observationIndex)) return;
            const candidate = candidates[trackIndex][observationIndex];
            if (!candidate) return;
            used.add(observationIndex);
            matches.push(candidate);
            visit(trackIndex + 1, used, matches, cost + candidate.cost);
            matches.pop();
            used.delete(observationIndex);
          });
        }
        visit = visit.bind(this);
        visit(0, new Set(), [], 0);
        all.sort((a, b) => a.cost - b.cost || a.signature.localeCompare(b.signature));
        const best = all[0] || { matches: [], cost: 0, signature: '' };
        const second = all.find((candidate) => candidate.signature !== best.signature) || null;
        const ambiguousTrackIds = new Set();
        const ambiguousObservationIds = new Set();
        if (second && second.cost - best.cost <= this.gates.ambiguityMargin) {
          const bestByTrack = new Map(best.matches.map((match) => [match.trackId, match.observationId]));
          const secondByTrack = new Map(second.matches.map((match) => [match.trackId, match.observationId]));
          tracks.forEach((track) => {
            if ((bestByTrack.get(track.trackId) || '~') !== (secondByTrack.get(track.trackId) || '~')) ambiguousTrackIds.add(track.trackId);
          });
          best.matches.forEach((match) => {
            if (ambiguousTrackIds.has(match.trackId)) ambiguousObservationIds.add(match.observationId);
          });
          second.matches.forEach((match) => {
            if (ambiguousTrackIds.has(match.trackId)) ambiguousObservationIds.add(match.observationId);
          });
        }
        const bestByTrack = new Map(best.matches.map((match) => [match.trackId, match]));
        const matched = Array.from(bestByTrack.values());
        for (let i = 0; i < matched.length; i += 1) {
          for (let j = i + 1; j < matched.length; j += 1) {
            const first = matched[i];
            const secondMatch = matched[j];
            const firstObservation = observations.find((observation) => observation.observationId === first.observationId);
            const secondObservation = observations.find((observation) => observation.observationId === secondMatch.observationId);
            if (!firstObservation || !secondObservation) continue;
            const observationsOverlap = boxIoU(firstObservation.bbox, secondObservation.bbox) >= this.gates.crossoverIoU ||
              distance(boxCenter(firstObservation.bbox), boxCenter(secondObservation.bbox)) <= this.gates.crossoverDistance;
            const crossedPaths = pathCrosses(first, secondMatch, firstObservation, secondObservation);
            const weakIdentityEvidence = !first.keypoints || !secondMatch.keypoints || first.keypoints.count < 2 || secondMatch.keypoints.count < 2;
            if (weakIdentityEvidence && (crossedPaths || observationsOverlap)) {
              ambiguousTrackIds.add(first.trackId);
              ambiguousTrackIds.add(secondMatch.trackId);
              ambiguousObservationIds.add(first.observationId);
              ambiguousObservationIds.add(secondMatch.observationId);
            }
          }
        }
        return { best, second, candidates, ambiguousTrackIds, ambiguousObservationIds };
      }
  
      createTrack(observation, mediaTime) {
        const track = {
          trackId: this.newTrackId(),
          bbox: copy(observation.bbox),
          keypoints: copy(observation.keypoints),
          confidence: observation.confidence,
          state: observation.state === STATES.TRACKED && observation.confidence >= this.gates.minTrackedConfidence ? STATES.TRACKED : STATES.PARTIAL,
          lastMediaTime: mediaTime,
          lastObservationId: observation.observationId,
          missedFrames: 0,
          velocity: { x: 0, y: 0, width: 0, height: 0 },
          detector: copy(observation.detector),
          source: copy(observation.source),
          uncertaintyFrames: 0
        };
        this.tracks.set(track.trackId, track);
        return track;
      }
  
      updateMotionHint(track, observation, mediaTime) {
        // During a crossover the candidate is useful as a velocity hint, but its
        // identity is not committed. Keeping the old last-observed box plus this
        // hint lets separated players recover their prior IDs on a later frame.
        const dt = Math.max(1e-6, mediaTime - track.lastMediaTime);
        track.velocity = {
          x: (observation.bbox.x - track.bbox.x) / dt,
          y: (observation.bbox.y - track.bbox.y) / dt,
          width: (observation.bbox.width - track.bbox.width) / dt,
          height: (observation.bbox.height - track.bbox.height) / dt
        };
      }
  
      updateTrack(track, observation, mediaTime) {
        const dt = Math.max(1e-6, mediaTime - track.lastMediaTime);
        const old = track.bbox;
        track.velocity = {
          x: (observation.bbox.x - old.x) / dt,
          y: (observation.bbox.y - old.y) / dt,
          width: (observation.bbox.width - old.width) / dt,
          height: (observation.bbox.height - old.height) / dt
        };
        track.bbox = copy(observation.bbox);
        track.keypoints = copy(observation.keypoints);
        track.confidence = observation.confidence;
        track.state = observation.state === STATES.TRACKED && observation.confidence !== null && observation.confidence >= this.gates.minTrackedConfidence ? STATES.TRACKED : STATES.PARTIAL;
        track.lastMediaTime = mediaTime;
        track.lastObservationId = observation.observationId;
        track.missedFrames = 0;
        track.detector = copy(observation.detector);
        track.source = copy(observation.source);
        track.uncertaintyFrames = 0;
      }
  
      playerView(track, mediaTime, forceUnknown = false) {
        const bbox = predictedBox(track, mediaTime);
        const state = forceUnknown ? STATES.UNKNOWN : track.missedFrames > 0 ? (track.missedFrames <= this.gates.maxMissedFrames ? STATES.PARTIAL : STATES.UNKNOWN) : track.state;
        return {
          trackId: track.trackId,
          state: validTrackState(state) ? state : STATES.UNKNOWN,
          confidence: state === STATES.TRACKED ? track.confidence : null,
          bbox: state === STATES.UNKNOWN ? null : bbox,
          keypoints: state === STATES.UNKNOWN ? [] : copy(track.keypoints),
          observationId: track.missedFrames ? null : track.lastObservationId,
          lastSeenMediaTime: track.lastMediaTime,
          missedFrames: track.missedFrames,
          detector: copy(track.detector),
          source: copy(track.source)
        };
      }
  
      processFrame(input = {}) {
        const requestId = String(input.requestId || 'unknown-request');
        const mediaTime = input.mediaTime;
        if (!finite(mediaTime) || mediaTime < 0) throw new TypeError('mediaTime must be a non-negative number');
        if (input.sessionId && input.sessionId !== this.sessionId) {
          return { accepted: false, reason: 'session-mismatch', result: resultShape({ sessionId: this.sessionId, requestId, mediaTime, state: STATES.UNKNOWN, players: [], observations: [], duplicates: [], accepted: false, reason: 'session-mismatch' }) };
        }
        if (input.stale) {
          return { accepted: false, reason: 'stale-frame', result: this.snapshot(requestId, mediaTime, [], [], { reason: 'stale-frame' }, false) };
        }
        if (input.cameraCut) this.reset('camera-cut');
        if (this.seenRequests.has(requestId)) {
          return { accepted: false, reason: 'duplicate-request', result: this.snapshot(requestId, mediaTime, [], [], { reason: 'duplicate-request' }, false) };
        }
        if (mediaTime <= this.lastMediaTime) {
          return { accepted: false, reason: 'stale-frame', result: this.snapshot(requestId, mediaTime, [], [], { reason: 'stale-frame' }, false) };
        }
        this.seenRequests.add(requestId);
        if (this.seenRequests.size > 128) this.seenRequests.delete(this.seenRequests.values().next().value);
        const deduped = this.normalize(input);
        const observations = deduped.observations;
        const eligible = observations.filter((observation) => observation.bbox && observation.state !== STATES.UNKNOWN);
        const priorTracks = Array.from(this.tracks.values()).sort((a, b) => a.trackId.localeCompare(b.trackId));
        const association = this.assignments(priorTracks, eligible, mediaTime);
        const matchedObservationIds = new Set();
        const ambiguousTrackIds = association.ambiguousTrackIds;
        const events = [];
        association.best.matches.forEach((match) => {
          const track = this.tracks.get(match.trackId);
          const observation = eligible.find((item) => item.observationId === match.observationId);
          if (!track || !observation) return;
          matchedObservationIds.add(observation.observationId);
          if (ambiguousTrackIds.has(track.trackId)) {
            this.updateMotionHint(track, observation, mediaTime);
            track.missedFrames += 1;
            track.uncertaintyFrames += 1;
            events.push({ type: 'identity-uncertain', trackId: track.trackId, observationIds: Array.from(association.ambiguousObservationIds).sort() });
          } else {
            this.updateTrack(track, observation, mediaTime);
          }
        });
        priorTracks.forEach((track) => {
          if (!association.best.matches.some((match) => match.trackId === track.trackId)) {
            track.missedFrames += 1;
            track.uncertaintyFrames += 1;
          }
          if (track.missedFrames >= this.gates.retireAfterMissedFrames) this.tracks.delete(track.trackId);
        });
        const blockedByUncertainty = new Set(association.ambiguousObservationIds);
        eligible.filter((observation) => !matchedObservationIds.has(observation.observationId) && !blockedByUncertainty.has(observation.observationId))
          .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || a.observationId.localeCompare(b.observationId))
          .forEach((observation) => {
            if (this.tracks.size >= this.gates.maxTracks) return;
            if (observation.confidence !== null && observation.confidence < this.gates.minNewTrackConfidence) return;
            if (observation.confidence === null && observation.state !== STATES.TRACKED) return;
            this.createTrack(observation, mediaTime);
          });
        this.lastMediaTime = mediaTime;
        const players = Array.from(this.tracks.values()).sort((a, b) => a.trackId.localeCompare(b.trackId)).map((track) => this.playerView(track, mediaTime, ambiguousTrackIds.has(track.trackId)));
        const associationView = {
          maxTracks: this.gates.maxTracks,
          gates: copy(this.gates),
          matched: association.best.matches.filter((match) => !ambiguousTrackIds.has(match.trackId)).map((match) => ({ trackId: match.trackId, observationId: match.observationId })),
          ambiguousTrackIds: Array.from(ambiguousTrackIds).sort(),
          ambiguousObservationIds: Array.from(association.ambiguousObservationIds).sort(),
          identityRisk: ambiguousTrackIds.size ? 'likely-id-switch-or-crossover' : 'none',
          events
        };
        const result = resultShape({
          sessionId: this.sessionId,
          requestId,
          mediaTime,
          state: trackingState(players, observations.length),
          players,
          observations,
          duplicates: deduped.duplicates,
          invalidObservations: deduped.invalid || [],
          association: associationView
        });
        return { accepted: true, reason: 'processed', result };
      }
  
      snapshot(requestId, mediaTime, observations = [], duplicates = [], association = {}, accepted = false, invalidObservations = []) {
        const players = Array.from(this.tracks.values()).sort((a, b) => a.trackId.localeCompare(b.trackId)).map((track) => this.playerView(track, this.lastMediaTime === -Infinity ? mediaTime : this.lastMediaTime, true));
        return resultShape({ sessionId: this.sessionId, requestId, mediaTime, state: trackingState(players, observations.length), players, observations, duplicates, invalidObservations, association, accepted, reason: association.reason || 'not-processed' });
      }
  
      update(input) { return this.processFrame(input); }
      associate(input) { return this.processFrame(input); }
    }
  
    function unknownTrackingResult({ sessionId = 'unknown-session', requestId = 'unknown-request', mediaTime = 0, detector, source, reason = 'no-detections' } = {}) {
      return {
        schema: TRACKING_SCHEMA,
        version: VERSION,
        sessionId,
        requestId,
        mediaTime,
        state: STATES.UNKNOWN,
        players: [],
        observations: [],
        duplicateObservations: [],
        invalidObservations: [],
        detector: identity(detector, 'unknown-detector', 'pose-detector'),
        source: identity(source, 'unknown-source', 'frame-source'),
        association: { method: 'gated-motion-box-keypoint-v1', maxTracks: DEFAULT_GATES.maxTracks, gates: copy(DEFAULT_GATES), identityRisk: 'none' },
        accepted: true,
        reason
      };
    }
  
    function validKeypointArray(keypoints) {
      if (!Array.isArray(keypoints)) return false;
      const names = new Set();
      return keypoints.every((point) => {
        if (!isObject(point) || !nonEmptyString(point.name) || names.has(point.name) ||
            !finite(point.x) || !finite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
        names.add(point.name);
        return point.confidence === null || (finite(point.confidence) && point.confidence >= 0 && point.confidence <= 1);
      });
    }
  
    function isTrackingResult(value) {
      return isObject(value) && value.schema === TRACKING_SCHEMA && value.version === VERSION &&
        nonEmptyString(value.sessionId) && nonEmptyString(value.requestId) && finite(value.mediaTime) && value.mediaTime >= 0 &&
        Object.values(STATES).includes(value.state) && Array.isArray(value.players) && Array.isArray(value.observations) &&
        value.observations.every(isPoseObservation) && value.players.every((player) => isObject(player) && nonEmptyString(player.trackId) &&
          Object.values(STATES).includes(player.state) && (player.confidence === null || (finite(player.confidence) && player.confidence >= 0 && player.confidence <= 1)) &&
          validateBox(player.bbox) && validKeypointArray(player.keypoints) && validateIdentity(player.detector) && validateIdentity(player.source) &&
          (player.state !== STATES.TRACKED || (player.bbox !== null && player.confidence !== null)));
    }
  
    return Object.freeze({
      OBSERVATION_SCHEMA,
      TRACKING_SCHEMA,
      VERSION,
      STATES,
      DEFAULT_GATES,
      normalizePoseObservation,
      normalizeObservation: normalizePoseObservation,
      normalizeObservations: (values, options = {}) => {
        const normalized = (Array.isArray(values) ? values : []).map((value, index) => normalizePoseObservation(value, Object.assign({}, options, { observationId: value?.observationId || value?.id || `${options.requestId || 'unknown-request'}:pose-${index}` })));
        const valid = normalized.filter(isPoseObservation);
        return Object.assign(deduplicateObservations(valid, options.duplicateIoU || DEFAULT_GATES.duplicateIoU), { invalid: normalized.filter((value) => !isPoseObservation(value)) });
      },
      isPoseObservation,
      isObservation: isPoseObservation,
      validatePoseObservation: isPoseObservation,
      unknownTrackingResult,
      isTrackingResult,
      SessionPlayerTracker,
      SessionLocalTracker: SessionPlayerTracker,
      PlayerTracker: SessionPlayerTracker,
      createSessionTracker: (options) => new SessionPlayerTracker(options),
      boxIoU,
      keypointEvidence
    });
  }));
  
  /* src/extension/common/frame-transport.js */
  /* global globalThis */
  (function installFrameTransport(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BSOFrameTransport = api;
  }(typeof globalThis === 'object' ? globalThis : self, function frameTransportFactory() {
    'use strict';
  
    const SERIALIZABLE_FORMAT = 'rgba-array-v1';
    const BITMAP_FORMAT = 'image-bitmap';
    // The production pose model reads a 256x256 input. Capping the serialized
    // frame at a 256px long edge (256x144 for 16:9) keeps the model input
    // usable while bounding message size; the pixel bound below is only a
    // safety net for extreme aspect ratios.
    const DEFAULT_MAX_LONG_EDGE = 256;
    const DEFAULT_MAX_PIXELS = 65536;
  
    function positiveInteger(value) {
      return Number.isInteger(value) && value > 0;
    }
  
    function manifestFor(chromeApi) {
      if (!chromeApi?.runtime || typeof chromeApi.runtime.getManifest !== 'function') return null;
      try { return chromeApi.runtime.getManifest(); } catch (_) { return null; }
    }
  
    /**
     * Structured-clone messaging is an optional channel capability, not a
     * stable-channel manifest assumption. The public manifest deliberately
     * omits message_serialization because Chrome stable reports it as a Canary-
     * only manifest key. A future channel may opt in explicitly and retain the
     * ImageBitmap path without changing capture or analyzer contracts.
     */
    function supportsStructuredClone(chromeApi) {
      return manifestFor(chromeApi)?.message_serialization === 'structured_clone';
    }
  
    function selectTransport(chromeApi) {
      return supportsStructuredClone(chromeApi) ? BITMAP_FORMAT : SERIALIZABLE_FORMAT;
    }
  
    function targetDimensions(width, height, { maxPixels = DEFAULT_MAX_PIXELS, maxLongEdge = DEFAULT_MAX_LONG_EDGE } = {}) {
      if (!positiveInteger(width) || !positiveInteger(height)) throw new TypeError('frame dimensions must be positive integers');
      const limit = positiveInteger(maxPixels) ? maxPixels : DEFAULT_MAX_PIXELS;
      const edge = positiveInteger(maxLongEdge) ? maxLongEdge : DEFAULT_MAX_LONG_EDGE;
      const scale = Math.min(1, Math.sqrt(limit / (width * height)), edge / Math.max(width, height));
      let targetWidth = Math.max(1, Math.round(width * scale));
      let targetHeight = Math.max(1, Math.round(height * scale));
      while (targetWidth * targetHeight > limit) {
        if (targetWidth >= targetHeight && targetWidth > 1) targetWidth -= 1;
        else if (targetHeight > 1) targetHeight -= 1;
        else break;
      }
      while (Math.max(targetWidth, targetHeight) > edge) {
        if (targetWidth >= targetHeight && targetWidth > 1) targetWidth -= 1;
        else if (targetHeight > 1) targetHeight -= 1;
        else break;
      }
      return { width: targetWidth, height: targetHeight };
    }
  
    function createCanvas(width, height, environment) {
      const source = environment || globalThis;
      const Canvas = source && source.OffscreenCanvas;
      if (typeof Canvas === 'function') return new Canvas(width, height);
      if (source?.document && typeof source.document.createElement === 'function') {
        const canvas = source.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      return null;
    }
  
    /**
     * Convert the captured bitmap to a bounded plain object for Chrome stable's
     * default JSON extension messaging. This keeps ImageBitmap as the capture
     * primitive, but never sends an object that stable JSON serialization would
     * silently turn into `{}`. The fixture analyzer only needs sampled pixels,
     * so the fallback is intentionally capped rather than sending a full-size
     * video frame through the service worker. The bound is a 256px long edge,
     * which is the production pose model's input width.
     */
    async function toSerializableFrame(frame, {
      environment = globalThis,
      maxPixels = DEFAULT_MAX_PIXELS,
      maxLongEdge = DEFAULT_MAX_LONG_EDGE
    } = {}) {
      if (!frame || !positiveInteger(frame.width) || !positiveInteger(frame.height)) {
        throw new TypeError('captured frame dimensions are unavailable');
      }
      const dimensions = targetDimensions(frame.width, frame.height, { maxPixels, maxLongEdge });
      const canvas = createCanvas(dimensions.width, dimensions.height, environment);
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new Error('frame serialization canvas unavailable');
      }
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context || typeof context.drawImage !== 'function' || typeof context.getImageData !== 'function') {
        throw new Error('frame serialization pixel read unavailable');
      }
      context.drawImage(frame, 0, 0, dimensions.width, dimensions.height);
      const image = context.getImageData(0, 0, dimensions.width, dimensions.height);
      if (!image || !image.data || image.data.length !== dimensions.width * dimensions.height * 4) {
        throw new Error('frame serialization returned invalid RGBA data');
      }
      return {
        frame: {
          width: dimensions.width,
          height: dimensions.height,
          data: Array.from(image.data)
        },
        frameFormat: SERIALIZABLE_FORMAT,
        transferables: [],
        releaseSource: true,
        sourceDimensions: { width: frame.width, height: frame.height }
      };
    }
  
    async function prepareFrame(frame, {
      mode = SERIALIZABLE_FORMAT,
      environment = globalThis,
      maxPixels = DEFAULT_MAX_PIXELS,
      maxLongEdge = DEFAULT_MAX_LONG_EDGE
    } = {}) {
      if (mode === BITMAP_FORMAT) {
        return {
          frame,
          frameFormat: BITMAP_FORMAT,
          transferables: [frame],
          releaseSource: false,
          sourceDimensions: { width: frame?.width || 0, height: frame?.height || 0 }
        };
      }
      return toSerializableFrame(frame, { environment, maxPixels, maxLongEdge });
    }
  
    return Object.freeze({
      SERIALIZABLE_FORMAT,
      BITMAP_FORMAT,
      DEFAULT_MAX_LONG_EDGE,
      DEFAULT_MAX_PIXELS,
      supportsStructuredClone,
      selectTransport,
      targetDimensions,
      toSerializableFrame,
      prepareFrame
    });
  }));
  
  /* src/extension/common/capabilities.js */
  /* global globalThis, BSOProtocol, BSOFrameTransport */
  (function installCapabilities(root, factory) {
    const api = factory(root.BSOProtocol, root.BSOFrameTransport);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BSOCapabilities = api;
  }(typeof globalThis === 'object' ? globalThis : self, function capabilitiesFactory(protocol, frameTransportApi) {
    'use strict';
  
    function detectCapture(video, environment = globalThis) {
      const hasFrameCallback = Boolean(video && typeof video.requestVideoFrameCallback === 'function');
      const hasBitmap = typeof environment.createImageBitmap === 'function';
      if (hasFrameCallback && hasBitmap) return { mode: 'request-video-frame-callback', available: true, fallback: null };
      if (hasBitmap) return { mode: 'timer-fallback', available: true, fallback: 'requestVideoFrameCallback-unavailable' };
      return { mode: 'unavailable', available: false, fallback: 'createImageBitmap-unavailable' };
    }
  
    function detectRuntime(chromeApi = globalThis.chrome, video, environment = globalThis) {
      const capture = detectCapture(video, environment);
      const offscreen = Boolean(chromeApi && chromeApi.offscreen && typeof chromeApi.offscreen.createDocument === 'function');
      const fallbacks = [];
      if (capture.fallback) fallbacks.push(capture.fallback);
      if (!offscreen) fallbacks.push('offscreen-document-unavailable');
      const frameTransport = frameTransportApi && typeof frameTransportApi.selectTransport === 'function'
        ? frameTransportApi.selectTransport(chromeApi)
        : 'image-bitmap';
      return protocol.createCapabilityReport({
        sessionId: 'capability-probe',
        capture: capture.mode,
        transferableFrames: frameTransport === 'image-bitmap' && (typeof environment.ImageBitmap === 'function' || typeof environment.VideoFrame === 'function'),
        frameTransport,
        offscreen,
        inference: false,
        analyzer: 'none',
        fallbacks,
        reason: capture.available ? '' : 'Capture cannot produce frame samples in this browser'
      });
    }
  
    return Object.freeze({ detectCapture, detectRuntime });
  }));
  
  /* src/extension/common/synchronization.js */
  /* global globalThis */
  (function installSynchronization(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BSOSynchronization = api;
  }(typeof globalThis === 'object' ? globalThis : self, function synchronizationFactory() {
    'use strict';
  
    const EPSILON = 1e-4;
  
    function validResult(result) {
      return result && typeof result.sessionId === 'string' && result.sessionId.length > 0 &&
        typeof result.mediaTime === 'number' && Number.isFinite(result.mediaTime) && result.mediaTime >= 0;
    }
  
    /**
     * Pure public selector used by the renderer and tests. Results newer than the
     * current media timestamp are held, not displayed. A displayed result is
     * never replaced by an older timestamp or by another video session.
     */
    function selectSynchronizedResult(results, currentMediaTime, sessionId, lastDisplayedMediaTime = -Infinity) {
      if (!Array.isArray(results) || !Number.isFinite(currentMediaTime) || currentMediaTime < 0) {
        return { result: null, ageSeconds: null, stale: true, reason: 'invalid-clock' };
      }
      const eligible = results
        .filter((result) => validResult(result) && result.sessionId === sessionId)
        .filter((result) => result.mediaTime <= currentMediaTime + EPSILON)
        .filter((result) => result.mediaTime + EPSILON >= lastDisplayedMediaTime)
        .sort((a, b) => (b.mediaTime - a.mediaTime) || String(b.requestId || '').localeCompare(String(a.requestId || '')));
      const result = eligible[0] || null;
      return {
        result,
        ageSeconds: result ? Math.max(0, currentMediaTime - result.mediaTime) : null,
        stale: !result,
        reason: result ? 'eligible' : 'no-result-at-or-before-media-time'
      };
    }
  
    class MediaTimestampSynchronizer {
      constructor({ sessionId, staleAfterSeconds = 1.5, onDisplay = () => {}, onStatus = () => {} } = {}) {
        if (!sessionId) throw new TypeError('sessionId is required');
        this.sessionId = sessionId;
        this.staleAfterSeconds = staleAfterSeconds;
        this.onDisplay = onDisplay;
        this.onStatus = onStatus;
        this.pending = [];
        this.displayed = null;
        this.currentMediaTime = null;
        this.lastDisplayedMediaTime = -Infinity;
      }
  
      reset(sessionId = this.sessionId, reason = 'reset') {
        this.sessionId = sessionId;
        this.pending = [];
        this.displayed = null;
        this.currentMediaTime = null;
        this.lastDisplayedMediaTime = -Infinity;
        this.onStatus({ type: 'synchronizer-reset', reason, sessionId });
      }
  
      ingest(result) {
        if (!validResult(result) || result.sessionId !== this.sessionId) return false;
        if (this.displayed && result.mediaTime + EPSILON < this.lastDisplayedMediaTime) return false;
        if (this.pending.some((item) => item.requestId && item.requestId === result.requestId)) return false;
        this.pending.push(result);
        return true;
      }
  
      update(currentMediaTime) {
        if (!Number.isFinite(currentMediaTime) || currentMediaTime < 0) {
          this.onStatus({ type: 'synchronizer-status', status: 'invalid-clock' });
          return { result: this.displayed, ageSeconds: null, stale: true, reason: 'invalid-clock' };
        }
        if (this.currentMediaTime !== null && currentMediaTime + EPSILON < this.currentMediaTime) {
          this.pending = [];
          this.displayed = null;
          this.lastDisplayedMediaTime = -Infinity;
          this.onStatus({ type: 'synchronizer-status', status: 'timeline-reset', from: this.currentMediaTime, to: currentMediaTime });
        }
        this.currentMediaTime = currentMediaTime;
        const selection = selectSynchronizedResult(this.pending, currentMediaTime, this.sessionId, this.lastDisplayedMediaTime);
        if (selection.result) {
          this.displayed = selection.result;
          this.lastDisplayedMediaTime = selection.result.mediaTime;
          this.pending = this.pending.filter((item) => item.mediaTime > selection.result.mediaTime + EPSILON);
          this.onDisplay({ result: this.displayed, ageSeconds: selection.ageSeconds, stale: false });
        } else if (this.displayed) {
          const ageSeconds = Math.max(0, currentMediaTime - this.displayed.mediaTime);
          const view = { result: this.displayed, ageSeconds, stale: ageSeconds > this.staleAfterSeconds, reason: 'retained-while-inference-lags' };
          this.onDisplay(view);
          return view;
        }
        const view = { ...selection, result: selection.result || this.displayed };
        if (view.stale) this.onStatus({ type: 'synchronizer-status', status: 'awaiting-result', mediaTime: currentMediaTime });
        return view;
      }
    }
  
    return Object.freeze({
      EPSILON,
      selectSynchronizedResult,
      MediaTimestampSynchronizer
    });
  }));
  
  /* src/extension/content/capture.js */
  /* global globalThis, BSOProtocol, BSOCapabilities, BSOFrameTransport */
  (function installCapture(root, factory) {
    const api = factory(root.BSOProtocol, root.BSOCapabilities, root.BSOFrameTransport);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BSOCapture = api;
  }(typeof globalThis === 'object' ? globalThis : self, function captureFactory(protocol, capabilityApi, frameTransportApi) {
    'use strict';
  
    class VideoCapture {
      constructor({
        video,
        sessionId,
        sendSample = () => {},
        onMediaTime = () => {},
        onStatus = () => {},
        environment = globalThis,
        minWallIntervalMs = 250,
        minMediaIntervalSeconds = 0.1,
        fallbackIntervalMs = 250,
        maxInFlight = 1,
        frameTransport = 'image-bitmap',
        prepareFrame = null
      } = {}) {
        if (!video || !sessionId) throw new TypeError('video and sessionId are required');
        if (!Number.isInteger(maxInFlight) || maxInFlight < 1) throw new TypeError('maxInFlight must be a positive integer');
        this.video = video;
        this.sessionId = sessionId;
        this.sendSample = sendSample;
        this.onMediaTime = onMediaTime;
        this.onStatus = onStatus;
        this.environment = environment;
        this.minWallIntervalMs = minWallIntervalMs;
        this.minMediaIntervalSeconds = minMediaIntervalSeconds;
        this.fallbackIntervalMs = fallbackIntervalMs;
        this.maxInFlight = maxInFlight;
        this.frameTransport = frameTransport;
        this.prepareFrame = typeof prepareFrame === 'function' ? prepareFrame : null;
        this.active = false;
        this.mode = 'unavailable';
        this.callbackHandle = null;
        this.fallbackTimer = null;
        this.sampleNumber = 0;
        this.lastSampleWall = -Infinity;
        this.lastSampleMediaTime = -Infinity;
        this.inFlightCount = 0;
        this.inFlight = false;
        this.captureGeneration = 0;
        this.backpressureNotified = false;
      }
  
      start() {
        if (this.active) return;
        this.active = true;
        const capability = capabilityApi.detectCapture(this.video, this.environment);
        this.mode = capability.mode;
        this.onStatus({ type: 'capture-capability', mode: this.mode, fallback: capability.fallback, frameTransport: this.frameTransport });
        if (!capability.available) return;
        if (this.mode === 'request-video-frame-callback') {
          this.scheduleVideoFrameCallback();
        } else {
          this.scheduleFallbackCapture();
        }
      }
  
      stop() {
        this.active = false;
        this.captureGeneration += 1;
        if (this.fallbackTimer !== null) {
          const clear = this.environment.clearTimeout || clearTimeout;
          clear(this.fallbackTimer);
          this.fallbackTimer = null;
        }
        // requestVideoFrameCallback has no cancellation API. The active/video
        // and generation checks in the callback make a queued callback harmless.
        this.callbackHandle = null;
        this.backpressureNotified = false;
      }
  
      scheduleVideoFrameCallback() {
        if (!this.active || this.mode !== 'request-video-frame-callback') return;
        const callback = (now, metadata) => this.handleVideoFrame(now, metadata);
        this.callbackHandle = this.video.requestVideoFrameCallback(callback);
      }
  
      handleVideoFrame(now, metadata = {}) {
        if (!this.active || this.mode !== 'request-video-frame-callback') return;
        const mediaTime = Number.isFinite(metadata.mediaTime)
          ? metadata.mediaTime
          : Number.isFinite(this.video.currentTime) ? this.video.currentTime : null;
        if (mediaTime !== null) {
          this.onMediaTime(mediaTime, { mode: this.mode, metadata });
          this.maybeCapture(mediaTime, Number.isFinite(now) ? now : Date.now(), metadata);
        }
        this.scheduleVideoFrameCallback();
      }
  
      scheduleFallbackCapture() {
        if (!this.active || this.mode !== 'timer-fallback') return;
        const schedule = this.environment.setTimeout || setTimeout;
        this.fallbackTimer = schedule(() => {
          this.fallbackTimer = null;
          const mediaTime = Number.isFinite(this.video.currentTime) ? this.video.currentTime : null;
          if (mediaTime !== null) {
            const now = Date.now();
            this.onMediaTime(mediaTime, { mode: this.mode, metadata: {} });
            this.maybeCapture(mediaTime, now, {});
          }
          this.scheduleFallbackCapture();
        }, this.fallbackIntervalMs);
      }
  
      maybeCapture(mediaTime, wallTime, metadata) {
        if (!this.active) return;
        if (this.inFlightCount >= this.maxInFlight) {
          if (!this.backpressureNotified) {
            this.backpressureNotified = true;
            this.onStatus({
              type: 'capture-status',
              status: 'backpressure',
              inFlight: this.inFlightCount,
              maxInFlight: this.maxInFlight,
              message: 'Frame sample held back while the local analyzer is busy'
            });
          }
          return;
        }
        if (mediaTime + 1e-4 < this.lastSampleMediaTime) {
          this.lastSampleMediaTime = -Infinity;
          this.lastSampleWall = -Infinity;
          this.onStatus({ type: 'capture-status', status: 'timeline-reset', mediaTime });
        }
        if (wallTime - this.lastSampleWall < this.minWallIntervalMs &&
            mediaTime - this.lastSampleMediaTime < this.minMediaIntervalSeconds) return;
        if (typeof this.environment.createImageBitmap !== 'function') return;
        const width = Number.isInteger(metadata.width) && metadata.width > 0
          ? metadata.width
          : this.video.videoWidth;
        const height = Number.isInteger(metadata.height) && metadata.height > 0
          ? metadata.height
          : this.video.videoHeight;
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
          this.onStatus({ type: 'capture-error', message: 'Video dimensions are unavailable' });
          return;
        }
        this.inFlightCount += 1;
        this.inFlight = true;
        const generation = this.captureGeneration;
        let prepared = null;
        let sourceFrame = null;
        let sourceReleased = false;
        Promise.resolve(this.environment.createImageBitmap(this.video)).then((frame) => {
          sourceFrame = frame;
          if (!this.active || generation !== this.captureGeneration || this.mode === 'unavailable') {
            if (frame && typeof frame.close === 'function') {
              frame.close();
              sourceReleased = true;
            }
            return null;
          }
          const prepare = this.prepareFrame || (frameTransportApi && typeof frameTransportApi.prepareFrame === 'function'
            ? (capturedFrame) => frameTransportApi.prepareFrame(capturedFrame, {
              mode: this.frameTransport,
              environment: this.environment
            })
            : (capturedFrame) => ({
              frame: capturedFrame,
              frameFormat: 'image-bitmap',
              transferables: [capturedFrame],
              releaseSource: false
            }));
          return Promise.resolve(prepare(frame, { width, height, mediaTime })).then((value) => {
            prepared = value;
            if (!prepared || !prepared.frame) throw new Error('frame transport produced no frame');
            if (!this.active || generation !== this.captureGeneration || this.mode === 'unavailable') return null;
            const requestId = `${this.sessionId}:${++this.sampleNumber}`;
            const sample = protocol.createFrameSample({
              sessionId: this.sessionId,
              requestId,
              mediaTime,
              // rVFC's `now` is monotonic; capturedAt is wall-clock metadata.
              capturedAt: Date.now(),
              width: Number.isInteger(prepared.frame.width) && prepared.frame.width > 0 ? prepared.frame.width : width,
              height: Number.isInteger(prepared.frame.height) && prepared.frame.height > 0 ? prepared.frame.height : height,
              frame: prepared.frame,
              frameFormat: prepared.frameFormat || this.frameTransport
            });
            this.lastSampleWall = wallTime;
            this.lastSampleMediaTime = mediaTime;
            const delivered = this.sendSample(sample.message, prepared.transferables || sample.transferables);
            if (delivered === false && prepared.frame && typeof prepared.frame.close === 'function') {
              prepared.frame.close();
              if (prepared.frame === sourceFrame) sourceReleased = true;
            }
            this.backpressureNotified = false;
            return delivered;
          });
        }).catch((error) => {
          this.onStatus({ type: 'capture-error', message: error instanceof Error ? error.message : String(error) });
        }).finally(() => {
          // The stable-channel fallback sends a plain RGBA object, so the
          // original ImageBitmap must be released after conversion. In the
          // structured-clone path ownership moves to the offscreen analyzer.
          if (!sourceReleased && sourceFrame && (!prepared || prepared.releaseSource) && typeof sourceFrame.close === 'function') sourceFrame.close();
          this.inFlightCount = Math.max(0, this.inFlightCount - 1);
          this.inFlight = this.inFlightCount > 0;
        });
      }
    }
  
    return Object.freeze({ VideoCapture });
  }));
  
  /* src/extension/content/video-discovery.js */
  /* global globalThis */
  (function installVideoDiscovery(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BSOVideoDiscovery = api;
  }(typeof globalThis === 'object' ? globalThis : self, function videoDiscoveryFactory() {
    'use strict';
  
    function visibleVideo(video) {
      if (!video || typeof video.getBoundingClientRect !== 'function') return false;
      const rect = video.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && video.isConnected !== false;
    }
  
    function findVideo(documentRef = globalThis.document) {
      if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return null;
      const videos = Array.from(documentRef.querySelectorAll('video'));
      const connected = videos.filter((video) => video.isConnected !== false);
      const visible = connected.filter(visibleVideo);
      return (visible.length ? visible : connected)[0] || null;
    }
  
    class VideoDiscovery {
      constructor({ documentRef = globalThis.document, windowRef = globalThis.window, onVideo = () => {}, onNavigation = () => {} } = {}) {
        this.document = documentRef;
        this.window = windowRef;
        this.onVideo = onVideo;
        this.onNavigation = onNavigation;
        this.video = null;
        this.observer = null;
        this.timer = null;
        this.started = false;
        this.listeners = [];
        this.navigationToken = 0;
      }
  
      start() {
        if (this.started) return;
        this.started = true;
        const MutationObserverImpl = this.window && this.window.MutationObserver
          ? this.window.MutationObserver
          : typeof MutationObserver === 'function' ? MutationObserver : null;
        if (this.document && MutationObserverImpl) {
          this.observer = new MutationObserverImpl(() => this.scheduleScan('dom-change'));
          this.observer.observe(this.document, { childList: true, subtree: true });
        }
        this.addListener('yt-navigate-start', () => this.navigate('youtube-spa-start'));
        this.addListener('yt-navigate-finish', () => {
          this.navigate('youtube-spa-finish');
          this.scheduleScan('youtube-spa-finish');
        });
        this.addListener('popstate', () => this.navigate('history-navigation'));
        this.addListener('hashchange', () => this.navigate('hash-navigation'));
        this.scheduleScan('initial');
      }
  
      stop() {
        this.started = false;
        if (this.observer) this.observer.disconnect();
        this.observer = null;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        for (const [name, listener] of this.listeners) {
          if (this.window && this.window.removeEventListener) this.window.removeEventListener(name, listener);
        }
        this.listeners = [];
        if (this.video) this.onVideo(null, 'stopped');
        this.video = null;
      }
  
      addListener(name, listener) {
        if (this.window && this.window.addEventListener) {
          this.window.addEventListener(name, listener);
          this.listeners.push([name, listener]);
        }
      }
  
      navigate(reason) {
        this.navigationToken += 1;
        this.onNavigation({ reason, token: this.navigationToken });
        if (this.video) {
          this.onVideo(null, reason);
          this.video = null;
        }
      }
  
      scheduleScan(reason) {
        if (!this.started || this.timer !== null) return;
        this.timer = setTimeout(() => {
          this.timer = null;
          this.scan(reason);
        }, 0);
      }
  
      scan(reason = 'scan') {
        if (!this.started) return;
        const candidate = findVideo(this.document);
        if (candidate !== this.video) {
          if (this.video) this.onVideo(null, 'video-replaced');
          this.video = candidate;
          this.onVideo(candidate, candidate ? reason : 'video-unavailable');
        }
      }
    }
  
    return Object.freeze({ VideoDiscovery, findVideo, visibleVideo });
  }));
  
  /* src/extension/content/runtime.js */
  /* global globalThis, BSOProtocol, BSOSynchronization, BSOCapabilities, BSOFrameTransport, BSOCapture, BSOVideoDiscovery */
  (function installRuntime(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BSORuntime = api;
  }(typeof globalThis === 'object' ? globalThis : self, function runtimeFactory() {
    'use strict';
  
    class RuntimeBridge {
      constructor({
        chromeApi = globalThis.chrome,
        onMessage = () => {},
        onStatus = () => {},
        supportsTransferList = true
      } = {}) {
        this.chrome = chromeApi;
        this.onMessage = onMessage;
        this.onStatus = onStatus;
        this.supportsTransferList = supportsTransferList;
        this.transferFallbackReported = false;
        this.port = null;
        this.sessionId = null;
      }
  
      start(sessionId, capabilities) {
        this.sessionId = sessionId;
        this.transferFallbackReported = false;
        if (!this.chrome || !this.chrome.runtime || typeof this.chrome.runtime.connect !== 'function') {
          this.onStatus({ type: 'bridge-unavailable', reason: 'runtime-connect-unavailable' });
          return false;
        }
        try {
          this.port = this.chrome.runtime.connect({ name: 'bso-runtime-v1' });
          if (this.port.onMessage && this.port.onMessage.addListener) this.port.onMessage.addListener((message) => this.onMessage(message));
          if (this.port.onDisconnect && this.port.onDisconnect.addListener) {
            this.port.onDisconnect.addListener(() => {
              this.onStatus({ type: 'bridge-disconnected', reason: 'service-worker-disconnected' });
            });
          }
          this.post(BSOProtocol.createSessionStart({
            sessionId,
            pageUrl: typeof location === 'object' ? location.href : '',
            capabilities
          }));
          return true;
        } catch (error) {
          this.port = null;
          this.onStatus({ type: 'bridge-unavailable', reason: error instanceof Error ? error.message : String(error) });
          return false;
        }
      }
  
      post(message, transferables = []) {
        if (!this.port || typeof this.port.postMessage !== 'function') {
          this.onStatus({ type: 'bridge-unavailable', reason: 'runtime-port-not-connected' });
          return false;
        }
        try {
          // Runtime ports do not provide a transferable-list contract that is
          // safe to assume on stable Chrome. The selected frame transport sends
          // plain RGBA data there; an explicitly structured-clone-capable
          // channel may still use the ImageBitmap branch.
          if (!transferables.length || this.supportsTransferList) {
            this.port.postMessage(message, transferables);
          } else {
            this.port.postMessage(message);
            if (!this.transferFallbackReported) {
              this.transferFallbackReported = true;
              this.onStatus({ type: 'frame-transport-fallback', reason: 'mv3-runtime-port-uses-structured-clone' });
            }
          }
          return true;
        } catch (error) {
          if (transferables.length) {
            try {
              this.port.postMessage(message);
              this.onStatus({ type: 'frame-transport-fallback', reason: error instanceof Error ? error.message : String(error) });
              return true;
            } catch (_) {
              // Fall through to the explicit transport error below.
            }
          }
          this.onStatus({ type: 'frame-transport-error', reason: error instanceof Error ? error.message : String(error) });
          return false;
        }
      }
  
      sendFrameSample(message, transferables) {
        if (!BSOProtocol.isFrameSample(message) || message.sessionId !== this.sessionId) {
          this.onStatus({ type: 'frame-rejected', reason: 'invalid-frame-sample' });
          return false;
        }
        return this.post(message, transferables);
      }
  
      end(reason = 'detached') {
        if (this.port && this.sessionId) {
          this.post(BSOProtocol.createSessionEnd({ sessionId: this.sessionId, reason }));
          if (typeof this.port.disconnect === 'function') this.port.disconnect();
        }
        this.port = null;
        this.sessionId = null;
      }
    }
  
    class RuntimeController {
      constructor({
        documentRef = globalThis.document,
        windowRef = globalThis.window,
        chromeApi = globalThis.chrome,
        // The design-system content UI owns the visible overlay. Keeping this
        // boundary null by default prevents the retired plain-text status layer
        // from appearing when a controller is constructed directly.
        overlay = null,
        bridge = null,
        onRuntimeMessage = () => {},
        onRuntimeStatus = () => {},
        onRuntimeView = () => {},
        onSessionReset = () => {}
      } = {}) {
        this.document = documentRef;
        this.window = windowRef;
        this.chrome = chromeApi;
        this.overlay = overlay;
        this.onRuntimeMessage = onRuntimeMessage;
        this.onRuntimeStatus = onRuntimeStatus;
        this.onRuntimeView = onRuntimeView;
        this.onSessionReset = onSessionReset;
        this.bridge = bridge || new RuntimeBridge({
          chromeApi,
          // Stable Chrome receives the serializable RGBA frame selected by the
          // content runtime. This bridge still accepts the ImageBitmap branch
          // for an explicitly structured-clone-capable channel.
          supportsTransferList: false,
          onMessage: (message) => this.handleMessage(message),
          onStatus: (status) => this.handleBridgeStatus(status)
        });
        this.discovery = null;
        this.video = null;
        this.capture = null;
        this.rateListener = null;
        this.metadataListener = null;
        this.sessionId = null;
        this.synchronizer = null;
        this.lastMediaTime = null;
      }
  
      start() {
        this.discovery = new BSOVideoDiscovery.VideoDiscovery({
          documentRef: this.document,
          windowRef: this.window,
          onVideo: (video, reason) => this.setVideo(video, reason),
          onNavigation: ({ reason }) => this.handleNavigation(reason)
        });
        this.discovery.start();
      }
  
      stop() {
        if (this.discovery) this.discovery.stop();
        this.discovery = null;
        this.setVideo(null, 'runtime-stopped');
      }
  
      handleNavigation(reason) {
        if (this.synchronizer) this.synchronizer.reset(this.sessionId, reason);
        this.lastMediaTime = null;
        this.onSessionReset(reason || 'navigation');
        if (this.overlay) this.overlay.setStatus('Navigating', 'waiting for video');
      }
  
      setVideo(video, reason = 'video-change') {
        if (video === this.video) return;
        this.detachVideo(reason);
        if (!video) {
          if (this.overlay) this.overlay.setStatus('Waiting', 'YouTube video unavailable');
          return;
        }
        this.video = video;
        this.sessionId = this.newSessionId();
        this.synchronizer = new BSOSynchronization.MediaTimestampSynchronizer({
          sessionId: this.sessionId,
          onDisplay: (view) => this.renderSynchronized(view),
          onStatus: (status) => this.handleSynchronizerStatus(status)
        });
        if (this.overlay) {
          this.overlay.attach(video);
          this.overlay.setStatus('Starting', 'local runtime');
        }
        this.rateListener = () => {
          // Read playbackRate for honest status only. Playback properties are
          // never assigned by this runtime.
          const rate = Number.isFinite(video.playbackRate) ? video.playbackRate : null;
          this.handleMediaTime(video.currentTime, { reason: 'ratechange', playbackRate: rate });
          if (this.overlay) this.overlay.setStatus('Watching', rate === null ? 'playback rate changed' : `rate ${rate}x`);
        };
        this.metadataListener = () => this.overlay && this.overlay.refresh();
        video.addEventListener('ratechange', this.rateListener);
        video.addEventListener('loadedmetadata', this.metadataListener);
        const captureCapability = BSOCapabilities.detectCapture(video, globalThis);
        const offscreenAvailable = Boolean(this.chrome && this.chrome.offscreen && typeof this.chrome.offscreen.createDocument === 'function');
        const frameTransport = BSOFrameTransport && typeof BSOFrameTransport.selectTransport === 'function'
          ? BSOFrameTransport.selectTransport(this.chrome)
          : 'image-bitmap';
        const capabilities = {
          capture: captureCapability.mode,
          // Stable Chrome uses the serializable RGBA fallback unless the
          // manifest explicitly opts into structured-clone messaging on a
          // channel that supports it. ImageBitmap remains the capture source in
          // both paths; only the message payload changes.
          transferableFrames: frameTransport === 'image-bitmap' && (typeof globalThis.ImageBitmap === 'function' || typeof globalThis.VideoFrame === 'function'),
          frameTransport,
          offscreen: offscreenAvailable,
          inference: false,
          analyzer: 'pending',
          transport: 'mv3-runtime-messaging'
        };
        this.bridge.start(this.sessionId, capabilities);
        this.capture = new BSOCapture.VideoCapture({
          video,
          sessionId: this.sessionId,
          sendSample: (message, transferables) => this.bridge.sendFrameSample(message, transferables),
          onMediaTime: (mediaTime, metadata) => this.handleMediaTime(mediaTime, metadata),
          onStatus: (status) => this.handleCaptureStatus(status),
          environment: globalThis,
          frameTransport,
          prepareFrame: BSOFrameTransport && typeof BSOFrameTransport.prepareFrame === 'function'
            ? (frame) => BSOFrameTransport.prepareFrame(frame, { mode: frameTransport, environment: globalThis })
            : null
        });
        this.capture.start();
        if (reason === 'video-replaced') this.handleNavigation('video-replaced');
      }
  
      detachVideo(reason) {
        if (!this.video) return;
        if (this.capture) this.capture.stop();
        this.capture = null;
        if (this.rateListener) this.video.removeEventListener('ratechange', this.rateListener);
        if (this.metadataListener) this.video.removeEventListener('loadedmetadata', this.metadataListener);
        this.rateListener = null;
        this.metadataListener = null;
        this.bridge.end(reason);
        this.video = null;
        this.sessionId = null;
        this.synchronizer = null;
        this.lastMediaTime = null;
        this.onSessionReset(reason || 'video-detached');
        if (this.overlay) this.overlay.detach();
      }
  
      handleMediaTime(mediaTime, metadata = {}) {
        if (!this.synchronizer || !Number.isFinite(mediaTime) || mediaTime < 0) return;
        this.lastMediaTime = mediaTime;
        const view = this.synchronizer.update(mediaTime);
        if (this.overlay) this.overlay.setSynchronizedView(view, mediaTime);
        this.onRuntimeView(view, mediaTime);
        if (metadata.reason === 'ratechange' && this.overlay) this.overlay.setStatus('Watching', `rate ${metadata.playbackRate}x`);
        return view;
      }
  
      handleMessage(message) {
        if (!message || message.sessionId !== this.sessionId) return;
        if (BSOProtocol.isAnalyzerResult(message)) {
          let view = null;
          if (this.synchronizer) {
            this.synchronizer.ingest(message);
            if (this.lastMediaTime !== null) view = this.handleMediaTime(this.lastMediaTime);
          }
          // Do not bypass media-time selection before the first captured frame.
          // A result may arrive ahead of the clock; the synchronizer must hold it
          // until playback reaches its timestamp rather than exposing a future
          // pose to the UI. Direct seam consumers without a controller still
          // retain their compatibility path in src/runtime.js.
          if (!this.synchronizer || view) this.onRuntimeMessage(message, view, this.lastMediaTime);
          return;
        }
        if (BSOProtocol.isCapabilityReport(message)) {
          this.applyCapabilities(message.capabilities, message.fallbacks, message.reason);
          this.onRuntimeMessage(message);
          return;
        }
        if (message.type === BSOProtocol.TYPES.RUNTIME_STATUS) {
          this.applyCapabilities(message.capabilities || {}, [], message.reason || message.message);
          if (this.overlay && message.message) this.overlay.setStatus(message.phase || 'Runtime', message.message);
          this.onRuntimeMessage(message);
        }
      }
  
      applyCapabilities(capabilities, fallbacks = [], reason = '') {
        const analyzer = capabilities.analyzer || 'none';
        const label = analyzer === 'fixture-probe-v1'
          ? 'runtime integration probe (not production CV)'
          : (capabilities.inference ? analyzer : 'local analyzer unavailable');
        const fallback = fallbacks.length ? ` · ${fallbacks.join(', ')}` : '';
        if (this.overlay) this.overlay.setStatus(capabilities.inference ? 'Ready' : 'Fallback', `${label}${fallback}${reason ? ` · ${reason}` : ''}`);
      }
  
      handleBridgeStatus(status) {
        this.onRuntimeStatus(status);
        if (!this.overlay) return;
        const messages = {
          'bridge-unavailable': 'offscreen bridge unavailable',
          'bridge-disconnected': 'runtime disconnected',
          'frame-transport-error': 'frame transfer unavailable',
          'frame-transport-fallback': 'ImageBitmap copied by MV3 structured-clone transport',
          'frame-rejected': 'frame sample rejected'
        };
        this.overlay.setStatus('Fallback', messages[status.type] || status.reason || 'runtime fallback');
      }
  
      handleCaptureStatus(status) {
        this.onRuntimeStatus(status);
        if (!this.overlay) return;
        if (status.type === 'capture-capability') {
          const label = status.mode === 'request-video-frame-callback' ? 'frame callback capture' : status.mode;
          const transport = status.frameTransport ? ` · ${status.frameTransport}` : '';
          this.overlay.setStatus(status.mode === 'unavailable' ? 'Fallback' : 'Starting', label + transport);
        } else if (status.type === 'capture-error') {
          this.overlay.setStatus('Fallback', status.message);
        }
      }
  
      handleSynchronizerStatus(status) {
        this.onRuntimeStatus(status);
        if (!this.overlay) return;
        if (status.status === 'timeline-reset') this.overlay.setStatus('Resyncing', 'media timeline changed');
      }
  
      renderSynchronized(view) {
        if (this.overlay && this.lastMediaTime !== null) this.overlay.setSynchronizedView(view, this.lastMediaTime);
      }
  
      newSessionId() {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
        return `video-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
    }
  
    return Object.freeze({ RuntimeBridge, RuntimeController });
  }));
  
  /* src/runtime.js */
  /*
   * Read-only playback boundary.
   * This adapter intentionally has no methods that can pause, seek, mute, resize,
   * replace, or restyle a video. Inference can be attached through onFrame later.
   */
  (function (root) {
    function snapshot(video) {
      if (!video) return null;
      return {
        mediaTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        paused: Boolean(video.paused),
        muted: Boolean(video.muted),
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        readyState: video.readyState || 0,
        playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : 1
      };
    }
  
    function clientRect(value) {
      value = value || {};
      return {
        left: Number(value.left) || 0,
        top: Number(value.top) || 0,
        width: Math.max(0, Number(value.width) || 0),
        height: Math.max(0, Number(value.height) || 0)
      };
    }
  
    function geometryNumber(value) {
      if (!Number.isFinite(value)) return 0;
      var rounded = Math.round(value * 1e9) / 1e9;
      return Math.abs(rounded) < 1e-9 ? 0 : rounded;
    }
  
    function objectPositionOffset(token, freeSpace, startKeyword, endKeyword) {
      token = String(token || "50%").toLowerCase();
      if (token === "center") return freeSpace / 2;
      if (token === startKeyword) return 0;
      if (token === endKeyword) return freeSpace;
      if (/^-?\d+(?:\.\d+)?%$/.test(token)) return freeSpace * Number(token.slice(0, -1)) / 100;
      if (/^-?\d+(?:\.\d+)?px$/.test(token)) return Number(token.slice(0, -2));
      return freeSpace / 2;
    }
  
    /**
     * Return the rectangle occupied by captured video pixels, not merely the
     * HTMLVideoElement box. YouTube may letterbox that box with object-fit while
     * switching theater/fullscreen layouts; normalized runtime coordinates must
     * stay attached to the rendered pixels through those changes.
     */
    function videoContentRect(video, windowRef) {
      if (!video || typeof video.getBoundingClientRect !== "function") return clientRect();
      windowRef = windowRef || root;
      var elementRect = clientRect(video.getBoundingClientRect());
      var intrinsicWidth = Number(video.videoWidth);
      var intrinsicHeight = Number(video.videoHeight);
      if (!elementRect.width || !elementRect.height || !Number.isFinite(intrinsicWidth) || intrinsicWidth <= 0 || !Number.isFinite(intrinsicHeight) || intrinsicHeight <= 0) {
        return Object.assign({}, elementRect, { elementRect: elementRect, objectFit: "fill", clipped: false });
      }
      var style = windowRef && typeof windowRef.getComputedStyle === "function" ? windowRef.getComputedStyle(video) : null;
      var objectFit = String(style && style.objectFit || "fill").toLowerCase();
      var scaleX = elementRect.width / intrinsicWidth;
      var scaleY = elementRect.height / intrinsicHeight;
      var renderedWidth = elementRect.width;
      var renderedHeight = elementRect.height;
      if (objectFit === "contain" || objectFit === "scale-down") {
        var containScale = Math.min(scaleX, scaleY);
        if (objectFit === "scale-down") containScale = Math.min(1, containScale);
        renderedWidth = intrinsicWidth * containScale;
        renderedHeight = intrinsicHeight * containScale;
      } else if (objectFit === "cover") {
        var coverScale = Math.max(scaleX, scaleY);
        renderedWidth = intrinsicWidth * coverScale;
        renderedHeight = intrinsicHeight * coverScale;
      } else if (objectFit === "none") {
        renderedWidth = intrinsicWidth;
        renderedHeight = intrinsicHeight;
      }
      var position = String(style && style.objectPosition || "50% 50%").trim().split(/\s+/);
      if (position.length === 1) position.push("50%");
      var left = elementRect.left + objectPositionOffset(position[0], elementRect.width - renderedWidth, "left", "right");
      var top = elementRect.top + objectPositionOffset(position[1], elementRect.height - renderedHeight, "top", "bottom");
      var clipInsets = {
        top: geometryNumber(Math.max(0, elementRect.top - top)),
        right: geometryNumber(Math.max(0, left + renderedWidth - (elementRect.left + elementRect.width))),
        bottom: geometryNumber(Math.max(0, top + renderedHeight - (elementRect.top + elementRect.height))),
        left: geometryNumber(Math.max(0, elementRect.left - left))
      };
      return {
        left: geometryNumber(left),
        top: geometryNumber(top),
        width: geometryNumber(renderedWidth),
        height: geometryNumber(renderedHeight),
        elementRect: elementRect,
        objectFit: objectFit,
        clipped: clipInsets.top > 0 || clipInsets.right > 0 || clipInsets.bottom > 0 || clipInsets.left > 0,
        clipInsets: clipInsets
      };
    }
  
    function createPlaybackAdapter(video, onFrame) {
      var active = false;
      var callbackId = null;
      var timerId = null;
      var frameHandler = typeof onFrame === "function" ? onFrame : function () {};
  
      function emit(mediaTime, metadata) {
        var current = snapshot(video);
        if (!current) return;
        frameHandler(Object.assign({}, current, {
          mediaTime: Number.isFinite(mediaTime) ? mediaTime : current.mediaTime,
          presentedFrames: metadata && metadata.presentedFrames
        }));
      }
  
      function requestNext() {
        if (!active) return;
        if (typeof video.requestVideoFrameCallback === "function") {
          callbackId = video.requestVideoFrameCallback(function (now, metadata) {
            emit(metadata && metadata.mediaTime, metadata);
            requestNext();
          });
          return;
        }
        timerId = setTimeout(function () {
          emit(video.currentTime);
          requestNext();
        }, 250);
      }
  
      return {
        start: function () {
          if (active) return;
          active = true;
          requestNext();
        },
        stop: function () {
          active = false;
          if (callbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
            video.cancelVideoFrameCallback(callbackId);
          }
          if (timerId !== null) clearTimeout(timerId);
          callbackId = null;
          timerId = null;
        },
        read: function () { return snapshot(video); },
        isRunning: function () { return active; }
      };
    }
  
    function runtimeViewDefaults() {
      return {
        phase: "idle",
        message: "Local runtime starting",
        reason: "",
        analyzer: "none",
        inference: false,
        fallbacks: [],
        capabilities: {},
        result: null,
        currentMediaTime: null,
        ageSeconds: null,
        stale: true
      };
    }
  
    /**
     * Explicit UI seam for the runtime foundation. It accepts capability and
     * result envelopes without knowing an analyzer implementation. The result
     * remains model-neutral (including any future array of player tracks), while
     * synchronization age/stale state is kept visible to the renderer.
     */
    function createRuntimeUiSeam(options) {
      options = options || {};
      var onChange = typeof options.onChange === "function" ? options.onChange : function () {};
      var view = runtimeViewDefaults();
  
      function publish() { onChange(Object.assign({}, view, { fallbacks: view.fallbacks.slice() })); }
      function update(patch) {
        view = Object.assign({}, view, patch);
        publish();
      }
      function resultUpdate(message, synchronizationView, currentMediaTime) {
        var sync = synchronizationView || {};
        var resultCapabilities = message.capabilities || message.capabilityState || {};
        return {
          phase: message.status === "fallback" ? "fallback" : "result",
          message: message.result && message.result.note ? message.result.note : "Local analyzer result received",
          reason: message.result && message.result.runtimeIntegrationTest
            ? "runtime-integration-probe"
            : message.status === "fallback" && !message.inferenceAvailable
              ? (message.result && message.result.reason) || "local-inference-unavailable"
              : "",
          analyzer: message.inferenceAvailable ? (message.analyzer || resultCapabilities.analyzer || "none") : (resultCapabilities.analyzer || "none"),
          inference: Boolean(message.inferenceAvailable),
          fallbacks: Array.isArray(resultCapabilities.fallbacks) ? resultCapabilities.fallbacks.slice() : view.fallbacks,
          capabilities: resultCapabilities,
          result: message.result || null,
          currentMediaTime: Number.isFinite(currentMediaTime) ? currentMediaTime : view.currentMediaTime,
          ageSeconds: Number.isFinite(sync.ageSeconds) ? sync.ageSeconds : view.ageSeconds,
          stale: sync.stale == null ? view.stale : Boolean(sync.stale)
        };
      }
      function synchronizedEnvelope(synchronizationView) {
        var sync = synchronizationView || {};
        return sync.result && sync.result.type === "analysis.result" ? sync.result : null;
      }
      function acceptMessage(message, synchronizationView, currentMediaTime) {
        if (!message) return;
        if (message.type === "runtime.capabilities") {
          var capabilityState = message.capabilities || {};
          update({
            phase: capabilityState.inference ? "ready" : "fallback",
            message: message.reason || (capabilityState.inference ? "Local runtime ready" : "Local analysis unavailable"),
            reason: message.reason || "",
            analyzer: capabilityState.analyzer || "none",
            inference: Boolean(capabilityState.inference),
            fallbacks: Array.isArray(message.fallbacks) ? message.fallbacks.slice() : [],
            capabilities: capabilityState
          });
        } else if (message.type === "analysis.result") {
          var sync = synchronizationView || {};
          // RuntimeController always supplies a result key. If it is null, this
          // envelope is still in the future and must not bypass synchronization.
          // Direct seam consumers that omit the key retain the model-neutral
          // compatibility path used by summaries/tests.
          if (Object.prototype.hasOwnProperty.call(sync, "result")) {
            var selected = synchronizedEnvelope(sync);
            if (selected) update(resultUpdate(selected, sync, currentMediaTime));
            else update({
              currentMediaTime: Number.isFinite(currentMediaTime) ? currentMediaTime : view.currentMediaTime,
              ageSeconds: Number.isFinite(sync.ageSeconds) ? sync.ageSeconds : null,
              stale: sync.stale == null ? view.stale : Boolean(sync.stale)
            });
          } else update(resultUpdate(message, sync, currentMediaTime));
        } else if (message.type === "runtime.status") {
          var statusCapabilities = message.capabilities || {};
          update({
            phase: message.phase || view.phase,
            message: message.message || view.message,
            reason: message.reason || view.reason,
            analyzer: statusCapabilities.analyzer || view.analyzer,
            inference: statusCapabilities.inference == null ? view.inference : Boolean(statusCapabilities.inference),
            fallbacks: Array.isArray(statusCapabilities.fallbacks) ? statusCapabilities.fallbacks.slice() : view.fallbacks,
            capabilities: Object.keys(statusCapabilities).length ? statusCapabilities : view.capabilities
          });
        }
      }
      function acceptStatus(status) {
        if (!status) return;
        if (status.type === "capture-capability") {
          update({
            phase: status.mode === "unavailable" ? "fallback" : "starting",
            message: status.mode === "unavailable" ? "Frame capture unavailable" : "Frame capture ready",
            reason: status.fallback || "",
            inference: false
          });
          return;
        }
        if (status.type === "synchronizer-status") {
          if (status.status === "timeline-reset") update({ phase: "resyncing", message: "Media timeline changed", reason: "timeline-reset" });
          return;
        }
        if (status.type === "capture-status") {
          // Backpressure is an expected bounded-capture condition, not a loss
          // of inference. Keep the last capability/result state so a busy local
          // analyzer does not flash the user-facing production fallback card.
          if (status.status === "timeline-reset") {
            update({ phase: "resyncing", message: "Media timeline changed", reason: "timeline-reset" });
          } else if (status.status === "backpressure") {
            update({
              phase: view.phase === "idle" ? "starting" : view.phase,
              message: "Local analyzer is catching up",
              reason: "",
              inference: view.inference
            });
          }
          return;
        }
        update({
          phase: status.type === "frame-transport-fallback" ? view.phase : "fallback",
          message: status.reason || "Runtime fallback",
          reason: status.reason || status.type || "runtime-fallback",
          inference: status.type === "frame-transport-fallback" ? view.inference : false
        });
      }
      function acceptSynchronization(synchronizationView, currentMediaTime) {
        var sync = synchronizationView || {};
        var selected = synchronizedEnvelope(sync);
        if (selected) {
          update(resultUpdate(selected, sync, currentMediaTime));
          return;
        }
        update({
          currentMediaTime: Number.isFinite(currentMediaTime) ? currentMediaTime : view.currentMediaTime,
          ageSeconds: Number.isFinite(sync.ageSeconds) ? sync.ageSeconds : null,
          stale: sync.stale == null ? view.stale : Boolean(sync.stale)
        });
      }
      function reset(reason) {
        view = runtimeViewDefaults();
        view.phase = "resyncing";
        view.message = "Local runtime session reset";
        view.reason = reason || "session-reset";
        publish();
      }
      return {
        acceptMessage: acceptMessage,
        acceptStatus: acceptStatus,
        acceptSynchronization: acceptSynchronization,
        reset: reset,
        snapshot: function () { return Object.assign({}, view, { fallbacks: view.fallbacks.slice() }); }
      };
    }
  
    function startIntegratedRuntime(options) {
      options = options || {};
      if (!root.BSORuntime || typeof root.BSORuntime.RuntimeController !== "function") return null;
      var seam = createRuntimeUiSeam({ onChange: options.onChange });
      var controller = new root.BSORuntime.RuntimeController({
        documentRef: options.documentRef || root.document,
        windowRef: options.windowRef || root,
        chromeApi: options.chromeApi || root.chrome,
        // The design-system content UI owns the visible overlay. Runtime
        // messages and synchronization are adapted before they reach it.
        overlay: null,
        onRuntimeMessage: function (message, view, currentMediaTime) {
          seam.acceptMessage(message, view, currentMediaTime);
        },
        onRuntimeStatus: function (status) { seam.acceptStatus(status); },
        onRuntimeView: function (view, currentMediaTime) {
          if (typeof options.onMediaTime === "function") options.onMediaTime(currentMediaTime);
          seam.acceptSynchronization(view, currentMediaTime);
        },
        onSessionReset: function (reason) { seam.reset(reason); }
      });
      controller.start();
      return { controller: controller, seam: seam };
    }
  
    root.BVRuntime = {
      createPlaybackAdapter: createPlaybackAdapter,
      createRuntimeUiSeam: createRuntimeUiSeam,
      startIntegratedRuntime: startIntegratedRuntime,
      snapshot: snapshot,
      videoContentRect: videoContentRect
    };
  })(typeof globalThis !== "undefined" ? globalThis : window);
  
  /* src/analysis.js */
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
  
    /*
     * CSV import contract
     * -------------------
     * The Import CSV control restores a previously exported shots CSV into the
     * current video's per-video label store. Parsing and normalization are
     * deliberately dependency-free: they only read the exported columns, never
     * invent evidence, and never claim an automatic/fixture row as manual.
     */
    var IMPORT_COLUMN_ALIASES = {
      shot_id: "eventId", eventid: "eventId", event_id: "eventId", shotid: "eventId", id: "eventId",
      start_sec: "startSec", startsec: "startSec", start_time: "startSec", start: "startSec", time: "startSec",
      end_sec: "endSec", endsec: "endSec", end_time: "endSec", end: "endSec",
      label: "shot", shot: "shot", shot_family: "shot", shotfamily: "shot",
      player: "player", player_id: "player", playerid: "player",
      provenance: "provenance", source: "source",
      longitudinal_position: "Longitudinal", longitudinal: "Longitudinal",
      lateral_position: "Lateral", lateral: "Lateral",
      timing: "Timing", intention: "Intention", impact: "Impact", direction: "Direction"
    };
    var IMPORT_AXIS_KEYS = ["Longitudinal", "Lateral", "Timing", "Intention", "Impact", "Direction"];
  
    function parseCsvRows(text) {
      if (typeof text !== "string") return { error: "CSV is empty" };
      text = text.replace(/^\uFEFF/, "");
      if (!text.trim()) return { error: "CSV is empty" };
      var rows = [];
      var row = [];
      var field = "";
      var inQuotes = false;
      for (var i = 0; i < text.length; i += 1) {
        var character = text[i];
        if (inQuotes) {
          if (character === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 1; }
            else inQuotes = false;
          } else field += character;
        } else if (character === '"') inQuotes = true;
        else if (character === ",") { row.push(field); field = ""; }
        else if (character === "\n" || character === "\r") {
          if (character === "\r" && text[i + 1] === "\n") i += 1;
          row.push(field); field = "";
          if (row.some(function (value) { return String(value).trim() !== ""; })) rows.push(row);
          row = [];
        } else field += character;
      }
      row.push(field);
      if (row.some(function (value) { return String(value).trim() !== ""; })) rows.push(row);
      if (!rows.length) return { error: "CSV has no data rows" };
      return { fields: rows[0], rows: rows.slice(1) };
    }
  
    function parseShotsCsv(text) {
      var parsed = parseCsvRows(text);
      if (parsed.error) return { ok: false, error: parsed.error };
      var mapped = Object.create(null);
      parsed.fields.forEach(function (field, index) {
        var key = String(field || "").trim().toLowerCase().replace(/\s+/g, "_");
        var target = IMPORT_COLUMN_ALIASES[key];
        if (target && mapped[target] == null) mapped[target] = index;
      });
      if (mapped.eventId == null || mapped.shot == null) {
        return { ok: false, error: "Unrecognized CSV header. Expected a badminton-vision shots export with shot_id, start_sec, and label columns." };
      }
      var rows = parsed.rows.map(function (values) {
        var record = {};
        Object.keys(mapped).forEach(function (key) { record[key] = values[mapped[key]] != null ? String(values[mapped[key]]).trim() : ""; });
        return record;
      });
      return { ok: true, fields: parsed.fields, rows: rows };
    }
  
    function formatImportTime(seconds) {
      if (!Number.isFinite(seconds)) return null;
      var minutes = Math.floor(seconds / 60);
      var remaining = seconds - minutes * 60;
      return String(minutes).padStart(2, "0") + ":" + remaining.toFixed(3).padStart(6, "0");
    }
  
    function importedRowDuplicate(record, existing, seenIds, seenWindows, windowSeconds) {
      var id = record && record.eventId;
      if (id != null) {
        if (seenIds[id]) return true;
        if ((existing || []).some(function (item) { return item && item.eventId != null && String(item.eventId) === String(id); })) return true;
      }
      if (record && record.startSec != null) {
        var start = Number(record.startSec);
        var shot = String(record.shot || "").toLowerCase();
        function near(item) {
          return item && item.startSec != null && Math.abs(Number(item.startSec) - start) < windowSeconds && String(item.shot || "").toLowerCase() === shot;
        }
        if (seenWindows.some(near)) return true;
        if ((existing || []).some(near)) return true;
      }
      return false;
    }
  
    function normalizeImportedShots(rows, options) {
      options = options || {};
      var now = options.now || new Date().toISOString();
      var existing = Array.isArray(options.existing) ? options.existing : [];
      var windowSeconds = Number.isFinite(Number(options.windowSeconds)) ? Number(options.windowSeconds) : 0.5;
      var records = [];
      var seenIds = Object.create(null);
      var seenWindows = [];
      var skipped = 0;
      var invalid = 0;
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (!row || typeof row !== "object") { invalid += 1; return; }
        var eventId = textValue(row.eventId);
        var shot = textValue(row.shot);
        var startSec = manualMediaSeconds(row.startSec);
        var endRaw = row.endSec != null ? String(row.endSec).trim() : "";
        var endSec = endRaw === "" ? null : manualMediaSeconds(endRaw);
        var provenance = textValue(row.provenance) || textValue(row.source) || "manual";
        var sourceKey = String(provenance).toLowerCase().replace(/[ _]+/g, "-");
        // Only rows that are genuinely manual (or unmarked exports) are restored
        // as labels. Automatic, suggested, model, and fixture rows are skipped:
        // importing must never turn CV evidence into a manual label.
        if (NON_MANUAL_SOURCES[sourceKey]) { skipped += 1; return; }
        if (!eventId || !shot) { invalid += 1; return; }
        var record = {
          eventId: String(eventId),
          shot: shot,
          startSec: startSec,
          endSec: endSec,
          time: startSec == null ? null : formatImportTime(startSec),
          axes: {},
          source: "manual",
          provenance: provenance,
          status: "accepted",
          createdAt: now,
          updatedAt: now
        };
        var player = textValue(row.player);
        // Match the form-created record shape: player fields are omitted (not
        // null) when the export has no player identity.
        if (player != null) { record.playerId = player; record.player = player; }
        IMPORT_AXIS_KEYS.forEach(function (axis) {
          var value = textValue(row[axis]);
          if (value && !UNKNOWN_LABELS[value.toLowerCase()]) record.axes[axis] = value;
        });
        if (importedRowDuplicate(record, existing, seenIds, seenWindows, windowSeconds)) { skipped += 1; return; }
        seenIds[record.eventId] = true;
        if (record.startSec != null) seenWindows.push({ startSec: record.startSec, shot: record.shot });
        records.push(record);
      });
      return { records: records, imported: records.length, skipped: skipped, invalid: invalid };
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
      parseCsvRows: parseCsvRows,
      parseShotsCsv: parseShotsCsv,
      normalizeImportedShots: normalizeImportedShots,
      escapeCsv: escapeCsv
    };
  })(typeof globalThis !== "undefined" ? globalThis : window);
  
  /* analysis/index.js */
  'use strict';
  
  /**
   * UI-independent badminton analysis primitives.
   *
   * This module intentionally contains no frame capture, model, DOM, canvas, or
   * rendering code. It accepts observations from an upstream analyzer and
   * returns deterministic court, record, feature, and highlight values.
   */
  
  const COURT_LENGTH_M = 13.4;
  const COURT_WIDTH_M = 6.1;
  const LINE_WIDTH_M = 0.04;
  const NET_Y_M = 6.7;
  const NET_POST_HEIGHT_M = 1.55;
  const SINGLES_SIDE_MARGIN_M = 0.46;
  const SINGLES_WIDTH_M = 5.18;
  const SHORT_SERVICE_OFFSET_M = 1.98;
  const DOUBLES_LONG_SERVICE_OFFSET_M = 0.76;
  const SHORT_SERVICE_NEAR_Y_M = Number((NET_Y_M - SHORT_SERVICE_OFFSET_M).toFixed(2));
  const SHORT_SERVICE_FAR_Y_M = Number((NET_Y_M + SHORT_SERVICE_OFFSET_M).toFixed(2));
  const DOUBLES_LONG_SERVICE_NEAR_Y_M = DOUBLES_LONG_SERVICE_OFFSET_M;
  const DOUBLES_LONG_SERVICE_FAR_Y_M = COURT_LENGTH_M - DOUBLES_LONG_SERVICE_OFFSET_M;
  
  const COARSE_SHOT_FAMILIES = Object.freeze(['clear', 'drop', 'smash', 'net']);
  const SHOT_FAMILY_UNKNOWN = 'unknown';
  const MANUAL_SHOT_LABELS = Object.freeze([
    'Serve',
    'Clear',
    'Drop',
    'Smash',
    'Half Smash',
    'Lift',
    'Net Shot',
    'Net Kill',
    'Push',
    'Drive',
    'Block',
  ]);
  const EVENT_SOURCES = Object.freeze(['auto', 'manual', 'corrected', 'unknown']);
  const EVENT_STATUSES = Object.freeze(['suggested', 'accepted', 'corrected', 'partial', 'unknown', 'unclassified']);
  const OUTCOME_LABELS = Object.freeze(['winner', 'forced_error', 'unforced_error', 'unclassified']);
  const LINE_CALL_LABELS = Object.freeze(['in', 'out', 'unknown']);
  const EVIDENCE_STATES = Object.freeze(['accepted', 'suggested', 'corrected', 'partial', 'unknown']);
  const RALLY_STATUSES = Object.freeze(['in_progress', 'completed', 'incomplete']);
  const RALLY_TERMINATIONS = Object.freeze(['rally_end', 'camera_cut', 'implicit', 'unknown']);
  const STROKE_EVENT_FIELDS = Object.freeze([
    'event_id', 'rally_id', 'sequence', 'player_id', 'shot_family', 'label', 'hit_media_time',
    'classification_confidence', 'geometry_confidence', 'tracking_confidence', 'status', 'created_at_wall_time',
    'evidence', 'player_evidence', 'shuttle_evidence', 'shot_evidence', 'landing_evidence',
  ]);
  const RALLY_OPTIONAL_FIELDS = Object.freeze([
    'evidence_state', 'partial_reasons', 'termination', 'boundary_media_time', 'camera_cut_id',
    'line_calls', 'evidence',
  ]);
  
  class AnalysisError extends Error {
    constructor(message, code = 'analysis-error', details = undefined) {
      super(message);
      this.name = 'AnalysisError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }
  
  class SchemaValidationError extends AnalysisError {
    constructor(recordName, errors) {
      super(`${recordName} failed schema validation: ${errors.join('; ')}`, 'schema-validation', {
        recordName,
        errors,
      });
      this.name = 'SchemaValidationError';
      this.errors = errors;
    }
  }
  
  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  
  function deepClone(value) {
    if (Array.isArray(value)) return value.map(deepClone);
    if (isRecord(value)) {
      const result = {};
      for (const [key, item] of Object.entries(value)) result[key] = deepClone(item);
      return result;
    }
    return value;
  }
  
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
  }
  
  function finishRecord(value) {
    return deepFreeze(value);
  }
  
  function assertObject(value, name) {
    if (!isRecord(value)) throw new SchemaValidationError(name, ['value must be an object']);
  }
  
  function assertFiniteNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new SchemaValidationError('value', [`${name} must be a finite number`]);
    }
    if (value < min || value > max) {
      throw new SchemaValidationError('value', [`${name} must be between ${min} and ${max}`]);
    }
  }
  
  function assertTimestamp(value, name, { nullable = false } = {}) {
    if (nullable && value === null) return;
    assertFiniteNumber(value, name, { min: 0 });
  }
  
  function assertNonEmptyString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new SchemaValidationError('value', [`${name} must be a non-empty string`]);
    }
  }
  
  function validateEnum(value, name, choices, errors) {
    if (!choices.includes(value)) errors.push(`${name} must be one of: ${choices.join(', ')}`);
  }
  
  function pointXY(point, name = 'point') {
    let x;
    let y;
    if (Array.isArray(point) && point.length === 2) {
      [x, y] = point;
    } else if (isRecord(point)) {
      ({ x, y } = point);
    } else {
      throw new AnalysisError(`${name} must be a [x, y] pair or {x, y} object`, 'invalid-point');
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new AnalysisError(`${name} coordinates must be finite`, 'non-finite-point');
    }
    return { x, y };
  }
  
  /** Create a normalized point. By default coordinates are constrained to [0, 1]. */
  function createNormalizedPoint(x, y, { allowOutside = false } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new AnalysisError('normalized point coordinates must be finite', 'non-finite-point');
    }
    if (!allowOutside && (x < 0 || x > 1 || y < 0 || y > 1)) {
      throw new AnalysisError('normalized point coordinates must be in [0, 1]', 'point-out-of-range');
    }
    return finishRecord({ x, y });
  }
  
  function createCourtPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new AnalysisError('court point coordinates must be finite', 'non-finite-point');
    }
    return finishRecord({ x, y });
  }
  
  function normalizeCourtPoint(point, { allowOutside = false } = {}) {
    const { x, y } = pointXY(point, 'court point');
    return createNormalizedPoint(x / COURT_WIDTH_M, y / COURT_LENGTH_M, { allowOutside });
  }
  
  function denormalizeCourtPoint(point) {
    const { x, y } = pointXY(point, 'normalized court point');
    return createCourtPoint(x * COURT_WIDTH_M, y * COURT_LENGTH_M);
  }
  
  function normalizeCourtLine(start, end) {
    return {
      start: normalizeCourtPoint(start, { allowOutside: true }),
      end: normalizeCourtPoint(end, { allowOutside: true }),
    };
  }
  
  function makeCourtLine(id, role, start, end, formats, includedIn, extra = {}) {
    const normalized = normalizeCourtLine(start, end);
    return {
      id,
      role,
      start: finishRecord({ ...start }),
      end: finishRecord({ ...end }),
      normalized_start: normalized.start,
      normalized_end: normalized.end,
      width_m: LINE_WIDTH_M,
      normalized_width: finishRecord({ x: LINE_WIDTH_M / COURT_WIDTH_M, y: LINE_WIDTH_M / COURT_LENGTH_M }),
      formats: [...formats],
      included_in: [...includedIn],
      line_ownership: 'line-is-part-of-the-area-it-bounds',
      ...extra,
    };
  }
  
  /**
   * Generate the fixed BWF court lines from the physical dimensions in the
   * README. Coordinates are line center coordinates in metres; line ownership
   * is explicit because a 40 mm line belongs to the area it bounds.
   */
  function generateCourtLines() {
    const xLeft = 0;
    const xRight = COURT_WIDTH_M;
    const xSinglesLeft = SINGLES_SIDE_MARGIN_M;
    const xSinglesRight = COURT_WIDTH_M - SINGLES_SIDE_MARGIN_M;
    const xCenter = COURT_WIDTH_M / 2;
    const full = ['doubles', 'singles'];
    const lines = [
      makeCourtLine(
        'doubles-side-left',
        'doubles-side-boundary',
        { x: xLeft, y: 0 },
        { x: xLeft, y: COURT_LENGTH_M },
        ['doubles'],
        ['doubles-rally-court', 'doubles-service-court'],
        { boundary: true, service_boundary: true },
      ),
      makeCourtLine(
        'doubles-side-right',
        'doubles-side-boundary',
        { x: xRight, y: 0 },
        { x: xRight, y: COURT_LENGTH_M },
        ['doubles'],
        ['doubles-rally-court', 'doubles-service-court'],
        { boundary: true, service_boundary: true },
      ),
      makeCourtLine(
        'singles-side-left',
        'singles-side-boundary',
        { x: xSinglesLeft, y: 0 },
        { x: xSinglesLeft, y: COURT_LENGTH_M },
        ['singles'],
        ['singles-rally-court', 'singles-service-court'],
        { boundary: true, service_boundary: true },
      ),
      makeCourtLine(
        'singles-side-right',
        'singles-side-boundary',
        { x: xSinglesRight, y: 0 },
        { x: xSinglesRight, y: COURT_LENGTH_M },
        ['singles'],
        ['singles-rally-court', 'singles-service-court'],
        { boundary: true, service_boundary: true },
      ),
      makeCourtLine(
        'back-boundary-near',
        'back-boundary',
        { x: xLeft, y: 0 },
        { x: xRight, y: 0 },
        full,
        ['doubles-rally-court', 'singles-rally-court', 'singles-service-court'],
        { boundary: true, service_boundary: true },
      ),
      makeCourtLine(
        'back-boundary-far',
        'back-boundary',
        { x: xLeft, y: COURT_LENGTH_M },
        { x: xRight, y: COURT_LENGTH_M },
        full,
        ['doubles-rally-court', 'singles-rally-court', 'singles-service-court'],
        { boundary: true, service_boundary: true },
      ),
      makeCourtLine(
        'short-service-line-near',
        'short-service-line',
        { x: xLeft, y: SHORT_SERVICE_NEAR_Y_M },
        { x: xRight, y: SHORT_SERVICE_NEAR_Y_M },
        full,
        ['doubles-service-court', 'singles-service-court'],
        { service_line: true },
      ),
      makeCourtLine(
        'short-service-line-far',
        'short-service-line',
        { x: xLeft, y: SHORT_SERVICE_FAR_Y_M },
        { x: xRight, y: SHORT_SERVICE_FAR_Y_M },
        full,
        ['doubles-service-court', 'singles-service-court'],
        { service_line: true },
      ),
      makeCourtLine(
        'doubles-long-service-line-near',
        'doubles-long-service-line',
        { x: xLeft, y: DOUBLES_LONG_SERVICE_NEAR_Y_M },
        { x: xRight, y: DOUBLES_LONG_SERVICE_NEAR_Y_M },
        ['doubles'],
        ['doubles-service-court'],
        { service_line: true, doubles_only: true },
      ),
      makeCourtLine(
        'doubles-long-service-line-far',
        'doubles-long-service-line',
        { x: xLeft, y: DOUBLES_LONG_SERVICE_FAR_Y_M },
        { x: xRight, y: DOUBLES_LONG_SERVICE_FAR_Y_M },
        ['doubles'],
        ['doubles-service-court'],
        { service_line: true, doubles_only: true },
      ),
      makeCourtLine(
        'centre-line-near',
        'centre-line',
        { x: xCenter, y: 0 },
        { x: xCenter, y: SHORT_SERVICE_NEAR_Y_M },
        full,
        ['doubles-service-court', 'singles-service-court'],
        { service_line: true, divides_service_courts: true },
      ),
      makeCourtLine(
        'centre-line-far',
        'centre-line',
        { x: xCenter, y: SHORT_SERVICE_FAR_Y_M },
        { x: xCenter, y: COURT_LENGTH_M },
        full,
        ['doubles-service-court', 'singles-service-court'],
        { service_line: true, divides_service_courts: true },
      ),
      makeCourtLine(
        'net',
        'net',
        { x: xLeft, y: NET_Y_M },
        { x: xRight, y: NET_Y_M },
        full,
        [],
        { boundary: false, physical_net: true, line_ownership: 'physical-net-not-court-area' },
      ),
    ];
    return lines.map((line) => finishRecord(line));
  }
  
  const COURT_LINES = finishRecord(generateCourtLines());
  const COURT_GEOMETRY = finishRecord({
    coordinate_system: 'court-meters',
    normalized_coordinate_system: 'court-normalized',
    units: 'm',
    length_m: COURT_LENGTH_M,
    width_m: COURT_WIDTH_M,
    line_width_m: LINE_WIDTH_M,
    net_y_m: NET_Y_M,
    net_post_height_m: NET_POST_HEIGHT_M,
    singles_side_margin_m: SINGLES_SIDE_MARGIN_M,
    singles_width_m: SINGLES_WIDTH_M,
    short_service_offset_m: SHORT_SERVICE_OFFSET_M,
    doubles_long_service_offset_m: DOUBLES_LONG_SERVICE_OFFSET_M,
    bounds: { x_min: 0, x_max: COURT_WIDTH_M, y_min: 0, y_max: COURT_LENGTH_M },
    outer_corner_order: [
      { x: 0, y: 0 },
      { x: COURT_WIDTH_M, y: 0 },
      { x: COURT_WIDTH_M, y: COURT_LENGTH_M },
      { x: 0, y: COURT_LENGTH_M },
    ],
    lines: COURT_LINES,
  });
  
  function getCourtGeometry() {
    return COURT_GEOMETRY;
  }
  
  function getCourtLine(id) {
    return COURT_LINES.find((line) => line.id === id) || null;
  }
  
  function projectCourtLines(homography) {
    if (!homography || typeof homography.courtToImage !== 'function') {
      throw new AnalysisError('a fitted homography is required', 'invalid-homography');
    }
    return finishRecord(
      COURT_LINES.map((line) =>
        finishRecord({
          ...line,
          start: homography.courtToImage(line.start),
          end: homography.courtToImage(line.end),
        }),
      ),
    );
  }
  
  function matrixMultiply(a, b) {
    const result = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        result[row][col] = a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col];
      }
    }
    return result;
  }
  
  function matrixDeterminant(m) {
    return (
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    );
  }
  
  function matrixInverse(m, code = 'near-singular') {
    const determinant = matrixDeterminant(m);
    const scale = Math.max(1, ...m.flat().map((value) => Math.abs(value)));
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-14 * scale ** 3) {
      throw new AnalysisError('homography matrix is singular or near-singular', code);
    }
    const inverse = [
      [
        (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / determinant,
        (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / determinant,
        (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / determinant,
      ],
      [
        (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / determinant,
        (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / determinant,
        (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / determinant,
      ],
      [
        (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / determinant,
        (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / determinant,
        (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / determinant,
      ],
    ];
    return inverse;
  }
  
  function solveLinearSystem(matrix, vector, pivotTolerance = 1e-12) {
    const n = vector.length;
    const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);
    let largestPivot = 0;
    let smallestPivot = Infinity;
  
    for (let column = 0; column < n; column += 1) {
      let pivotRow = column;
      for (let row = column + 1; row < n; row += 1) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
      }
      const pivot = Math.abs(augmented[pivotRow][column]);
      largestPivot = Math.max(largestPivot, pivot);
      if (!Number.isFinite(pivot) || pivot <= pivotTolerance) {
        throw new AnalysisError('homography seed produces a near-singular system', 'near-singular');
      }
      smallestPivot = Math.min(smallestPivot, pivot);
      [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
      const divisor = augmented[column][column];
      for (let item = column; item <= n; item += 1) augmented[column][item] /= divisor;
      for (let row = 0; row < n; row += 1) {
        if (row === column) continue;
        const factor = augmented[row][column];
        if (factor === 0) continue;
        for (let item = column; item <= n; item += 1) augmented[row][item] -= factor * augmented[column][item];
      }
    }
  
    if (smallestPivot / largestPivot <= pivotTolerance ** 2) {
      throw new AnalysisError('homography seed is numerically ill-conditioned', 'near-singular');
    }
    return augmented.map((row) => row[n]);
  }
  
  function normalizePointSet(points) {
    const centroid = points.reduce(
      (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
      { x: 0, y: 0 },
    );
    const meanDistance = points.reduce(
      (sum, point) => sum + Math.hypot(point.x - centroid.x, point.y - centroid.y),
      0,
    ) / points.length;
    if (!Number.isFinite(meanDistance) || meanDistance <= 1e-15) {
      throw new AnalysisError('homography points have no measurable extent', 'near-singular');
    }
    const scale = Math.SQRT2 / meanDistance;
    return {
      transform: [
        [scale, 0, -scale * centroid.x],
        [0, scale, -scale * centroid.y],
        [0, 0, 1],
      ],
      points: points.map((point) => ({
        x: scale * (point.x - centroid.x),
        y: scale * (point.y - centroid.y),
      })),
    };
  }
  
  function validateQuadrilateral(points, name, { minimumAreaRatio = 1e-8, duplicateRatio = 1e-9 } = {}) {
    if (!Array.isArray(points) || points.length !== 4) {
      throw new AnalysisError(`${name} must contain exactly four points`, 'invalid-seed');
    }
    const parsed = points.map((point, index) => pointXY(point, `${name}[${index}]`));
    const xExtent = Math.max(...parsed.map((point) => point.x)) - Math.min(...parsed.map((point) => point.x));
    const yExtent = Math.max(...parsed.map((point) => point.y)) - Math.min(...parsed.map((point) => point.y));
    const scale = Math.max(xExtent, yExtent, ...parsed.flatMap((point) => parsed.map((other) => Math.hypot(point.x - other.x, point.y - other.y))), 1e-15);
  
    for (let first = 0; first < parsed.length; first += 1) {
      for (let second = first + 1; second < parsed.length; second += 1) {
        if (Math.hypot(parsed[first].x - parsed[second].x, parsed[first].y - parsed[second].y) <= duplicateRatio * scale) {
          throw new AnalysisError(`${name} contains duplicate or near-duplicate points`, 'duplicate-corner');
        }
      }
    }
  
    const signedCrosses = [];
    for (let index = 0; index < 4; index += 1) {
      const a = parsed[index];
      const b = parsed[(index + 1) % 4];
      const c = parsed[(index + 2) % 4];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) <= minimumAreaRatio * scale ** 2) {
        throw new AnalysisError(`${name} contains collinear or near-collinear corners`, 'collinear-corners');
      }
      signedCrosses.push(Math.sign(cross));
    }
    if (new Set(signedCrosses).size !== 1) {
      throw new AnalysisError(`${name} must be a convex, consistently ordered quadrilateral`, 'invalid-order');
    }
  
    const area = Math.abs(parsed.reduce((sum, point, index) => {
      const next = parsed[(index + 1) % parsed.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
    if (area <= minimumAreaRatio * scale ** 2) {
      throw new AnalysisError(`${name} has insufficient area`, 'near-singular');
    }
    return parsed;
  }
  
  function fitHomography(sourcePoints, targetPoints, options = {}) {
    const source = validateQuadrilateral(sourcePoints, 'source points', options);
    const target = validateQuadrilateral(targetPoints, 'target points', options);
    const sourceNormalized = normalizePointSet(source);
    const targetNormalized = normalizePointSet(target);
    const matrix = [];
    const vector = [];
  
    for (let index = 0; index < 4; index += 1) {
      const { x, y } = sourceNormalized.points[index];
      const { x: u, y: v } = targetNormalized.points[index];
      matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      vector.push(u);
      matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      vector.push(v);
    }
  
    const solved = solveLinearSystem(matrix, vector, options.pivotTolerance || 1e-12);
    const normalizedHomography = [
      [solved[0], solved[1], solved[2]],
      [solved[3], solved[4], solved[5]],
      [solved[6], solved[7], 1],
    ];
    const sourceTransform = sourceNormalized.transform;
    const targetTransformInverse = matrixInverse(targetNormalized.transform);
    let homography = matrixMultiply(matrixMultiply(targetTransformInverse, normalizedHomography), sourceTransform);
    const normalization = Math.abs(homography[2][2]) > 1e-14 ? homography[2][2] : Math.max(...homography.flat().map((value) => Math.abs(value)));
    homography = homography.map((row) => row.map((value) => value / normalization));
    const inverse = matrixInverse(homography);
  
    const targetExtent = Math.max(
      Math.max(...target.map((point) => point.x)) - Math.min(...target.map((point) => point.x)),
      Math.max(...target.map((point) => point.y)) - Math.min(...target.map((point) => point.y)),
      1,
    );
    for (let index = 0; index < 4; index += 1) {
      const projected = applyMatrix(homography, source[index], 'homography fit');
      if (Math.hypot(projected.x - target[index].x, projected.y - target[index].y) > 1e-7 * targetExtent) {
        throw new AnalysisError('homography fit residual is too large', 'near-singular');
      }
    }
  
    return new Homography(source, target, homography, inverse);
  }
  
  function applyMatrix(matrix, point, operation = 'projection') {
    const { x, y } = pointXY(point, operation);
    const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
    const scale = Math.max(1, ...matrix.flat().map((value) => Math.abs(value)), Math.abs(x), Math.abs(y));
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-12 * scale) {
      throw new AnalysisError(`${operation} is at a projective singularity`, 'projection-singular');
    }
    const projected = {
      x: (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
      y: (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator,
    };
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      throw new AnalysisError(`${operation} produced a non-finite point`, 'projection-singular');
    }
    return finishRecord(projected);
  }
  
  class Homography {
    constructor(sourcePoints, targetPoints, matrix, inverse) {
      this.source_points = finishRecord(sourcePoints.map((point) => ({ ...point })));
      this.target_points = finishRecord(targetPoints.map((point) => ({ ...point })));
      this.matrix = finishRecord(matrix.map((row) => [...row]));
      this.inverse_matrix = finishRecord(inverse.map((row) => [...row]));
      deepFreeze(this);
    }
  
    mapSourceToTarget(point) {
      return applyMatrix(this.matrix, point, 'source-to-target projection');
    }
  
    mapTargetToSource(point) {
      return applyMatrix(this.inverse_matrix, point, 'target-to-source projection');
    }
  
    imageToCourt(point) {
      return this.mapSourceToTarget(point);
    }
  
    courtToImage(point) {
      return this.mapTargetToSource(point);
    }
  
    imageToNormalizedCourt(point, options = {}) {
      return normalizeCourtPoint(this.imageToCourt(point), options);
    }
  
    normalizedCourtToImage(point) {
      return this.courtToImage(denormalizeCourtPoint(point));
    }
  }
  
  function fitOuterCourtHomography(imageCorners, options = {}) {
    return fitHomography(imageCorners, COURT_GEOMETRY.outer_corner_order, options);
  }
  
  function confidenceErrors(value, name = 'confidence') {
    const errors = [];
    if (!isRecord(value)) {
      errors.push(`${name} must be a confidence object`);
      return errors;
    }
    validateEnum(value.status, `${name}.status`, ['known', 'unknown'], errors);
    if (value.status === 'known' && (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0 || value.value > 1)) {
      errors.push(`${name}.value must be a finite number in [0, 1] when known`);
    }
    if (value.status === 'unknown' && value.value !== null) errors.push(`${name}.value must be null when unknown`);
    if (value.reason !== null && value.reason !== undefined && typeof value.reason !== 'string') {
      errors.push(`${name}.reason must be a string or null`);
    }
    return errors;
  }
  
  function createConfidence(value = null, { reason = 'not-provided' } = {}) {
    if (isRecord(value)) {
      const candidate = {
        value: value.status === 'unknown' ? null : value.value,
        status: value.status,
        reason: value.reason ?? (value.status === 'unknown' ? reason : null),
      };
      const errors = confidenceErrors(candidate);
      if (errors.length) throw new SchemaValidationError('Confidence', errors);
      return finishRecord(candidate);
    }
    if (value === null || value === undefined) return finishRecord({ value: null, status: 'unknown', reason });
    assertFiniteNumber(value, 'confidence', { min: 0, max: 1 });
    return finishRecord({ value, status: 'known', reason: null });
  }
  
  function validateConfidence(value) {
    const errors = confidenceErrors(value);
    return { valid: errors.length === 0, errors };
  }
  
  function stableNumber(value, digits = 12) {
    return Number(value.toFixed(digits));
  }
  
  function provenanceErrors(value, name = 'provenance') {
    const errors = [];
    if (!isRecord(value)) return [`${name} must be an object`];
    validateEnum(value.source, `${name}.source`, EVENT_SOURCES, errors);
    if (typeof value.reason !== 'string' || value.reason.trim() === '') errors.push(`${name}.reason must be a non-empty string`);
    if (value.corrected_at_media_time !== null && value.corrected_at_media_time !== undefined &&
        (typeof value.corrected_at_media_time !== 'number' || !Number.isFinite(value.corrected_at_media_time) || value.corrected_at_media_time < 0)) {
      errors.push(`${name}.corrected_at_media_time must be a non-negative finite number or null`);
    }
    if (!Array.isArray(value.changed_fields) || value.changed_fields.some((field) => typeof field !== 'string')) {
      errors.push(`${name}.changed_fields must be an array of strings`);
    }
    return errors;
  }
  
  function createCorrectionProvenance({ source = 'manual', reason, corrected_at_media_time = null, changed_fields = [] } = {}) {
    const value = {
      source,
      reason,
      corrected_at_media_time,
      changed_fields: [...changed_fields],
    };
    const errors = provenanceErrors(value);
    if (errors.length) throw new SchemaValidationError('CorrectionProvenance', errors);
    return finishRecord(value);
  }
  
  function validateCorrectionProvenance(value) {
    const errors = provenanceErrors(value);
    return { valid: errors.length === 0, errors };
  }
  
  function normalizeProvenanceList(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new SchemaValidationError('CorrectionProvenance', ['must be an array']);
    return value.map((item) => {
      const candidate = createCorrectionProvenance(item);
      return candidate;
    });
  }
  
  function eventErrors(value) {
    const errors = [];
    if (!isRecord(value)) return ['value must be an object'];
    for (const field of ['event_id', 'rally_id']) {
      if (typeof value[field] !== 'string' || value[field].trim() === '') errors.push(`${field} must be a non-empty string`);
    }
    if (value.player_id !== null && (typeof value.player_id !== 'string' || value.player_id.trim() === '')) {
      errors.push('player_id must be a non-empty string or null');
    }
    if (value.sequence !== null && (!Number.isInteger(value.sequence) || value.sequence < 0)) {
      errors.push('sequence must be a non-negative integer or null');
    }
    if (value.hit_media_time !== null && (typeof value.hit_media_time !== 'number' || !Number.isFinite(value.hit_media_time) || value.hit_media_time < 0)) {
      errors.push('hit_media_time must be a non-negative finite number or null');
    }
    validateEnum(value.shot_family, `${'shot_family'}`, [...COARSE_SHOT_FAMILIES, SHOT_FAMILY_UNKNOWN], errors);
    validateEnum(value.source, 'source', EVENT_SOURCES, errors);
    validateEnum(value.status, 'status', EVENT_STATUSES, errors);
    errors.push(...confidenceErrors(value.classification_confidence, 'classification_confidence'));
    errors.push(...confidenceErrors(value.geometry_confidence, 'geometry_confidence'));
    if (value.tracking_confidence !== null && value.tracking_confidence !== undefined) {
      errors.push(...confidenceErrors(value.tracking_confidence, 'tracking_confidence'));
    }
    if (value.label !== null && value.label !== undefined && !MANUAL_SHOT_LABELS.includes(value.label)) {
      errors.push(`label must be one of: ${MANUAL_SHOT_LABELS.join(', ')}`);
    }
    if (!Array.isArray(value.correction_provenance)) errors.push('correction_provenance must be an array');
    else value.correction_provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `correction_provenance[${index}]`)));
    if (value.created_at_wall_time !== null && value.created_at_wall_time !== undefined && typeof value.created_at_wall_time !== 'string') {
      errors.push('created_at_wall_time must be a string or null');
    }
    return errors;
  }
  
  function validateStrokeEvent(value) {
    const errors = eventErrors(value);
    return { valid: errors.length === 0, errors };
  }
  
  function createStrokeEvent(input) {
    assertObject(input, 'StrokeEvent');
    const value = {
      event_id: input.event_id,
      rally_id: input.rally_id,
      sequence: input.sequence ?? null,
      player_id: input.player_id ?? null,
      shot_family: input.shot_family ?? SHOT_FAMILY_UNKNOWN,
      label: input.label ?? null,
      hit_media_time: input.hit_media_time ?? null,
      source: input.source ?? 'unknown',
      classification_confidence: createConfidence(input.classification_confidence),
      geometry_confidence: createConfidence(input.geometry_confidence),
      tracking_confidence: input.tracking_confidence === undefined ? null : createConfidence(input.tracking_confidence),
      status: input.status ?? 'unknown',
      created_at_wall_time: input.created_at_wall_time ?? null,
      correction_provenance: normalizeProvenanceList(input.correction_provenance),
    };
    for (const field of ['evidence', 'player_evidence', 'shuttle_evidence', 'shot_evidence', 'landing_evidence']) {
      if (Object.prototype.hasOwnProperty.call(input, field)) value[field] = deepClone(input[field]);
    }
    const errors = eventErrors(value);
    if (errors.length) throw new SchemaValidationError('StrokeEvent', errors);
    return finishRecord(value);
  }
  
  function correctStrokeEvent(event, patch, provenance = {}) {
    const original = createStrokeEvent(event);
    assertObject(patch, 'StrokeEvent correction');
    if (Object.prototype.hasOwnProperty.call(patch, 'event_id') && patch.event_id !== original.event_id) {
      throw new AnalysisError('a correction must preserve event_id', 'correction-id-change');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'correction_provenance')) {
      throw new AnalysisError('correction provenance is appended automatically', 'correction-provenance-overwrite');
    }
    const unknownFields = Object.keys(patch).filter((field) => !STROKE_EVENT_FIELDS.includes(field));
    if (unknownFields.length) throw new AnalysisError(`unknown correction field(s): ${unknownFields.join(', ')}`, 'unknown-correction-field');
    const changedFields = Object.keys(patch).filter((field) => field !== 'source' && field !== 'status');
    const entry = createCorrectionProvenance({
      source: provenance.source ?? 'manual',
      reason: provenance.reason,
      corrected_at_media_time: provenance.corrected_at_media_time ?? null,
      changed_fields: changedFields,
    });
    return createStrokeEvent({
      ...original,
      ...deepClone(patch),
      event_id: original.event_id,
      source: 'corrected',
      status: 'corrected',
      correction_provenance: [...original.correction_provenance, entry],
    });
  }
  
  function replaceCorrectedStrokeEvent(events, eventId, patch, provenance = {}) {
    if (!Array.isArray(events)) throw new SchemaValidationError('StrokeEventCollection', ['events must be an array']);
    const normalized = events.map((event) => createStrokeEvent(event));
    const matching = normalized.filter((event) => event.event_id === eventId);
    if (matching.length === 0) throw new AnalysisError(`event ${eventId} was not found`, 'event-not-found');
    if (matching.length > 1) throw new AnalysisError(`event ${eventId} occurs more than once`, 'duplicate-event-id');
    return finishRecord(normalized.map((event) => event.event_id === eventId ? correctStrokeEvent(event, patch, provenance) : event));
  }
  
  function inferScoreState(score) {
    if (!isRecord(score)) return 'unknown';
    const left = score.player_a ?? score.a ?? score.home;
    const right = score.player_b ?? score.b ?? score.away;
    if (!Number.isFinite(left) || !Number.isFinite(right) || left < 0 || right < 0) return 'unknown';
    return Math.abs(left - right) <= 2 && Math.max(left, right) >= 18 ? 'tight' : 'ordinary';
  }
  
  function inferGamePoint(score) {
    if (!isRecord(score)) return null;
    if (typeof score.game_point === 'boolean') return score.game_point;
    const left = score.player_a ?? score.a ?? score.home;
    const right = score.player_b ?? score.b ?? score.away;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return Math.max(left, right) >= 20 && Math.abs(left - right) <= 1;
  }
  
  function normalizeScoreContext(value) {
    if (value === undefined || value === null) {
      return finishRecord({ state: 'unknown', game_point: null, source: 'unknown', score: null });
    }
    assertObject(value, 'ScoreContext');
    const score = value.score === undefined ? null : deepClone(value.score);
    const candidate = {
      state: value.state ?? inferScoreState(score),
      game_point: value.game_point ?? inferGamePoint(score),
      source: value.source ?? 'unknown',
      score,
    };
    const errors = [];
    validateEnum(candidate.state, 'score_context.state', ['tight', 'ordinary', 'unknown'], errors);
    validateEnum(candidate.source, 'score_context.source', ['ocr', 'manual', 'unknown'], errors);
    if (candidate.game_point !== null && typeof candidate.game_point !== 'boolean') errors.push('score_context.game_point must be boolean or null');
    if (errors.length) throw new SchemaValidationError('ScoreContext', errors);
    return finishRecord(candidate);
  }
  
  function outcomeErrors(value, name = 'winner_state') {
    const errors = [];
    if (!isRecord(value)) return [`${name} must be an object`];
    validateEnum(value.label, `${name}.label`, OUTCOME_LABELS, errors);
    if (value.label !== 'unclassified' && (typeof value.player_id !== 'string' || value.player_id.trim() === '')) {
      errors.push(`${name}.player_id is required for a classified outcome`);
    }
    if (value.label === 'unclassified' && value.player_id !== null) errors.push(`${name}.player_id must be null when unclassified`);
    errors.push(...confidenceErrors(value.confidence, `${name}.confidence`));
    validateEnum(value.source, `${name}.source`, EVENT_SOURCES, errors);
    validateEnum(value.status, `${name}.status`, EVENT_STATUSES, errors);
    if (!Array.isArray(value.evidence)) errors.push(`${name}.evidence must be an array`);
    if (!Array.isArray(value.correction_provenance)) errors.push(`${name}.correction_provenance must be an array`);
    else value.correction_provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `${name}.correction_provenance[${index}]`)));
    return errors;
  }
  
  function validateWinnerState(value) {
    const errors = outcomeErrors(value);
    return { valid: errors.length === 0, errors };
  }
  
  function createWinnerState(input = {}) {
    assertObject(input, 'WinnerState');
    const value = {
      label: input.label ?? 'unclassified',
      player_id: input.player_id ?? null,
      confidence: createConfidence(input.confidence),
      source: input.source ?? 'auto',
      status: input.status ?? 'unclassified',
      evidence: input.evidence === undefined ? [] : deepClone(input.evidence),
      correction_provenance: normalizeProvenanceList(input.correction_provenance),
    };
    const errors = outcomeErrors(value);
    if (errors.length) throw new SchemaValidationError('WinnerState', errors);
    return finishRecord(value);
  }
  
  function rallyErrors(value) {
    const errors = [];
    if (!isRecord(value)) return ['value must be an object'];
    if (typeof value.rally_id !== 'string' || value.rally_id.trim() === '') errors.push('rally_id must be a non-empty string');
    if (value.start_media_time !== null && (typeof value.start_media_time !== 'number' || !Number.isFinite(value.start_media_time) || value.start_media_time < 0)) {
      errors.push('start_media_time must be a non-negative finite number or null');
    }
    if (value.end_media_time !== null && (typeof value.end_media_time !== 'number' || !Number.isFinite(value.end_media_time) ||
        (value.start_media_time !== null && value.end_media_time < value.start_media_time))) {
      errors.push('end_media_time must be null or a finite number no earlier than start_media_time');
    }
    validateEnum(value.status, 'status', RALLY_STATUSES, errors);
    if (value.status === 'completed' && value.end_media_time === null) errors.push('completed rallies require end_media_time');
    if (!Array.isArray(value.stroke_event_ids) || value.stroke_event_ids.some((id) => typeof id !== 'string')) errors.push('stroke_event_ids must be an array of strings');
    if (new Set(value.stroke_event_ids || []).size !== (value.stroke_event_ids || []).length) errors.push('stroke_event_ids must not contain duplicates');
    if (!Number.isInteger(value.shot_count) || value.shot_count < 0) errors.push('shot_count must be a non-negative integer');
    if (!Array.isArray(value.coarse_shot_families)) errors.push('coarse_shot_families must be an array');
    else value.coarse_shot_families.forEach((family) => validateEnum(family, 'coarse_shot_families item', COARSE_SHOT_FAMILIES, errors));
    errors.push(...outcomeErrors(value.winner_state));
    if (value.winner !== null && (typeof value.winner !== 'string' || value.winner.trim() === '')) errors.push('winner must be a non-empty string or null');
    if (isRecord(value.winner_state) && value.winner !== value.winner_state.player_id) errors.push('winner must mirror winner_state.player_id');
    if (value.lose_reason !== null && !OUTCOME_LABELS.includes(value.lose_reason)) errors.push('lose_reason must be a valid outcome label or null');
    if (!isRecord(value.score_context)) errors.push('score_context must be an object');
    if (value.highlight_index !== null && (typeof value.highlight_index !== 'number' || !Number.isFinite(value.highlight_index) || value.highlight_index < 0 || value.highlight_index > 100)) {
      errors.push('highlight_index must be null or a number in [0, 100]');
    }
    errors.push(...confidenceErrors(value.aggregate_confidence, 'aggregate_confidence'));
    validateEnum(value.source, 'source', EVENT_SOURCES, errors);
    if (!Array.isArray(value.correction_provenance)) errors.push('correction_provenance must be an array');
    else value.correction_provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `correction_provenance[${index}]`)));
    if (value.evidence_state !== undefined) validateEnum(value.evidence_state, 'evidence_state', EVIDENCE_STATES, errors);
    if (value.partial_reasons !== undefined && (!Array.isArray(value.partial_reasons) || value.partial_reasons.some((reason) => typeof reason !== 'string'))) {
      errors.push('partial_reasons must be an array of strings');
    }
    if (value.termination !== undefined) validateEnum(value.termination, 'termination', RALLY_TERMINATIONS, errors);
    if (value.boundary_media_time !== undefined && value.boundary_media_time !== null &&
        (typeof value.boundary_media_time !== 'number' || !Number.isFinite(value.boundary_media_time) || value.boundary_media_time < 0)) {
      errors.push('boundary_media_time must be a non-negative finite number or null');
    }
    if (value.camera_cut_id !== undefined && value.camera_cut_id !== null && typeof value.camera_cut_id !== 'string') {
      errors.push('camera_cut_id must be a string or null');
    }
    if (value.line_calls !== undefined) {
      if (!Array.isArray(value.line_calls)) errors.push('line_calls must be an array of objects');
      else value.line_calls.forEach((call, index) => errors.push(...lineCallErrors(call).map((error) => `line_calls[${index}].${error}`)));
    }
    return errors;
  }
  
  function validateRallyRecord(value) {
    const errors = rallyErrors(value);
    return { valid: errors.length === 0, errors };
  }
  
  function createRallyRecord(input) {
    assertObject(input, 'RallyRecord');
    const value = {
      rally_id: input.rally_id,
      start_media_time: input.start_media_time ?? null,
      end_media_time: input.end_media_time ?? null,
      status: input.status ?? 'in_progress',
      stroke_event_ids: input.stroke_event_ids === undefined ? [] : [...input.stroke_event_ids],
      shot_count: input.shot_count ?? (input.stroke_event_ids ? input.stroke_event_ids.length : 0),
      coarse_shot_families: input.coarse_shot_families === undefined ? [] : [...new Set(input.coarse_shot_families)],
      winner_state: createWinnerState(input.winner_state ?? {}),
      winner: input.winner ?? (input.winner_state?.player_id ?? null),
      lose_reason: input.lose_reason ?? ((input.winner_state?.label === 'forced_error' || input.winner_state?.label === 'unforced_error') ? input.winner_state.label : null),
      score_context: normalizeScoreContext(input.score_context),
      highlight_index: input.highlight_index ?? null,
      aggregate_confidence: createConfidence(input.aggregate_confidence),
      source: input.source ?? 'auto',
      correction_provenance: normalizeProvenanceList(input.correction_provenance),
    };
    for (const field of RALLY_OPTIONAL_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
      value[field] = field === 'line_calls' && Array.isArray(input[field])
        ? input[field].map((call) => createLineCallState(call))
        : deepClone(input[field]);
    }
    const errors = rallyErrors(value);
    if (errors.length) throw new SchemaValidationError('RallyRecord', errors);
    return finishRecord(value);
  }
  
  function lineCallErrors(value) {
    const errors = [];
    if (!isRecord(value)) return ['value must be an object'];
    validateEnum(value.state, 'state', LINE_CALL_LABELS, errors);
    if (value.state !== 'unknown' && value.relevant_line_id !== null && value.relevant_line_id !== undefined && typeof value.relevant_line_id !== 'string') {
      errors.push('relevant_line_id must be a string or null');
    }
    if (value.landing_point !== null && value.landing_point !== undefined) {
      try {
        pointXY(value.landing_point, 'landing_point');
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (value.distance_to_line_m !== null && (typeof value.distance_to_line_m !== 'number' || !Number.isFinite(value.distance_to_line_m) || value.distance_to_line_m < 0)) {
      errors.push('distance_to_line_m must be null or a non-negative finite number');
    }
    if (value.timestamp_media_time !== null && (typeof value.timestamp_media_time !== 'number' || !Number.isFinite(value.timestamp_media_time) || value.timestamp_media_time < 0)) {
      errors.push('timestamp_media_time must be a non-negative finite number or null');
    }
    errors.push(...confidenceErrors(value.confidence, 'confidence'));
    validateEnum(value.source, 'source', EVENT_SOURCES, errors);
    validateEnum(value.status, 'status', EVENT_STATUSES, errors);
    if (!Array.isArray(value.evidence)) errors.push('evidence must be an array');
    if (!Array.isArray(value.correction_provenance)) errors.push('correction_provenance must be an array');
    else value.correction_provenance.forEach((item, index) => errors.push(...provenanceErrors(item, `correction_provenance[${index}]`)));
    return errors;
  }
  
  function validateLineCallState(value) {
    const errors = lineCallErrors(value);
    return { valid: errors.length === 0, errors };
  }
  
  function createLineCallState(input = {}) {
    assertObject(input, 'LineCallState');
    const value = {
      state: input.state ?? 'unknown',
      relevant_line_id: input.relevant_line_id ?? null,
      landing_point: input.landing_point === undefined || input.landing_point === null
        ? null
        : (() => {
          const point = pointXY(input.landing_point, 'landing_point');
          return createNormalizedPoint(point.x, point.y, { allowOutside: true });
        })(),
      distance_to_line_m: input.distance_to_line_m ?? null,
      timestamp_media_time: input.timestamp_media_time ?? null,
      confidence: createConfidence(input.confidence),
      source: input.source ?? 'unknown',
      status: input.status ?? (input.state === 'unknown' || input.state === undefined ? 'unknown' : 'suggested'),
      evidence: input.evidence === undefined ? [] : deepClone(input.evidence),
      correction_provenance: normalizeProvenanceList(input.correction_provenance),
    };
    const errors = lineCallErrors(value);
    if (errors.length) throw new SchemaValidationError('LineCallState', errors);
    return finishRecord(value);
  }
  
  function classifyOutcomeFromWinnerState(winnerState) {
    return winnerState && OUTCOME_LABELS.includes(winnerState.label) ? winnerState.label : 'unclassified';
  }
  
  function normalizeFeatureNumber(value, name, { min = 0, max = Infinity } = {}) {
    if (value === undefined || value === null) return null;
    assertFiniteNumber(value, name, { min, max });
    return value;
  }
  
  function createCoarseShotFeatures(input = {}) {
    assertObject(input, 'CoarseShotFeatures');
    let flightDistance = input.flight_distance_m;
    let landingDepth = input.landing_depth_m;
    if ((flightDistance === undefined || landingDepth === undefined) && input.impact_point && input.landing_point) {
      const impact = normalizeCourtPoint(input.impact_point, { allowOutside: true });
      const landing = normalizeCourtPoint(input.landing_point, { allowOutside: true });
      flightDistance = Math.hypot(
        (landing.x - impact.x) * COURT_WIDTH_M,
        (landing.y - impact.y) * COURT_LENGTH_M,
      );
      // Depth is measured from the net on the receiver's half, independent of
      // which half is represented by y <= 0.5 or y >= 0.5.
      landingDepth = (landing.y <= 0.5 ? 0.5 - landing.y : landing.y - 0.5) * COURT_LENGTH_M;
    }
    const value = {
      flight_distance_m: normalizeFeatureNumber(flightDistance, 'flight_distance_m'),
      landing_depth_m: normalizeFeatureNumber(landingDepth, 'landing_depth_m', { max: COURT_LENGTH_M / 2 }),
      apex_height_m: normalizeFeatureNumber(input.apex_height_m, 'apex_height_m'),
      impact_height_m: normalizeFeatureNumber(input.impact_height_m, 'impact_height_m'),
      downward_speed_mps: normalizeFeatureNumber(input.downward_speed_mps, 'downward_speed_mps'),
      flight_time_s: normalizeFeatureNumber(input.flight_time_s, 'flight_time_s'),
    };
    value.missing = Object.keys(value).filter((key) => key !== 'missing' && value[key] === null);
    return finishRecord(value);
  }
  
  const COARSE_RULE_THRESHOLDS = finishRecord({
    net: { max_landing_depth_m: 1.5, max_flight_distance_m: 3.5 },
    smash: { min_impact_height_m: 1.5, min_downward_speed_mps: 5, min_flight_distance_m: 2 },
    clear: { min_landing_depth_m: 4.8, min_apex_height_m: 2 },
    drop: { min_landing_depth_m: 1.5, max_landing_depth_m: 4.8, max_apex_height_m: 2.5 },
  });
  
  /**
   * Classify only from supplied coarse features. This is a rule seam, not a
   * detector or model: insufficient features intentionally produce unknown.
   */
  function classifyCoarseShot(input) {
    const features = input && input.missing ? input : createCoarseShotFeatures(input);
    const net = COARSE_RULE_THRESHOLDS.net;
    if (
      features.landing_depth_m !== null && features.flight_distance_m !== null &&
      features.landing_depth_m <= net.max_landing_depth_m && features.flight_distance_m <= net.max_flight_distance_m
    ) {
      return finishRecord({
        shot_family: 'net',
        status: 'classified',
        confidence: createConfidence(0.75),
        rule: 'net: landing depth <= 1.5m and flight distance <= 3.5m',
        features_used: ['landing_depth_m', 'flight_distance_m'],
        explanation: 'Near-net landing and short travel matched the net rule.',
      });
    }
    const smash = COARSE_RULE_THRESHOLDS.smash;
    if (
      features.impact_height_m !== null && features.downward_speed_mps !== null && features.flight_distance_m !== null &&
      features.impact_height_m >= smash.min_impact_height_m &&
      features.downward_speed_mps >= smash.min_downward_speed_mps &&
      features.flight_distance_m >= smash.min_flight_distance_m
    ) {
      return finishRecord({
        shot_family: 'smash',
        status: 'classified',
        confidence: createConfidence(0.8),
        rule: 'smash: impact height >= 1.5m, downward speed >= 5m/s, flight distance >= 2m',
        features_used: ['impact_height_m', 'downward_speed_mps', 'flight_distance_m'],
        explanation: 'High impact, fast downward travel, and sufficient travel matched the smash rule.',
      });
    }
    const clear = COARSE_RULE_THRESHOLDS.clear;
    if (
      features.landing_depth_m !== null && features.apex_height_m !== null &&
      features.landing_depth_m >= clear.min_landing_depth_m && features.apex_height_m >= clear.min_apex_height_m
    ) {
      return finishRecord({
        shot_family: 'clear',
        status: 'classified',
        confidence: createConfidence(0.75),
        rule: 'clear: landing depth >= 4.8m and apex height >= 2m',
        features_used: ['landing_depth_m', 'apex_height_m'],
        explanation: 'Deep landing and high trajectory matched the clear rule.',
      });
    }
    const drop = COARSE_RULE_THRESHOLDS.drop;
    if (
      features.landing_depth_m !== null && features.apex_height_m !== null &&
      features.landing_depth_m > drop.min_landing_depth_m && features.landing_depth_m < drop.max_landing_depth_m &&
      features.apex_height_m <= drop.max_apex_height_m
    ) {
      return finishRecord({
        shot_family: 'drop',
        status: 'classified',
        confidence: createConfidence(0.65),
        rule: 'drop: landing depth in (1.5m, 4.8m) and apex height <= 2.5m',
        features_used: ['landing_depth_m', 'apex_height_m'],
        explanation: 'Intermediate landing depth and low trajectory matched the drop rule.',
      });
    }
    const missing = ['landing_depth_m', 'flight_distance_m', 'apex_height_m', 'impact_height_m', 'downward_speed_mps']
      .filter((field) => features[field] === null);
    return finishRecord({
      shot_family: SHOT_FAMILY_UNKNOWN,
      status: 'unclassified',
      confidence: createConfidence(null, { reason: missing.length ? 'insufficient-features' : 'no-rule-match' }),
      rule: null,
      features_used: Object.keys(features).filter((field) => field !== 'missing' && features[field] !== null),
      explanation: missing.length ? `Unclassified because required features are missing: ${missing.join(', ')}.` : 'No coarse rule matched.',
    });
  }
  
  function canonicalOutcomeLabel(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[ -]+/g, '_');
    if (normalized === 'forcederror') return 'forced_error';
    if (normalized === 'unforcederror') return 'unforced_error';
    return OUTCOME_LABELS.includes(normalized) ? normalized : null;
  }
  
  function canonicalEvidenceStatus(value, fallback = 'unknown') {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase().replace(/[ -]+/g, '_');
    if (normalized === 'unknown' || normalized === 'unclassified') return 'unknown';
    if (['accepted', 'suggested', 'corrected', 'partial'].includes(normalized)) return normalized;
    return fallback;
  }
  
  function canonicalEventStatus(value, fallback = 'unknown') {
    const status = canonicalEvidenceStatus(value, fallback);
    return status === 'unknown' ? (value === 'unclassified' ? 'unclassified' : 'unknown') : status;
  }
  
  function mediaTimeOf(value) {
    if (!isRecord(value)) return null;
    const candidate = value.hit_media_time ?? value.media_time ?? value.timestamp_media_time ?? value.start_media_time ?? value.end_media_time ?? value.timestamp ?? value.time;
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
  }
  
  function stableIdentifier(value) {
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  }
  
  function explicitPlayerId(value) {
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (!isRecord(value)) return null;
    const candidate = value.player_id ?? value.id;
    return stableIdentifier(candidate);
  }
  
  function coarseFamilyFromValue(value) {
    if (typeof value !== 'string') return SHOT_FAMILY_UNKNOWN;
    const normalized = value.trim().toLowerCase().replace(/[ _-]+/g, '');
    if (normalized === 'clear') return 'clear';
    if (normalized === 'drop') return 'drop';
    if (normalized === 'smash' || normalized === 'halfsmash') return 'smash';
    if (normalized === 'net' || normalized === 'netshot' || normalized === 'netkill') return 'net';
    return SHOT_FAMILY_UNKNOWN;
  }
  
  function evidenceStatusForChannel(channel) {
    if (!isRecord(channel)) return 'unknown';
    return canonicalEvidenceStatus(channel.status ?? channel.state, 'unknown');
  }
  
  function knownPlayerId(value) {
    const playerId = explicitPlayerId(value);
    return playerId && playerId.toLowerCase() !== 'unknown' ? playerId : null;
  }
  
  function normalizeOutcomeEvidence(input = {}) {
    if (!isRecord(input)) return null;
    const candidate = input.winner_state ?? input.outcome_state ?? input.outcome_evidence;
    if (!isRecord(candidate)) return null;
    const label = canonicalOutcomeLabel(candidate.label ?? candidate.outcome);
    if (!label) return null;
    return candidate;
  }
  
  function normalizeLineCallEvidence(input, fallbackTime = null, fallbackStatus = 'unknown') {
    if (input === undefined || input === null) return createLineCallState({ timestamp_media_time: fallbackTime });
    const raw = typeof input === 'string' ? { state: input } : (isRecord(input) ? input : {});
    const landingPoint = raw.landing_point ?? raw.point ?? (
      Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: raw.x, y: raw.y } : null
    );
    const state = String(raw.state ?? raw.call ?? raw.line_call ?? 'unknown').toLowerCase();
    const allowedState = LINE_CALL_LABELS.includes(state) ? state : 'unknown';
    return createLineCallState({
      state: allowedState,
      relevant_line_id: raw.relevant_line_id ?? raw.line_id ?? null,
      landing_point: landingPoint,
      distance_to_line_m: raw.distance_to_line_m ?? raw.distance_m ?? null,
      timestamp_media_time: raw.timestamp_media_time ?? raw.media_time ?? fallbackTime,
      confidence: raw.confidence,
      source: raw.source ?? 'unknown',
      status: raw.status ?? (EVIDENCE_STATES.includes(state) ? state : (allowedState === 'unknown' ? fallbackStatus : 'suggested')),
      evidence: raw.evidence === undefined ? [deepClone(input)] : deepClone(raw.evidence),
      correction_provenance: raw.correction_provenance,
    });
  }
  
  function eventConfidence(event) {
    if (!event) return null;
    return event.tracking_confidence || event.geometry_confidence || event.classification_confidence || null;
  }
  
  function attributionInputEvents(input) {
    const values = input?.events ?? input?.stroke_events ?? input?.strokeEvents ?? [];
    if (!Array.isArray(values)) return [];
    return values.map((event) => createStrokeEvent(event));
  }
  
  function acceptedEvidenceStatus(status) {
    return status === 'accepted' || status === 'corrected';
  }
  
  /**
   * Attribute only what the supplied terminal evidence can establish. In
   * particular, an OUT call identifies a losing hitter, but does not by itself
   * establish forced versus unforced error. A suggested/partial/unknown call is
   * never promoted to an official-looking outcome.
   */
  function attributeRallyOutcome(input = {}) {
    assertObject(input, 'RallyOutcomeInput');
    const events = attributionInputEvents(input)
      .filter((event) => acceptedEvidenceStatus(event.status))
      .sort((left, right) => (left.hit_media_time ?? Infinity) - (right.hit_media_time ?? Infinity) ||
        (left.sequence ?? Infinity) - (right.sequence ?? Infinity) || left.event_id.localeCompare(right.event_id));
    const finalEvent = input.final_event ? createStrokeEvent(input.final_event) : events[events.length - 1] || null;
    const finalEventIsAccepted = Boolean(finalEvent && acceptedEvidenceStatus(finalEvent.status));
    const rawLanding = input.landing_call ?? input.line_call ?? input.landing ?? input.final_landing ??
      finalEvent?.landing_evidence ?? null;
    let landing;
    try {
      landing = normalizeLineCallEvidence(rawLanding, mediaTimeOf(finalEvent), input.landing_status ?? input.status ?? finalEvent?.status ?? 'unknown');
    } catch (error) {
      landing = createLineCallState({ timestamp_media_time: mediaTimeOf(finalEvent), evidence: [{ kind: 'invalid-landing-evidence', message: error.message }] });
    }
    const termination = isRecord(input.termination) ? input.termination : { outcome: input.termination };
    const explicit = normalizeOutcomeEvidence(input) || termination;
    const explicitLabel = canonicalOutcomeLabel(
      input.outcome ?? input.label ?? explicit?.label ?? explicit?.outcome ?? explicit?.lose_reason,
    );
    const explicitWinner = knownPlayerId(
      input.winner_player_id ?? input.winner_id ?? explicit?.winner_player_id ?? explicit?.player_id,
    );
    const explicitUnknown = explicitLabel === 'unclassified' && (
      Object.prototype.hasOwnProperty.call(input, 'outcome') ||
      Object.prototype.hasOwnProperty.call(input, 'label') ||
      Object.prototype.hasOwnProperty.call(input, 'winner_state') ||
      Object.prototype.hasOwnProperty.call(input, 'outcome_state') ||
      Object.prototype.hasOwnProperty.call(input, 'outcome_evidence') ||
      (isRecord(input.termination) && Object.prototype.hasOwnProperty.call(input.termination, 'outcome'))
    );
    const finalPlayer = knownPlayerId(finalEvent?.player_id ?? input.final_player_id);
    const participants = [...new Set([
      ...events.map((event) => knownPlayerId(event.player_id)).filter(Boolean),
      ...((Array.isArray(input.players) ? input.players : []).map(knownPlayerId).filter(Boolean)),
      knownPlayerId(input.opponent_player_id),
      finalPlayer,
    ].filter(Boolean))];
    const landingAuthoritative = acceptedEvidenceStatus(landing.status) && (landing.state === 'in' || landing.state === 'out');
    const explicitSource = explicit?.source ?? input.source ?? 'unknown';
    const explicitStatus = canonicalEventStatus(explicit?.status ?? input.status,
      explicitSource === 'manual' || explicitSource === 'corrected' ? 'accepted' : 'unknown');
    const explicitIsTrusted = !['partial', 'unknown', 'unclassified'].includes(explicitStatus) &&
      (explicitSource === 'manual' || explicitSource === 'corrected' || acceptedEvidenceStatus(explicitStatus));
    const landingEvidenceError = Array.isArray(rawLanding?.evidence)
      ? rawLanding.evidence.map((entry) => (isRecord(entry) ? entry.error_type : null)).find(Boolean)
      : null;
    const errorType = canonicalOutcomeLabel(input.error_type ?? input.error ?? termination.error_type ?? rawLanding?.error_type ?? landingEvidenceError ?? finalEvent?.landing_evidence?.error_type) ??
      (explicitLabel === 'forced_error' || explicitLabel === 'unforced_error' ? explicitLabel : null);
    const rallyEnded = input.completed === true || input.rally_ended === true ||
      input.type === 'rally_end' || input.event_type === 'rally_end' || input.termination === 'rally_end' ||
      (isRecord(termination) && (termination.type === 'rally_end' || termination.kind === 'rally_end'));
    const evidence = [];
    if (finalEvent) evidence.push({ kind: 'final-stroke', event_id: finalEvent.event_id, player_id: finalEvent.player_id, status: finalEvent.status });
    evidence.push({ kind: 'landing', state: landing.state, status: landing.status, relevant_line_id: landing.relevant_line_id });
    if (landing.correction_provenance.length) evidence.push({ kind: 'landing-correction-provenance', provenance: deepClone(landing.correction_provenance) });
    if (isRecord(input.termination) || input.termination !== undefined) evidence.push({ kind: 'termination', value: deepClone(input.termination) });
    if (Array.isArray(explicit?.evidence)) evidence.push(...deepClone(explicit.evidence));
    if (Array.isArray(input.evidence)) evidence.push(...deepClone(input.evidence));
  
    let label = 'unclassified';
    let winnerPlayer = null;
    let reason = 'outcome-uncertain';
    let confidence = input.confidence;
    let source = explicitSource;
    let status = explicitStatus;
  
    // An explicitly accepted/manual outcome is evidence in its own right. It is
    // still required to identify the winning player; null is never a placeholder.
    const explicitCanClassify = explicitLabel && explicitWinner && explicitIsTrusted &&
      (landingAuthoritative || explicitSource === 'manual' || explicitSource === 'corrected');
    if (explicitCanClassify) {
      label = explicitLabel;
      winnerPlayer = explicitWinner;
      reason = 'explicit-terminal-outcome';
    } else if (!explicitUnknown && landingAuthoritative && landing.state === 'out' && finalPlayer && finalEventIsAccepted) {
      // An OUT call establishes the opponent as winner only when the opponent is
      // unambiguous. The error class remains unknown unless explicitly supplied.
      const opponents = participants.filter((playerId) => playerId !== finalPlayer);
      if (opponents.length === 1) {
        winnerPlayer = opponents[0];
        label = errorType === 'forced_error' || errorType === 'unforced_error' ? errorType : 'unclassified';
        reason = label === 'unclassified' ? 'out-landing-without-error-class' : 'out-landing-and-explicit-error-class';
      } else {
        reason = 'out-landing-opponent-ambiguous';
      }
    } else if (!explicitUnknown && landingAuthoritative && landing.state === 'in' && finalPlayer && finalEventIsAccepted && rallyEnded) {
      label = 'winner';
      winnerPlayer = finalPlayer;
      reason = 'in-landing-and-rally-end';
    } else if (explicitLabel && !explicitIsTrusted) {
      reason = 'terminal-outcome-not-accepted';
    } else if (!landingAuthoritative) {
      reason = 'final-landing-unknown';
    } else if (!finalEventIsAccepted) {
      reason = 'final-stroke-not-accepted';
    } else if (!finalPlayer) {
      reason = 'final-player-unknown';
    }
  
    // WinnerState intentionally cannot carry a player for an unclassified label;
    // retain the losing/final evidence above instead of making a partial winner.
    if (label === 'unclassified') winnerPlayer = null;
    const knownConfidences = [landing.confidence, eventConfidence(finalEvent)].filter((value) => value && value.status === 'known');
    if (confidence === undefined && knownConfidences.length === 2) confidence = Math.min(...knownConfidences.map((value) => value.value));
    if (!source || !EVENT_SOURCES.includes(source)) source = 'unknown';
    if (label === 'unclassified' && !explicitLabel) status = 'unclassified';
    if (label !== 'unclassified' && (status === 'unknown' || status === 'unclassified')) status = 'suggested';
    if (!EVENT_STATUSES.includes(status)) status = label === 'unclassified' ? 'unclassified' : 'suggested';
    const winnerState = createWinnerState({
      label,
      player_id: winnerPlayer,
      confidence,
      source,
      status,
      evidence: [...evidence, { kind: 'attribution', reason, supported: label !== 'unclassified' }],
      correction_provenance: input.correction_provenance ?? explicit?.correction_provenance,
    });
    return finishRecord({
      winner_state: winnerState,
      winner: winnerState.player_id,
      lose_reason: label === 'forced_error' || label === 'unforced_error' ? label : null,
      landing,
      final_event: finalEvent,
      reason,
      evidence: winnerState.evidence,
    });
  }
  
  function normalizeStateMachineEvent(input, rallyId, sequence) {
    assertObject(input, 'Rally event');
    const playerEvidence = input.player_evidence ?? input.player ?? null;
    const shotEvidence = input.shot_evidence ?? input.shot ?? null;
    const shuttleEvidence = input.shuttle_evidence ?? input.shuttle ?? null;
    const landingEvidence = input.landing_evidence ?? input.landing ?? input.line_call ?? null;
    const channelStatuses = [playerEvidence, shuttleEvidence, shotEvidence, landingEvidence].map(evidenceStatusForChannel);
    const hasChannelEvidence = channelStatuses.some((status) => status !== 'unknown') ||
      playerEvidence !== null || shuttleEvidence !== null || shotEvidence !== null || landingEvidence !== null ||
      Object.prototype.hasOwnProperty.call(input, 'player_id') || Object.prototype.hasOwnProperty.call(input, 'shot_family');
    const derivedStatus = channelStatuses.includes('partial') ? 'partial' :
      channelStatuses.includes('corrected') ? 'corrected' :
        channelStatuses.includes('suggested') ? 'suggested' :
          channelStatuses.includes('accepted') ? 'accepted' : (hasChannelEvidence ? 'suggested' : 'unknown');
    const rawShot = isRecord(shotEvidence) ? (shotEvidence.family ?? shotEvidence.shot_family ?? shotEvidence.label) : shotEvidence;
    const shotFamily = input.shot_family === undefined ? coarseFamilyFromValue(rawShot) : coarseFamilyFromValue(input.shot_family);
    const label = input.label ?? (isRecord(shotEvidence) ? shotEvidence.label : (typeof shotEvidence === 'string' && !COARSE_SHOT_FAMILIES.includes(coarseFamilyFromValue(shotEvidence)) ? shotEvidence : null));
    const explicitPlayer = stableIdentifier(input.player_id);
    const playerId = Object.prototype.hasOwnProperty.call(input, 'player_id')
      ? (explicitPlayer && explicitPlayer.toLowerCase() !== 'unknown' ? explicitPlayer : null)
      : knownPlayerId(playerEvidence);
    const eventInput = {
      ...deepClone(input),
      event_id: stableIdentifier(input.event_id ?? input.observation_id) ?? `${rallyId}:event:${sequence + 1}`,
      rally_id: stableIdentifier(rallyId) ?? rallyId,
      sequence: input.sequence ?? sequence,
      player_id: playerId,
      shot_family: COARSE_SHOT_FAMILIES.includes(shotFamily) ? shotFamily : SHOT_FAMILY_UNKNOWN,
      label: label && MANUAL_SHOT_LABELS.includes(label) ? label : null,
      hit_media_time: input.hit_media_time ?? input.media_time ?? input.timestamp_media_time ?? null,
      source: input.source ?? 'unknown',
      status: input.status === undefined ? derivedStatus : canonicalEventStatus(input.status),
      classification_confidence: input.classification_confidence ?? (isRecord(shotEvidence) ? shotEvidence.confidence : null),
      geometry_confidence: input.geometry_confidence ?? (isRecord(landingEvidence) ? landingEvidence.confidence : null),
      tracking_confidence: input.tracking_confidence ?? (isRecord(playerEvidence) ? playerEvidence.confidence : null),
      evidence: input.evidence === undefined ? [] : input.evidence,
      player_evidence: playerEvidence,
      shuttle_evidence: shuttleEvidence,
      shot_evidence: shotEvidence,
      landing_evidence: landingEvidence,
    };
    return createStrokeEvent(eventInput);
  }
  
  function orderEvents(events) {
    return [...events].sort((left, right) => (left.hit_media_time === null ? Infinity : left.hit_media_time) -
      (right.hit_media_time === null ? Infinity : right.hit_media_time) ||
      (left.sequence === null ? Infinity : left.sequence) - (right.sequence === null ? Infinity : right.sequence) ||
      left.event_id.localeCompare(right.event_id));
  }
  
  function aggregateRallyConfidence(events) {
    const considered = events.filter((event) => acceptedEvidenceStatus(event.status));
    if (!considered.length) return createConfidence(null, { reason: 'no-accepted-stroke-evidence' });
    const values = considered.map(eventConfidence);
    if (values.some((value) => !value || value.status !== 'known')) return createConfidence(null, { reason: 'partial-stroke-confidence' });
    return createConfidence(stableNumber(values.reduce((sum, value) => sum + value.value, 0) / values.length));
  }
  
  function stateMachinePartialReasons(context, events, outcome, status) {
    const reasons = [];
    if (context.start_media_time === null) reasons.push('rally-start-time-unknown');
    if (status !== 'completed') reasons.push(context.termination === 'camera_cut' ? 'camera-cut' : 'rally-end-unknown');
    if (events.some((event) => event.player_id === null)) reasons.push('player-identity-unknown');
    if (events.some((event) => event.shot_family === SHOT_FAMILY_UNKNOWN || event.status === 'partial' || event.status === 'unknown' || event.status === 'unclassified')) reasons.push('partial-or-unknown-shot-evidence');
    if (events.some((event) => !acceptedEvidenceStatus(event.status))) reasons.push('unaccepted-stroke-evidence');
    const acceptedEvents = events.filter((event) => acceptedEvidenceStatus(event.status));
    if (!acceptedEvents.length) reasons.push('no-accepted-stroke-evidence');
    if (acceptedEvents.some((event) => {
      const confidence = eventConfidence(event);
      return !confidence || confidence.status !== 'known';
    })) reasons.push('partial-or-unknown-confidence');
    if (outcome.winner_state.label === 'unclassified') reasons.push(outcome.reason);
    return [...new Set(reasons)];
  }
  
  function createRallyStateMachine(options = {}) {
    assertObject(options, 'RallyStateMachineOptions');
    let rallyCounter = 0;
    let eventCounter = 0;
    let segmentCounter = 0;
    let active = null;
    let finalized = false;
    const contexts = [];
    const eventRecords = new Map();
    const duplicates = [];
    const cameraCuts = [];
    const unassignedEvidence = [];
  
    function nextRallyId(prefix = options.rally_id_prefix ?? 'rally') {
      rallyCounter += 1;
      return `${prefix}-${rallyCounter}`;
    }
  
    function uniqueRallyId(candidate) {
      const normalized = stableIdentifier(candidate);
      if (!normalized || !contexts.some((context) => context.rally_id === normalized)) return normalized || nextRallyId();
      segmentCounter += 1;
      return `${normalized}-segment-${segmentCounter}`;
    }
  
    function newContext(input = {}, forcedId = null) {
      const requestedId = stableIdentifier(forcedId || input.rally_id || input.id);
      const id = uniqueRallyId(requestedId);
      const start = mediaTimeOf(input);
      const context = {
        rally_id: id,
        source_rally_id: requestedId,
        start_media_time: start,
        end_media_time: null,
        status: 'in_progress',
        termination: 'unknown',
        boundary_media_time: null,
        camera_cut_id: null,
        event_ids: [],
        line_calls: [],
        evidence: [],
        score_context: input.score_context,
        outcome_input: null,
      };
      contexts.push(context);
      return context;
    }
  
    function eventForId(eventId) {
      return eventRecords.get(eventId) || null;
    }
  
    function currentEvents(context) {
      return orderEvents(context.event_ids.map(eventForId).filter(Boolean));
    }
  
    function ensureActive(input = {}, rallyId = null) {
      if (!active) active = newContext(input, rallyId);
      if (rallyId && active.rally_id !== rallyId && active.source_rally_id !== rallyId) {
        closeContext(active, { status: 'incomplete', termination: 'implicit', boundary_media_time: mediaTimeOf(input) });
        active = newContext(input, rallyId);
      }
      if (active.start_media_time === null && mediaTimeOf(input) !== null) active.start_media_time = mediaTimeOf(input);
      return active;
    }
  
    function addEvent(input) {
      const requestedRallyId = stableIdentifier(input.rally_id ?? input.rallyId);
      const playerEvidence = input.player_evidence ?? input.player ?? null;
      const shotEvidence = input.shot_evidence ?? input.shot ?? null;
      const requestedEventId = input.event_id ?? input.observation_id ?? null;
      const existingRequested = requestedEventId ? eventForId(requestedEventId) : null;
      const existingContext = existingRequested
        ? contexts.find((context) => context.event_ids.includes(existingRequested.event_id))
        : null;
      const context = existingContext || ensureActive(input, requestedRallyId);
      eventCounter += 1;
      const event = normalizeStateMachineEvent(input, context.rally_id, eventCounter - 1);
      const existing = eventForId(event.event_id);
      if (existing) {
        if (event.status === 'corrected' || event.source === 'corrected') {
          let replacement = event;
          const completeCorrection = ['rally_id', 'sequence', 'player_id', 'shot_family', 'hit_media_time',
            'classification_confidence', 'geometry_confidence', 'status'].every((field) => Object.prototype.hasOwnProperty.call(input, field));
          if (event.correction_provenance.length && completeCorrection) {
            const provenance = [...existing.correction_provenance];
            for (const entry of event.correction_provenance) {
              if (!provenance.some((candidate) => JSON.stringify(candidate) === JSON.stringify(entry))) provenance.push(entry);
            }
            replacement = createStrokeEvent({ ...event, correction_provenance: provenance });
          } else {
            const patch = {};
            for (const field of STROKE_EVENT_FIELDS) {
              if (['event_id', 'rally_id', 'source', 'status', 'correction_provenance'].includes(field)) continue;
              if (Object.prototype.hasOwnProperty.call(input, field)) patch[field] = event[field];
            }
            if (Object.prototype.hasOwnProperty.call(input, 'player_id') || playerEvidence !== null) patch.player_id = event.player_id;
            if (Object.prototype.hasOwnProperty.call(input, 'shot_family') || shotEvidence !== null) patch.shot_family = event.shot_family;
            if (Object.prototype.hasOwnProperty.call(input, 'hit_media_time') || Object.prototype.hasOwnProperty.call(input, 'media_time')) patch.hit_media_time = event.hit_media_time;
            if (Object.prototype.hasOwnProperty.call(input, 'landing_evidence') || Object.prototype.hasOwnProperty.call(input, 'landing')) patch.landing_evidence = event.landing_evidence;
            replacement = correctStrokeEvent(existing, patch, {
              reason: input.correction_reason ?? event.correction_provenance.at(-1)?.reason ?? 'rally event correction',
              corrected_at_media_time: mediaTimeOf(input) ?? event.correction_provenance.at(-1)?.corrected_at_media_time ?? null,
            });
            if (event.correction_provenance.length) {
              const provenance = [...replacement.correction_provenance];
              for (const entry of event.correction_provenance) {
                if (!provenance.some((candidate) => JSON.stringify(candidate) === JSON.stringify(entry))) provenance.push(entry);
              }
              replacement = createStrokeEvent({ ...replacement, correction_provenance: provenance });
            }
          }
          eventRecords.set(event.event_id, replacement);
          return replacement;
        }
        duplicates.push({ event_id: event.event_id, rally_id: context.rally_id, reason: 'duplicate-event-ignored' });
        return existing;
      }
      eventRecords.set(event.event_id, event);
      context.event_ids.push(event.event_id);
      context.evidence.push(...(Array.isArray(event.evidence) ? deepClone(event.evidence) : [deepClone(event.evidence)]));
      if (context.start_media_time === null && event.hit_media_time !== null) context.start_media_time = event.hit_media_time;
      if (event.landing_evidence) addLanding(event.landing_evidence, event.hit_media_time, context, event.status);
      return event;
    }
  
    function addLanding(input, fallbackTime = null, context = active, fallbackStatus = 'unknown') {
      if (!context) {
        unassignedEvidence.push(deepClone(input));
        return null;
      }
      let call;
      try {
        call = normalizeLineCallEvidence(input, fallbackTime, fallbackStatus);
      } catch (error) {
        call = createLineCallState({ timestamp_media_time: fallbackTime, evidence: [{ kind: 'invalid-landing-evidence', message: error.message }, deepClone(input)] });
      }
      context.line_calls.push(call);
      context.evidence.push(...(Array.isArray(call.evidence) ? deepClone(call.evidence) : [deepClone(call.evidence)]));
      return call;
    }
  
    function startRally(input = {}) {
      if (active) {
        const requestedId = stableIdentifier(input.rally_id ?? input.id);
        const same = requestedId && requestedId === active.rally_id;
        if (same && mediaTimeOf(input) === active.start_media_time) return active;
        closeContext(active, { status: 'incomplete', termination: 'implicit', boundary_media_time: mediaTimeOf(input) });
      }
      active = newContext(input);
      active.score_context = input.score_context;
      active.evidence.push(...(Array.isArray(input.evidence) ? deepClone(input.evidence) : []));
      return active;
    }
  
    function endRally(input = {}) {
      const context = ensureActive(input, stableIdentifier(input.rally_id ?? input.rallyId));
      context.end_media_time = mediaTimeOf(input);
      context.score_context = input.score_context ?? context.score_context;
      context.outcome_input = deepClone(input);
      context.termination = 'rally_end';
      context.evidence.push(...(Array.isArray(input.evidence) ? deepClone(input.evidence) : []));
      context.status = context.end_media_time === null ? 'incomplete' : 'completed';
      active = null;
      return context;
    }
  
    function cameraCut(input = {}) {
      const time = mediaTimeOf(input);
      cameraCuts.push(finishRecord({
        camera_cut_id: input.camera_cut_id ?? input.cut_id ?? `camera-cut-${cameraCuts.length + 1}`,
        media_time: time,
        evidence: input.evidence === undefined ? [] : deepClone(input.evidence),
      }));
      if (active) {
        active.termination = 'camera_cut';
        active.status = 'incomplete';
        active.boundary_media_time = time;
        active.camera_cut_id = cameraCuts[cameraCuts.length - 1].camera_cut_id;
        active.evidence.push({ kind: 'camera-cut', camera_cut_id: active.camera_cut_id, media_time: time });
        active = null;
      }
      return cameraCuts[cameraCuts.length - 1];
    }
  
    function closeContext(context, patch = {}) {
      if (!context) return;
      context.status = patch.status ?? context.status;
      context.termination = patch.termination ?? context.termination;
      if (patch.boundary_media_time !== undefined) context.boundary_media_time = patch.boundary_media_time;
      if (patch.end_media_time !== undefined) context.end_media_time = patch.end_media_time;
      if (context.status === 'completed' && context.end_media_time === null) context.status = 'incomplete';
      if (active === context) active = null;
    }
  
    function recordForContext(context) {
      const events = currentEvents(context);
      const calls = [...context.line_calls].sort((left, right) => (left.timestamp_media_time ?? Infinity) - (right.timestamp_media_time ?? Infinity));
      const attributed = attributeRallyOutcome({
        events,
        landing_call: calls[calls.length - 1] ?? null,
        ...(context.outcome_input || {}),
        events,
      });
      const acceptedFamilies = [...new Set(events.filter((event) => acceptedEvidenceStatus(event.status)).map((event) => event.shot_family).filter((family) => COARSE_SHOT_FAMILIES.includes(family)))];
      const partialReasons = stateMachinePartialReasons(context, events, attributed, context.status);
      const evidenceState = context.status !== 'completed' || partialReasons.length ? 'partial' : 'accepted';
      return createRallyRecord({
        rally_id: context.rally_id,
        start_media_time: context.start_media_time,
        end_media_time: context.end_media_time,
        status: context.status,
        stroke_event_ids: events.map((event) => event.event_id),
        shot_count: events.length,
        coarse_shot_families: acceptedFamilies,
        winner_state: attributed.winner_state,
        winner: attributed.winner,
        lose_reason: attributed.lose_reason,
        score_context: context.score_context,
        aggregate_confidence: aggregateRallyConfidence(events),
        source: 'auto',
        evidence_state: evidenceState,
        partial_reasons: partialReasons,
        termination: context.termination,
        boundary_media_time: context.boundary_media_time,
        camera_cut_id: context.camera_cut_id,
        line_calls: calls,
        evidence: context.evidence,
      });
    }
  
    function snapshot() {
      const allContexts = contexts.map(recordForContext);
      return finishRecord({
        state: active ? 'in_progress' : (finalized ? 'finalized' : 'ready'),
        active_rally_id: active?.rally_id ?? null,
        rallies: allContexts,
        stroke_events: orderEvents([...eventRecords.values()]),
        events: orderEvents([...eventRecords.values()]),
        duplicates: deepClone(duplicates),
        camera_cuts: deepClone(cameraCuts),
        unassigned_evidence: deepClone(unassignedEvidence),
      });
    }
  
    function ingest(input) {
      if (finalized) throw new AnalysisError('rally state machine is finalized', 'state-machine-finalized');
      if (Array.isArray(input)) {
        for (const item of input) ingest(item);
        return snapshot();
      }
      assertObject(input, 'Rally observation');
      const type = String(input.type ?? input.event_type ?? input.kind ?? (input.event_id || input.observation_id ? 'shot' : '')).toLowerCase().replace(/[- ]/g, '_');
      if (['camera_cut', 'cut', 'camera_change'].includes(type)) cameraCut(input);
      else if (['rally_start', 'start', 'rallystart'].includes(type)) startRally(input);
      else if (['rally_end', 'end', 'rallyend'].includes(type)) endRally(input);
      else if (['landing', 'line_call', 'linecall'].includes(type)) addLanding(input.line_call ?? input.landing ?? input, mediaTimeOf(input));
      else addEvent(input);
      return snapshot();
    }
  
    function finalize() {
      if (!finalized) {
        if (active) {
          active.status = 'incomplete';
          active.termination = active.termination === 'unknown' ? 'unknown' : active.termination;
          active = null;
        }
        finalized = true;
      }
      return snapshot();
    }
  
    return Object.freeze({
      ingest,
      consume: ingest,
      push: ingest,
      process: ingest,
      processRallyEvent: ingest,
      addEvent: ingest,
      addShot(input) { return ingest({ type: 'shot', ...input }); },
      addLanding(input) { return ingest({ type: 'landing', ...input }); },
      startRally(input) { startRally(input); return snapshot(); },
      endRally(input) { endRally(input); return snapshot(); },
      closeRally(input) { endRally(input); return snapshot(); },
      cameraCut(input) { const cut = cameraCut(input); return finishRecord({ ...cut }); },
      finalize,
      snapshot,
      getState: snapshot,
    });
  }
  
  function analyzeRallyEvents(observations, options = {}) {
    const machine = createRallyStateMachine(options);
    const batch = Array.isArray(observations)
      ? observations
      : (observations?.observations ?? observations?.events ?? observations?.stroke_events ?? observations);
    machine.ingest(batch || []);
    return machine.finalize();
  }
  
  const analyzeRally = analyzeRallyEvents;
  const analyzeRallies = analyzeRallyEvents;
  const processRallyEvents = analyzeRallyEvents;
  const buildRallyAnalysis = analyzeRallyEvents;
  const buildRallyTimeline = analyzeRallyEvents;
  const createRallyAnalyzer = createRallyStateMachine;
  
  function normalizeRallyForHighlight(rally) {
    return rally && rally.rally_id ? createRallyRecord(rally) : rally;
  }
  
  function groupEvents(strokeEvents) {
    const grouped = new Map();
    const seen = new Set();
    function add(key, event) {
      const normalized = createStrokeEvent(event);
      if (seen.has(normalized.event_id)) throw new AnalysisError(`event ${normalized.event_id} occurs more than once`, 'duplicate-event-id');
      seen.add(normalized.event_id);
      const rallyKey = key ?? normalized.rally_id;
      if (!grouped.has(rallyKey)) grouped.set(rallyKey, []);
      grouped.get(rallyKey).push(normalized);
    }
    if (strokeEvents instanceof Map) {
      for (const [key, value] of strokeEvents.entries()) {
        const list = Array.isArray(value) ? value : [value];
        for (const event of list) add(key, event);
      }
      return grouped;
    }
    if (!strokeEvents) return grouped;
    if (Array.isArray(strokeEvents)) {
      for (const event of strokeEvents) add(null, event);
      return grouped;
    }
    if (isRecord(strokeEvents)) {
      for (const [key, value] of Object.entries(strokeEvents)) {
        const list = Array.isArray(value) ? value : [value];
        for (const event of list) add(key, event);
      }
    }
    return grouped;
  }
  
  function highlightEventFeatures(rally, eventIndex) {
    const events = eventIndex.get(rally.rally_id) || [];
    const eventById = new Map(events.map((event) => [event.event_id, event]));
    const referencedEvents = rally.stroke_event_ids.length
      ? rally.stroke_event_ids.map((id) => eventById.get(id) || null)
      : events;
    const acceptedEvents = referencedEvents.filter((event) => event && (event.status === 'accepted' || event.status === 'corrected'));
    const shotCount = rally.shot_count > 0 ? rally.shot_count : Math.max(acceptedEvents.length, rally.stroke_event_ids.length);
    const familiesFromRally = rally.coarse_shot_families.filter((family) => COARSE_SHOT_FAMILIES.includes(family));
    const families = new Set(familiesFromRally);
    for (const event of acceptedEvents) if (COARSE_SHOT_FAMILIES.includes(event.shot_family)) families.add(event.shot_family);
  
    const expectedConfidenceCount = Math.max(acceptedEvents.length, rally.stroke_event_ids.length, rally.shot_count);
    let confidenceSum = 0;
    let missingConfidenceCount = 0;
    for (let index = 0; index < expectedConfidenceCount; index += 1) {
      const event = acceptedEvents[index];
      if (!event) {
        missingConfidenceCount += 1;
        continue;
      }
      const confidence = event.tracking_confidence || event.geometry_confidence;
      if (!confidence || confidence.status !== 'known') missingConfidenceCount += 1;
      else confidenceSum += confidence.value;
    }
    const meanTrackingConfidence = expectedConfidenceCount ? stableNumber(confidenceSum / expectedConfidenceCount) : 0;
    return {
      shot_count: shotCount,
      unique_families: [...families],
      mean_tracking_confidence: meanTrackingConfidence,
      missing_confidence_count: missingConfidenceCount,
      accepted_event_count: acceptedEvents.length,
    };
  }
  
  function outcomePressure(rally) {
    const label = classifyOutcomeFromWinnerState(rally.winner_state);
    const classifiedPressure = label === 'unclassified' ? 0 : 0.4;
    if (label !== 'winner' && label !== 'forced_error') {
      return { value: classifiedPressure, partial: false, reason: label === 'unclassified' ? 'outcome-unclassified' : 'ordinary-classified-outcome' };
    }
    const score = rally.score_context;
    const scoreKnown = score && (score.state !== 'unknown' || score.game_point === true);
    const tight = scoreKnown && (score.state === 'tight' || score.game_point === true);
    return {
      value: tight ? 1 : 0.7,
      partial: !scoreKnown,
      reason: tight ? 'tight-or-game-point' : (scoreKnown ? 'ordinary-score-state' : 'score-unavailable-ordinary-fallback'),
    };
  }
  
  function completedRalliesOnly(rallies) {
    return rallies.filter((rally) => rally && rally.status === 'completed' && rally.end_media_time !== null);
  }
  
  function percentileRank(value, values) {
    if (!values.length) return 0;
    return values.filter((candidate) => candidate <= value).length / values.length;
  }
  
  function calculateHighlightIndex(rallyInput, completedHistoryInput, strokeEvents = []) {
    const rally = normalizeRallyForHighlight(rallyInput);
    const history = completedRalliesOnly((completedHistoryInput || []).map(normalizeRallyForHighlight));
    if (!rally || rally.status !== 'completed' || rally.end_media_time === null) {
      return { rally_id: rally?.rally_id ?? null, eligible: false, index: null, reason: 'rally-not-completed', sample_size: history.length };
    }
    const candidates = [...history];
    if (!candidates.some((candidate) => candidate.rally_id === rally.rally_id)) candidates.push(rally);
    const completed = completedRalliesOnly(candidates);
    const sampleSize = completed.length;
    const base = {
      rally_id: rally.rally_id,
      eligible: false,
      index: null,
      sample_size: sampleSize,
      minimum_sample_size: 10,
      source_timestamp: { start_media_time: rally.start_media_time, end_media_time: rally.end_media_time },
    };
    if (sampleSize < 10) return { ...base, reason: 'insufficient-history' };
  
    const eventIndex = groupEvents(strokeEvents);
    const currentFeatures = highlightEventFeatures(rally, eventIndex);
    const shotCounts = completed.map((candidate) => highlightEventFeatures(candidate, eventIndex).shot_count);
    const lengthPercentile = percentileRank(currentFeatures.shot_count, shotCounts);
    const variety = Math.min(currentFeatures.unique_families.length / COARSE_SHOT_FAMILIES.length, 1);
    const pressure = outcomePressure(rally);
    const meanTrackingConfidence = currentFeatures.mean_tracking_confidence;
    const weighted = 0.4 * lengthPercentile + 0.25 * variety + 0.2 * pressure.value + 0.15 * meanTrackingConfidence;
    const partialComponents = [];
    if (pressure.partial) partialComponents.push('outcome_pressure');
    if (currentFeatures.missing_confidence_count > 0) partialComponents.push('mean_tracking_confidence');
    return finishRecord({
      rally_id: rally.rally_id,
      eligible: true,
      index: Math.round(100 * weighted),
      sample_size: sampleSize,
      minimum_sample_size: 10,
      components: {
        length_percentile: lengthPercentile,
        variety,
        outcome_pressure: pressure.value,
        mean_tracking_confidence: meanTrackingConfidence,
      },
      weights: { length_percentile: 0.4, variety: 0.25, outcome_pressure: 0.2, mean_tracking_confidence: 0.15 },
      partial_components: partialComponents,
      partial: partialComponents.length > 0,
      component_reasons: {
        outcome_pressure: pressure.reason,
        mean_tracking_confidence: currentFeatures.missing_confidence_count > 0
          ? `${currentFeatures.missing_confidence_count} missing confidence value(s) contributed 0`
          : 'all accepted stroke confidence values known',
      },
      score_context: rally.score_context,
      outcome: rally.winner_state,
      shot_count: currentFeatures.shot_count,
      unique_coarse_shot_families: currentFeatures.unique_families,
      source_timestamp: { start_media_time: rally.start_media_time, end_media_time: rally.end_media_time },
    });
  }
  
  function rankRallyHighlights(ralliesInput, strokeEvents = [], { limit = Infinity } = {}) {
    if (!Array.isArray(ralliesInput)) throw new SchemaValidationError('RallyCollection', ['rallies must be an array']);
    const rallies = ralliesInput.map((rally) => createRallyRecord(rally));
    if (new Set(rallies.map((rally) => rally.rally_id)).size !== rallies.length) {
      throw new AnalysisError('rally_id values must be unique for highlight ranking', 'duplicate-rally-id');
    }
    const completed = completedRalliesOnly(rallies);
    if (completed.length < 10) {
      return finishRecord({
        eligible: false,
        reason: 'insufficient-history',
        sample_size: completed.length,
        minimum_sample_size: 10,
        results: [],
      });
    }
    const results = completed
      .map((rally) => calculateHighlightIndex(rally, completed, strokeEvents))
      .sort((left, right) => right.index - left.index || left.source_timestamp.end_media_time - right.source_timestamp.end_media_time || left.rally_id.localeCompare(right.rally_id))
      .slice(0, limit);
    return finishRecord({ eligible: true, sample_size: completed.length, minimum_sample_size: 10, results });
  }
  
  const rankHighlights = rankRallyHighlights;
  const scoreRallyHighlights = rankRallyHighlights;
  
  function isPointInsideCourt(point, format = 'doubles') {
    const { x, y } = pointXY(point);
    if (format !== 'doubles' && format !== 'singles') throw new AnalysisError('format must be doubles or singles', 'invalid-format');
    const minX = format === 'singles' ? SINGLES_SIDE_MARGIN_M : 0;
    const maxX = format === 'singles' ? COURT_WIDTH_M - SINGLES_SIDE_MARGIN_M : COURT_WIDTH_M;
    return x >= minX && x <= maxX && y >= 0 && y <= COURT_LENGTH_M;
  }
  
  const ANALYSIS_PRIMITIVES = {
    AnalysisError,
    SchemaValidationError,
    COURT_LENGTH_M,
    COURT_WIDTH_M,
    COURT_GEOMETRY,
    COURT_LINES,
    LINE_WIDTH_M,
    NET_Y_M,
    NET_POST_HEIGHT_M,
    SINGLES_SIDE_MARGIN_M,
    SINGLES_WIDTH_M,
    SHORT_SERVICE_OFFSET_M,
    SHORT_SERVICE_NEAR_Y_M,
    SHORT_SERVICE_FAR_Y_M,
    DOUBLES_LONG_SERVICE_OFFSET_M,
    DOUBLES_LONG_SERVICE_NEAR_Y_M,
    DOUBLES_LONG_SERVICE_FAR_Y_M,
    COARSE_SHOT_FAMILIES,
    SHOT_FAMILY_UNKNOWN,
    MANUAL_SHOT_LABELS,
    EVENT_SOURCES,
    EVENT_STATUSES,
    OUTCOME_LABELS,
    LINE_CALL_LABELS,
    EVIDENCE_STATES,
    RALLY_STATUSES,
    RALLY_TERMINATIONS,
    createNormalizedPoint,
    createCourtPoint,
    normalizeCourtPoint,
    denormalizeCourtPoint,
    getCourtGeometry,
    generateCourtLines,
    getCourtLine,
    projectCourtLines,
    fitHomography,
    fitOuterCourtHomography,
    Homography,
    createConfidence,
    validateConfidence,
    createCorrectionProvenance,
    validateCorrectionProvenance,
    createStrokeEvent,
    validateStrokeEvent,
    correctStrokeEvent,
    replaceCorrectedStrokeEvent,
    createWinnerState,
    validateWinnerState,
    createRallyRecord,
    validateRallyRecord,
    createLineCallState,
    createLineCallRecord: createLineCallState,
    validateLineCallState,
    attributeRallyOutcome,
    createRallyStateMachine,
    createRallyEventStateMachine: createRallyStateMachine,
    createRallyAnalyzer,
    analyzeRallyEvents,
    analyzeRally: analyzeRallyEvents,
    analyzeRallies,
    processRallyEvents,
    buildRallyAnalysis: analyzeRallyEvents,
    buildRallyTimeline: analyzeRallyEvents,
    createCoarseShotFeatures,
    COARSE_RULE_THRESHOLDS,
    classifyCoarseShot,
    calculateHighlightIndex,
    rankRallyHighlights,
    rankHighlights,
    scoreRallyHighlights,
    isPointInsideCourt,
  };
  
  // The analysis package remains CommonJS for Node consumers. The same
  // dependency-free primitives are also exposed as a browser global for the MV3
  // calibration adapter; there is no second geometry implementation to drift.
  if (typeof module === 'object' && module.exports) module.exports = ANALYSIS_PRIMITIVES;
  if (typeof globalThis === 'object') globalThis.BVAnalysisPrimitives = ANALYSIS_PRIMITIVES;
  
  /* src/calibration.js */
  /* Dependency-free browser adapter for the shared BWF geometry/homography primitives. */
  (function (root) {
    "use strict";
  
    var primitives = root.BVAnalysisPrimitives;
    var CALIBRATION_VERSION = 1;
    var COORDINATE_SYSTEM = "normalized-video-image";
    var COURT_COORDINATE_SYSTEM = "normalized-court";
    var FIT_OPTIONS = { minimumAreaRatio: 1e-7, duplicateRatio: 1e-7, pivotTolerance: 1e-12 };
  
    function CalibrationError(message, code, cause) {
      this.name = "CalibrationError";
      this.message = message;
      this.code = code || "invalid-calibration";
      this.recoverable = true;
      if (cause) this.cause = cause;
      if (Error.captureStackTrace) Error.captureStackTrace(this, CalibrationError);
    }
    CalibrationError.prototype = Object.create(Error.prototype);
    CalibrationError.prototype.constructor = CalibrationError;
  
    function fail(message, code, cause) { throw new CalibrationError(message, code, cause); }
  
    function point(value, name, allowOutside) {
      var x;
      var y;
      if (Array.isArray(value) && value.length === 2) {
        x = value[0]; y = value[1];
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        x = value.x; y = value.y;
      } else {
        fail(name + " must be an {x, y} point", "invalid-point");
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) fail(name + " must contain finite coordinates", "non-finite-point");
      if (!allowOutside && (x < 0 || x > 1 || y < 0 || y > 1)) {
        fail(name + " must be normalized to [0, 1]", "point-out-of-range");
      }
      return { x: x, y: y };
    }
  
    function points(value) {
      if (!Array.isArray(value) || value.length !== 4) fail("Four outer-court corners are required", "invalid-seed");
      return value.map(function (entry, index) { return point(entry, "corner " + (index + 1), false); });
    }
  
    function canonicalCorners() {
      if (!primitives || !primitives.COURT_GEOMETRY) fail("shared BWF court geometry is unavailable", "geometry-unavailable");
      return primitives.COURT_GEOMETRY.outer_corner_order.map(function (corner) {
        return { x: corner.x / primitives.COURT_GEOMETRY.width_m, y: corner.y / primitives.COURT_GEOMETRY.length_m };
      });
    }
  
    function copyMatrix(matrix, name) {
      if (!Array.isArray(matrix) || matrix.length !== 3 || matrix.some(function (row) { return !Array.isArray(row) || row.length !== 3; })) {
        fail(name + " must be a 3 × 3 matrix", "invalid-homography");
      }
      var copied = matrix.map(function (row) {
        return row.map(function (value) {
          if (!Number.isFinite(value)) fail(name + " must contain finite values", "invalid-homography");
          return value;
        });
      });
      return copied;
    }
  
    function applyMatrix(matrix, value, operation) {
      var input = point(value, operation || "projection", true);
      var denominator = matrix[2][0] * input.x + matrix[2][1] * input.y + matrix[2][2];
      var scale = Math.max(1, ...matrix.reduce(function (all, row) { return all.concat(row.map(Math.abs)); }, []), Math.abs(input.x), Math.abs(input.y));
      if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-12 * scale) {
        fail((operation || "projection") + " is projectively singular", "projection-singular");
      }
      var result = {
        x: (matrix[0][0] * input.x + matrix[0][1] * input.y + matrix[0][2]) / denominator,
        y: (matrix[1][0] * input.x + matrix[1][1] * input.y + matrix[1][2]) / denominator
      };
      if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) fail((operation || "projection") + " produced a non-finite point", "projection-singular");
      return result;
    }
  
    function errorMessage(error) {
      var messages = {
        "duplicate-corner": "Two clicks overlap. Undo and click four distinct outer corners.",
        "collinear-corners": "The clicked corners are nearly in a line. Undo and click the full court rectangle.",
        "invalid-order": "The corners are out of order. Undo and click Near left, Near right, Far right, then Far left.",
        "near-singular": "This court shape is too narrow or unstable. Undo and click clearer outer corners.",
        "non-finite-point": "A corner was not a usable point. Undo and click the visible court corners again.",
        "point-out-of-range": "A corner landed outside the video. Undo and click inside the video.",
        "projection-singular": "The court projection is unstable. Undo and click clearer outer corners."
      };
      return messages[error && error.code] || "Calibration failed. Undo or reset, then click the four outer corners again.";
    }
  
    function projectLines(inverseMatrix) {
      if (!primitives || !Array.isArray(primitives.COURT_LINES)) fail("shared BWF court lines are unavailable", "geometry-unavailable");
      return primitives.COURT_LINES.map(function (line) {
        var projectedStart = applyMatrix(inverseMatrix, line.normalized_start, "court-line projection");
        var projectedEnd = applyMatrix(inverseMatrix, line.normalized_end, "court-line projection");
        // Keep canonical endpoints and all BWF ownership/format metadata while
        // making start/end the explicit normalized image coordinates consumed by
        // the browser renderer.
        return Object.assign({}, line, {
          court_start: { x: line.start.x, y: line.start.y },
          court_end: { x: line.end.x, y: line.end.y },
          start: projectedStart,
          end: projectedEnd
        });
      });
    }
  
    function fitCourtCalibration(seedPoints) {
      if (!primitives || typeof primitives.fitHomography !== "function") fail("shared homography primitive is unavailable", "homography-unavailable");
      var source;
      var target;
      var homography;
      try {
        source = points(seedPoints);
        target = canonicalCorners();
        // The shared implementation performs duplicate, collinear, ordering,
        // conditioning, residual, and projective-singularity checks.
        homography = primitives.fitHomography(source, target, FIT_OPTIONS);
      } catch (error) {
        if (error instanceof CalibrationError) {
          error.message = errorMessage(error);
          throw error;
        }
        throw new CalibrationError(errorMessage(error), error && error.code || "invalid-calibration", error);
      }
  
      var imageToCourt = copyMatrix(homography.matrix, "image-to-court matrix");
      var courtToImage = copyMatrix(homography.inverse_matrix, "court-to-image matrix");
      var result = {
        version: CALIBRATION_VERSION,
        coordinateSystem: COORDINATE_SYSTEM,
        courtCoordinateSystem: COURT_COORDINATE_SYSTEM,
        seedPoints: source.map(function (entry) { return { x: entry.x, y: entry.y }; }),
        normalizedSeedPoints: source.map(function (entry) { return { x: entry.x, y: entry.y }; }),
        canonicalCorners: target.map(function (entry) { return { x: entry.x, y: entry.y }; }),
        homography: {
          imageToCourt: imageToCourt,
          courtToImage: courtToImage,
          // Keep the shared primitive naming available to storage consumers.
          matrix: imageToCourt,
          inverse_matrix: courtToImage
        },
        lines: projectLines(courtToImage)
      };
      return result;
    }
  
    function matrixFor(calibration, direction) {
      if (!calibration || typeof calibration !== "object") fail("a court calibration is required", "invalid-calibration");
      if (calibration.coordinateSystem !== COORDINATE_SYSTEM || calibration.courtCoordinateSystem !== COURT_COORDINATE_SYSTEM) {
        fail("calibration uses an unsupported coordinate system", "invalid-coordinate-system");
      }
      var matrices = calibration.homography || {};
      return copyMatrix(matrices[direction], direction + " matrix");
    }
  
    function projectCourtPoint(calibration, normalizedCourtPoint) {
      return applyMatrix(matrixFor(calibration, "courtToImage"), normalizedCourtPoint, "court-to-image projection");
    }
  
    function projectImagePoint(calibration, normalizedImagePoint) {
      return applyMatrix(matrixFor(calibration, "imageToCourt"), normalizedImagePoint, "image-to-court projection");
    }
  
    function projectCourtLines(calibration) {
      var inverse = matrixFor(calibration, "courtToImage");
      return projectLines(inverse);
    }
  
    function restoreCalibration(value) {
      if (value === null || value === undefined) return null;
      try {
        // Refit from persisted normalized seeds instead of trusting mutable
        // storage matrices. This makes old/corrupt state fail recoverably.
        return fitCourtCalibration(value.seedPoints || value.normalizedSeedPoints || value.sourcePoints);
      } catch (error) {
        if (error instanceof CalibrationError) throw error;
        throw new CalibrationError(errorMessage(error), error && error.code || "invalid-calibration", error);
      }
    }
  
    function tryFitCourtCalibration(seedPoints) {
      try {
        return { ok: true, calibration: fitCourtCalibration(seedPoints), error: null };
      } catch (error) {
        return { ok: false, calibration: null, error: error instanceof CalibrationError ? error : new CalibrationError(errorMessage(error), error && error.code || "invalid-calibration", error) };
      }
    }
  
    function canonicalCourt() {
      return primitives && primitives.COURT_GEOMETRY ? primitives.COURT_GEOMETRY : null;
    }
  
    root.BVCalibration = Object.freeze({
      CalibrationError: CalibrationError,
      CALIBRATION_VERSION: CALIBRATION_VERSION,
      COORDINATE_SYSTEM: COORDINATE_SYSTEM,
      COURT_COORDINATE_SYSTEM: COURT_COORDINATE_SYSTEM,
      canonicalCourt: canonicalCourt,
      canonicalCorners: canonicalCorners,
      fitCourtCalibration: fitCourtCalibration,
      fitOuterCourtHomography: fitCourtCalibration,
      fit: fitCourtCalibration,
      restoreCalibration: restoreCalibration,
      tryFitCourtCalibration: tryFitCourtCalibration,
      projectCourtPoint: projectCourtPoint,
      projectImagePoint: projectImagePoint,
      projectNormalizedCourtPoint: projectCourtPoint,
      projectCourtLines: projectCourtLines,
      projectLines: projectCourtLines,
      errorMessage: errorMessage
    });
  })(typeof globalThis !== "undefined" ? globalThis : window);
  
  /* src/panel-layout.js */
  /* Pure geometry helpers for movable, resizable video-overlay panels. */
  (function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.BVPanelLayout = api;
  })(typeof globalThis !== "undefined" ? globalThis : self, function () {
    "use strict";
  
    var PANEL_MARGIN = 12;
    var PANEL_NUDGE = 16;
    var PANEL_RESIZE_NUDGE = 16;
    // YouTube draws its bottom control strip (progress bar, play/pause, volume,
    // settings) over the video's bottom edge. Overlay panels reserve this strip
    // so the native player stays fully interactive; callers pass the reserve in
    // per-panel constraints (0 keeps the classic full-area behavior).
    var DEFAULT_CONTROLS_RESERVE = 0;
  
    function finite(value, fallback) {
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    }
  
    function dimension(value) { return Math.max(0, finite(value, 0)); }
  
    function optionalRatio(value) {
      if (value == null || value === "") return null;
      var number = Number(value);
      return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
    }
  
    function normalizeLayout(layout) {
      if (!layout || typeof layout !== "object") return null;
      var result = {};
      ["x", "y", "width", "height"].forEach(function (key) {
        var value = optionalRatio(layout[key]);
        if (value != null) result[key] = value;
      });
      if (!Object.keys(result).length) return null;
      if (result.width === 0) delete result.width;
      if (result.height === 0) delete result.height;
      return Object.keys(result).length ? result : null;
    }
  
    function bounds(viewport, constraints) {
      var width = dimension(viewport && viewport.width);
      var height = dimension(viewport && viewport.height);
      var options = constraints || {};
      var margin = Math.max(0, finite(options.margin, PANEL_MARGIN));
      var bottomReserve = Math.max(0, finite(options.bottomReserve, DEFAULT_CONTROLS_RESERVE));
      var availableWidth = Math.max(0, width - margin * 2);
      var availableHeight = Math.max(0, height - margin * 2 - bottomReserve);
      var configuredMinWidth = Math.max(1, finite(options.minWidth, 160));
      var configuredMinHeight = Math.max(1, finite(options.minHeight, 96));
      var configuredMaxWidth = Math.max(configuredMinWidth, finite(options.maxWidth, width || configuredMinWidth));
      var configuredMaxHeight = Math.max(configuredMinHeight, finite(options.maxHeight, height || configuredMinHeight));
      return {
        width: width,
        height: height,
        margin: margin,
        bottomReserve: bottomReserve,
        minWidth: Math.min(configuredMinWidth, availableWidth || configuredMinWidth),
        minHeight: Math.min(configuredMinHeight, availableHeight || configuredMinHeight),
        maxWidth: Math.max(0, Math.min(configuredMaxWidth, availableWidth)),
        maxHeight: Math.max(0, Math.min(configuredMaxHeight, availableHeight))
      };
    }
  
    function clamp(value, minimum, maximum) {
      if (maximum < minimum) return maximum;
      return Math.max(minimum, Math.min(maximum, value));
    }
  
    function pixelPanelLayout(layout, viewport, rendered, constraints) {
      var area = bounds(viewport, constraints);
      var normalized = normalizeLayout(layout) || {};
      var fallback = rendered || {};
      var width = normalized.width != null ? normalized.width * area.width : dimension(fallback.width);
      var height = normalized.height != null ? normalized.height * area.height : dimension(fallback.height);
      width = clamp(width || area.minWidth, Math.min(area.minWidth, area.maxWidth), area.maxWidth);
      height = clamp(height || area.minHeight, Math.min(area.minHeight, area.maxHeight), area.maxHeight);
      var left = normalized.x != null ? normalized.x * area.width : finite(fallback.left, area.margin);
      var top = normalized.y != null ? normalized.y * area.height : finite(fallback.top, area.margin);
      left = clamp(left, area.margin, Math.max(area.margin, area.width - width - area.margin));
      // The bottom reserve keeps a panel bottom edge clear of the native player
      // control strip even when a saved layout (or a drag) aims below it.
      top = clamp(top, area.margin, Math.max(area.margin, area.height - height - area.margin - area.bottomReserve));
      return {
        left: left,
        top: top,
        width: width,
        height: height,
        layout: {
          x: area.width ? left / area.width : 0,
          y: area.height ? top / area.height : 0,
          width: area.width ? width / area.width : 0,
          height: area.height ? height / area.height : 0
        }
      };
    }
  
    function movePanelLayout(layout, delta, viewport, rendered, constraints) {
      var pixels = pixelPanelLayout(layout, viewport, rendered, constraints);
      var area = bounds(viewport, constraints);
      return pixelPanelLayout({
        x: area.width ? (pixels.left + finite(delta && delta.x, 0)) / area.width : 0,
        y: area.height ? (pixels.top + finite(delta && delta.y, 0)) / area.height : 0,
        width: pixels.layout.width,
        height: pixels.layout.height
      }, viewport, pixels, constraints).layout;
    }
  
    function resizePanelLayout(layout, delta, viewport, rendered, constraints) {
      var pixels = pixelPanelLayout(layout, viewport, rendered, constraints);
      var area = bounds(viewport, constraints);
      return pixelPanelLayout({
        x: pixels.layout.x,
        y: pixels.layout.y,
        width: area.width ? (pixels.width + finite(delta && delta.x, 0)) / area.width : 0,
        height: area.height ? (pixels.height + finite(delta && delta.y, 0)) / area.height : 0
      }, viewport, pixels, constraints).layout;
    }
  
    function nudgePanelLayout(layout, direction, viewport, rendered, constraints, amount) {
      var step = Math.max(1, finite(amount, PANEL_NUDGE));
      var delta = { x: 0, y: 0 };
      if (direction === "ArrowLeft") delta.x = -step;
      if (direction === "ArrowRight") delta.x = step;
      if (direction === "ArrowUp") delta.y = -step;
      if (direction === "ArrowDown") delta.y = step;
      return movePanelLayout(layout, delta, viewport, rendered, constraints);
    }
  
    function nudgePanelSize(layout, direction, viewport, rendered, constraints, amount) {
      var step = Math.max(1, finite(amount, PANEL_RESIZE_NUDGE));
      var delta = { x: 0, y: 0 };
      if (direction === "ArrowLeft") delta.x = -step;
      if (direction === "ArrowRight") delta.x = step;
      if (direction === "ArrowUp") delta.y = -step;
      if (direction === "ArrowDown") delta.y = step;
      return resizePanelLayout(layout, delta, viewport, rendered, constraints);
    }
  
    function isWithinBounds(layout, viewport, rendered, constraints) {
      var area = bounds(viewport, constraints);
      var pixels = pixelPanelLayout(layout, viewport, rendered, constraints);
      return pixels.left >= area.margin - 1e-9 && pixels.top >= area.margin - 1e-9 &&
        pixels.left + pixels.width <= area.width - area.margin + 1e-9 &&
        pixels.top + pixels.height <= area.height - area.margin - area.bottomReserve + 1e-9 &&
        pixels.width >= Math.min(area.minWidth, area.maxWidth) - 1e-9 &&
        pixels.height >= Math.min(area.minHeight, area.maxHeight) - 1e-9;
    }
  
    return Object.freeze({
      PANEL_MARGIN: PANEL_MARGIN,
      PANEL_NUDGE: PANEL_NUDGE,
      PANEL_RESIZE_NUDGE: PANEL_RESIZE_NUDGE,
      normalizeLayout: normalizeLayout,
      pixelPanelLayout: pixelPanelLayout,
      movePanelLayout: movePanelLayout,
      resizePanelLayout: resizePanelLayout,
      nudgePanelLayout: nudgePanelLayout,
      nudgePanelSize: nudgePanelSize,
      isWithinBounds: isWithinBounds
    });
  });
  
  /* src/seed-card.js */
  /* Geometry helpers for the movable court-seeding instruction card. */
  (function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.BVSeedCard = api;
  })(typeof globalThis !== "undefined" ? globalThis : self, function () {
    "use strict";
  
    var SEED_CARD_MARGIN = 12;
    var SEED_CARD_NUDGE = 16;
    // The card sits in the quiet middle band, between the likely far and near
    // corner clicks, rather than over the bottom video controls/corners.
    var DEFAULT_SEED_CARD_TOP_RATIO = 0.35;
  
    function finite(value, fallback) {
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    }
  
    function dimension(value) { return Math.max(0, finite(value, 0)); }
  
    function normalizePosition(position) {
      if (!position || typeof position !== "object") return null;
      var x = finite(position.x, NaN);
      var y = finite(position.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }
  
    function available(viewport, card, margin) {
      var width = dimension(viewport && viewport.width);
      var height = dimension(viewport && viewport.height);
      var cardWidth = dimension(card && card.width);
      var cardHeight = dimension(card && card.height);
      var inset = Math.max(0, finite(margin, SEED_CARD_MARGIN));
      return {
        width: width,
        height: height,
        cardWidth: cardWidth,
        cardHeight: cardHeight,
        margin: inset,
        maxLeft: Math.max(inset, width - cardWidth - inset),
        maxTop: Math.max(inset, height - cardHeight - inset)
      };
    }
  
    function defaultSeedCardPosition(viewport, card, margin) {
      var bounds = available(viewport, card, margin);
      return {
        x: bounds.width ? ((bounds.maxLeft + bounds.margin) / 2) / bounds.width : 0,
        y: bounds.height ? Math.max(bounds.margin, Math.min(bounds.maxTop, bounds.height * DEFAULT_SEED_CARD_TOP_RATIO)) / bounds.height : 0
      };
    }
  
    function clampSeedCardPosition(position, viewport, card, margin) {
      var bounds = available(viewport, card, margin);
      var fallback = defaultSeedCardPosition(viewport, card, margin);
      var normalized = normalizePosition(position) || fallback;
      var left = normalized.x * bounds.width;
      var top = normalized.y * bounds.height;
      left = Math.max(bounds.margin, Math.min(bounds.maxLeft, left));
      top = Math.max(bounds.margin, Math.min(bounds.maxTop, top));
      return {
        x: bounds.width ? left / bounds.width : 0,
        y: bounds.height ? top / bounds.height : 0
      };
    }
  
    function pixelSeedCardPosition(position, viewport, card, margin) {
      var bounds = available(viewport, card, margin);
      var clamped = clampSeedCardPosition(position, viewport, card, margin);
      return {
        left: clamped.x * bounds.width,
        top: clamped.y * bounds.height,
        position: clamped
      };
    }
  
    function moveSeedCardPosition(position, delta, viewport, card, margin) {
      var bounds = available(viewport, card, margin);
      var current = pixelSeedCardPosition(position, viewport, card, margin);
      var next = {
        x: bounds.width ? (current.left + finite(delta && delta.x, 0)) / bounds.width : 0,
        y: bounds.height ? (current.top + finite(delta && delta.y, 0)) / bounds.height : 0
      };
      return clampSeedCardPosition(next, viewport, card, margin);
    }
  
    function nudgeSeedCardPosition(position, direction, viewport, card, margin, amount) {
      var delta = { x: 0, y: 0 };
      var step = Math.max(1, finite(amount, SEED_CARD_NUDGE));
      if (direction === "ArrowLeft") delta.x = -step;
      if (direction === "ArrowRight") delta.x = step;
      if (direction === "ArrowUp") delta.y = -step;
      if (direction === "ArrowDown") delta.y = step;
      return moveSeedCardPosition(position, delta, viewport, card, margin);
    }
  
    function canSeedFromClick(target, layer, seedCount, defaultPrevented) {
      return !defaultPrevented && target === layer && Number(seedCount) < 4;
    }
  
    function isWithinSeedCardBounds(position, viewport, card, margin) {
      var bounds = available(viewport, card, margin);
      var pixels = pixelSeedCardPosition(position, viewport, card, margin);
      return pixels.left >= bounds.margin - 1e-9 &&
        pixels.top >= bounds.margin - 1e-9 &&
        pixels.left + bounds.cardWidth <= bounds.width - bounds.margin + 1e-9 &&
        pixels.top + bounds.cardHeight <= bounds.height - bounds.margin + 1e-9;
    }
  
    return Object.freeze({
      SEED_CARD_MARGIN: SEED_CARD_MARGIN,
      SEED_CARD_NUDGE: SEED_CARD_NUDGE,
      DEFAULT_SEED_CARD_TOP_RATIO: DEFAULT_SEED_CARD_TOP_RATIO,
      normalizePosition: normalizePosition,
      defaultSeedCardPosition: defaultSeedCardPosition,
      clampSeedCardPosition: clampSeedCardPosition,
      pixelSeedCardPosition: pixelSeedCardPosition,
      moveSeedCardPosition: moveSeedCardPosition,
      nudgeSeedCardPosition: nudgeSeedCardPosition,
      canSeedFromClick: canSeedFromClick,
      isWithinSeedCardBounds: isWithinSeedCardBounds
    });
  });
  
  /* src/fixtures.js */
  /* Deterministic fixtures stand in for runtime inference until the private adapter exists. */
  (function (root) {
    root.BVFixtures = {
      video: {
        title: "Men's Singles Final — full match",
        channel: "Court Side Archive",
        views: "412K views",
        posted: "3 weeks ago",
        duration: "1:12:40",
        url: "https://www.youtube.com/watch?v=badminton-vision-fixture"
      },
      strokes: [
        { eventId: "r14-s01", rallyId: 14, sequence: 1, player: "A", shot: "Serve", time: "12:01.020", status: "accepted", source: "auto", confidence: 0.94 },
        { eventId: "r14-s02", rallyId: 14, sequence: 2, player: "B", shot: "Lift", time: "12:01.760", status: "accepted", source: "auto", confidence: 0.81 },
        { eventId: "r14-s03", rallyId: 14, sequence: 3, player: "A", shot: "Clear", time: "12:02.140", status: "accepted", source: "auto", confidence: 0.91 },
        { eventId: "r14-s04", rallyId: 14, sequence: 4, player: "B", shot: "Drop", time: "12:03.020", status: "corrected", source: "manual", confidence: null },
        { eventId: "r14-s05", rallyId: 14, sequence: 5, player: "A", shot: "Net Shot", time: "12:03.560", status: "accepted", source: "auto", confidence: 0.72 },
        { eventId: "r14-s06", rallyId: 14, sequence: 6, player: "B", shot: null, time: "12:03.980", status: "unclassified", source: "auto", confidence: null }
      ],
      suggestion: { eventId: "r14-s07", rallyId: 14, shot: "Smash", confidence: 0.61, time: "12:04.120" },
      rallies: [
        { rallyId: 1, shots: 8, duration: "11.2s", outcome: "winner", startSec: 61, endSec: 72.2, shotFamilies: ["Serve", "Clear", "Drop"], meanTrackingConfidence: 0.83, tightScore: false },
        { rallyId: 2, shots: 14, duration: "18.6s", outcome: "forced error", startSec: 75, endSec: 93.6, shotFamilies: ["Serve", "Clear", "Smash", "Net Shot"], meanTrackingConfidence: 0.79, tightScore: true },
        { rallyId: 3, shots: 6, duration: "8.4s", outcome: "unforced error", startSec: 98, endSec: 106.4, shotFamilies: ["Serve", "Drop"], meanTrackingConfidence: 0.76, tightScore: false },
        { rallyId: 4, shots: 11, duration: "15.8s", outcome: "winner", startSec: 110, endSec: 125.8, shotFamilies: ["Serve", "Clear", "Lift", "Smash"], meanTrackingConfidence: 0.88, tightScore: false },
        { rallyId: 5, shots: 16, duration: "21.0s", outcome: "unclassified", startSec: 130, endSec: 151, shotFamilies: ["Serve", "Clear", "Drop", "Net Shot"], meanTrackingConfidence: 0.61, tightScore: false, scoreOcrUnavailable: true },
        { rallyId: 6, shots: 9, duration: "12.4s", outcome: "forced error", startSec: 154, endSec: 166.4, shotFamilies: ["Serve", "Drive", "Drop"], meanTrackingConfidence: 0.8, tightScore: false },
        { rallyId: 7, shots: 22, duration: "29.5s", outcome: "winner", startSec: 171, endSec: 200.5, shotFamilies: ["Serve", "Clear", "Drop", "Smash", "Net Shot"], meanTrackingConfidence: 0.9, tightScore: true },
        { rallyId: 8, shots: 13, duration: "17.2s", outcome: "unforced error", startSec: 204, endSec: 221.2, shotFamilies: ["Serve", "Lift", "Drive"], meanTrackingConfidence: 0.74, tightScore: false },
        { rallyId: 9, shots: 27, duration: "36.1s", outcome: "forced error", startSec: 435, endSec: 471.1, shotFamilies: ["Serve", "Clear", "Drop", "Smash", "Net Shot"], meanTrackingConfidence: 0.86, tightScore: false },
        { rallyId: 10, shots: 10, duration: "14.0s", outcome: "winner", startSec: 480, endSec: 494, shotFamilies: ["Serve", "Clear", "Net Kill"], meanTrackingConfidence: 0.82, tightScore: false },
        { rallyId: 14, shots: 24, duration: "31.9s", outcome: "winner", startSec: 721, endSec: 752.9, shotFamilies: ["Serve", "Clear", "Drop", "Smash", "Net Kill"], meanTrackingConfidence: 0.84, tightScore: false },
        { rallyId: 23, shots: 31, duration: "42.6s", outcome: "winner", startSec: 1122, endSec: 1164.6, shotFamilies: ["Serve", "Clear", "Drop", "Smash", "Net Shot", "Drive"], meanTrackingConfidence: 0.78, tightScore: true, scoreOcrUnavailable: true }
      ],
      shotMix: [
        { label: "Clear", value: 84, color: "var(--player-a)" },
        { label: "Drop", value: 61, color: "#2f8f77" },
        { label: "Smash", value: 47, color: "var(--lime-500)" },
        { label: "Net", value: 39, color: "var(--player-b)" },
        { label: "Unclassified", value: 18, color: "var(--signal-unknown)" }
      ],
      outcomeMix: [
        { label: "Winner", value: 31, color: "var(--signal-in)" },
        { label: "Forced error", value: 22, color: "var(--signal-warn)" },
        { label: "Unforced error", value: 27, color: "var(--signal-out)" },
        { label: "Unclassified", value: 12, color: "var(--signal-unknown)" }
      ],
      landings: [
        { x: 0.94, y: 10, side: "a", call: "IN" }, { x: 1.55, y: 2.04, side: "b", call: "IN" },
        { x: 0.73, y: 11.83, side: "a", call: "IN" }, { x: 1.95, y: -0.59, side: "b", call: "OUT" },
        { x: 3.52, y: 9.76, side: "a", call: "IN" }, { x: 2.77, y: 6.06, side: "b", call: "IN" },
        { x: 2.49, y: 11.59, side: "a", call: "IN" }, { x: 3.39, y: 3.67, side: "b", call: "IN" },
        { x: 5.48, y: 13.96, side: "a", call: "UNKNOWN" }, { x: 6.64, y: 1.15, side: "b", call: "UNKNOWN" },
        { x: 6.61, y: 11.56, side: "a", call: "OUT" }, { x: 1.9, y: -0.6, side: "b", call: "OUT" },
        { x: 2.99, y: 11.8, side: "a", call: "UNKNOWN" }, { x: 4.29, y: 4.38, side: "b", call: "UNKNOWN" },
        { x: 0.52, y: 10.34, side: "a", call: "IN" }, { x: 2.83, y: 2.55, side: "b", call: "IN" },
        { x: 2.72, y: 9.37, side: "a", call: "IN" }, { x: 2.4, y: 2.1, side: "b", call: "IN" },
        { x: 3.42, y: 10.26, side: "a", call: "IN" }, { x: 0.94, y: 4.26, side: "b", call: "IN" },
        { x: -0.28, y: 10.86, side: "a", call: "UNKNOWN" }, { x: 6.52, y: 0.59, side: "b", call: "OUT" },
        { x: 2.78, y: 12.74, side: "a", call: "UNKNOWN" }, { x: 5.21, y: 2.5, side: "b", call: "IN" },
        { x: 2.93, y: 10.12, side: "a", call: "IN" }, { x: 2.85, y: -0.52, side: "b", call: "OUT" },
        { x: 3.51, y: 13.81, side: "a", call: "OUT" }, { x: 5.81, y: 5.03, side: "b", call: "IN" }
      ],
      axes: [
        { label: "Longitudinal", options: ["rear", "mid", "front"], value: "rear" },
        { label: "Lateral", options: ["forehand", "centre", "backhand"], value: "forehand" },
        { label: "Timing", options: ["early", "normal", "late"], value: "normal" },
        { label: "Intention", options: ["offensive", "neutral", "defensive"], value: "offensive" },
        { label: "Impact", options: ["above", "shoulder", "below"], value: "above" },
        { label: "Direction", options: ["straight", "cross", "centre"], value: "cross" }
      ]
    };
  })(typeof globalThis !== "undefined" ? globalThis : window);
  
  /* src/review.js */
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
  
  /* src/state.js */
  /* UI state is serialisable so storage and runtime messages share one contract. */
  (function (root) {
    "use strict";
  
    var LABEL_STORE_VERSION = 1;
    var UNSCOPED_LABEL_KEY = "legacy:unscoped";
    var defaults = {
      enabled: false,
      seeded: false,
      seeding: false,
      labeling: false,
      stale: false,
      cameraCut: false,
      videoKey: null,
      videoUrl: null,
      // manualLabels is the active-video compatibility projection. The durable
      // source of truth is manualLabelsByVideo below.
      manualLabels: [],
      manualLabelsByVideo: {},
      labelUndoByVideo: {},
      manualLabelsVersion: LABEL_STORE_VERSION,
      lastEdit: null,
      // Evidence visibility is independent from analyzer execution. These
      // preferences survive every live result rerender; unavailable groups keep
      // their remembered value without implying that evidence exists.
      // The default video layer is evidence-only: pose, shuttle, and any
      // supplied racket signal. Player boxes remain an explicit opt-in so the
      // picture stays clear while the underlying runtime still analyzes them.
      trackerSettings: { court: true, players: false, body: true, shuttle: true, racket: true },
      // seedPoints are the committed, normalized outer-corner correspondences.
      seedPoints: [],
      // A draft is deliberately separate so Cancel can preserve a prior court.
      seedDraftPoints: [],
      // Kept for migration from the first movable court-card implementation.
      seedCardPosition: null,
      // Overlay geometry is normalized to the video rectangle and scoped by
      // video so theater/fullscreen changes can clamp it without touching video.
      panelLayouts: {},
      panelLayoutsByVideo: {},
      calibration: null,
      calibrationError: null,
      rally: 14,
      time: "12:04.320",
      density: "minimal",
      // Panels are on-demand furniture. Minimal starts with only the normalized
      // detection layer and the compact in-video access point; the popup is the
      // canonical place to choose persistent panel visibility.
      panels: { feed: false, stats: false, map: false, evidence: false, controls: false },
      // Explicit panel choices override density presets while the preference
      // still gives Balanced/Full a useful default presentation. Both the
      // effective values and overrides are scoped to the active video.
      panelOverrides: {},
      panelsByVideo: {},
      panelOverridesByVideo: {},
      trackerSettingsByVideo: {},
      // Collapse state mirrors panel geometry: per panel, scoped by video, so a
      // collapsed panel stays collapsed for that video only.
      collapsedPanels: {},
      collapsedPanelsByVideo: {},
      // The court-setup line overlay is a show/hide preference scoped by video.
      // Absent entries mean visible (the default); only explicit hides are kept.
      courtLinesByVideo: {},
    };
  
    function clone(value) {
      if (value == null || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(clone);
      var result = {};
      Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
      return result;
    }
  
    function copyPoints(points) {
      return Array.isArray(points) ? points.map(function (point) {
        return point && typeof point === "object" ? { x: point.x, y: point.y } : point;
      }) : [];
    }
  
    function copyCardPosition(position) {
      if (!position || typeof position !== "object") return null;
      var x = Number(position.x);
      var y = Number(position.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }
  
    var PANEL_LAYOUT_KEYS = ["courtSetup", "stats", "map", "feed", "manual", "controls", "evidence"];
  
    function copyPanelLayout(layout) {
      if (!layout || typeof layout !== "object") return null;
      var result = {};
      ["x", "y", "width", "height"].forEach(function (key) {
        if (layout[key] == null || layout[key] === "") return;
        var value = Number(layout[key]);
        if (!Number.isFinite(value)) return;
        value = Math.max(0, Math.min(1, value));
        if ((key === "width" || key === "height") && value === 0) return;
        result[key] = value;
      });
      return Object.keys(result).length ? result : null;
    }
  
    function copyPanelLayouts(layouts) {
      var result = {};
      if (!layouts || typeof layouts !== "object") return result;
      PANEL_LAYOUT_KEYS.forEach(function (key) {
        var layout = copyPanelLayout(layouts[key]);
        if (layout) result[key] = layout;
      });
      return result;
    }
  
    function copyPanelLayoutMap(raw) {
      var result = {};
      if (!raw || typeof raw !== "object") return result;
      Object.keys(raw).forEach(function (key) {
        var layouts = copyPanelLayouts(raw[key]);
        if (Object.keys(layouts).length) result[String(key)] = layouts;
      });
      return result;
    }
  
    function panelLayoutsForVideo(stateOrMap, videoKey) {
      var map = stateOrMap && stateOrMap.panelLayoutsByVideo ? stateOrMap.panelLayoutsByVideo : stateOrMap;
      if (!map || videoKey == null || !map[String(videoKey)]) return {};
      return copyPanelLayouts(map[String(videoKey)]);
    }
  
    // Panels that are overlay furniture (not the transient court-setup card)
    // get a header collapse/expand affordance; state mirrors layout persistence.
    var PANEL_COLLAPSE_KEYS = ["stats", "map", "feed", "manual", "controls", "evidence"];
  
    function copyPanelCollapseState(collapsed) {
      var result = {};
      if (!collapsed || typeof collapsed !== "object") return result;
      PANEL_COLLAPSE_KEYS.forEach(function (key) {
        if (collapsed[key] === true) result[key] = true;
      });
      return result;
    }
  
    function copyPanelCollapseMap(raw) {
      var result = {};
      if (!raw || typeof raw !== "object") return result;
      Object.keys(raw).forEach(function (key) {
        var collapsed = copyPanelCollapseState(raw[key]);
        if (Object.keys(collapsed).length) result[String(key)] = collapsed;
      });
      return result;
    }
  
    function collapsedPanelsForVideo(stateOrMap, videoKey) {
      var map = stateOrMap && stateOrMap.collapsedPanelsByVideo ? stateOrMap.collapsedPanelsByVideo : stateOrMap;
      if (!map || videoKey == null || !map[String(videoKey)]) return {};
      return copyPanelCollapseState(map[String(videoKey)]);
    }
  
    function copyCourtLinesMap(raw) {
      var result = {};
      if (!raw || typeof raw !== "object") return result;
      Object.keys(raw).forEach(function (key) {
        if (raw[key] === false) result[String(key)] = false;
      });
      return result;
    }
  
    function copyRecords(records) {
      return Array.isArray(records) ? records.map(clone) : [];
    }
  
    function copyEdit(edit) { return edit && typeof edit === "object" ? clone(edit) : null; }
  
    var PANEL_VISIBILITY_KEYS = ["feed", "stats", "map", "evidence", "controls"];
    function copyPanelVisibility(panels) {
      var result = {};
      if (!panels || typeof panels !== "object") return result;
      PANEL_VISIBILITY_KEYS.forEach(function (key) {
        if (panels[key] != null) result[key] = Boolean(panels[key]);
      });
      return result;
    }
    function copyPanelVisibilityMap(raw) {
      var result = {};
      if (!raw || typeof raw !== "object") return result;
      Object.keys(raw).forEach(function (key) {
        var panels = copyPanelVisibility(raw[key]);
        if (Object.keys(panels).length) result[String(key)] = panels;
      });
      return result;
    }
    function copyPanelOverrides(overrides) {
      return copyPanelVisibility(overrides);
    }
    function copyPanelOverridesMap(raw) {
      return copyPanelVisibilityMap(raw);
    }
    function copyTrackerSettings(settings) {
      var result = {};
      if (!settings || typeof settings !== "object") return result;
      Object.keys(defaults.trackerSettings).forEach(function (key) {
        if (settings[key] != null) result[key] = Boolean(settings[key]);
      });
      return result;
    }
    function copyTrackerSettingsMap(raw) {
      var result = {};
      if (!raw || typeof raw !== "object") return result;
      Object.keys(raw).forEach(function (key) {
        var settings = copyTrackerSettings(raw[key]);
        if (Object.keys(settings).length) result[String(key)] = settings;
      });
      return result;
    }
    function panelsForDensity(density, overrides) {
      var panels = {
        // Minimal is deliberately evidence-only. Balanced and Full retain the
        // existing richer presets without making them the default experience.
        feed: density !== "minimal",
        stats: density !== "minimal",
        map: density === "full",
        evidence: density === "full",
        controls: density !== "minimal"
      };
      Object.keys(overrides || {}).forEach(function (key) {
        panels[key] = Boolean(overrides[key]);
      });
      return panels;
    }
    function withPanelPreferences(current, panels, overrides) {
      var panelMap = copyPanelVisibilityMap(current.panelsByVideo);
      var overrideMap = copyPanelOverridesMap(current.panelOverridesByVideo);
      var key = current.videoKey == null ? null : String(current.videoKey);
      if (key) {
        panelMap[key] = copyPanelVisibility(panels);
        overrideMap[key] = copyPanelOverrides(overrides);
      }
      return initialExtensionState(Object.assign({}, current, {
        panels: Object.assign({}, defaults.panels, panels || {}),
        panelOverrides: copyPanelOverrides(overrides),
        panelsByVideo: panelMap,
        panelOverridesByVideo: overrideMap
      }));
    }
    function withTrackerPreferences(current, trackerSettings) {
      var trackerMap = copyTrackerSettingsMap(current.trackerSettingsByVideo);
      var key = current.videoKey == null ? null : String(current.videoKey);
      if (key) trackerMap[key] = copyTrackerSettings(trackerSettings);
      return initialExtensionState(Object.assign({}, current, {
        trackerSettings: Object.assign({}, defaults.trackerSettings, trackerSettings || {}),
        trackerSettingsByVideo: trackerMap
      }));
    }
    function timestamp(value) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value !== "string" || !value.trim()) return null;
      var text = value.trim();
      if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
      var parts = text.split(":");
      if (parts.length !== 2) return null;
      var minutes = Number(parts[0]);
      var seconds = Number(parts[1]);
      return Number.isFinite(minutes) && Number.isFinite(seconds) ? minutes * 60 + seconds : null;
    }
  
    function formatMediaTime(seconds) {
      if (!Number.isFinite(seconds)) return "";
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
  
    function hash(text) {
      var result = 2166136261;
      String(text || "").split("").forEach(function (character) {
        result ^= character.charCodeAt(0);
        result = Math.imul(result, 16777619);
      });
      return (result >>> 0).toString(36);
    }
  
    function createManualEventId(videoKey, startSec, records) {
      var base = "manual-" + hash(videoKey || UNSCOPED_LABEL_KEY) + "-" + (Number.isFinite(Number(startSec)) ? Math.round(Number(startSec) * 1000) : "point");
      var used = Object.create(null);
      (Array.isArray(records) ? records : []).forEach(function (record) {
        if (record && record.eventId != null) used[String(record.eventId)] = true;
      });
      if (!used[base]) return base;
      var suffix = 2;
      while (used[base + "-" + suffix]) suffix += 1;
      return base + "-" + suffix;
    }
  
    function normalizeLabel(record, index, videoKey, options) {
      var value = clone(record || {});
      var key = videoKey || UNSCOPED_LABEL_KEY;
      if (value.eventId == null && value.id != null) value.eventId = value.id;
      if (value.eventId == null || String(value.eventId) === "") {
        var generatedId = createManualEventId(key, timestamp(value.startSec != null ? value.startSec : value.time), []);
        value.eventId = generatedId + (index ? "-" + index : "");
      }
      value.eventId = String(value.eventId);
      var start = timestamp(value.startSec != null ? value.startSec : (value.start_media_time != null ? value.start_media_time : value.startTime != null ? value.startTime : value.time));
      var end = timestamp(value.endSec != null ? value.endSec : (value.end_media_time != null ? value.end_media_time : value.endTime));
      if (start != null && start >= 0) {
        value.startSec = start;
        if (value.time == null) value.time = formatMediaTime(start);
      }
      if (end != null && end >= 0) value.endSec = end;
      if (value.shot == null && value.label != null) value.shot = value.label;
      if (value.source == null) value.source = value.provenance || "manual";
      if (value.provenance == null) value.provenance = value.source;
      if (value.createdAt == null) value.createdAt = nowIso(options);
      if (value.updatedAt == null) value.updatedAt = value.createdAt;
      return value;
    }
  
    function mergeLabelValues(previous, value) {
      var merged = Object.assign({}, previous || {}, value || {});
      if (value && value.source === "manual") {
        ["confidence", "classification_confidence", "geometry_confidence"].forEach(function (field) {
          if (!Object.prototype.hasOwnProperty.call(value, field)) delete merged[field];
        });
      }
      return merged;
    }
  
    function mergeRecords(base, additions, videoKey, options) {
      var result = [];
      var positions = Object.create(null);
      (Array.isArray(base) ? base : []).forEach(function (record, index) {
        var value = normalizeLabel(record, index, videoKey, options);
        var id = String(value.eventId);
        if (positions[id] == null) {
          positions[id] = result.length;
          result.push(value);
        } else result[positions[id]] = mergeLabelValues(result[positions[id]], value);
      });
      (Array.isArray(additions) ? additions : []).forEach(function (record, index) {
        var value = normalizeLabel(record, index, videoKey, options);
        var id = String(value.eventId);
        if (positions[id] == null) {
          positions[id] = result.length;
          result.push(value);
        } else result[positions[id]] = mergeLabelValues(result[positions[id]], value);
      });
      return result;
    }
  
    function copyLabelMap(raw, options) {
      var result = {};
      if (!raw || typeof raw !== "object") return result;
      Object.keys(raw).forEach(function (key) {
        var entry = raw[key];
        var records = Array.isArray(entry) ? entry : entry && typeof entry === "object" && (entry.labels || entry.records);
        if (!Array.isArray(records)) return;
        result[String(key)] = mergeRecords([], records, String(key), options);
      });
      return result;
    }
  
    function copyUndoMap(raw) {
      var result = {};
      if (!raw || typeof raw !== "object") return result;
      Object.keys(raw).forEach(function (key) {
        if (raw[key] && typeof raw[key] === "object") result[String(key)] = copyEdit(raw[key]);
      });
      return result;
    }
  
    function mapKeys(map) { return Object.keys(map || {}).filter(function (key) { return Array.isArray(map[key]); }); }
  
    // YouTube's video id is stable across theater/fullscreen and query ordering.
    // A canonical, fragment-free URL is the safe fallback for other media pages.
    function videoKeyForUrl(url) {
      var text = String(url || "");
      var parsed = null;
      try { if (typeof URL === "function") parsed = new URL(text); } catch (_) { parsed = null; }
      if (parsed && /^https?:$/.test(parsed.protocol)) {
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
        try { parsed.searchParams.forEach(function (value, key) { query.push([key, value]); }); } catch (_) {}
        query.sort(function (a, b) { return a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]); });
        var search = query.map(function (pair) { return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]); }).join("&");
        return "url:" + parsed.origin + parsed.pathname + (search ? "?" + search : "");
      }
      // The extension has URL in the browser, but keep normalization usable in
      // storage migrations and Node/unit-test sandboxes without that global.
      var youtubeMatch = text.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i);
      if (youtubeMatch) {
        var queryMatch = text.match(/[?&]v=([^&#]+)/i);
        var pathMatch = text.match(/\/(?:shorts|embed|live)\/([^/?#]+)/i) || text.match(/^https?:\/\/youtu\.be\/([^/?#]+)/i);
        var fallbackId = queryMatch && queryMatch[1] || pathMatch && pathMatch[1];
        if (fallbackId) {
          try { fallbackId = decodeURIComponent(fallbackId); } catch (_) {}
          return "youtube:" + fallbackId;
        }
      }
      var fallbackUrl = text.replace(/#.*$/, "").match(/^(https?:\/\/)([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?$/i);
      if (fallbackUrl) {
        var fallbackHost = fallbackUrl[2].replace(/^.*@/, "");
        var fallbackPath = fallbackUrl[3] || "/";
        var fallbackQuery = (fallbackUrl[4] || "").split("&").filter(Boolean).sort().join("&");
        return "url:" + fallbackUrl[1].toLowerCase() + fallbackHost.toLowerCase() + fallbackPath + (fallbackQuery ? "?" + fallbackQuery : "");
      }
      return "url:" + text.replace(/#.*$/, "");
    }
  
    function labelsForVideo(stateOrMap, videoKey) {
      var map = stateOrMap && stateOrMap.manualLabelsByVideo ? stateOrMap.manualLabelsByVideo : stateOrMap;
      if (!map || videoKey == null || !Array.isArray(map[String(videoKey)])) return [];
      return copyRecords(map[String(videoKey)]);
    }
  
    function stateForVideo(input, videoKey, options) {
      var current = initialExtensionState(input, options);
      var key = videoKey == null ? current.videoKey : String(videoKey);
      // The first active page is the only safe destination for an old global
      // array. Once migrated, subsequent videos only see their own map entry.
      if (key && !current.videoKey) {
        if (current.manualLabels.length && !mapKeys(current.manualLabelsByVideo).length) current.manualLabelsByVideo[key] = copyRecords(current.manualLabels);
        if (Object.keys(current.panelLayouts).length) current.panelLayoutsByVideo[key] = copyPanelLayouts(current.panelLayouts);
        if (Object.keys(current.collapsedPanels).length) current.collapsedPanelsByVideo[key] = copyPanelCollapseState(current.collapsedPanels);
        current.videoKey = key;
      }
      if (!key || current.videoKey === key) {
        current.videoKey = key || current.videoKey;
        if (current.videoKey != null && Object.prototype.hasOwnProperty.call(current.manualLabelsByVideo, String(current.videoKey))) {
          current.manualLabels = labelsForVideo(current, current.videoKey);
        }
        current.lastEdit = copyEdit(current.labelUndoByVideo[current.videoKey]) || current.lastEdit;
        return initialExtensionState(current, options);
      }
      return resetVideoLocalState(current, key, options);
    }
  
    function initialExtensionState(overrides, options) {
      var raw = overrides || {};
      var value = Object.assign({}, defaults, raw);
      value.panels = Object.assign({}, defaults.panels, raw.panels || {});
      value.panelOverrides = copyPanelOverrides(raw.panelOverrides);
      value.panelsByVideo = copyPanelVisibilityMap(raw.panelsByVideo);
      value.panelOverridesByVideo = copyPanelOverridesMap(raw.panelOverridesByVideo);
      value.trackerSettingsByVideo = copyTrackerSettingsMap(raw.trackerSettingsByVideo);
      value.seedPoints = copyPoints(raw.seedPoints);
      value.seedDraftPoints = copyPoints(raw.seedDraftPoints);
      value.seedCardPosition = copyCardPosition(raw.seedCardPosition);
      value.panelLayoutsByVideo = copyPanelLayoutMap(raw.panelLayoutsByVideo);
      value.panelLayouts = copyPanelLayouts(raw.panelLayouts);
      value.collapsedPanelsByVideo = copyPanelCollapseMap(raw.collapsedPanelsByVideo);
      value.collapsedPanels = copyPanelCollapseState(raw.collapsedPanels);
      value.courtLinesByVideo = copyCourtLinesMap(raw.courtLinesByVideo);
      // Migrate a saved court-card position without retaining the old visible
      // grip affordance. New writes use the generic per-panel layout contract.
      if (value.seedCardPosition && !value.panelLayouts.courtSetup) value.panelLayouts.courtSetup = copyPanelLayout(value.seedCardPosition);
      if (raw.videoKey != null) {
        var panelVideoKey = String(raw.videoKey);
        if (Object.keys(value.panelLayouts).length) value.panelLayoutsByVideo[panelVideoKey] = Object.assign({}, value.panelLayoutsByVideo[panelVideoKey] || {}, copyPanelLayouts(value.panelLayouts));
        if (value.panelLayoutsByVideo[panelVideoKey]) value.panelLayouts = copyPanelLayouts(value.panelLayoutsByVideo[panelVideoKey]);
        if (Object.keys(value.collapsedPanels).length) value.collapsedPanelsByVideo[panelVideoKey] = Object.assign({}, value.collapsedPanelsByVideo[panelVideoKey] || {}, copyPanelCollapseState(value.collapsedPanels));
        if (value.collapsedPanelsByVideo[panelVideoKey]) value.collapsedPanels = copyPanelCollapseState(value.collapsedPanelsByVideo[panelVideoKey]);
        // Legacy states stored the active visibility preferences directly. Move
        // those values into the video-local maps once, while new states always
        // read the map entry instead of leaking another video's choices.
        if (!Object.prototype.hasOwnProperty.call(raw, "panelsByVideo") && raw.panels) {
          // The previous minimal default showed the feed and evidence controls.
          // Treat that legacy shape as a migration, not as a fresh opt-in; keep
          // deliberate SET_PANELS choices through panelOverrides and preserve a
          // deliberately selected Balanced/Full density preset.
          value.panelsByVideo[panelVideoKey] = copyPanelVisibility(panelsForDensity(raw.density || "minimal", raw.panelOverrides));
        }
        if (!Object.prototype.hasOwnProperty.call(raw, "panelOverridesByVideo") && raw.panelOverrides) value.panelOverridesByVideo[panelVideoKey] = copyPanelOverrides(raw.panelOverrides);
        if (!Object.prototype.hasOwnProperty.call(raw, "trackerSettingsByVideo") && raw.trackerSettings) value.trackerSettingsByVideo[panelVideoKey] = copyTrackerSettings(raw.trackerSettings);
        if (value.panelOverridesByVideo[panelVideoKey]) value.panelOverrides = copyPanelOverrides(value.panelOverridesByVideo[panelVideoKey]);
        if (value.panelsByVideo[panelVideoKey]) value.panels = Object.assign({}, defaults.panels, value.panelsByVideo[panelVideoKey]);
        if (value.trackerSettingsByVideo[panelVideoKey]) value.trackerSettings = Object.assign({}, defaults.trackerSettings, value.trackerSettingsByVideo[panelVideoKey]);
      }
      var labelOptions = options || {};
      var mapSource = raw.manualLabelsByVideo || raw.labelsByVideo || (raw.manualLabelStore && raw.manualLabelStore.videos) || {};
      value.manualLabelsByVideo = copyLabelMap(mapSource, labelOptions);
      value.labelUndoByVideo = copyUndoMap(raw.labelUndoByVideo);
      if (raw.videoKey != null && raw.lastEdit && !value.labelUndoByVideo[String(raw.videoKey)]) value.labelUndoByVideo[String(raw.videoKey)] = copyEdit(raw.lastEdit);
      value.manualLabelsVersion = Number(raw.manualLabelsVersion || (raw.manualLabelStore && raw.manualLabelStore.version)) || LABEL_STORE_VERSION;
      var legacy = copyRecords(raw.manualLabels);
      if (legacy.length && raw.videoKey != null) {
        var legacyKey = String(raw.videoKey);
        value.manualLabelsByVideo[legacyKey] = mergeRecords(value.manualLabelsByVideo[legacyKey], legacy, legacyKey, labelOptions);
      } else if (legacy.length && mapKeys(value.manualLabelsByVideo).length) {
        // Keep an old unscoped array intact when a newer per-video store already
        // exists. It is retained for a deliberate future migration, never shown
        // on a known video where it could be mistaken for that video's labels.
        value.manualLabelsByVideo[UNSCOPED_LABEL_KEY] = mergeRecords(value.manualLabelsByVideo[UNSCOPED_LABEL_KEY], legacy, UNSCOPED_LABEL_KEY, labelOptions);
      }
      value.manualLabels = legacy.map(function (record, index) { return normalizeLabel(record, index, raw.videoKey || UNSCOPED_LABEL_KEY, labelOptions); });
      if (raw.videoKey != null && value.manualLabelsByVideo[String(raw.videoKey)]) value.manualLabels = copyRecords(value.manualLabelsByVideo[String(raw.videoKey)]);
      value.lastEdit = copyEdit(raw.lastEdit);
      if (raw.videoKey != null && value.labelUndoByVideo[String(raw.videoKey)]) value.lastEdit = copyEdit(value.labelUndoByVideo[String(raw.videoKey)]);
      value.trackerSettings = Object.assign({}, defaults.trackerSettings, raw.trackerSettings || {});
      return value;
    }
  
    function resetVideoLocalState(state, videoKey, options) {
      var current = initialExtensionState(state, options);
      var key = videoKey == null ? current.videoKey : String(videoKey);
      var labels = labelsForVideo(current, key);
      var undo = copyEdit(current.labelUndoByVideo[key]);
      return initialExtensionState(Object.assign({}, current, {
        enabled: false,
        seeded: false,
        seeding: false,
        labeling: false,
        stale: false,
        cameraCut: false,
        videoKey: key,
        videoUrl: videoKey == null || key === current.videoKey ? current.videoUrl : null,
        seedPoints: [],
        seedDraftPoints: [],
        seedCardPosition: null,
        calibration: null,
        calibrationError: null,
        // Visibility is video-local too. Start a new video from the minimal
        // evidence-only defaults, then let initialExtensionState apply any
        // preferences explicitly saved for that key.
        panels: defaults.panels,
        panelOverrides: {},
        trackerSettings: defaults.trackerSettings,
        panelLayouts: panelLayoutsForVideo(current, key),
        collapsedPanels: collapsedPanelsForVideo(current, key),
        manualLabels: labels,
        lastEdit: undo
      }), options);
    }
  
    function without(records, eventId) {
      return (Array.isArray(records) ? records : []).filter(function (record) {
        return record && String(record.eventId) !== String(eventId);
      }).map(clone);
    }
  
    function upsert(records, record) {
      var next = copyRecords(records);
      var id = record && record.eventId != null ? String(record.eventId) : null;
      var index = id == null ? -1 : next.findIndex(function (item) { return item && String(item.eventId) === id; });
      if (index < 0) next.push(clone(record));
      else next[index] = mergeLabelValues(next[index], clone(record));
      return next;
    }
  
    function undoLabels(records, edit) {
      if (!edit || edit.eventId == null) return copyRecords(records);
      var result = without(records, edit.eventId);
      if (edit.previousLabel) result = upsert(result, edit.previousLabel);
      return result;
    }
  
    function reduceExtensionState(state, action) {
      var current = initialExtensionState(state);
      switch (action && action.type) {
        case "ENABLE": return Object.assign(current, { enabled: true, seeding: !current.seeded });
        case "DISABLE": return Object.assign(current, { enabled: false, seeding: false, labeling: false, stale: false, cameraCut: false });
        case "OPEN_OVERLAY": return Object.assign(current, { enabled: true, labeling: false });
        case "START_SEED": return Object.assign(current, { enabled: true, seeding: true, labeling: false, seedDraftPoints: [], calibrationError: null });
        case "SET_SEED_DRAFT": return Object.assign(current, { seedDraftPoints: copyPoints(action.points), calibrationError: action.error || null });
        case "SET_SEED_CARD_POSITION": return Object.assign(current, { seedCardPosition: copyCardPosition(action.position) });
        case "SET_PANEL_LAYOUT": {
          if (PANEL_LAYOUT_KEYS.indexOf(action.panel) < 0) return current;
          var layoutKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
          var nextLayouts = layoutKey && current.videoKey !== layoutKey
            ? panelLayoutsForVideo(current, layoutKey)
            : copyPanelLayouts(current.panelLayouts);
          var nextLayout = copyPanelLayout(action.layout);
          if (nextLayout) nextLayouts[action.panel] = nextLayout;
          else delete nextLayouts[action.panel];
          var nextLayoutMap = copyPanelLayoutMap(current.panelLayoutsByVideo);
          if (layoutKey) nextLayoutMap[layoutKey] = copyPanelLayouts(nextLayouts);
          return initialExtensionState(Object.assign({}, current, { videoKey: layoutKey || current.videoKey, seedCardPosition: null, panelLayouts: nextLayouts, panelLayoutsByVideo: nextLayoutMap }));
        }
        case "RESET_PANEL_LAYOUT": return reduceExtensionState(current, { type: "SET_PANEL_LAYOUT", videoKey: action.videoKey, panel: action.panel, layout: null });
        case "LOCK_COURT": return Object.assign(current, {
          enabled: true,
          seeded: true,
          seeding: false,
          cameraCut: false,
          stale: false,
          calibration: action.calibration || current.calibration,
          seedPoints: copyPoints(action.seedPoints || current.seedPoints),
          seedDraftPoints: [],
          calibrationError: null
        });
        case "RESET_COURT": return Object.assign(current, {
          seeded: false,
          seeding: true,
          cameraCut: false,
          stale: false,
          calibration: null,
          seedPoints: [],
          seedDraftPoints: [],
          seedCardPosition: null,
          calibrationError: null
        });
        case "OPEN_LABELING": return Object.assign(current, { labeling: true, seeding: false });
        case "CLOSE_LABELING": return Object.assign(current, { labeling: false });
        case "SET_DENSITY": {
          var density = ["minimal", "balanced", "full"].indexOf(action.value) >= 0 ? action.value : current.density;
          // Density presets decide only the density-driven panels; explicit
          // toggles (including Evidence visibility) always win and survive.
          return withPanelPreferences(Object.assign({}, current, { density: density }), Object.assign({}, current.panels, panelsForDensity(density, current.panelOverrides)), current.panelOverrides);
        }
        case "TOGGLE_PANEL": {
          if (PANEL_VISIBILITY_KEYS.indexOf(action.panel) < 0) return current;
          var panelValue = Boolean(action.value);
          return withPanelPreferences(current, Object.assign({}, current.panels, { [action.panel]: panelValue }), Object.assign({}, current.panelOverrides, { [action.panel]: panelValue }));
        }
        case "TOGGLE_PANEL_COLLAPSE": {
          if (PANEL_COLLAPSE_KEYS.indexOf(action.panel) < 0) return current;
          var collapseKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
          var nextCollapsed = collapseKey && current.videoKey !== collapseKey
            ? collapsedPanelsForVideo(current, collapseKey)
            : copyPanelCollapseState(current.collapsedPanels);
          if (action.value === false) delete nextCollapsed[action.panel];
          else nextCollapsed[action.panel] = true;
          var nextCollapseMap = copyPanelCollapseMap(current.collapsedPanelsByVideo);
          if (collapseKey) nextCollapseMap[collapseKey] = copyPanelCollapseState(nextCollapsed);
          return initialExtensionState(Object.assign({}, current, { videoKey: collapseKey || current.videoKey, collapsedPanels: nextCollapsed, collapsedPanelsByVideo: nextCollapseMap }));
        }
        case "SET_COURT_LINES": {
          var linesKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
          var nextLines = copyCourtLinesMap(current.courtLinesByVideo);
          if (action.value === false) nextLines[linesKey] = false;
          else delete nextLines[linesKey];
          return initialExtensionState(Object.assign({}, current, { videoKey: linesKey || current.videoKey, courtLinesByVideo: nextLines }));
        }
        case "SET_PANELS": {
          var nextPanels = Object.assign({}, current.panels);
          var nextOverrides = Object.assign({}, current.panelOverrides);
          Object.keys(action.panels || {}).forEach(function (key) {
            if (PANEL_VISIBILITY_KEYS.indexOf(key) < 0) return;
            nextPanels[key] = Boolean(action.panels[key]);
            nextOverrides[key] = Boolean(action.panels[key]);
          });
          return withPanelPreferences(current, nextPanels, nextOverrides);
        }
        case "SET_TRACKER": return withTrackerPreferences(current, Object.assign({}, current.trackerSettings, { [action.tracker]: Boolean(action.value) }));
        case "CREATE_LABEL":
        case "LABEL_CREATE":
        case "UPDATE_LABEL":
        case "LABEL_UPDATE": {
          var mutationLabel = action.label || action.record;
          if (!mutationLabel || mutationLabel.eventId == null) return current;
          var mutationKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
          var previousMutationLabel = (current.manualLabels || []).find(function (label) { return label && String(label.eventId) === String(mutationLabel.eventId); });
          var mutationEdit = action.lastEdit || {
            eventId: String(mutationLabel.eventId),
            operation: action.type.indexOf("CREATE") >= 0 ? "create" : "update",
            source: mutationLabel.source || "manual",
            time: mutationLabel.time,
            previousLabel: previousMutationLabel ? clone(previousMutationLabel) : null
          };
          return reduceExtensionState(current, { type: "SET_REVIEW_LABELS", videoKey: mutationKey, labels: upsert(current.manualLabels, mutationLabel), lastEdit: mutationEdit });
        }
        case "DELETE_LABEL":
        case "LABEL_DELETE": {
          var deleteKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
          var deleteId = action.eventId != null ? action.eventId : action.label && action.label.eventId;
          if (deleteId == null) return current;
          var priorDelete = (current.manualLabels || []).find(function (label) { return label && String(label.eventId) === String(deleteId); });
          return reduceExtensionState(current, { type: "SET_REVIEW_LABELS", videoKey: deleteKey, labels: without(current.manualLabels, deleteId), lastEdit: action.lastEdit || { eventId: String(deleteId), operation: "delete", source: "manual", time: priorDelete && priorDelete.time, previousLabel: priorDelete ? clone(priorDelete) : null } });
        }
        case "SET_REVIEW_LABELS": {
          var reviewKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
          var reviewLabels = copyRecords(action.labels);
          var reviewMap = copyLabelMap(current.manualLabelsByVideo);
          if (reviewKey) reviewMap[reviewKey] = reviewLabels;
          var reviewUndos = copyUndoMap(current.labelUndoByVideo);
          if (reviewKey && action.lastEdit) reviewUndos[reviewKey] = copyEdit(action.lastEdit);
          else if (reviewKey && action.lastEdit === null) delete reviewUndos[reviewKey];
          return initialExtensionState(Object.assign({}, current, {
            videoKey: reviewKey || current.videoKey,
            manualLabels: reviewLabels,
            manualLabelsByVideo: reviewMap,
            labelUndoByVideo: reviewUndos,
            lastEdit: action.lastEdit === undefined ? current.lastEdit : copyEdit(action.lastEdit),
            manualLabelsVersion: LABEL_STORE_VERSION
          }));
        }
        case "UNDO_LAST_LABEL":
        case "UNDO_LABEL": {
          var undoKey = action.videoKey != null ? String(action.videoKey) : current.videoKey;
          var undoEdit = action.edit || current.lastEdit || (undoKey && current.labelUndoByVideo[undoKey]);
          var undoResult = action.labels ? copyRecords(action.labels) : undoLabels(current.manualLabels, undoEdit);
          var undoMap = copyLabelMap(current.manualLabelsByVideo);
          var undoHistory = copyUndoMap(current.labelUndoByVideo);
          if (undoKey) { undoMap[undoKey] = undoResult; delete undoHistory[undoKey]; }
          return initialExtensionState(Object.assign({}, current, { videoKey: undoKey || current.videoKey, manualLabels: undoResult, manualLabelsByVideo: undoMap, labelUndoByVideo: undoHistory, lastEdit: null }));
        }
        case "SET_STALE": return Object.assign(current, { stale: Boolean(action.value) });
        case "CAMERA_CUT": return Object.assign(current, {
          seeded: false,
          stale: true,
          cameraCut: true,
          seeding: true,
          calibration: null,
          seedPoints: [],
          seedDraftPoints: [],
          seedCardPosition: null,
          calibrationError: null
        });
        case "VIDEO_RESET": return resetVideoLocalState(current, action.videoKey);
        default: return current;
      }
    }
  
    root.BVState = {
      defaults: defaults,
      LABEL_STORE_VERSION: LABEL_STORE_VERSION,
      UNSCOPED_LABEL_KEY: UNSCOPED_LABEL_KEY,
      initialExtensionState: initialExtensionState,
      normalizeLabel: normalizeLabel,
      normalizeLabelStore: function (input, videoKey, options) { return stateForVideo(input, videoKey, options); },
      stateForVideo: stateForVideo,
      labelsForVideo: labelsForVideo,
      PANEL_LAYOUT_KEYS: PANEL_LAYOUT_KEYS.slice(),
      PANEL_COLLAPSE_KEYS: PANEL_COLLAPSE_KEYS.slice(),
      panelLayoutsForVideo: panelLayoutsForVideo,
      collapsedPanelsForVideo: collapsedPanelsForVideo,
      courtLinesForVideo: function (stateOrMap, videoKey) {
        var map = stateOrMap && stateOrMap.courtLinesByVideo ? stateOrMap.courtLinesByVideo : stateOrMap;
        return map && videoKey != null && map[String(videoKey)] === false ? false : true;
      },
      createManualEventId: createManualEventId,
      videoKeyForUrl: videoKeyForUrl,
      resetVideoLocalState: resetVideoLocalState,
      undoLabels: undoLabels,
      reduceExtensionState: reduceExtensionState
    };
  })(typeof globalThis !== "undefined" ? globalThis : window);
  
  /* src/ui.js */
  /*
   * Small DOM implementations of the supplied design-system primitives.
   * The source components remain in design-system/components; these counterparts
   * keep the unpacked MV3 build dependency-free while consuming the same tokens.
   */
  (function (root) {
    var iconPaths = {
      activity: [["path", { d: "M22 12h-4l-3 9L9 3l-3 9H2" }]],
      "arrow-left": [["path", { d: "m12 19-7-7 7-7" }], ["path", { d: "M19 12H5" }]],
      check: [["path", { d: "m5 12 4 4L19 6" }]],
      clock: [["circle", { cx: "12", cy: "12", r: "10" }], ["polyline", { points: "12 6 12 12 16 14" }]],
      "chevron-down": [["path", { d: "m6 9 6 6 6-6" }]],
      "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
      "chevron-up": [["path", { d: "m18 15-6-6-6 6" }]],
      crosshair: [["circle", { cx: "12", cy: "12", r: "10" }], ["line", { x1: "22", y1: "12", x2: "18", y2: "12" }], ["line", { x1: "6", y1: "12", x2: "2", y2: "12" }], ["line", { x1: "12", y1: "6", x2: "12", y2: "2" }], ["line", { x1: "12", y1: "22", x2: "12", y2: "18" }]],
      download: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["polyline", { points: "7 10 12 15 17 10" }], ["line", { x1: "12", y1: "15", x2: "12", y2: "3" }]],
      upload: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["polyline", { points: "17 8 12 3 7 8" }], ["line", { x1: "12", y1: "3", x2: "12", y2: "15" }]],
      external: [["path", { d: "M15 3h6v6" }], ["path", { d: "M10 14 21 3" }], ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }]],
      filter: [["polygon", { points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" }]],
      grip: [["circle", { cx: "9", cy: "5", r: "1" }], ["circle", { cx: "15", cy: "5", r: "1" }], ["circle", { cx: "9", cy: "12", r: "1" }], ["circle", { cx: "15", cy: "12", r: "1" }], ["circle", { cx: "9", cy: "19", r: "1" }], ["circle", { cx: "15", cy: "19", r: "1" }]],
      help: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }], ["line", { x1: "12", y1: "17", x2: "12.01", y2: "17" }]],
      info: [["circle", { cx: "12", cy: "12", r: "10" }], ["line", { x1: "12", y1: "16", x2: "12", y2: "12" }], ["line", { x1: "12", y1: "8", x2: "12.01", y2: "8" }]],
      layout: [["rect", { x: "3", y: "3", width: "7", height: "7" }], ["rect", { x: "14", y: "3", width: "7", height: "7" }], ["rect", { x: "14", y: "14", width: "7", height: "7" }], ["rect", { x: "3", y: "14", width: "7", height: "7" }]],
      list: [["line", { x1: "8", y1: "6", x2: "21", y2: "6" }], ["line", { x1: "8", y1: "12", x2: "21", y2: "12" }], ["line", { x1: "8", y1: "18", x2: "21", y2: "18" }], ["line", { x1: "3", y1: "6", x2: "3.01", y2: "6" }], ["line", { x1: "3", y1: "12", x2: "3.01", y2: "12" }], ["line", { x1: "3", y1: "18", x2: "3.01", y2: "18" }]],
      maximize: [["path", { d: "M8 3H5a2 2 0 0 0-2 2v3" }], ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3" }], ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3" }], ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3" }]],
      pause: [["rect", { x: "6", y: "4", width: "4", height: "16" }], ["rect", { x: "14", y: "4", width: "4", height: "16" }]],
      pencil: [["path", { d: "M12 20h9" }], ["path", { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" }]],
      play: [["polygon", { points: "6 3 20 12 6 21 6 3" }]],
      settings: [["path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }], ["circle", { cx: "12", cy: "12", r: "3" }]],
      sliders: [["line", { x1: "4", y1: "21", x2: "4", y2: "14" }], ["line", { x1: "4", y1: "10", x2: "4", y2: "3" }], ["line", { x1: "12", y1: "21", x2: "12", y2: "12" }], ["line", { x1: "12", y1: "8", x2: "12", y2: "3" }], ["line", { x1: "20", y1: "21", x2: "20", y2: "16" }], ["line", { x1: "20", y1: "12", x2: "20", y2: "3" }], ["line", { x1: "2", y1: "14", x2: "6", y2: "14" }], ["line", { x1: "10", y1: "8", x2: "14", y2: "8" }], ["line", { x1: "18", y1: "16", x2: "22", y2: "16" }]],
      table: [["path", { d: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18" }]],
      volume: [["polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }], ["path", { d: "M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" }]],
      x: [["line", { x1: "18", y1: "6", x2: "6", y2: "18" }], ["line", { x1: "6", y1: "6", x2: "18", y2: "18" }]],
      "triangle-alert": [["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }], ["line", { x1: "12", y1: "9", x2: "12", y2: "13" }], ["line", { x1: "12", y1: "17", x2: "12.01", y2: "17" }]]
    };
  
    function el(tag, attrs, children) {
      var node = document.createElement(tag);
      attrs = attrs || {};
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value == null) return;
        // ARIA state is string-valued. Treating true as a presence-only
        // attribute produced aria-checked="" and broke both styling and assistive
        // state; false also needs to remain explicit for switches/radios.
        if (key.slice(0, 5) === "aria-" && typeof value === "boolean") {
          node.setAttribute(key, String(value));
          return;
        }
        if (value === false) return;
        if (key === "className") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
        else if (key === "dataset") Object.keys(value).forEach(function (dataKey) { node.dataset[dataKey] = value[dataKey]; });
        else if (key.slice(0, 2) === "on" && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === "checked") node.checked = Boolean(value);
        else if (key === "disabled") node.disabled = Boolean(value);
        else if (key === "html") node.innerHTML = value;
        else node.setAttribute(key, value === true ? "" : value);
      });
      (Array.isArray(children) ? children : [children]).forEach(function (child) {
        if (child == null || child === false) return;
        node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
      });
      return node;
    }
  
    function svgEl(tag, attrs) {
      var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
      return node;
    }
  
    function icon(name, size) {
      var svg = svgEl("svg", { xmlns: "http://www.w3.org/2000/svg", width: size || 16, height: size || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
      (iconPaths[name] || iconPaths.info).forEach(function (item) { var child = svgEl(item[0], item[1]); svg.appendChild(child); });
      return svg;
    }
  
    function button(label, opts) {
      opts = opts || {};
      var children = [];
      if (opts.icon) children.push(icon(opts.icon, opts.iconSize || 16));
      children.push(label);
      if (opts.iconRight) children.push(icon(opts.iconRight, opts.iconSize || 13));
      var attrs = { className: "bv-button " + (opts.variant || "secondary") + (opts.size ? " " + opts.size : "") + (opts.full ? " full" : ""), type: "button", disabled: opts.disabled, title: opts.title, "aria-pressed": opts.pressed, onClick: opts.onClick, style: opts.style };
      return el("button", attrs, children);
    }
  
    function iconButton(name, label, opts) {
      opts = opts || {};
      return el("button", { className: "bv-icon-button " + (opts.size || "") + (opts.variant || "") + (opts.active ? " active" : ""), type: "button", "aria-label": label, title: label, disabled: opts.disabled, onClick: opts.onClick }, [icon(name, opts.iconSize || 14)]);
    }
  
    var badgeTone = { neutral: "neutral", accent: "accent", in: "in", out: "out", warn: "warn", info: "info", unknown: "unknown" };
    function badge(text, tone, uppercase) { return el("span", { className: "bv-badge " + (badgeTone[tone] || "neutral"), style: uppercase === false ? { textTransform: "none", letterSpacing: "0" } : null }, [text]); }
    function kbd(text, accent) { return el("kbd", { className: "bv-kbd" + (accent ? " accent" : "") }, [text]); }
  
    function confidence(value, opts) {
      opts = opts || {};
      var band = value == null ? "unknown" : value >= .75 ? "high" : value >= .45 ? "medium" : "low";
      var count = value == null ? 0 : Math.max(1, Math.round(value * 4));
      var segments = el("span", { className: "bv-confidence-segments " + band });
      for (var i = 0; i < 4; i += 1) segments.appendChild(el("i", { className: i < count ? "filled" : "" }));
      var label = opts.label ? el("span", { className: "bv-label" }, [opts.label]) : null;
      var word = band === "high" ? "sure" : band === "medium" ? "fairly sure" : band === "low" ? "not sure" : "unknown";
      var valueText = value == null ? "unknown" : (opts.showWord ? word + " " : "") + Math.round(value * 100) + "%";
      return el("span", { className: "bv-confidence " + band, title: value == null ? "confidence unknown" : "confidence " + Math.round(value * 100) + "%" }, [label, segments, (opts.showValue !== false || opts.showWord) ? el("span", { className: "bv-confidence-value" }, [valueText]) : null]);
    }
  
    function statusChip(state, label, detail, onClick) {
      var className = "bv-status-chip " + (state || "off");
      var node = el("div", { className: className, role: onClick ? "button" : null, tabindex: onClick ? "0" : null, onClick: onClick }, [el("span", { className: "bv-status-dot" }), el("span", { className: "bv-status-label" }, [label || (state === "live" ? "Live" : state === "ready" ? "Ready" : "Off")]), detail ? el("span", { className: "bv-status-detail" }, [detail]) : null]);
      if (onClick) node.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") onClick(event); });
      return node;
    }
  
    function panel(title, opts, children) {
      opts = opts || {};
      var movable = Boolean(opts.layoutId);
      var collapsed = Boolean(opts.collapsed);
      var section = el("section", {
        className: "bv-panel" + (opts.solid ? " solid" : "") + (opts.className ? " " + opts.className : "") + (movable ? " bv-panel-layout" : "") + (collapsed ? " bv-panel-collapsed" : ""),
        style: opts.style,
        "aria-label": title,
        "data-bso-panel": opts.layoutId,
        "data-bso-panel-layout": movable ? "true" : null,
        "data-bso-panel-resizable": movable && opts.resizable !== false ? "true" : "false",
        "data-bso-panel-collapsed": String(collapsed)
      });
      if (title || opts.actions) {
        var movementHelp = movable ? "Move the " + title.toLowerCase() + " panel. Drag this header or use arrow keys; Home resets the panel." : null;
        // Every movable overlay panel gets a header collapse/expand affordance.
        // A collapsed panel keeps only its header bar so it stops covering the
        // video while staying one click away from full content.
        var actions = (opts.actions || []).slice();
        if (movable && opts.collapsible !== false) {
          var collapseToggle = iconButton(collapsed ? "chevron-down" : "chevron-up", (collapsed ? "Expand " : "Collapse ") + title.toLowerCase() + " panel", {
            size: "sm",
            onClick: function (event) {
              if (event && event.stopPropagation) event.stopPropagation();
              if (opts.onToggleCollapse) opts.onToggleCollapse(!collapsed);
            }
          });
          collapseToggle.setAttribute("aria-expanded", String(!collapsed));
          collapseToggle.setAttribute("data-bso-panel-collapse", "true");
          actions.unshift(collapseToggle);
        }
        var heading = el("header", {
          className: "bv-panel-header",
          tabindex: movable ? "0" : null,
          role: movable ? "group" : null,
          "aria-label": movable ? title + " panel header; drag to move, or use arrow keys" : null,
          "aria-keyshortcuts": movable ? "ArrowLeft ArrowRight ArrowUp ArrowDown Home" : null,
          "aria-grabbed": movable ? "false" : null,
          title: movementHelp,
          "data-bso-panel-drag-handle": movable ? "true" : null
        }, [opts.icon ? icon(opts.icon, 13) : null, title ? el("h2", {}, [title]) : null, opts.mediaTime ? el("span", { className: "bv-panel-time" + (opts.stale ? " stale" : "") }, [opts.mediaTime + (opts.stale ? " · stale" : "")]) : null, el("span", { className: "bv-panel-actions" }, actions)]);
        section.appendChild(heading);
      }
      if (!collapsed) section.appendChild(el("div", { className: "bv-panel-body", style: opts.bodyStyle }, children || []));
      if (!collapsed && opts.footer) section.appendChild(el("footer", { className: "bv-panel-footer" }, opts.footer));
      if (movable && opts.resizable !== false && !collapsed) section.appendChild(el("button", {
        className: "bv-panel-resize-handle",
        type: "button",
        "aria-label": "Resize " + title.toLowerCase() + " panel",
        "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home",
        title: "Drag to resize. Use arrow keys for precise sizing; Home resets the size.",
        "data-bso-panel-resize-handle": "true"
      }, [icon("grip", 12)]));
      return section;
    }
  
    function callout(tone, title, body, opts) {
      opts = opts || {};
      var iconName = tone === "warn" ? "triangle-alert" : tone === "info" ? "info" : "help";
      var content = [el("span", { className: "bv-callout-icon" }, [icon(iconName, 14)]), el("span", { className: "bv-callout-copy" }, [title ? el("strong", {}, [title]) : null, el("span", {}, [body])])];
      if (opts.onDismiss) content.push(iconButton("x", "Dismiss", { size: "sm", onClick: opts.onDismiss }));
      return el("div", { className: "bv-callout " + (tone || "guide"), role: tone === "warn" ? "status" : null }, content);
    }
  
    function stepDots(current, labels) {
      var node = el("div", { className: "bv-step-dots", "aria-label": "Court seed step " + Math.min(current + 1, 4) + " of 4" });
      for (var i = 0; i < 4; i += 1) node.appendChild(el("span", { className: "bv-step-dot " + (i < current ? "done" : i === current ? "active" : ""), title: labels && labels[i] }, [i + 1]));
      return node;
    }
  
    function segmented(options, value, onChange, full, valueAttribute) {
      var node = el("div", { className: "bv-segmented" + (full ? " full" : ""), role: "radiogroup" });
      options.forEach(function (option) {
        option = typeof option === "string" ? { value: option, label: option } : option;
        var attrs = { type: "button", role: "radio", "aria-checked": option.value === value, disabled: option.disabled, onClick: function () { if (onChange && !option.disabled) onChange(option.value); } };
        if (valueAttribute) attrs[valueAttribute] = option.value;
        node.appendChild(el("button", attrs, [option.label]));
      });
      return node;
    }
  
    function toggle(label, description, checked, onChange, opts) {
      opts = opts || {};
      var sw = el("button", { className: "bv-toggle-switch", id: opts.id, type: "button", role: "switch", "aria-checked": Boolean(checked), disabled: opts.disabled, "aria-label": "Toggle " + label, onClick: function () { if (onChange && !opts.disabled) onChange(!checked); } }, [el("i")]);
      // A label wrapping a button can synthesize a second activation in Chrome;
      // that made one click look inert because the two toggles cancelled out.
      // The switch is the sole interactive control, so keep the copy in a
      // neutral container rather than using label activation semantics.
      return el("div", { className: "bv-toggle" + (opts.disabled ? " disabled" : "") }, [el("span", { className: "bv-toggle-copy" }, [el("strong", {}, [label]), description ? el("span", {}, [description]) : null]), sw]);
    }
  
    function chip(text, selected, onClick, count) { return el("button", { className: "bv-chip", type: "button", "aria-pressed": Boolean(selected), onClick: onClick }, [text, count == null ? null : el("span", { className: "bv-mono", style: { fontSize: "var(--fs-11)" } }, [count])]); }
  
    function stat(label, value, unit, note, accent) { return el("div", { className: "bv-stat" }, [el("span", { className: "bv-stat-label" }, [label]), el("span", { className: "bv-stat-value" + (accent ? " accent" : "") }, [value, unit ? el("small", { className: "bv-stat-unit" }, [unit]) : null]), note ? el("span", { className: "bv-stat-note" }, [note]) : null]); }
  
    function mixBar(segments) {
      var total = segments.reduce(function (sum, item) { return sum + item.value; }, 0) || 1;
      var bar = el("div", { className: "bv-mix-bar", role: "img", "aria-label": segments.map(function (item) { return item.label + " " + item.value; }).join(", ") });
      segments.forEach(function (item) { bar.appendChild(el("i", { style: { flex: String(item.value) + " 1 0", background: item.color || "var(--signal-unknown)" }, title: item.label + ": " + Math.round(item.value / total * 100) + "%" })); });
      var legend = el("div", { className: "bv-mix-legend" });
      segments.forEach(function (item) { legend.appendChild(el("span", { className: "bv-mix-item" }, [el("i", { className: "bv-mix-dot", style: { background: item.color || "var(--signal-unknown)" } }), item.label, el("b", {}, [Math.round(item.value / total * 100) + "%"])])); });
      return el("div", { className: "bv-mix" }, [bar, legend]);
    }
  
    function strokeFeedItem(stroke, onClick) {
      var unknown = stroke.status === "unclassified";
      var sourceTone = stroke.status === "corrected" ? "info" : stroke.status === "unclassified" ? "unknown" : "in";
      var sourceLabel = stroke.fixtureRow ? "fixture" : stroke.source === "manual" ? "manual" : stroke.source === "auto" ? "suggestion" : stroke.status;
      if (stroke.fixtureRow) sourceTone = "neutral";
      var row = el("div", { className: "bv-feed-row" + (stroke.selected ? " selected" : "") + (stroke.source === "manual" && !stroke.fixtureRow ? " manual" : ""), role: onClick ? "button" : null, tabindex: onClick ? "0" : null, "data-bso-event-id": stroke.eventId, "data-bso-label-source": stroke.fixtureRow ? "fixture" : stroke.source || "unknown", onClick: onClick }, [el("span", { className: "bv-feed-seq" }, [stroke.sequence]), el("span", { className: "bv-feed-player " + (stroke.player === "B" || stroke.playerId === "B" ? "b" : "") }), el("span", { className: "bv-feed-copy" }, [el("span", { className: "bv-feed-shot" + (unknown ? " unknown" : "") }, [unknown ? "unclassified" : stroke.shot]), el("span", { className: "bv-feed-time" }, [stroke.time || "—"]) ]), el("span", { className: "bv-feed-meta" }, [stroke.confidence !== undefined && stroke.confidence !== null ? confidence(stroke.confidence, { showValue: false }) : null, badge(sourceLabel, sourceTone)] )]);
      if (onClick) row.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(event); } });
      return row;
    }
  
    function suggestionRow(suggestion, onAccept, onCorrect) {
      return el("div", { className: "bv-suggestion" }, [el("span", { className: "bv-suggestion-copy" }, [el("span", { className: "bv-suggestion-line" }, [el("span", { className: "bv-suggestion-label" }, ["looks like"]), el("span", { className: "bv-suggestion-shot" }, [suggestion.shot]), el("span", { className: "bv-suggestion-time" }, [suggestion.time])]), confidence(suggestion.confidence, { showWord: true })]), button("Looks right", { variant: "primary", size: "sm", iconRight: null, onClick: onAccept }), button("Change it", { variant: "ghost", size: "sm", onClick: onCorrect })]);
    }
  
    function dimensionAxis(label, options, value, onChange) {
      return el("div", { className: "bv-axis", "data-bso-axis": label }, [el("span", { className: "bv-axis-label" }, [label]), el("span", { className: "bv-axis-options" }, options.map(function (option) { return el("button", { className: "bv-axis-option" + (option === value ? " selected" : ""), type: "button", "aria-pressed": option === value, "data-bso-axis-option": option, onClick: function () { onChange(option); } }, [option]); }))]);
    }
  
    function shotPicker(value, suggested, onChange) {
      var shots = ["Serve", "Clear", "Drop", "Smash", "Half Smash", "Lift", "Net Shot", "Net Kill", "Push", "Drive", "Block"];
      return el("div", { className: "bv-shot-picker" }, shots.map(function (shot, i) { var selected = value === shot; return el("button", { className: "bv-shot" + (selected ? " selected" : suggested === shot ? " suggested" : ""), type: "button", "aria-pressed": selected, "data-bso-shot": shot, onClick: function () { onChange(shot); } }, [shot, i < 9 ? kbd(i + 1, selected) : null]); }));
    }
  
    function courtDiagram(opts) {
      opts = opts || {};
      var margin = .55, width = 6.1 + margin * 2, height = 13.4 + margin * 2, svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, width: opts.renderWidth || 200, height: (opts.renderWidth || 200) * height / width, class: "bv-court", role: "img", "aria-label": opts.ariaLabel || "Canonical badminton court" });
      var X = function (x) { return x + margin; }, Y = function (y) { return y + margin; };
      svg.appendChild(svgEl("rect", { x: 0, y: 0, width: width, height: height, fill: "var(--court-fill-alt)" }));
      svg.appendChild(svgEl("rect", { x: X(0), y: Y(0), width: 6.1, height: 13.4, fill: "var(--court-fill)" }));
      function line(x1, y1, x2, y2, opacity) { svg.appendChild(svgEl("line", { x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2), stroke: "var(--court-line)", "stroke-width": .04, "stroke-linecap": "square", opacity: opacity == null ? 1 : opacity })); }
      line(0, 0, 6.1, 0); line(0, 13.4, 6.1, 13.4); line(0, 0, 0, 13.4); line(6.1, 0, 6.1, 13.4); line(.46, 0, .46, 13.4, .75); line(5.64, 0, 5.64, 13.4, .75); line(0, 4.72, 6.1, 4.72, .75); line(0, 8.68, 6.1, 8.68, .75); line(0, .76, 6.1, .76, .55); line(0, 12.64, 6.1, 12.64, .55); line(3.05, 0, 3.05, 4.72, .75); line(3.05, 8.68, 3.05, 13.4, .75);
      svg.appendChild(svgEl("line", { x1: X(-.28), y1: Y(6.7), x2: X(6.38), y2: Y(6.7), stroke: "var(--court-net)", "stroke-width": .07 }));
      if (opts.trajectory && opts.trajectory.length > 1) svg.appendChild(svgEl("polyline", { points: opts.trajectory.map(function (p) { return X(p.x) + "," + Y(p.y); }).join(" "), fill: "none", stroke: "var(--lime-500)", "stroke-width": .06, "stroke-linecap": "round", "stroke-dasharray": ".22 .16" }));
      if (opts.landing) { var landingColor = opts.call === "IN" ? "var(--signal-in)" : opts.call === "OUT" ? "var(--signal-out)" : "var(--signal-unknown)"; svg.appendChild(svgEl("circle", { cx: X(opts.landing.x), cy: Y(opts.landing.y), r: .34, fill: "none", stroke: landingColor, "stroke-width": .05, opacity: .55 })); svg.appendChild(svgEl("circle", { cx: X(opts.landing.x), cy: Y(opts.landing.y), r: .14, fill: landingColor })); }
      (opts.landings || []).forEach(function (p) { var color = opts.colorBy === "player" ? p.side === "b" ? "var(--player-b)" : "var(--player-a)" : p.call === "IN" ? "var(--signal-in)" : p.call === "OUT" ? "var(--signal-out)" : "var(--signal-unknown)"; svg.appendChild(svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: .13, fill: p.call === "UNKNOWN" ? "transparent" : color, stroke: p.call === "UNKNOWN" ? color : "none", "stroke-width": .045, "stroke-dasharray": p.call === "UNKNOWN" ? ".09 .07" : "none", "fill-opacity": .72 })); });
      (opts.players || []).forEach(function (p) { var color = p.side === "b" ? "var(--player-b)" : "var(--player-a)"; svg.appendChild(svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: .36, fill: color, opacity: .22 })); svg.appendChild(svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: .19, fill: color })); });
      if (opts.labels) { var text = svgEl("text", { x: X(3.05), y: Y(-.16), "text-anchor": "middle", fill: "var(--text-faint)", "font-size": ".34", "font-family": "var(--font-mono)" }); text.textContent = "6.10 m"; svg.appendChild(text); }
      return svg;
    }
  
    function legend(items) { return el("div", { className: "bv-legend" }, items.map(function (item) { return el("span", { className: "bv-legend-item" }, [el("i", { className: "bv-legend-dot" + (item.dashed ? " dashed" : ""), style: item.dashed ? null : { background: item.color } }), item.label, item.value == null ? null : el("b", {}, [item.value])]); })); }
  
    function rallyRow(rally, rank, onReview) {
      return el("div", { className: "bv-rally-row" }, [el("span", { className: "bv-rally-rank" }, [rank]), el("span", { className: "bv-rally-index-wrap" }, [el("span", { className: "bv-rally-index" }, [rally.index == null ? "—" : rally.index]), rally.partial ? el("span", { className: "bv-mono", style: { color: "var(--signal-warn)", fontSize: "var(--fs-10)" } }, ["*"]) : null]), el("span", { className: "bv-rally-copy" }, [el("strong", {}, ["Rally " + rally.rallyId]), el("span", { className: "bv-rally-meta" }, [rally.shots + " shots · " + rally.duration])]), badge(rally.outcome, rally.outcome === "winner" ? "in" : rally.outcome === "forced error" ? "warn" : rally.outcome === "unforced error" ? "out" : "unknown"), el("button", { className: "bv-review", type: "button", onClick: function () { onReview(rally); } }, [rally.timestamp])]);
    }
  
    function emptyState(title, body, action, iconName) { return el("div", { className: "bv-empty" }, [el("span", { className: "bv-empty-icon" }, [icon(iconName || "info", 20)]), el("strong", {}, [title]), el("p", {}, [body]), action]); }
  
    function infoTip(term, body) {
      var wrapper = el("span", { style: { position: "relative", display: "inline-flex" } });
      var trigger = iconButton("help", term ? "What is " + term + "?" : "More information", { size: "sm" });
      var tooltip = el("span", { role: "tooltip", style: { display: "none", position: "absolute", zIndex: 40, width: "244px", left: "50%", bottom: "calc(100% + 8px)", transform: "translateX(-50%)", padding: "9px 11px", borderRadius: "var(--radius-md)", background: "var(--ink-800)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-raised)", textAlign: "left" } }, [term ? el("strong", { className: "bv-label", style: { color: "var(--lime-500)" } }, [term]) : null, el("span", { style: { display: "block", marginTop: "4px", font: "var(--type-ui-sm)", fontSize: "var(--fs-12)", color: "var(--text-body)" } }, [body])]);
      function setOpen(open) { tooltip.style.display = open ? "block" : "none"; }
      trigger.addEventListener("mouseenter", function () { setOpen(true); }); trigger.addEventListener("mouseleave", function () { setOpen(false); }); trigger.addEventListener("focus", function () { setOpen(true); }); trigger.addEventListener("blur", function () { setOpen(false); }); trigger.addEventListener("click", function () { setOpen(tooltip.style.display === "none"); }); wrapper.appendChild(trigger); wrapper.appendChild(tooltip); return wrapper;
    }
  
    root.BVUI = { el: el, icon: icon, button: button, iconButton: iconButton, badge: badge, kbd: kbd, confidence: confidence, statusChip: statusChip, panel: panel, callout: callout, stepDots: stepDots, segmented: segmented, toggle: toggle, chip: chip, stat: stat, mixBar: mixBar, strokeFeedItem: strokeFeedItem, suggestionRow: suggestionRow, dimensionAxis: dimensionAxis, shotPicker: shotPicker, courtDiagram: courtDiagram, legend: legend, rallyRow: rallyRow, emptyState: emptyState, infoTip: infoTip };
  })(typeof globalThis !== "undefined" ? globalThis : window);
  
  /* src/content.js */
  /*
   * YouTube sibling overlay. It reads the active video and anchors to its client
   * rectangle; it never calls a playback mutator or writes to the video element.
   */
  (function () {
    // All MV3 page actions enter through this one bundled content script. Keep
    // the guard in this source file too: it protects direct recovery/tests and
    // makes a second evaluation a no-op before any DOM or listener is created.
    var singletonKey = "__BV_CONTENT_SINGLETON_V1__";
    if (window[singletonKey]) return;
    var singleton = window[singletonKey] = { version: 1, active: true };
  
    var ui = window.BVUI;
    var data = window.BVFixtures;
    var calibrationApi = window.BVCalibration;
    var seedCardApi = window.BVSeedCard;
    // The packed MV3 bundle loads this pure helper before the content entrypoint.
    // Keep direct-source recovery/tests tolerant of an older partial bundle.
    var panelLayoutApi = window.BVPanelLayout || null;
    var state = window.BVState.initialExtensionState();
    // Popup actions can arrive while the initial storage read is still pending.
    // Hold them until the stored video-local state is applied so hydration cannot
    // overwrite a just-enabled live session and leave an empty overlay behind.
    var storageHydrated = false;
    var pendingMessages = [];
    var seenMessageIds = [];
    // Fixture rows are only rendered after an explicit fixture-probe result is
    // received. A real session starts with no automatic stroke claims; manual
    // labels remain first-class and are merged into the current evidence.
    var strokes = [];
    var suggestion = null;
    var mediaTime = 0;
    var editingEventId = null;
    var draft = newDraft();
    var importResult = null;
    var csvInput = null;
  
    function currentMediaTimestamp() {
      return Number.isFinite(mediaTime) && mediaTime >= 0 ? mediaTime : null;
    }
    function newDraft(record) {
      var start = record && record.startSec != null ? record.startSec : currentMediaTimestamp();
      var end = record && record.endSec != null ? record.endSec : null;
      var next = {
        eventId: record && record.eventId != null ? String(record.eventId) : null,
        sequence: record && record.sequence != null ? record.sequence : null,
        rallyId: record && record.rallyId != null ? record.rallyId : null,
        shot: record && (record.shot || record.label) || null,
        start: start == null ? "" : formatMediaTime(start),
        end: end == null ? "" : formatMediaTime(end),
        playerId: record && (record.playerId != null ? record.playerId : record.player) || null,
        axes: {}
      };
      var dimensionFields = {
        Longitudinal: "longitudinal_position",
        Lateral: "lateral_position",
        Timing: "timing",
        Intention: "intention",
        Impact: "impact",
        Direction: "direction"
      };
      data.axes.forEach(function (axis) {
        var axes = record && record.axes && typeof record.axes === "object" ? record.axes : {};
        var field = dimensionFields[axis.label];
        next.axes[axis.label] = axes[axis.label] != null ? axes[axis.label] : axes[field] != null ? axes[field] : record && record[axis.label] != null ? record[axis.label] : record && field && record[field] != null ? record[field] : null;
      });
      return next;
    }
    // Draft points are normalized to the current video rectangle. The fitted
    // result is also normalized, so a resize/theater/fullscreen only requires
    // the existing anchor to move; no refit or player mutation is needed.
    var seedPoints = [];
    var calibration = null;
    var activeVideoKey = null;
    var host = null;
    var shadow = null;
    var root = null;
    var video = null;
    var domObserver = null;
    var navigationListeners = [];
    var mediaTimeListener = null;
    var videoGeometryListener = null;
    var videoResizeObserver = null;
    var layoutResizeObserver = null;
    var runtimeController = null;
    var runtimeView = {
      phase: "idle", message: "Local runtime starting", reason: "", analyzer: "none",
      inference: false, fallbacks: [], capabilities: {}, result: null,
      currentMediaTime: null, ageSeconds: null, stale: true
    };
    var publishedRuntimeKey = null;
    var lastRuntimeRenderAt = 0;
    var panelGesture = null;
    // The live video keeps one compact access point visible. Its on-demand menu
    // is intentionally transient; durable panel/evidence choices live in the
    // popup-backed, video-local state.
    var overlayMenuOpen = false;
  
    function hasSeenMessage(message) {
      var requestId = message && message.requestId;
      if (!requestId) return false;
      requestId = String(requestId);
      if (seenMessageIds.indexOf(requestId) >= 0) return true;
      seenMessageIds.push(requestId);
      if (seenMessageIds.length > 64) seenMessageIds.shift();
      return false;
    }
    function hasChrome() { return typeof chrome !== "undefined"; }
    function persist() {
      var key = state.videoKey || activeVideoKey || currentVideoKey();
      if (key) {
        state.videoKey = key;
        if (!state.videoUrl && window.location && /^https?:/.test(window.location.href)) state.videoUrl = window.location.href;
      }
      if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.set({ bvState: state }, function () { void chrome.runtime.lastError; });
    }
    function send(message) {
      if (hasChrome() && chrome.runtime) chrome.runtime.sendMessage(message, function () { void chrome.runtime.lastError; });
    }
    function courtDiagnosticState() {
      if (state.seeding) return "seeding";
      if (state.seeded && calibration) return "seeded";
      return "not-seeded";
    }
    function updateDiagnosticsMarkers() {
      if (!host) return;
      var result = runtimeView.result;
      var fallbacks = Array.isArray(runtimeView.fallbacks) ? runtimeView.fallbacks : [];
      var fallbackReasons = runtimeView.phase === "fallback"
        ? fallbacks.concat(runtimeView.reason || [])
        : [];
      host.setAttribute("data-bso-enabled", String(Boolean(state.enabled)));
      host.setAttribute("data-bso-court-state", courtDiagnosticState());
      host.setAttribute("data-bso-seed-count", String(state.seeding ? seedPoints.length : (state.seedPoints || []).length));
      host.setAttribute("data-bso-runtime-phase", runtimeView.phase || "unknown");
      host.setAttribute("data-bso-runtime-analyzer", runtimeView.analyzer || "none");
      host.setAttribute("data-bso-inference", String(Boolean(runtimeView.inference)));
      host.setAttribute("data-bso-analysis-state", result && result.state ? result.state : "unknown");
      host.setAttribute("data-bso-player-state", result && result.tracking && result.tracking.state || "unknown");
      host.setAttribute("data-bso-shuttle-state", result && result.shuttle && result.shuttle.state || "unknown");
      host.setAttribute("data-bso-player-count", String(runtimePlayers().filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length));
      host.setAttribute("data-bso-racket-state", runtimeRacketEvidence().state);
      host.setAttribute("data-bso-shuttle-confidence", String(result && result.shuttle && result.shuttle.confidence != null ? result.shuttle.confidence : "unknown"));
      host.setAttribute("data-bso-frame-transport", runtimeView.capabilities && runtimeView.capabilities.frameTransport || "unknown");
      host.setAttribute("data-bso-backend", runtimeView.capabilities && runtimeView.capabilities.backend || "unknown");
      host.setAttribute("data-bso-fallback", fallbackReasons.filter(Boolean).join(",") || "none");
    }
    function publishRuntimeView(view) {
      var previousResult = runtimeView && runtimeView.result;
      runtimeView = view;
      var resultChanged = Boolean(view && view.result !== previousResult);
      if (view && view.result && view.result.cameraCut && !state.cameraCut && (state.seeded || calibration)) {
        state = window.BVState.reduceExtensionState(state, { type: "CAMERA_CUT" });
        calibration = null;
        seedPoints = [];
        panelGesture = null;
        persist();
      }
      restoreReviewState();
      updateDiagnosticsMarkers();
      var result = view.result;
      var playerCount = result ? runtimePlayers().filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length : null;
      var racketEvidence = runtimeRacketEvidence();
      var status = {
        phase: view.phase,
        message: view.message,
        reason: view.reason,
        analyzer: view.analyzer,
        inference: Boolean(view.inference),
        frameTransport: view.capabilities && view.capabilities.frameTransport || "unknown",
        fallbacks: Array.isArray(view.fallbacks) ? view.fallbacks.slice() : [],
        capabilities: view.capabilities || {},
        stale: Boolean(view.stale),
        ageSeconds: Number.isFinite(view.ageSeconds) ? view.ageSeconds : null,
        resultKind: result && result.kind ? result.kind : null,
        resultState: result && result.state ? result.state : "unknown",
        // Keep only the model-neutral latest result needed by the summary; no
        // frame pixels or account/page content cross the local storage seam.
        result: result ? {
          kind: result.kind || null,
          state: result.state || "unknown",
          cameraCut: Boolean(result.cameraCut),
          players: runtimePlayers(),
          tracking: result.tracking || null,
          shuttle: result.shuttle || null,
          racket: result.racket || null,
          rackets: Array.isArray(result.rackets) ? result.rackets : [],
          strokeEvents: Array.isArray(result.strokeEvents) ? result.strokeEvents : [],
          rally: result.rally || { state: "unknown" },
          rallyEnd: result.rallyEnd || { state: "unknown" },
          winner: result.winner || { state: "unknown" }
        } : null,
        playerCount: playerCount,
        playerState: result && result.tracking ? result.tracking.state : "unknown",
        shuttleState: result && result.shuttle ? result.shuttle.state : "unknown",
        shuttleConfidence: result && result.shuttle && result.shuttle.confidence != null ? result.shuttle.confidence : null,
        racketSupported: racketEvidence.supported,
        racketState: racketEvidence.state,
        backend: view.capabilities && view.capabilities.backend || null,
        sessionId: runtimeController && runtimeController.sessionId ? runtimeController.sessionId : null
      };
      var key = JSON.stringify([status.phase, status.analyzer, status.inference, status.reason, status.frameTransport, status.backend, status.stale, status.resultKind, status.playerCount, status.playerState, status.shuttleState, status.shuttleConfidence, status.racketSupported, status.racketState]);
      var now = Date.now();
      var statusChanged = key !== publishedRuntimeKey;
      if (hasChrome() && chrome.storage && chrome.storage.local && statusChanged) {
        publishedRuntimeKey = key;
        chrome.storage.local.set({ bvRuntimeStatus: status }, function () { void chrome.runtime.lastError; });
      }
      // Synchronization is driven by every observed video frame, but the
      // design-system DOM only needs a modest refresh cadence for age/time labels.
      // Every newly synchronized result gets one immediate evidence refresh.
      // Age-only frame ticks remain bounded so labels do not rebuild at rVFC rate.
      if (resultChanged || statusChanged || now - lastRuntimeRenderAt >= 250) {
        lastRuntimeRenderAt = now;
        // Runtime/media updates can land between pointerdown and pointerup. Do
        // not replace the manual form under an in-flight user gesture; its
        // controls read the latest clock when invoked and only need the visible
        // timestamp patched in place.
        if (state.labeling) refreshLabelingClock();
        else render();
      }
    }
    function runtimeIsStale() { return Boolean(state.stale || runtimeView.stale); }
    function isFixtureRuntime() {
      return Boolean(runtimeView.result && runtimeView.result.kind === "runtime-integration-probe" || runtimeView.analyzer === "fixture-probe-v1");
    }
    function runtimeResult() { return runtimeView && runtimeView.result && typeof runtimeView.result === "object" ? runtimeView.result : null; }
    function runtimeTracking() { var result = runtimeResult(); return result && result.tracking || null; }
    function runtimePlayers() {
      var result = runtimeResult();
      var tracking = runtimeTracking();
      if (tracking && tracking.accepted === false) return [];
      // Older/runtime-compatible envelopes may put the accepted tracks only in
      // tracking.players. Prefer the top-level projection when it is populated,
      // but do not hide real tracks behind an empty compatibility array.
      if (result && Array.isArray(result.players) && result.players.length) return result.players;
      return tracking && Array.isArray(tracking.players)
        ? tracking.players
        : result && Array.isArray(result.players) ? result.players : [];
    }
    function runtimeShuttle() { var result = runtimeResult(); return result && result.shuttle || null; }
    function runtimeRacketEvidence() {
      var result = runtimeResult();
      if (!result) return { supported: false, state: "unavailable", items: [] };
      // Consume only an explicit runtime field. The current production
      // composition does not emit racket detections, so this remains unavailable
      // there rather than synthesizing a racket from a hand/keypoint.
      var fields = ["racket", "rackets", "racketSignal", "racketSignals"];
      var suppliedField = fields.find(function (field) { return Object.prototype.hasOwnProperty.call(result, field); });
      if (!suppliedField) return { supported: false, state: "unavailable", items: [] };
      var supplied = result[suppliedField];
      var items = Array.isArray(supplied) ? supplied.filter(Boolean) : supplied ? [supplied] : [];
      var visible = items.filter(function (item) { return item && typeof item === "object" && item.state !== "unknown"; });
      var stateValue = visible.some(function (item) { return item.state === "tracked" || item.accepted === true; })
        ? "tracked"
        : visible.length ? "available" : "unknown";
      return { supported: true, state: stateValue, items: items };
    }
    function evidenceVisible(name, fallback) {
      return state.trackerSettings && state.trackerSettings[name] != null ? Boolean(state.trackerSettings[name]) : fallback !== false;
    }
    function panelCollapsed(panelId) {
      return Boolean(state.collapsedPanels && state.collapsedPanels[panelId]);
    }
    function togglePanelCollapsed(panelId, value) {
      state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL_COLLAPSE", panel: panelId, videoKey: activeVideoKey || currentVideoKey(), value: value });
      persist();
      render();
    }
    function courtLinesVisible() {
      return window.BVState.courtLinesForVideo(state, activeVideoKey || currentVideoKey());
    }
    function setCourtLinesVisible(value) {
      state = window.BVState.reduceExtensionState(state, { type: "SET_COURT_LINES", videoKey: activeVideoKey || currentVideoKey(), value: value });
      persist();
      render();
    }
    function runtimeCaption() {
      if (isFixtureRuntime()) return "fixture result observed · not production CV";
      if (runtimeView.phase === "fallback") return "local production analysis unavailable · playback unaffected";
      var shuttle = runtimeShuttle();
      var shuttleState = shuttle && shuttle.state === "tracked" ? "shuttle candidate tracked" : "shuttle unknown";
      return runtimeView.inference ? "local pose + shuttle runtime · " + shuttleState : "local runtime · awaiting analyzer";
    }
    function evidenceState(value) { return value && value.state ? value.state : "unknown"; }
    function imagePointToCourt(point) {
      if (!point || !calibration || !calibrationApi || typeof calibrationApi.projectImagePoint !== "function") return null;
      try {
        var projected = calibrationApi.projectImagePoint(calibration, { x: Number(point.x), y: Number(point.y) });
        if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) return null;
        return { x: projected.x * 6.1, y: projected.y * 13.4 };
      } catch (_) { return null; }
    }
    function playerCourtPoints() {
      var players = runtimePlayers();
      return players.map(function (player, index) {
        if (!player || !player.bbox || player.state === "unknown") return null;
        var imagePoint = { x: player.bbox.x + player.bbox.width / 2, y: player.bbox.y + player.bbox.height / 2 };
        var court = imagePointToCourt(imagePoint);
        return court ? Object.assign(court, { side: index % 2 ? "b" : "a", state: player.state, trackId: player.trackId }) : null;
      }).filter(Boolean);
    }
    function shuttleCourtTrajectory() {
      var shuttle = runtimeShuttle();
      if (!shuttle || !Array.isArray(shuttle.trajectory)) return [];
      return shuttle.trajectory.map(imagePointToCourt).filter(Boolean);
    }
    function shuttleCourtCandidate() {
      var shuttle = runtimeShuttle();
      if (!shuttle || shuttle.state !== "tracked" || !shuttle.candidate || shuttle.candidate.accepted !== true) return null;
      return imagePointToCourt(shuttle.candidate);
    }
    function evidenceStrokes() {
      var result = runtimeResult();
      if (isFixtureRuntime()) return data.strokes.slice();
      if (!result || !Array.isArray(result.strokeEvents)) return [];
      return result.strokeEvents.filter(function (stroke) { return stroke && typeof stroke === "object"; }).map(function (stroke, index) {
        return Object.assign({}, stroke, {
          eventId: stroke.eventId || "auto-" + (stroke.hit_media_time == null ? index : stroke.hit_media_time),
          sequence: stroke.sequence == null ? index + 1 : stroke.sequence,
          player: stroke.player || stroke.player_id || "?",
          shot: stroke.shot || stroke.shot_family || "unclassified",
          time: stroke.time || formatMediaTime(Number(stroke.hit_media_time) || mediaTime),
          status: stroke.status || "unclassified",
          source: stroke.source || "auto",
          confidence: stroke.classification_confidence == null ? null : stroke.classification_confidence
        });
      });
    }
    function formatMediaTime(seconds) {
      var minutes = Math.floor(seconds / 60);
      var remaining = seconds - minutes * 60;
      return String(minutes).padStart(2, "0") + ":" + remaining.toFixed(3).padStart(6, "0");
    }
    function formatDuration(seconds) {
      if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return null;
      var total = Math.round(Number(seconds));
      var hours = Math.floor(total / 3600);
      var minutes = Math.floor(total % 3600 / 60);
      var secs = total % 60;
      return hours > 0
        ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
        : minutes + ":" + String(secs).padStart(2, "0");
    }
    // The popup shows the real current tab's video identity. The content script
    // publishes only page-visible metadata (tab title, media duration, channel
    // meta tag) so the popup never falls back to the demo fixture for a real tab.
    var publishedVideoInfoKey = null;
    function currentVideoInfo() {
      if (!video) return null;
      var title = document && document.title ? String(document.title).replace(/\s*-\s*YouTube\s*$/, "").trim() : null;
      var channelNode = document && document.querySelector ? document.querySelector('meta[itemprop="channelName"], meta[name="channelName"]') : null;
      var channel = channelNode && channelNode.getAttribute && channelNode.getAttribute("content") ? channelNode.getAttribute("content").trim() : null;
      return {
        url: window.location && /^https?:/.test(window.location.href) ? window.location.href : null,
        title: title || null,
        channel: channel || null,
        duration: formatDuration(video.duration)
      };
    }
    function publishVideoInfo() {
      if (!hasChrome() || !chrome.storage || !chrome.storage.local) return;
      var info = currentVideoInfo();
      var key = JSON.stringify(info);
      if (key === publishedVideoInfoKey) return;
      publishedVideoInfoKey = key;
      chrome.storage.local.set({ bvVideoInfo: info }, function () { void chrome.runtime.lastError; });
    }
    function updateState(next) { state = window.BVState.initialExtensionState(next); persist(); render(); }
    function currentVideoKey() {
      return window.BVState.videoKeyForUrl(window.location && window.location.href);
    }
    function reviewStrokes() {
      var merged = window.BVReview ? window.BVReview.mergeStrokes(evidenceStrokes(), state.manualLabels) : evidenceStrokes();
      return merged.map(function (stroke) {
        var isFixture = data.strokes.some(function (fixture) { return String(fixture.eventId) === String(stroke.eventId); });
        var hasSavedReview = labelForEvent(stroke.eventId);
        return isFixture && !hasSavedReview ? Object.assign({}, stroke, { fixtureRow: true }) : stroke;
      });
    }
    function restoreReviewState() {
      strokes = reviewStrokes();
      suggestion = isFixtureRuntime() && data.suggestion ? Object.assign({}, data.suggestion) : null;
      if (suggestion && strokes.some(function (stroke) { return String(stroke.eventId) === String(suggestion.eventId); })) suggestion = null;
    }
    function resetVideoLocalState(reason) {
      persist();
      activeVideoKey = currentVideoKey();
      state = window.BVState.resetVideoLocalState(state, activeVideoKey);
      state.videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : null;
      calibration = null;
      seedPoints = [];
      panelGesture = null;
      overlayMenuOpen = false;
      editingEventId = null;
      strokes = [];
      suggestion = null;
      draft = newDraft();
      importResult = null;
      persist();
      render();
    }
    function restoreCalibrationState() {
      calibration = null;
      if (state.calibration && calibrationApi && calibrationApi.restoreCalibration) {
        try {
          calibration = calibrationApi.restoreCalibration(state.calibration);
        } catch (error) {
          // Corrupt storage must not become a silently accepted court.
          state = window.BVState.initialExtensionState(Object.assign({}, state, {
            seeded: false,
            calibration: null,
            seedPoints: [],
            calibrationError: calibrationApi.errorMessage(error)
          }));
        }
      }
      seedPoints = state.seeding ? state.seedDraftPoints.slice() : [];
      if (state.seeding) {
        // A re-seed draft must never accidentally reuse the previously
        // committed projection, especially after a reload with four bad clicks.
        calibration = null;
        if (seedPoints.length === 4) fitSeedPoints();
      }
    }
    function bindVideoState() {
      var key = currentVideoKey();
      if (activeVideoKey !== null && key !== activeVideoKey) resetVideoLocalState("navigation");
      else if (state.videoKey && key && state.videoKey !== key) resetVideoLocalState("video-replacement");
      else {
        activeVideoKey = key;
        state = window.BVState.stateForVideo(state, key);
        restoreReviewState();
        restoreCalibrationState();
      }
    }
  
    function positionToVideo() {
      if (!host || !video || typeof video.getBoundingClientRect !== "function") return;
      var rect = window.BVRuntime && typeof window.BVRuntime.videoContentRect === "function"
        ? window.BVRuntime.videoContentRect(video, window)
        : video.getBoundingClientRect();
      var visible = video.isConnected !== false && rect.width > 0 && rect.height > 0;
      host.style.display = visible ? "block" : "none";
      if (!visible) return;
      host.style.left = rect.left + "px";
      host.style.top = rect.top + "px";
      host.style.width = rect.width + "px";
      host.style.height = rect.height + "px";
      host.style.clipPath = rect.clipped && rect.clipInsets
        ? "inset(" + rect.clipInsets.top + "px " + rect.clipInsets.right + "px " + rect.clipInsets.bottom + "px " + rect.clipInsets.left + "px)"
        : "none";
      host.setAttribute("data-bso-video-geometry", "rendered-content-box");
      refreshPanelLayouts();
    }
    function resetVideoResizeObserver() {
      if (videoResizeObserver) videoResizeObserver.disconnect();
      videoResizeObserver = null;
      var ResizeObserverImpl = window.ResizeObserver || (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
      if (video && ResizeObserverImpl) {
        videoResizeObserver = new ResizeObserverImpl(positionToVideo);
        videoResizeObserver.observe(video);
      }
    }
    function attachVideo() {
      var next = document.querySelector("video");
      if (next === video) { positionToVideo(); return; }
      if (video && next !== video) {
        if (mediaTimeListener) video.removeEventListener("timeupdate", mediaTimeListener);
        if (videoGeometryListener) {
          video.removeEventListener("loadedmetadata", videoGeometryListener);
          video.removeEventListener("resize", videoGeometryListener);
        }
        mediaTimeListener = null;
        videoGeometryListener = null;
        resetVideoResizeObserver();
        resetVideoLocalState("video-replacement");
      }
      video = next;
      bindVideoState();
      if (video) {
        mediaTime = Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0;
        if (!state.stale) state.time = formatMediaTime(mediaTime);
        mediaTimeListener = function () {
          var nextTime = Number(video.currentTime);
          if (Number.isFinite(nextTime) && nextTime >= 0) {
            mediaTime = nextTime;
            if (!state.stale) state.time = formatMediaTime(nextTime);
            if (state.labeling) refreshLabelingClock();
          }
          // Duration becomes known once metadata loads; publish only on change.
          publishVideoInfo();
        };
        videoGeometryListener = positionToVideo;
        video.addEventListener("timeupdate", mediaTimeListener);
        video.addEventListener("loadedmetadata", videoGeometryListener);
        video.addEventListener("resize", videoGeometryListener);
      }
      resetVideoResizeObserver();
      positionToVideo();
      publishVideoInfo();
    }
  
    function stopRuntime(reason) {
      var controller = runtimeController;
      runtimeController = null;
      publishedRuntimeKey = null;
      if (controller && typeof controller.stop === "function") {
        try { controller.stop(); } catch (_) {}
      }
      runtimeView = {
        phase: "idle",
        message: "Local runtime stopped",
        reason: reason || "runtime-stopped",
        analyzer: "none",
        inference: false,
        fallbacks: [],
        capabilities: {},
        result: null,
        currentMediaTime: null,
        ageSeconds: null,
        stale: true
      };
    }
    function startRuntime() {
      if (runtimeController || !window.BVRuntime || !window.BVRuntime.startIntegratedRuntime) return;
      try {
        var session = window.BVRuntime.startIntegratedRuntime({
          documentRef: document,
          windowRef: window,
          chromeApi: window.chrome,
          onChange: publishRuntimeView,
          onMediaTime: function (currentMediaTime) {
            if (Number.isFinite(currentMediaTime)) {
              mediaTime = currentMediaTime;
              if (!state.stale && Math.abs(mediaTime) > .001) state.time = formatMediaTime(mediaTime);
            }
          }
        });
        if (session) runtimeController = session.controller;
      } catch (error) {
        // A page/runtime integration problem must remain visible without
        // preventing the content UI from serving manual labels.
        runtimeView = {
          phase: "fallback",
          message: "Local runtime unavailable",
          reason: error && error.message ? error.message : String(error),
          analyzer: "none",
          inference: false,
          fallbacks: ["content-runtime-initialization-failed"],
          capabilities: {},
          result: null,
          currentMediaTime: null,
          ageSeconds: null,
          stale: true
        };
        updateDiagnosticsMarkers();
      }
    }
  
    function fitSeedPoints() {
      if (seedPoints.length !== 4 || !calibrationApi) return false;
      var result = calibrationApi.tryFitCourtCalibration(seedPoints);
      if (result.ok) {
        calibration = result.calibration;
        state.calibrationError = null;
        return true;
      }
      calibration = null;
      state.calibrationError = calibrationApi.errorMessage(result.error);
      return false;
    }
    function seedPointStyle(point) { return { left: (point.x * 100) + "%", top: (point.y * 100) + "%" }; }
    function seedClickAllowed(event, layer) {
      return seedCardApi
        ? seedCardApi.canSeedFromClick(event.target, layer, seedPoints.length, event.defaultPrevented)
        : !event.defaultPrevented && event.target === layer && seedPoints.length < 4;
    }
    // YouTube's bottom control strip (progress bar, play/pause, volume, settings)
    // overlays the video's bottom edge. Panels reserve this strip so the native
    // player controls stay clickable with the overlay active.
    var PLAYER_CONTROLS_RESERVE = 72;
    var PANEL_LAYOUT_CONSTRAINTS = {
      courtSetup: { minWidth: 280, minHeight: 170, maxWidth: 560, maxHeight: 680, bottomReserve: PLAYER_CONTROLS_RESERVE },
      stats: { minWidth: 220, minHeight: 128, maxWidth: 460, maxHeight: 420, bottomReserve: PLAYER_CONTROLS_RESERVE },
      map: { minWidth: 176, minHeight: 190, maxWidth: 360, maxHeight: 520, bottomReserve: PLAYER_CONTROLS_RESERVE },
      feed: { minWidth: 280, minHeight: 128, maxWidth: 560, maxHeight: 520, bottomReserve: PLAYER_CONTROLS_RESERVE },
      manual: { minWidth: 320, minHeight: 300, maxWidth: 620, maxHeight: 690, bottomReserve: PLAYER_CONTROLS_RESERVE },
      controls: { minWidth: 180, minHeight: 84, maxWidth: 360, maxHeight: 220, bottomReserve: PLAYER_CONTROLS_RESERVE },
      evidence: { minWidth: 220, minHeight: 180, maxWidth: 420, maxHeight: 520, bottomReserve: PLAYER_CONTROLS_RESERVE }
    };
    function panelConstraints(panelId) { return PANEL_LAYOUT_CONSTRAINTS[panelId] || {}; }
    function panelMetrics(container, panel) {
      var containerRect = container && typeof container.getBoundingClientRect === "function" ? container.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      var panelRect = panel && typeof panel.getBoundingClientRect === "function" ? panel.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      return {
        viewport: { width: Math.max(0, Number(containerRect.width) || 0), height: Math.max(0, Number(containerRect.height) || 0) },
        rendered: {
          left: (Number(panelRect.left) || 0) - (Number(containerRect.left) || 0),
          top: (Number(panelRect.top) || 0) - (Number(containerRect.top) || 0),
          width: Math.max(0, Number(panelRect.width) || 0),
          height: Math.max(0, Number(panelRect.height) || 0)
        }
      };
    }
    function panelContainer(panel) { return panel && panel.parentNode ? panel.parentNode : root; }
    function panelLayoutFor(panelId, container, panel) {
      var metrics = panelMetrics(container, panel);
      // A collapsed panel is a header-only bar. Keep its drag/saved geometry at
      // a usable size so moving it cannot shrink the expanded panel later.
      if (panel && panel.getAttribute && panel.getAttribute("data-bso-panel-collapsed") === "true") {
        var collapsedConstraints = panelConstraints(panelId);
        if (collapsedConstraints.minHeight) metrics.rendered.height = Math.max(metrics.rendered.height, collapsedConstraints.minHeight);
        if (collapsedConstraints.minWidth) metrics.rendered.width = Math.max(metrics.rendered.width, collapsedConstraints.minWidth);
      }
      return { layout: state.panelLayouts && state.panelLayouts[panelId] || null, viewport: metrics.viewport, rendered: metrics.rendered };
    }
    function applyPanelLayout(container, panel, panelId, layout) {
      if (!panel || !panelLayoutApi || typeof panelLayoutApi.pixelPanelLayout !== "function") return null;
      var metrics = panelMetrics(container, panel);
      // Resolve the CSS default once into the same bounded pixel contract used
      // by saved layouts. This keeps a newly rendered panel inside the video on
      // small players without persisting a viewport-specific default.
      var collapsed = panel.getAttribute && panel.getAttribute("data-bso-panel-collapsed") === "true";
      if (collapsed) metrics.rendered.height = 32;
      var result = panelLayoutApi.pixelPanelLayout(layout, metrics.viewport, metrics.rendered, panelConstraints(panelId));
      panel.style.left = result.left + "px"; panel.style.top = result.top + "px";
      panel.style.right = "auto"; panel.style.bottom = "auto";
      panel.style.width = result.width + "px";
      // A collapsed panel keeps only its header bar; height is governed by the
      // header so the panel cannot re-cover the video while collapsed.
      panel.style.height = collapsed ? "auto" : result.height + "px";
      panel.style.transform = "none";
      panel.setAttribute("data-bso-panel-bounds", "clamped");
      return result;
    }
    function refreshPanelLayouts() {
      if (!root || !root.querySelectorAll || !panelLayoutApi) return;
      root.querySelectorAll("[data-bso-panel-layout]").forEach(function (panel) {
        var panelId = panel.getAttribute("data-bso-panel");
        if (panelId) applyPanelLayout(panelContainer(panel), panel, panelId, state.panelLayouts && state.panelLayouts[panelId]);
      });
    }
    function storePanelLayout(panelId, layout) {
      state = window.BVState.reduceExtensionState(state, { type: "SET_PANEL_LAYOUT", panel: panelId, videoKey: activeVideoKey || currentVideoKey(), layout: layout });
      persist();
    }
    function panelEventId(event) { return event && event.pointerId == null ? 0 : event && event.pointerId; }
    function eventHasInteractiveAncestor(target, boundary) {
      var node = target;
      while (node && node !== boundary) {
        if (isInteractiveTarget(node) || node.className && String(node.className).split(/\s+/).indexOf("bv-panel-actions") >= 0) return true;
        node = node.parentNode;
      }
      return false;
    }
    function setPanelGestureState(gesture, active) {
      if (!gesture) return;
      if (gesture.surface && gesture.surface.setAttribute) gesture.surface.setAttribute("aria-grabbed", active ? "true" : "false");
      if (gesture.panel && gesture.panel.classList) gesture.panel.classList.toggle("is-dragging", active);
    }
    function panelPointerMove(event) {
      var gesture = panelGesture;
      if (!gesture || panelEventId(event) !== gesture.pointerId || !panelLayoutApi) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      var delta = { x: (Number(event.clientX) || 0) - gesture.clientX, y: (Number(event.clientY) || 0) - gesture.clientY };
      var next = gesture.kind === "resize"
        ? panelLayoutApi.resizePanelLayout(gesture.layout, delta, gesture.viewport, gesture.rendered, panelConstraints(gesture.panelId))
        : panelLayoutApi.movePanelLayout(gesture.layout, delta, gesture.viewport, gesture.rendered, panelConstraints(gesture.panelId));
      applyPanelLayout(gesture.container, gesture.panel, gesture.panelId, next);
      gesture.current = next;
    }
    function finishPanelGesture(event, cancelled) {
      var gesture = panelGesture;
      if (!gesture || panelEventId(event) !== gesture.pointerId) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (gesture.surface && gesture.surface.releasePointerCapture && gesture.surface.hasPointerCapture && gesture.surface.hasPointerCapture(gesture.pointerId)) gesture.surface.releasePointerCapture(gesture.pointerId);
      setPanelGestureState(gesture, false); panelGesture = null;
      if (!cancelled && gesture.current) storePanelLayout(gesture.panelId, gesture.current);
    }
    function beginPanelGesture(event, container, panel, panelId, surface, kind) {
      if (event.button != null && event.button !== 0) return;
      if (kind === "move" && eventHasInteractiveAncestor(event.target, surface)) return;
      if (panelGesture) finishPanelGesture({ pointerId: panelGesture.pointerId, preventDefault: function () {}, stopPropagation: function () {} }, true);
      var current = panelLayoutFor(panelId, container, panel);
      var layout = current.layout || {
        x: current.viewport.width ? current.rendered.left / current.viewport.width : 0,
        y: current.viewport.height ? current.rendered.top / current.viewport.height : 0,
        width: current.viewport.width ? current.rendered.width / current.viewport.width : 0,
        height: current.viewport.height ? current.rendered.height / current.viewport.height : 0
      };
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      panelGesture = { pointerId: panelEventId(event), clientX: Number(event.clientX) || 0, clientY: Number(event.clientY) || 0, panelId: panelId, panel: panel, container: container, surface: surface, kind: kind, layout: layout, current: layout, viewport: current.viewport, rendered: current.rendered };
      setPanelGestureState(panelGesture, true);
      if (surface.setPointerCapture) surface.setPointerCapture(panelGesture.pointerId);
    }
    function resetPanelLayout(panelId, keepPosition) {
      var current = state.panelLayouts && state.panelLayouts[panelId] || null;
      var next = keepPosition && current ? { x: current.x, y: current.y } : null;
      storePanelLayout(panelId, next); render();
      setTimeout(function () {
        var panel = root && root.querySelector && root.querySelector('[data-bso-panel="' + panelId + '"]');
        var focusTarget = panel && panel.querySelector && panel.querySelector("[data-bso-panel-drag-handle]");
        if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
      }, 0);
    }
    function keyboardPanelInteraction(event, container, panel, panelId, surface, kind) {
      // The resize surface is an intentional button, so its own key events must
      // remain available even though descendant controls are excluded from drag
      // handling on ordinary headers.
      if (event.target !== surface && eventHasInteractiveAncestor(event.target, surface)) return;
      var key = event.key;
      if (key !== "Home" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(key) < 0) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (key === "Home") { resetPanelLayout(panelId, kind === "resize"); return; }
      var current = panelLayoutFor(panelId, container, panel);
      var layout = current.layout || {
        x: current.viewport.width ? current.rendered.left / current.viewport.width : 0,
        y: current.viewport.height ? current.rendered.top / current.viewport.height : 0,
        width: current.viewport.width ? current.rendered.width / current.viewport.width : 0,
        height: current.viewport.height ? current.rendered.height / current.viewport.height : 0
      };
      if (!panelLayoutApi) return;
      var next = kind === "resize"
        ? panelLayoutApi.nudgePanelSize(layout, key, current.viewport, current.rendered, panelConstraints(panelId))
        : panelLayoutApi.nudgePanelLayout(layout, key, current.viewport, current.rendered, panelConstraints(panelId));
      applyPanelLayout(container, panel, panelId, next); storePanelLayout(panelId, next);
    }
    function installPanelInteractions(container, panel, panelId) {
      var header = panel && panel.querySelector && panel.querySelector("[data-bso-panel-drag-handle]");
      var resize = panel && panel.querySelector && panel.querySelector("[data-bso-panel-resize-handle]");
      if (!header) return;
      header.addEventListener("pointerdown", function (event) { beginPanelGesture(event, container, panel, panelId, header, "move"); });
      header.addEventListener("pointermove", panelPointerMove); header.addEventListener("pointerup", function (event) { finishPanelGesture(event, false); }); header.addEventListener("pointercancel", function (event) { finishPanelGesture(event, true); });
      header.addEventListener("keydown", function (event) { keyboardPanelInteraction(event, container, panel, panelId, header, "move"); });
      if (resize) {
        resize.addEventListener("pointerdown", function (event) { beginPanelGesture(event, container, panel, panelId, resize, "resize"); });
        resize.addEventListener("pointermove", panelPointerMove); resize.addEventListener("pointerup", function (event) { finishPanelGesture(event, false); }); resize.addEventListener("pointercancel", function (event) { finishPanelGesture(event, true); });
        resize.addEventListener("keydown", function (event) { keyboardPanelInteraction(event, container, panel, panelId, resize, "resize"); });
      }
    }
    function installPanelInteractionsInRoot() {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll("[data-bso-panel-layout]").forEach(function (panel) {
        var panelId = panel.getAttribute("data-bso-panel");
        if (panelId) installPanelInteractions(panelContainer(panel), panel, panelId);
      });
    }
    function resetSeedCardPosition() { resetPanelLayout("courtSetup", false); }
    function protectSeedCardFromCornerClicks(card) {
      // The card is above the seed layer. Keep card controls/gestures from
      // bubbling into the layer's deliberate target===layer click contract.
      card.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
      card.addEventListener("pointermove", function (event) { event.stopPropagation(); });
      card.addEventListener("pointerup", function (event) { event.stopPropagation(); });
      card.addEventListener("click", function (event) { event.stopPropagation(); });
    }
    function seedDrawing(points, fittedCalibration) {
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "bv-seed-drawing"); svg.setAttribute("viewBox", "0 0 1 1"); svg.setAttribute("preserveAspectRatio", "none");
      function add(tag, attrs) { var node = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); }); svg.appendChild(node); }
      if (points.length > 1) add("polyline", { points: points.map(function (item) { return item.x + "," + item.y; }).join(" ") + (points.length === 4 ? " " + points[0].x + "," + points[0].y : ""), fill: "none", stroke: "var(--court-setup-line)", "stroke-width": ".3", "vector-effect": "non-scaling-stroke" });
      if (fittedCalibration && Array.isArray(fittedCalibration.lines)) {
        fittedCalibration.lines.forEach(function (line) {
          var attrs = {
            x1: line.start.x, y1: line.start.y, x2: line.end.x, y2: line.end.y,
            // The setup projection uses the bright lime highlight so the drawn
            // court reads clearly against live footage; it stays distinct from
            // the muted diagram tokens used by the court map panel.
            stroke: line.role === "net" ? "var(--court-setup-net)" : "var(--court-setup-line)",
            "stroke-width": line.role === "net" ? ".35" : line.boundary ? ".3" : ".2",
            "vector-effect": "non-scaling-stroke",
            "data-court-line-id": line.id,
            "data-court-line-role": line.role,
            "data-line-ownership": line.line_ownership
          };
          add("line", attrs);
        });
      }
      return svg;
    }
    function calibrationDrawing() {
      var drawing = seedDrawing([], calibration);
      drawing.setAttribute("class", "bv-calibration-court");
      return drawing;
    }
    var SKELETON_EDGES = [
      ["nose", "neck"], ["nose", "left_eye"], ["nose", "right_eye"], ["left_eye", "left_ear"], ["right_eye", "right_ear"],
      ["neck", "left_shoulder"], ["neck", "right_shoulder"], ["left_shoulder", "right_shoulder"],
      ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"], ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
      ["neck", "left_hip"], ["neck", "right_hip"], ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"], ["left_hip", "right_hip"],
      ["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"]
    ];
    function normalizedPoint(point) {
      return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && Number(point.x) >= 0 && Number(point.x) <= 1 && Number(point.y) >= 0 && Number(point.y) <= 1;
    }
    function runtimeEvidenceDrawing() {
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "bv-runtime-evidence");
      svg.setAttribute("viewBox", "0 0 1 1");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-label", "Live local player, racket, and shuttle evidence");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("pointer-events", "none");
      svg.setAttribute("data-bso-production-evidence", String(!isFixtureRuntime()));
      svg.style.pointerEvents = "none";
      function add(tag, attrs) {
        var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        node.setAttribute("pointer-events", "none");
        svg.appendChild(node);
        return node;
      }
      runtimePlayers().forEach(function (player, index) {
        if (!player || player.state === "unknown") return;
        var trackId = player.trackId || "unknown-track";
        var side = index % 2 ? "b" : "a";
        var pointsByName = Object.create(null);
        (Array.isArray(player.keypoints) ? player.keypoints : []).forEach(function (point) {
          if (normalizedPoint(point) && point.name) pointsByName[String(point.name).toLowerCase().replace(/-/g, "_")] = point;
        });
        if (evidenceVisible("body", true)) {
          SKELETON_EDGES.forEach(function (edge) {
            var start = pointsByName[edge[0]];
            var end = pointsByName[edge[1]];
            if (!start || !end) return;
            add("line", {
              x1: start.x, y1: start.y, x2: end.x, y2: end.y,
              class: "bv-pose-bone " + side,
              "data-track-id": trackId,
              "data-keypoints": edge.join("|")
            });
          });
          Object.keys(pointsByName).forEach(function (name) {
            var point = pointsByName[name];
            add("circle", {
              cx: point.x, cy: point.y, r: ".0065",
              class: "bv-pose-keypoint " + side,
              "data-track-id": trackId,
              "data-keypoint": name,
              "data-keypoint-confidence": point.confidence == null ? "unknown" : point.confidence
            });
          });
        }
        // Never synthesize a box from keypoints. A rect appears only when the
        // selected runtime player explicitly supplies a normalized bbox.
        if (evidenceVisible("players", true) && player.bbox && normalizedPoint(player.bbox) && Number(player.bbox.width) > 0 && Number(player.bbox.height) > 0) {
          add("rect", {
            x: player.bbox.x, y: player.bbox.y, width: player.bbox.width, height: player.bbox.height,
            class: "bv-player-box " + side,
            "stroke-dasharray": player.state === "partial" ? "6 5" : "none",
            "data-track-id": trackId,
            "data-player-state": player.state,
            "data-box-source": "runtime"
          });
        }
      });
      var racket = runtimeRacketEvidence();
      if (evidenceVisible("racket", false) && racket.supported) {
        racket.items.forEach(function (item, index) {
          if (!item || item.state === "unknown") return;
          var segment = item.segment || item.line;
          if (segment && normalizedPoint(segment.start) && normalizedPoint(segment.end)) {
            add("line", { x1: segment.start.x, y1: segment.start.y, x2: segment.end.x, y2: segment.end.y, class: "bv-racket-signal", "data-racket-index": index, "data-racket-state": item.state || "available" });
          }
          if (Array.isArray(item.points) && item.points.length > 1 && item.points.every(normalizedPoint)) {
            add("polyline", { points: item.points.map(function (point) { return point.x + "," + point.y; }).join(" "), class: "bv-racket-signal", "data-racket-index": index, "data-racket-state": item.state || "available" });
          }
          if (item.bbox && normalizedPoint(item.bbox) && Number(item.bbox.width) > 0 && Number(item.bbox.height) > 0) {
            add("rect", { x: item.bbox.x, y: item.bbox.y, width: item.bbox.width, height: item.bbox.height, class: "bv-racket-box", "data-racket-index": index, "data-racket-state": item.state || "available", "data-box-source": "runtime" });
          }
          if (normalizedPoint(item)) add("circle", { cx: item.x, cy: item.y, r: ".007", class: "bv-racket-point", "data-racket-index": index, "data-racket-state": item.state || "available" });
        });
      }
      var shuttle = runtimeShuttle();
      if (evidenceVisible("shuttle", true) && shuttle && Array.isArray(shuttle.trajectory)) {
        var trajectory = shuttle.trajectory.filter(normalizedPoint);
        if (trajectory.length > 1) add("polyline", { points: trajectory.map(function (point) { return point.x + "," + point.y; }).join(" "), class: "bv-shuttle-trajectory", "data-shuttle-state": shuttle.state || "unknown" });
      }
      if (evidenceVisible("shuttle", true) && shuttle && shuttle.state === "tracked" && shuttle.accepted === true && shuttle.candidate && shuttle.candidate.accepted === true && normalizedPoint(shuttle.candidate)) {
        add("circle", { cx: shuttle.candidate.x, cy: shuttle.candidate.y, r: ".009", class: "bv-shuttle-point", "data-shuttle-state": "tracked", "data-candidate-source": "runtime" });
      }
      return svg;
    }
    function evidenceAvailability(name) {
      var players = runtimePlayers();
      if (name === "racket") {
        var racket = runtimeRacketEvidence();
        return racket.supported ? { state: racket.state, detail: racket.state === "tracked" ? "runtime evidence supplied" : "runtime signal unknown", disabled: false } : { state: "unavailable", detail: "no runtime racket output", disabled: true };
      }
      if (name === "body") {
        var points = players.reduce(function (count, player) { return count + (Array.isArray(player && player.keypoints) ? player.keypoints.filter(normalizedPoint).length : 0); }, 0);
        if (points) return { state: "available", detail: points + " keypoint" + (points === 1 ? "" : "s"), disabled: false };
        if (runtimeView.phase === "fallback" || isFixtureRuntime()) return { state: "unavailable", detail: "pose output unavailable", disabled: true };
        return { state: "unknown", detail: "no accepted keypoints yet", disabled: false };
      }
      if (name === "players") {
        var boxes = players.filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length;
        return boxes ? { state: "available", detail: boxes + " runtime box" + (boxes === 1 ? "" : "es"), disabled: false } : { state: "unknown", detail: "no runtime boxes supplied", disabled: false };
      }
      var shuttle = runtimeShuttle();
      if (isFixtureRuntime()) return { state: "unavailable", detail: "fixture has no shuttle signal", disabled: true };
      return shuttle && shuttle.state === "tracked" && shuttle.accepted === true
        ? { state: "available", detail: "accepted path / candidate", disabled: false }
        : { state: "unknown", detail: "candidate not accepted", disabled: false };
    }
    function setEvidenceVisibility(name, value) {
      state = window.BVState.reduceExtensionState(state, { type: "SET_TRACKER", tracker: name, value: value });
      persist();
      render();
    }
    function evidenceVisibilityPanel() {
      var groups = [
        { name: "body", label: "Pose keypoints + skeleton", fallback: true },
        { name: "players", label: "Player boxes", fallback: true },
        { name: "racket", label: "Racket evidence", fallback: false },
        { name: "shuttle", label: "Shuttle path + candidate", fallback: true }
      ];
      var rows = groups.map(function (group) {
        var availability = evidenceAvailability(group.name);
        var visible = evidenceVisible(group.name, group.fallback);
        var toggle = ui.toggle(group.label, availability.state + " · " + availability.detail, visible, function (next) { setEvidenceVisibility(group.name, next); }, { disabled: availability.disabled, id: "evidence-" + group.name });
        toggle.setAttribute("data-bso-evidence-control", group.name);
        toggle.setAttribute("data-bso-evidence-state", availability.state);
        return toggle;
      });
      // The calibrated court polygon over the video is one thing with one
      // toggle: a per-video show/hide preference. During the four-corner setup
      // the same projection always renders as the setup feedback; after the
      // court is locked this toggle is the only control for it.
      var projectionVisible = courtLinesVisible();
      var projectionToggle = ui.toggle("Court projection", projectionVisible ? "calibrated court polygon over the video" : "hidden until re-enabled", projectionVisible, function (next) { setCourtLinesVisible(next); }, { id: "court-lines" });
      projectionToggle.setAttribute("data-bso-court-projection-toggle", "true");
      rows.push(projectionToggle);
      return ui.panel("Evidence visibility", { layoutId: "evidence", icon: "activity", className: "bv-evidence-controls", bodyStyle: { padding: "6px" }, collapsed: panelCollapsed("evidence"), onToggleCollapse: function (value) { togglePanelCollapsed("evidence", value); }, actions: [ui.iconButton("x", "Hide evidence visibility", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "evidence", value: false }); persist(); render(); } })] }, rows);
    }
    function undoSeedPoint() {
      seedPoints.pop();
      calibration = null;
      state.seedDraftPoints = seedPoints.map(function (point) { return { x: point.x, y: point.y }; });
      state.calibrationError = null;
      persist();
      render();
    }
    function resetSeed() {
      state = window.BVState.reduceExtensionState(state, { type: "RESET_COURT" });
      panelGesture = null;
      seedPoints = [];
      calibration = null;
      persist();
      render();
    }
    function cancelSeeding() {
      state.seedDraftPoints = [];
      state.calibrationError = null;
      state.seeding = false;
      // Re-show the previously committed calibration if this was a re-seed.
      restoreCalibrationState();
      state.enabled = Boolean(state.seeded);
      persist();
      render();
    }
    function lockSeed() {
      if (!calibration && !fitSeedPoints()) return render();
      state = window.BVState.reduceExtensionState(state, { type: "LOCK_COURT", calibration: calibration, seedPoints: seedPoints });
      state.videoKey = activeVideoKey || currentVideoKey();
      persist();
      send({ type: "COURT_SEEDED", calibration: calibration });
      render();
    }
    function seedFlow() {
      var corners = ["Near left", "Near right", "Far right", "Far left"];
      var targets = [{ x: 22, y: 82 }, { x: 78, y: 82 }, { x: 63, y: 33 }, { x: 37, y: 33 }];
      var fitted = seedPoints.length === 4 && calibration;
      var invalid = seedPoints.length === 4 && !fitted;
      // The seed layer keeps full-click capture only above the native player
      // control strip: the strip itself passes pointer events through so pause,
      // seek, the time bar, and settings stay reachable during setup. On small
      // players the near-corner guide markers would fall inside the strip, so
      // they are clamped above the reserve where they stay clickable.
      var layerHeight = host && typeof host.getBoundingClientRect === "function" ? Number(host.getBoundingClientRect().height) || 0 : 0;
      var maxGuideY = layerHeight > 0 ? 1 - (PLAYER_CONTROLS_RESERVE + 24) / layerHeight : 1;
      var layer = ui.el("div", {
        className: "bv-seed-layer",
        role: "dialog",
        "aria-label": "Set up court",
        "data-bso-court-seeding": "true",
        "data-bso-seed-count": seedPoints.length,
        "data-bso-seed-order": corners.slice(0, seedPoints.length).join("|"),
        "data-bso-seed-click-policy": "layer-only",
        "data-bso-seed-lockable": String(Boolean(fitted))
      });
      layer.appendChild(seedDrawing(seedPoints, fitted));
      if (seedPoints.length < 4) {
        var guide = targets[seedPoints.length];
        layer.appendChild(ui.el("span", { className: "bv-seed-target", "data-bso-seed-guide": String(seedPoints.length), style: { left: guide.x + "%", top: Math.min(guide.y / 100, Math.max(0, maxGuideY)) * 100 + "%" } }));
      }
      seedPoints.forEach(function (point, index) { layer.appendChild(ui.el("span", { className: "bv-seed-point", style: seedPointStyle(point) }, [index + 1])); });
      var card = ui.el("section", { className: "bv-seed-card bv-panel-layout", role: "group", "aria-label": "Court setup instructions", "data-bso-seed-card": "true", "data-bso-contrast": "high", "data-bso-panel": "courtSetup", "data-bso-panel-layout": "true", "data-bso-panel-resizable": "true" });
      var title = fitted ? "Court ready to lock" : invalid ? "Court needs correction" : "Click the " + corners[seedPoints.length].toLowerCase() + " outer corner";
      var help = ui.el("span", { className: "bv-sr-only", id: "bv-seed-card-help" }, ["Use the court setup header to move the instructions inside the video. Use the arrow keys to nudge it. Press Home to reset the position."]);
      // The whole header is the drag surface. It has no visible grip or drag
      // copy, keeping the four corner targets unobstructed while retaining an
      // explicit keyboard and native-tooltip affordance for assistive users.
      var handle = ui.el("header", { className: "bv-seed-card-top bv-panel-header", tabindex: "0", role: "group", "aria-label": "Move court setup instructions", "aria-describedby": "bv-seed-card-help", "aria-grabbed": "false", "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home", title: "Move court setup instructions. Use arrow keys to nudge. Home resets the position.", "data-bso-seed-card-handle": "true", "data-bso-panel-drag-handle": "true" }, [ui.stepDots(Math.min(seedPoints.length, 4), corners), ui.el("span", { className: "bv-seed-card-title" }, [title]), fitted ? ui.badge("homography ok", "in") : invalid ? ui.badge("not accepted", "warn") : null, ui.el("span", { className: "bv-seed-card-actions" }, [ui.button("Reset position", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); resetSeedCardPosition(); } }), ui.button("Undo", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0, onClick: function (event) { event.stopPropagation(); undoSeedPoint(); } }), ui.button("Reset court", { variant: "ghost", size: "sm", disabled: seedPoints.length === 0 && !state.seeded, onClick: function (event) { event.stopPropagation(); resetSeed(); } }), ui.button("Skip to manual", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); openLabeling(); } }), ui.button("Lock court", { variant: "primary", size: "sm", disabled: !fitted, onClick: function (event) { event.stopPropagation(); lockSeed(); } })])]);
      handle.appendChild(help);
      card.appendChild(handle);
      if (state.calibrationError) card.appendChild(ui.callout("warn", "Calibration not accepted", state.calibrationError));
      card.appendChild(ui.el("p", {}, ["Your four clicks are the outer doubles corners only. Service lines, centre lines and the net come from the official 13.40 × 6.10 m court and are projected in — they never adapt to the image."]));
      card.appendChild(ui.el("div", { className: "bv-seed-note" }, [ui.icon("info", 13), ui.el("span", {}, ["Playback keeps running. A camera cut past tolerance pauses analysis, not the video."]), ui.button("Cancel", { variant: "ghost", size: "sm", onClick: function (event) { event.stopPropagation(); cancelSeeding(); } })]));
      card.appendChild(ui.el("button", { className: "bv-panel-resize-handle", type: "button", "aria-label": "Resize court setup panel", "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home", title: "Drag to resize. Use arrow keys for precise sizing; Home resets the size.", "data-bso-panel-resize-handle": "true" }, [ui.icon("grip", 12)]));
      layer.appendChild(card);
      applyPanelLayout(layer, card, "courtSetup", state.panelLayouts && state.panelLayouts.courtSetup);
      protectSeedCardFromCornerClicks(card);
      layer.addEventListener("click", function (event) {
        if (!seedClickAllowed(event, layer)) return;
        var rect = layer.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          state.calibrationError = "The video has no measurable size. Keep playback running and try again.";
          persist(); render(); return;
        }
        var next = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
        if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || next.x < 0 || next.x > 1 || next.y < 0 || next.y > 1) {
          state.calibrationError = "That click was outside the video. Click the visible outer court corner.";
          persist(); render(); return;
        }
        seedPoints.push(next);
        state.seedDraftPoints = seedPoints.map(function (point) { return { x: point.x, y: point.y }; });
        state.calibrationError = null;
        if (seedPoints.length === 4) fitSeedPoints();
        persist();
        render();
      });
      return layer;
    }
  
    // The saved manual label dataset is the honest source for rally-level
    // statistics until a CV backend supplies real evidence. It reuses the same
    // analysis core as the summary/CSV path, so the panels and the export never
    // disagree about serve counts, rally duration, or shot mix.
    function manualSummary() {
      if (!state.manualLabels || !state.manualLabels.length || !window.BVAnalysis) return null;
      var videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : data.video.url;
      var options = { videoUrl: videoUrl };
      var key = activeVideoKey || state.videoKey;
      if (key) options.videoKey = key;
      return window.BVAnalysis.calculateManualDatasetSummary(state.manualLabels, options);
    }
    function statsPanel() {
      var result = runtimeResult();
      var tracking = runtimeTracking();
      var shuttle = runtimeShuttle();
      var manual = manualSummary();
      var manualCount = manual ? manual.totalLabels : 0;
      // A production CV result with strokes or a known rally state is preferred
      // over the manual dataset. Fixture rows are explicitly not production CV,
      // so they never mask the honest manual statistics.
      var cvEvidence = !isFixtureRuntime() && Boolean(result) && (Array.isArray(result.strokeEvents) && result.strokeEvents.length > 0 || result.rally && result.rally.state !== "unknown");
      var rally = result && result.rally && result.rally.state !== "unknown" ? result.rally.id || state.rally : "unknown";
      var shotCount = strokes.length || "unknown";
      var duration = null;
      if (cvEvidence && result.rally) {
        var rallyStart = result.rally.start_media_time != null ? result.rally.start_media_time : result.rally.startSec;
        var rallyEnd = result.rally.end_media_time != null ? result.rally.end_media_time : result.rally.endSec;
        if (Number.isFinite(Number(rallyStart)) && Number.isFinite(Number(rallyEnd)) && Number(rallyEnd) >= Number(rallyStart)) duration = Number(rallyEnd) - Number(rallyStart);
      }
      if (duration == null && manual && manual.durationSec != null) duration = manual.durationSec;
      var statsSource = cvEvidence ? "cv" : manualCount ? "manual" : "none";
      var sourceLabel = statsSource === "cv" ? "live evidence" : statsSource === "manual" ? "manual labels" : "no evidence";
      var sourceNote = statsSource === "cv" ? "real evidence preferred · manual labels kept as seed" : statsSource === "manual" ? "statistics derived from saved manual labels only" : "no CV evidence and no saved labels";
      var children = [
        ui.el("div", { className: "bv-stat-grid" }, [ui.stat("Rally", rally), ui.stat("Shots", shotCount), ui.stat("Length", duration == null ? "unknown" : duration.toFixed(1), duration == null ? null : "s")]),
        ui.el("div", { className: "bv-evidence-grid" }, [ui.el("span", {}, ["Players", ui.badge(evidenceState(tracking), evidenceState(tracking) === "tracked" ? "in" : "unknown")]), ui.el("span", {}, ["Shuttle", ui.badge(evidenceState(shuttle), evidenceState(shuttle) === "tracked" ? "in" : "unknown")]), ui.el("span", {}, ["Winner", ui.badge(result && result.winner ? evidenceState(result.winner) : "unknown", "unknown")])]),
        ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", margin: "var(--sp-5) 0" } }, [ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-12)", color: "var(--text-muted)" } }, ["score unknown"]), ui.badge("score OCR unavailable", "warn")]),
        ui.el("div", { className: "bv-stats-source", "data-bso-stats-source": statsSource }, [ui.badge(sourceLabel, statsSource === "cv" ? "in" : statsSource === "manual" ? "info" : "unknown"), ui.el("span", { className: "bv-muted", style: { fontSize: "var(--fs-11)" } }, [sourceNote])]),
        ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-5)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-hairline)" } }, [ui.el("span", { className: "bv-muted", style: { fontSize: "var(--fs-11)" } }, ["Rally end"]), ui.badge(result && result.rallyEnd ? evidenceState(result.rallyEnd) : "unknown", "unknown"), ui.confidence(null, { showWord: true })])
      ];
      if (manualCount) {
        var segments = Object.keys(manual.shotLabelCounts).map(function (label) {
          return { label: label, value: manual.shotLabelCounts[label], color: label === "Clear" ? "var(--player-a)" : label === "Smash" ? "var(--lime-500)" : "#2f8f77" };
        });
        if (manual.unclassifiedCount) segments.push({ label: "Unclassified", value: manual.unclassifiedCount, color: "var(--signal-unknown)" });
        children.push(ui.el("div", { className: "bv-manual-stats", "data-bso-manual-stats": String(manualCount) }, [
          ui.el("div", { className: "bv-stat-grid" }, [ui.stat("Serves", manual.shotLabelCounts.Serve || 0), ui.stat("Labels", manualCount)]),
          ui.mixBar(segments)
        ]));
      }
      return ui.panel("Stats", { layoutId: "stats", icon: "activity", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", collapsed: panelCollapsed("stats"), onToggleCollapse: function (value) { togglePanelCollapsed("stats", value); }, actions: [ui.iconButton("x", "Hide stats", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "stats", value: false }); persist(); render(); } })] }, children);
    }
    function mapPanel() {
      var players = playerCourtPoints();
      var trajectory = shuttleCourtTrajectory();
      var landing = shuttleCourtCandidate();
      var shuttle = runtimeShuttle();
      var shuttleState = evidenceState(shuttle);
      var mapNote = !calibration ? "Seed the court to project live coordinates." : shuttleState === "tracked" && landing ? "Candidate shown; line call remains unknown." : "No accepted shuttle landing evidence.";
      return ui.panel("Court", { layoutId: "map", icon: "crosshair", mediaTime: state.time, className: "bv-court-panel bv-overlay-map", bodyStyle: { padding: "10px" }, collapsed: panelCollapsed("map"), onToggleCollapse: function (value) { togglePanelCollapsed("map", value); }, actions: [ui.iconButton("x", "Hide court map", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "map", value: false }); persist(); render(); } })] }, [
        ui.courtDiagram({ renderWidth: 154, players: players, trajectory: trajectory, landing: landing, call: "UNKNOWN", ariaLabel: "Current court map; unknown values are not inferred" }),
        ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)", marginTop: "var(--sp-4)" } }, [ui.badge(shuttleState === "tracked" ? "candidate" : "UNKNOWN", shuttleState === "tracked" ? "info" : "unknown"), ui.el("span", { className: "bv-mono", style: { fontSize: "var(--fs-10)", color: "var(--text-faint)" } }, [mapNote])]),
        ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.confidence(null, { label: "geo", showWord: true })])
      ]);
    }
    function labelForEvent(eventId) {
      return (state.manualLabels || []).find(function (label) { return label && String(label.eventId) === String(eventId); }) || null;
    }
    function openExistingLabel(stroke) {
      if (!stroke || stroke.eventId == null) return openLabeling();
      editingEventId = String(stroke.eventId);
      openLabeling(labelForEvent(stroke.eventId) || stroke);
    }
    function feedPanel() {
      var rows = ui.el("div", { className: "bv-feed" });
      strokes.forEach(function (stroke) { rows.appendChild(ui.strokeFeedItem(stroke, function () { openExistingLabel(stroke); })); });
      if (!strokes.length) rows.appendChild(ui.emptyState("No accepted stroke evidence", "Pose and shuttle signals do not establish a hit, shot family, rally end, or winner. Add a manual label while playback continues.", ui.button("Label current segment", { variant: "ghost", size: "sm", onClick: openLabeling }), "help"));
      var children = [];
      if (state.lastEdit) children.push(ui.el("div", { className: "bv-review-undo", role: "status" }, [ui.el("span", {}, [(state.lastEdit.source === "manual" ? "Saved manual label at " : "Saved review suggestion at ") + (state.lastEdit.time || "the current timestamp") + "."]), ui.button("Undo", { variant: "ghost", size: "sm", onClick: undoLastEdit })]));
      children.push(rows);
      if (suggestion) children.push(ui.el("div", { style: { marginTop: "var(--sp-3)" } }, [ui.suggestionRow(suggestion, acceptSuggestion, function () { openLabeling(); })]));
      var footerLabel = isFixtureRuntime() ? "rally 13 · index 74" : "rally unknown · index unavailable";
      var footer = ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.badge(footerLabel, isFixtureRuntime() ? "accent" : "unknown", false), ui.el("span", { className: "bv-runtime-footnote" }, [isFixtureRuntime() ? "fixture result · not production CV" : "automatic event evidence unknown"]), ui.button("Older rallies", { variant: "ghost", size: "sm", iconRight: "chevron-right", style: { marginLeft: "auto" }, onClick: openSummary })]);
      return ui.panel("Stroke feed", { layoutId: "feed", icon: "list", mediaTime: state.time, stale: runtimeIsStale(), className: "bv-overlay-feed", bodyStyle: { padding: "6px" }, footer: footer, collapsed: panelCollapsed("feed"), onToggleCollapse: function (value) { togglePanelCollapsed("feed", value); }, actions: [ui.iconButton("pencil", "Open manual labeling (O)", { size: "sm", onClick: openLabeling }), ui.iconButton("x", "Hide stroke feed", { size: "sm", onClick: function () { state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: "feed", value: false }); persist(); render(); } })] }, children);
    }
    function controlsPanel() {
      return ui.panel("Live controls", { layoutId: "controls", className: "bv-controls-panel", bodyStyle: { display: "flex", gap: "var(--sp-3)" }, collapsed: panelCollapsed("controls"), onToggleCollapse: function (value) { togglePanelCollapsed("controls", value); } }, [
        ui.button("Density: " + state.density, { size: "sm", icon: "sliders", onClick: cycleDensity }),
        ui.button("Summary", { size: "sm", icon: "table", onClick: openSummary })
      ]);
    }
    function overlayPanelShortcut(label, panel, icon, description) {
      var button = ui.button(label, {
        variant: state.panels[panel] ? "secondary" : "ghost",
        size: "sm",
        icon: icon,
        pressed: state.panels[panel],
        title: description || "Show " + label.toLowerCase() + " on the video",
        onClick: function () {
          state = window.BVState.reduceExtensionState(state, { type: "TOGGLE_PANEL", panel: panel, value: true });
          overlayMenuOpen = false;
          persist();
          render();
        }
      });
      button.setAttribute("data-bso-overlay-shortcut", panel);
      return button;
    }
    function overlayAccessPoint() {
      var access = ui.el("div", { className: "bv-overlay-access" });
      var button = ui.button("Panels", {
        variant: "ghost",
        size: "sm",
        icon: overlayMenuOpen ? "x" : "layout",
        pressed: overlayMenuOpen,
        title: overlayMenuOpen ? "Close overlay shortcuts" : "Open overlay shortcuts",
        onClick: function () { overlayMenuOpen = !overlayMenuOpen; render(); }
      });
      button.setAttribute("aria-expanded", String(overlayMenuOpen));
      button.setAttribute("aria-controls", "bv-overlay-shortcuts");
      button.setAttribute("data-bso-overlay-access", "true");
      access.appendChild(button);
      var manualShortcut = ui.button("Label it myself", { variant: "ghost", size: "sm", icon: "pencil", onClick: function () { overlayMenuOpen = false; openLabeling(); } });
      manualShortcut.setAttribute("data-bso-overlay-shortcut", "manual");
      var menu = ui.el("div", {
        className: "bv-overlay-menu",
        id: "bv-overlay-shortcuts",
        role: "menu",
        "aria-label": "Overlay shortcuts",
        "data-bso-overlay-menu": "true",
        hidden: !overlayMenuOpen
      }, [
        ui.el("strong", { className: "bv-overlay-menu-title" }, ["Overlay shortcuts"]),
        ui.el("span", { className: "bv-overlay-menu-help" }, ["Choose what to open over the video."]),
        overlayPanelShortcut("Shots this rally", "feed", "list", "Show the live stroke feed"),
        overlayPanelShortcut("Rally stats", "stats", "activity", "Show rally statistics"),
        overlayPanelShortcut("Court map", "map", "crosshair", "Show the court map"),
        overlayPanelShortcut("Evidence visibility", "evidence", "activity", "Show detection-layer visibility controls"),
        overlayPanelShortcut("Live controls", "controls", "sliders", "Show density and summary shortcuts"),
        manualShortcut,
        ui.button("Density: " + state.density, { variant: "ghost", size: "sm", icon: "sliders", onClick: cycleDensity }),
        ui.button("Summary", { variant: "ghost", size: "sm", icon: "table", onClick: openSummary })
      ]);
      access.appendChild(menu);
      return access;
    }
    function liveOverlay() {
      var overlay = ui.el("div", {
        className: "bv-overlay-root",
        "data-bso-overlay-state": runtimeView.phase === "fallback" ? "fallback" : runtimeIsStale() ? "stale" : "live",
        "data-bso-runtime-phase": runtimeView.phase || "unknown",
        "data-bso-analysis-state": runtimeView.result && runtimeView.result.state || "unknown",
        "data-bso-player-state": runtimeView.result && runtimeView.result.tracking && runtimeView.result.tracking.state || "unknown",
        "data-bso-shuttle-state": runtimeView.result && runtimeView.result.shuttle && runtimeView.result.shuttle.state || "unknown",
        "data-bso-court-state": courtDiagnosticState(),
        "data-bso-density": state.density
      });
      if (calibration && courtLinesVisible()) overlay.appendChild(calibrationDrawing());
      // Evidence is drawn in normalized video coordinates and never intercepts
      // pointer input, so player/shuttle rendering cannot block playback or seed clicks.
      overlay.appendChild(runtimeEvidenceDrawing());
      var leftChildren = [];
      if (state.density !== "minimal") leftChildren.push(ui.el("div", { className: "bv-runtime-note", role: "status" }, [ui.icon("info", 11), runtimeCaption()]));
      if (state.density === "full") leftChildren.push(ui.el("div", { className: "bv-runtime-signal", role: "status" }, ["players ", ui.badge(String(runtimePlayers().filter(function (player) { return player && player.bbox && player.state !== "unknown"; }).length), "info"), " · shuttle ", ui.badge(evidenceState(runtimeShuttle()), evidenceState(runtimeShuttle()) === "tracked" ? "in" : "unknown")]));
      if (leftChildren.length) overlay.appendChild(ui.el("div", { className: "bv-overlay-stack left" }, leftChildren));
      // The access point is the only default interactive surface. The popup is
      // canonical for durable visibility choices; this menu is a small shortcut
      // for opening an already-supported panel while watching.
      overlay.appendChild(overlayAccessPoint());
      if (state.panels.evidence) overlay.appendChild(evidenceVisibilityPanel());
      if (state.panels.stats) overlay.appendChild(statsPanel());
      if (state.panels.map) overlay.appendChild(mapPanel());
      if (state.panels.feed) overlay.appendChild(feedPanel());
      if (state.panels.controls) overlay.appendChild(controlsPanel());
      return overlay;
    }
  
    function openLabeling(record) {
      state = window.BVState.reduceExtensionState(state, { type: "OPEN_LABELING" });
      // Opening a fresh draft must never inherit the id of a previously edited
      // row. Existing-label mode is entered only through an explicit record.
      editingEventId = record && record.eventId != null ? String(record.eventId) : null;
      draft = record ? newDraft(record) : newDraft();
      persist();
      render();
    }
    function commitReviewEvent(record, previousSuggestion, operation) {
      if (!record || !record.eventId || !window.BVReview) return null;
      var previousStroke = strokes.find(function (stroke) { return String(stroke.eventId) === String(record.eventId); });
      var previousLabel = labelForEvent(record.eventId);
      var editNow = new Date().toISOString();
      if (previousLabel) {
        if (record.createdAt == null) record.createdAt = previousLabel.createdAt;
        record.updatedAt = editNow;
      }
      var normalized = window.BVReview.normalizeManualLabel(record, { now: editNow });
      if (!normalized) return null;
      var nextLabels = window.BVReview.upsert(state.manualLabels, normalized);
      var edit = {
        eventId: normalized.eventId,
        operation: operation || (previousLabel ? "update" : "create"),
        source: normalized.source || "manual",
        time: normalized.time,
        previousStroke: previousStroke ? window.BVReview.clone(previousStroke) : null,
        previousLabel: previousLabel ? window.BVReview.clone(previousLabel) : null,
        previousSuggestion: previousSuggestion ? window.BVReview.clone(previousSuggestion) : null
      };
      state = window.BVState.reduceExtensionState(state, { type: "SET_REVIEW_LABELS", videoKey: activeVideoKey, labels: nextLabels, lastEdit: edit });
      strokes = reviewStrokes();
      persist();
      return normalized;
    }
    function acceptSuggestion() {
      if (!suggestion) return;
      var accepted = {
        eventId: suggestion.eventId,
        rallyId: suggestion.rallyId,
        sequence: strokes.length + 1,
        shot: suggestion.shot,
        time: suggestion.time,
        startSec: suggestion.startSec != null ? suggestion.startSec : window.BVReview.mediaSeconds(suggestion.time),
        endSec: suggestion.endSec,
        status: "accepted",
        source: "auto",
        provenance: "suggestion",
        confidence: suggestion.confidence
      };
      if (suggestion.playerId != null) accepted.playerId = suggestion.playerId;
      if (suggestion.player != null) accepted.player = suggestion.player;
      var priorSuggestion = suggestion;
      var saved = commitReviewEvent(accepted, priorSuggestion);
      if (!saved) return;
      send({ type: "ACCEPT_SUGGESTION", eventId: accepted.eventId });
      suggestion = null;
      if (state.labeling) {
        editingEventId = null;
        draft = newDraft();
        persist();
      }
      render();
    }
    function undoLastEdit() {
      var edit = state.lastEdit;
      if (!edit || !edit.eventId || !window.BVReview) return;
      state = window.BVState.reduceExtensionState(state, { type: "UNDO_LABEL", videoKey: activeVideoKey, edit: edit, labels: window.BVReview.undoLabelMutation(state.manualLabels, edit) });
      strokes = reviewStrokes();
      suggestion = edit.previousSuggestion ? window.BVReview.clone(edit.previousSuggestion) : null;
      if (state.labeling) {
        editingEventId = null;
        draft = newDraft();
      }
      persist();
      send({ type: "UNDO_LABEL", eventId: edit.eventId });
      render();
    }
    function deleteReviewEvent(stroke) {
      if (!stroke || !stroke.eventId || !window.BVReview) return;
      var previousLabel = (state.manualLabels || []).find(function (label) { return String(label.eventId) === String(stroke.eventId); });
      if (!previousLabel) return;
      state.lastEdit = {
        eventId: stroke.eventId,
        source: "manual-delete",
        time: stroke.time,
        previousStroke: window.BVReview.clone(stroke),
        previousLabel: window.BVReview.clone(previousLabel),
        previousSuggestion: null
      };
      state.manualLabels = window.BVReview.without(state.manualLabels, stroke.eventId);
      strokes = reviewStrokes();
      persist();
      send({ type: "DELETE_LABEL", eventId: stroke.eventId });
      render();
    }
    function cycleDensity() {
      var values = ["minimal", "balanced", "full"];
      var next = values[(values.indexOf(state.density) + 1) % values.length];
      state = window.BVState.reduceExtensionState(state, { type: "SET_DENSITY", value: next });
      persist();
      send({ type: "SET_DENSITY", value: next });
      render();
    }
    function openSummary() {
      if (hasChrome() && chrome.runtime) send({ type: "OPEN_SUMMARY" });
      else if (window.open) window.open("summary.html?from=" + encodeURIComponent(window.location.href), "_blank");
    }
    function exportCsv() {
      var videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : data.video.url;
      var rows = strokes.map(function (stroke, index) {
        return window.BVReview ? window.BVReview.toShotRow(stroke, videoUrl, index) : { video_url: videoUrl, shot_id: stroke.eventId, label: stroke.shot || "unclassified" };
      });
      var csvText = window.BVAnalysis.toShotsCsv(rows, { includeManualMetadata: true });
      // Test/recovery seam: the latest export text stays on the singleton so the
      // CSV round trip can be asserted without reading a blob URL.
      if (singleton) singleton.lastExportCsv = csvText;
      var link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csvText], { type: "text/csv" })); link.download = "badminton-vision-shots.csv"; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
    }
    function setImportResult(result) {
      importResult = result;
      if (state.labeling) render();
    }
    function importCsvText(text) {
      if (!window.BVAnalysis || !window.BVReview || !window.BVState) return;
      var parsed = window.BVAnalysis.parseShotsCsv(text);
      if (!parsed || !parsed.ok) { setImportResult({ error: parsed && parsed.error ? parsed.error : "Could not parse the selected CSV file." }); return; }
      var existing = (state.manualLabels || []).slice();
      var normalized = window.BVAnalysis.normalizeImportedShots(parsed.rows, { existing: existing, now: new Date().toISOString() });
      if (normalized.records.length) {
        var merged = existing.slice();
        normalized.records.forEach(function (record) { merged = window.BVReview.upsert(merged, record); });
        state = window.BVState.reduceExtensionState(state, { type: "SET_REVIEW_LABELS", videoKey: activeVideoKey, labels: merged });
        strokes = reviewStrokes();
        persist();
        send({ type: "IMPORT_LABELS", count: normalized.records.length });
      }
      setImportResult({ imported: normalized.records.length, skipped: normalized.skipped + normalized.invalid, total: parsed.rows.length });
    }
    function readCsvFile(file) {
      function handle(text) { importCsvText(String(text || "")); }
      if (file && typeof file.text === "function") {
        var reading = file.text();
        if (reading && typeof reading.then === "function") reading.then(handle, function () { setImportResult({ error: "Could not read the selected CSV file." }); });
        else handle(reading);
      } else if (file && typeof FileReader !== "undefined") {
        var reader = new FileReader();
        reader.onload = function () { handle(reader.result); };
        reader.onerror = function () { setImportResult({ error: "Could not read the selected CSV file." }); };
        reader.readAsText(file);
      } else setImportResult({ error: "This browser cannot read the selected CSV file." });
    }
    function importCsv() {
      if (!csvInput) {
        csvInput = document.createElement("input");
        csvInput.type = "file";
        csvInput.accept = ".csv,text/csv";
        csvInput.setAttribute("data-bso-import-csv-input", "true");
        csvInput.style.display = "none";
        (document.body || document.documentElement || document).appendChild(csvInput);
        csvInput.addEventListener("change", function () {
          var file = csvInput.files && csvInput.files[0];
          csvInput.value = "";
          if (!file) return;
          readCsvFile(file);
        });
      }
      csvInput.click();
    }
    function refreshLabelingClock() {
      if (!state.labeling || !root || typeof root.querySelector !== "function") return false;
      var panel = root.querySelector(".bv-label-panel");
      if (!panel) return false;
      var time = panel.querySelector(".bv-panel-time");
      if (time) time.textContent = state.time || "";
      panel.setAttribute("data-bso-media-time", state.time || "");
      return true;
    }
    function syncManualDraft() {
      if (!state.labeling || !root || typeof root.querySelector !== "function") return false;
      var panel = root.querySelector(".bv-label-panel");
      if (!panel) return false;
      var activeSuggestion = state.enabled ? suggestion : null;
      var saveLabel = draft.shot || (activeSuggestion && activeSuggestion.shot);
      var windowLabel = panel.querySelector("[data-bso-label-window]");
      if (windowLabel) windowLabel.textContent = (draft.start || "current timestamp") + " → " + (draft.end || "—");
      panel.querySelectorAll("[data-bso-shot]").forEach(function (button) {
        var shot = button.getAttribute("data-bso-shot");
        var selected = draft.shot === shot;
        button.className = "bv-shot" + (selected ? " selected" : activeSuggestion && activeSuggestion.shot === shot ? " suggested" : "");
        button.setAttribute("aria-pressed", String(selected));
        var shortcut = button.querySelector(".bv-kbd");
        if (shortcut) shortcut.className = "bv-kbd" + (selected ? " accent" : "");
      });
      panel.querySelectorAll("[data-bso-player-id]").forEach(function (button) {
        button.setAttribute("aria-checked", String(button.getAttribute("data-bso-player-id") === (draft.playerId || "")));
      });
      panel.querySelectorAll("[data-bso-axis]").forEach(function (axis) {
        var value = draft.axes[axis.getAttribute("data-bso-axis")];
        axis.querySelectorAll("[data-bso-axis-option]").forEach(function (button) {
          var selected = button.getAttribute("data-bso-axis-option") === value;
          button.className = "bv-axis-option" + (selected ? " selected" : "");
          button.setAttribute("aria-pressed", String(selected));
        });
      });
      var save = panel.querySelector("[data-bso-label-save]");
      if (save) {
        var actionLabel = editingEventId ? "Save correction" : draft.shot ? "Save label" : activeSuggestion ? "Accept suggestion" : "Save label";
        save.disabled = !saveLabel;
        if (save.textContent !== actionLabel) save.replaceChildren(document.createTextNode(actionLabel));
      }
      panel.setAttribute("data-bso-label-mode", editingEventId ? "edit" : "create");
      panel.setAttribute("data-bso-draft-state", saveLabel ? "dirty" : "ready");
      refreshLabelingClock();
      return true;
    }
    function manualPanel() {
      // Offline mode has no suggestion source. Fixture suggestions only enter
      // the correction path when the live overlay is explicitly enabled.
      var activeSuggestion = state.enabled ? suggestion : null;
      var saveLabel = draft.shot || (activeSuggestion && activeSuggestion.shot);
      var saveActionLabel = editingEventId ? "Save correction" : draft.shot ? "Save label" : activeSuggestion ? "Accept suggestion" : "Save label";
      var canDelete = Boolean(editingEventId && labelForEvent(editingEventId));
      var saveButton = ui.button(saveActionLabel, { variant: "primary", size: "sm", disabled: !saveLabel, onClick: saveDraft });
      saveButton.setAttribute("data-bso-label-save", "true");
      var panel = ui.panel("Manual labeling", { layoutId: "manual", icon: "pencil", mediaTime: state.time, className: "bv-label-panel bv-overlay-label", bodyStyle: { flex: "1" }, collapsed: panelCollapsed("manual"), onToggleCollapse: function (value) { togglePanelCollapsed("manual", value); }, actions: [ui.kbd("Esc"), ui.iconButton("x", "Close manual labeling", { size: "sm", onClick: closeLabeling })], footer: ui.el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-4)" } }, [ui.button("Export CSV", { variant: "ghost", size: "sm", icon: "download", onClick: exportCsv }), ui.button("Import CSV", { variant: "ghost", size: "sm", icon: "upload", onClick: importCsv }), state.lastEdit ? ui.button("Undo", { variant: "ghost", size: "sm", onClick: undoLastEdit }) : null, canDelete ? ui.button("Delete label", { variant: "danger", size: "sm", onClick: deleteExistingLabel }) : null, ui.el("span", { style: { marginLeft: "auto", display: "flex", gap: "var(--sp-3)" } }, [ui.button("Close", { variant: "ghost", size: "sm", onClick: closeLabeling }), saveButton])]) }, []);
      panel.tabIndex = 0;
      panel.setAttribute("data-bso-label-mode", editingEventId ? "edit" : "create");
      panel.setAttribute("data-bso-draft-state", saveLabel ? "dirty" : "ready");
      panel.setAttribute("data-bso-media-time", state.time || "");
      var body = panel.querySelector(".bv-panel-body");
      // A collapsed panel renders only its header bar; the form is rebuilt when
      // the panel is expanded again, so nothing is lost by skipping the body.
      if (body) {
        body.appendChild(ui.callout("guide", "Manual / offline mode", "Playback is read-only. No court seed, inference model, or production CV evidence is required."));
        body.appendChild(ui.el("div", { className: "bv-segment-window" }, [ui.el("span", { className: "bv-mono", "data-bso-label-window": "true" }, [(draft.start || "current timestamp") + " → " + (draft.end || "—")]), ui.el("span", { className: "bv-segment-controls" }, [ui.button("Start", { variant: "ghost", size: "sm", disabled: currentMediaTimestamp() == null, onClick: function () { if (currentMediaTimestamp() != null) draft.start = formatMediaTime(currentMediaTimestamp()); syncManualDraft(); } }), ui.button("End", { variant: "ghost", size: "sm", disabled: currentMediaTimestamp() == null, onClick: function () { if (currentMediaTimestamp() != null) draft.end = formatMediaTime(currentMediaTimestamp()); syncManualDraft(); } })]) ]));
        if (activeSuggestion) body.appendChild(ui.el("div", { className: "bv-manual-suggestion" }, [ui.badge("auto suggestion", "warn"), ui.el("span", { className: "bv-feed-shot" + (draft.shot ? " replaced" : "") }, [activeSuggestion.shot]), ui.confidence(activeSuggestion.confidence, { showWord: true }), ui.el("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", font: "var(--type-ui-sm)", color: "var(--text-faint)" } }, ["accept", ui.kbd("↵", true)])]));
        body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Shot family"]));
        body.appendChild(ui.shotPicker(draft.shot, activeSuggestion && activeSuggestion.shot, function (shot) { draft.shot = shot; syncManualDraft(); }));
        body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Player identity (optional)"]));
        body.appendChild(ui.segmented([{ value: "", label: "Unknown" }, { value: "A", label: "Player A" }, { value: "B", label: "Player B" }], draft.playerId || "", function (player) { draft.playerId = player || null; syncManualDraft(); }, true, "data-bso-player-id"));
        body.appendChild(ui.el("span", { className: "bv-field-label" }, ["Dimensions (optional)"]));
        var axisList = ui.el("div", { className: "bv-axis-list" });
        data.axes.forEach(function (axis) { axisList.appendChild(ui.dimensionAxis(axis.label, axis.options, draft.axes[axis.label], function (value) { draft.axes[axis.label] = value; syncManualDraft(); })); });
        body.appendChild(axisList);
        body.appendChild(ui.el("p", { className: "bv-helper" }, ["Manual labels are first-class records. Saving updates the same event id and appends provenance — it never creates a duplicate or invents CV evidence."]));
        if (importResult) {
          var resultText = importResult.error
            ? "Import failed: " + importResult.error
            : "Imported " + importResult.imported + " label" + (importResult.imported === 1 ? "" : "s") + (importResult.skipped ? " · skipped " + importResult.skipped + " duplicate" + (importResult.skipped === 1 ? "" : "s") : "") + ".";
          body.appendChild(ui.el("p", { className: "bv-helper bv-import-result" + (importResult.error ? " error" : ""), role: "status", "data-bso-import-result": "true" }, [importResult.error ? ui.badge("failed", "warn") : ui.badge("ok", "in"), " " + resultText]));
        }
        if (state.manualLabels && state.manualLabels.length) {
          var savedLabels = ui.el("div", { className: "bv-manual-saved", "aria-label": "Saved labels for this video" });
          savedLabels.appendChild(ui.el("span", { className: "bv-field-label" }, ["Saved labels for this video"]));
          // Saved rows share the bounded, scrollable feed list contract so a
          // long manual session stays navigable without growing over the video.
          var savedFeed = ui.el("div", { className: "bv-feed" });
          state.manualLabels.forEach(function (label, index) {
            var savedRow = Object.assign({}, label, { sequence: label.sequence || index + 1 });
            savedFeed.appendChild(ui.strokeFeedItem(savedRow, function () { openExistingLabel(label); }));
          });
          savedLabels.appendChild(savedFeed);
          body.appendChild(savedLabels);
        }
      }
      setTimeout(function () {
        if (panel.isConnected && state.labeling && root && root.querySelector(".bv-label-panel") === panel) panel.focus();
      }, 0);
      return panel;
    }
    function saveDraft() {
      if (draft.shot) saveManual(draft.shot);
      else if (state.enabled && suggestion) acceptSuggestion();
    }
    function saveManual(shot) {
      if (!shot || !window.BVReview) return;
      var activeSuggestion = state.enabled ? suggestion : null;
      var existing = editingEventId ? labelForEvent(editingEventId) : null;
      var startSec = window.BVReview.mediaSeconds(draft.start);
      var endSec = window.BVReview.mediaSeconds(draft.end);
      if (startSec == null) startSec = currentMediaTimestamp();
      var eventId = editingEventId || (activeSuggestion && activeSuggestion.eventId) || window.BVState.createManualEventId(activeVideoKey, startSec, state.manualLabels);
      var record = {
        eventId: eventId,
        rallyId: activeSuggestion ? activeSuggestion.rallyId : draft.rallyId != null ? draft.rallyId : existing && existing.rallyId != null ? existing.rallyId : state.rally,
        sequence: draft.sequence || (strokes.find(function (stroke) { return String(stroke.eventId) === String(eventId); }) || {}).sequence || strokes.length + 1,
        shot: shot,
        time: startSec == null ? draft.start : formatMediaTime(startSec),
        startSec: startSec,
        endSec: endSec,
        axes: Object.keys(draft.axes || {}).reduce(function (result, key) { if (draft.axes[key] != null && draft.axes[key] !== "") result[key] = draft.axes[key]; return result; }, {}),
        status: activeSuggestion || existing ? "corrected" : "accepted",
        source: "manual",
        provenance: activeSuggestion ? "manual-correction" : existing ? "manual-edit" : "manual"
      };
      if (draft.playerId) {
        record.playerId = draft.playerId;
        record.player = draft.playerId;
      } else if (existing && existing.playerId != null) {
        record.playerId = existing.playerId;
        if (existing.player != null) record.player = existing.player;
      } else if (existing && existing.player != null) record.player = existing.player;
      else if (activeSuggestion && activeSuggestion.playerId != null) {
        record.playerId = activeSuggestion.playerId;
        if (activeSuggestion.player != null) record.player = activeSuggestion.player;
      } else if (activeSuggestion && activeSuggestion.player != null) record.player = activeSuggestion.player;
      if (existing) {
        var dimensionFields = { Longitudinal: "longitudinal_position", Lateral: "lateral_position", Timing: "timing", Intention: "intention", Impact: "impact", Direction: "direction" };
        Object.keys(dimensionFields).forEach(function (axis) {
          if (record.axes[axis] != null && existing[dimensionFields[axis]] != null) record[dimensionFields[axis]] = record.axes[axis];
        });
      }
      var priorSuggestion = activeSuggestion;
      var saved = commitReviewEvent(record, priorSuggestion);
      if (!saved) return;
      send({ type: "LABEL_EVENT", eventId: eventId, shot: shot, provenance: "manual", startSec: startSec, endSec: endSec });
      if (activeSuggestion) suggestion = null;
      // A save completes this draft, not the labeling session. Keep the panel
      // open with a fresh event id and freshly bound controls for the next shot.
      editingEventId = null;
      draft = newDraft();
      persist();
      render();
    }
    function deleteExistingLabel() {
      var existing = editingEventId && labelForEvent(editingEventId);
      if (!existing || !window.BVReview) return;
      var edit = {
        eventId: existing.eventId,
        operation: "delete",
        source: "manual",
        time: existing.time,
        previousLabel: window.BVReview.clone(existing),
        previousSuggestion: null
      };
      state = window.BVState.reduceExtensionState(state, { type: "SET_REVIEW_LABELS", videoKey: activeVideoKey, labels: window.BVReview.without(state.manualLabels, existing.eventId), lastEdit: edit });
      strokes = reviewStrokes();
      persist();
      send({ type: "DELETE_LABEL", eventId: existing.eventId, provenance: "manual" });
      editingEventId = null;
      draft = newDraft();
      persist();
      render();
    }
    function closeLabeling() {
      state = window.BVState.reduceExtensionState(state, { type: "CLOSE_LABELING" });
      editingEventId = null;
      draft = newDraft();
      importResult = null;
      persist();
      render();
    }
  
    function isInteractiveTarget(target) {
      var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
      return tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "a" || target && target.isContentEditable || target && target.getAttribute && target.getAttribute("role") === "button";
    }
    function handleKeyboardShortcuts(event) {
      var key = String(event.key || "").toLowerCase();
      // Escape is a global dismiss affordance, including while a shot button is
      // focused. Other shortcuts yield to native controls so Enter/Space do not
      // accidentally save a draft when activating a picker button.
      if (key === "escape" && overlayMenuOpen) {
        event.preventDefault();
        overlayMenuOpen = false;
        render();
        return;
      }
      if (key === "escape" && state.labeling && !state.seeding) {
        event.preventDefault();
        closeLabeling();
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (key === "o" && state.enabled && !state.seeding) {
        event.preventDefault();
        if (!state.labeling) openLabeling();
        return;
      }
      if (!state.labeling || state.seeding) return;
      if (key >= "1" && key <= "9") {
        draft.shot = ["Serve", "Clear", "Drop", "Smash", "Half Smash", "Lift", "Net Shot", "Net Kill", "Push"][Number(key) - 1];
        event.preventDefault();
        syncManualDraft();
      } else if (key === "s") {
        // Read current time directly from video element to avoid stale cached value
        var currentTime = video && Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : mediaTime;
        draft.start = formatMediaTime(currentTime);
        event.preventDefault();
        syncManualDraft();
      } else if (key === "e") {
        // Read current time directly from video element to avoid stale cached value
        var currentTime = video && Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : mediaTime;
        draft.end = formatMediaTime(currentTime);
        event.preventDefault();
        syncManualDraft();
      } else if (event.key === "Enter" && (draft.shot || suggestion)) {
        event.preventDefault();
        saveDraft();
      }
    }
  
    function render() {
      if (!root) return;
      // Runtime/status updates replace the panel DOM. Never leave a pointer
      // gesture attached to a retired node or let it write stale geometry.
      if (panelGesture) { setPanelGestureState(panelGesture, false); panelGesture = null; }
      updateDiagnosticsMarkers();
      root.replaceChildren();
      if (!state.enabled && !state.seeding && !state.labeling) return;
      if (state.seeding) root.appendChild(seedFlow());
      else if (state.enabled) root.appendChild(liveOverlay());
      if (state.labeling && !state.seeding) root.appendChild(manualPanel());
      refreshPanelLayouts();
      installPanelInteractionsInRoot();
    }
    function applyStoredState(nextState) {
      var key = currentVideoKey();
      var wasLabeling = state.labeling;
      state = window.BVState.stateForVideo(nextState, key);
      if (key) {
        state.videoKey = key;
        if (!state.videoUrl && window.location && /^https?:/.test(window.location.href)) state.videoUrl = window.location.href;
      }
      restoreReviewState();
      if (state.seeded && !state.calibration) {
        state = window.BVState.resetVideoLocalState(state, key);
        state.videoUrl = window.location && /^https?:/.test(window.location.href) ? window.location.href : null;
        state.calibrationError = "This saved court has no fitted calibration. Please seed the four outer corners again.";
        restoreReviewState();
      }
      activeVideoKey = key;
      if (video && Number.isFinite(video.currentTime) && !state.stale) state.time = formatMediaTime(video.currentTime);
      // A restored open panel starts a new draft at the actual media clock. Do
      // not carry the module's pre-video 00:00 draft into a reloaded page, while
      // preserving an in-progress draft when an external state update arrives
      // during an already-open labeling session.
      if (state.labeling && !wasLabeling) {
        editingEventId = null;
        draft = newDraft();
      }
      restoreCalibrationState();
      if (state.enabled) startRuntime();
      persist();
    }
    function handleNavigation() {
      // Navigation is a hard video-local boundary even if YouTube reuses the
      // same HTMLVideoElement for its next watch page.
      resetVideoLocalState("navigation");
    }
    function handleMessageAfterStorage(message) {
      if (!message) return;
      if (message.type === "START_SEED") {
        bindVideoState();
        state = window.BVState.reduceExtensionState(state, { type: "START_SEED" });
        state.videoKey = activeVideoKey || currentVideoKey();
        startRuntime();
        seedPoints = [];
        calibration = null;
        persist(); render();
      }
      else if (message.type === "ENABLE" || message.type === "OPEN_OVERLAY") {
        bindVideoState();
        state = window.BVState.reduceExtensionState(state, { type: message.type });
        state.videoKey = activeVideoKey || currentVideoKey();
        startRuntime();
        seedPoints = state.seeding ? state.seedDraftPoints.slice() : [];
        if (state.seeded && state.calibration && !calibration) restoreCalibrationState();
        persist(); render();
      }
      else if (message.type === "DISABLE") {
        overlayMenuOpen = false;
        stopRuntime("disabled");
        state = window.BVState.reduceExtensionState(state, { type: "DISABLE" });
        persist(); render();
      }
      else if (message.type === "OPEN_LABELING") { bindVideoState(); openLabeling(); }
      else if (message.type === "SET_DENSITY") { state = window.BVState.reduceExtensionState(state, { type: "SET_DENSITY", value: message.value }); persist(); render(); }
      else if (message.type === "SET_PANELS") { state = window.BVState.reduceExtensionState(state, { type: "SET_PANELS", panels: message.panels }); persist(); render(); }
      else if (message.type === "SET_TRACKER") { state = window.BVState.reduceExtensionState(state, message); persist(); render(); }
      else if (message.type === "TOGGLE_PANEL_COLLAPSE") { state = window.BVState.reduceExtensionState(state, message); persist(); render(); }
      else if (message.type === "SET_COURT_LINES") { state = window.BVState.reduceExtensionState(state, message); persist(); render(); }
      else if (message.type === "STATE_UPDATE" && message.state) { applyStoredState(message.state); render(); }
      else if (message.type === "CAMERA_CUT") {
        state = window.BVState.reduceExtensionState(state, { type: "CAMERA_CUT" });
        state.videoKey = activeVideoKey || currentVideoKey();
        calibration = null;
        panelGesture = null;
        seedPoints = [];
        persist(); render();
      }
    }
    function handleMessage(message) {
      if (!message || hasSeenMessage(message)) return;
      if (!storageHydrated) {
        pendingMessages.push(message);
        return;
      }
      handleMessageAfterStorage(message);
    }
    function releasePendingMessages() {
      storageHydrated = true;
      var queued = pendingMessages;
      pendingMessages = [];
      queued.forEach(handleMessageAfterStorage);
    }
    function removeRetiredRuntimeOverlays() {
      if (!document || typeof document.querySelectorAll !== "function") return;
      document.querySelectorAll("[data-bso-runtime-overlay]").forEach(function (node) {
        if (node && typeof node.remove === "function") node.remove();
        else if (node && node.parentNode && typeof node.parentNode.removeChild === "function") node.parentNode.removeChild(node);
      });
    }
    function removeRetiredContentHosts() {
      if (!document || typeof document.querySelectorAll !== "function") return;
      // Extension reloads invalidate the old isolated world but leave its DOM
      // host behind. Remove that stale instance before mounting the new one;
      // this is cleanup, not a second hidden panel or event-handler workaround.
      document.querySelectorAll("[data-badminton-vision]").forEach(function (node) {
        if (node && typeof node.remove === "function") node.remove();
        else if (node && node.parentNode && typeof node.parentNode.removeChild === "function") node.parentNode.removeChild(node);
      });
    }
    function init() {
      // An extension reload can leave the old plain-text runtime node in the
      // page after its isolated world is invalidated. Remove that retired node
      // before mounting the boxed design-system overlay.
      removeRetiredRuntimeOverlays();
      removeRetiredContentHosts();
      host = document.createElement("div"); host.className = "bv-overlay-anchor"; host.setAttribute("data-badminton-vision", "overlay");
      singleton.host = host;
      host.style.position = "fixed"; host.style.zIndex = "2147483640"; host.style.pointerEvents = "none";
      shadow = host.attachShadow({ mode: "open" });
      var link = document.createElement("link"); link.rel = "stylesheet"; link.href = hasChrome() && chrome.runtime ? chrome.runtime.getURL("styles.css") : "styles.css"; shadow.appendChild(link);
      // The stylesheet loads asynchronously; a panel measured before it applies
      // has block-layout geometry. Re-anchor and re-clamp once it is live so a
      // first render can never keep stale full-size panel rects over the video.
      link.addEventListener("load", positionToVideo);
      root = document.createElement("div"); root.className = "bv-overlay-root"; shadow.appendChild(root); document.documentElement.appendChild(host);
      // Publish a base diagnostic state before asynchronous discovery/storage so
      // a runtime fault cannot leave an indistinguishable empty host behind.
      updateDiagnosticsMarkers();
      window.addEventListener("resize", positionToVideo, { passive: true }); window.addEventListener("scroll", positionToVideo, { passive: true, capture: true });
      window.addEventListener("orientationchange", positionToVideo, { passive: true });
      window.addEventListener("transitionend", positionToVideo, { passive: true, capture: true });
      document.addEventListener("fullscreenchange", positionToVideo);
      document.addEventListener("webkitfullscreenchange", positionToVideo);
      window.addEventListener("keydown", handleKeyboardShortcuts);
      // Pointer capture covers normal browsers; the window listeners keep a
      // gesture alive in embedded/recovery DOMs that do not implement capture.
      window.addEventListener("pointermove", panelPointerMove);
      window.addEventListener("pointerup", function (event) { finishPanelGesture(event, false); });
      window.addEventListener("pointercancel", function (event) { finishPanelGesture(event, true); });
      ["yt-navigate-start", "yt-navigate-finish", "popstate", "hashchange"].forEach(function (name) {
        var listener = handleNavigation;
        window.addEventListener(name, listener);
        navigationListeners.push([name, listener]);
      });
      var LayoutResizeObserver = window.ResizeObserver || (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
      if (LayoutResizeObserver) {
        layoutResizeObserver = new LayoutResizeObserver(positionToVideo);
        layoutResizeObserver.observe(document.documentElement);
      }
      // YouTube toggles theater/fullscreen mostly through ancestor class/style
      // mutations. Pair those signals with ResizeObserver so the final measured
      // rendered video content box wins after layout settles.
      domObserver = new MutationObserver(attachVideo); domObserver.observe(document.documentElement, { childList: true, attributes: true, attributeFilter: ["class", "style"], subtree: true }); attachVideo();
      // Manual/offline labeling intentionally does not start the runtime. It
      // reads the media clock only; live inference begins on ENABLE/OPEN_OVERLAY.
      if (hasChrome() && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(handleMessage);
      if (hasChrome() && chrome.storage && chrome.storage.local) chrome.storage.local.get(["bvState"], function (result) {
        applyStoredState(result && result.bvState ? result.bvState : state);
        releasePendingMessages();
        render();
      });
      else {
        applyStoredState(state);
        releasePendingMessages();
        render();
      }
    }
    init();
  })();
  
})(typeof globalThis === "object" ? globalThis : self);
