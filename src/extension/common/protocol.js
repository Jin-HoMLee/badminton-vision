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
  function unknownAnalysisResult() {
    return {
      schema: 'bso.analysis.result.v1',
      state: 'partial',
      players: [],
      shuttle: { state: 'unknown', confidence: null },
      strokeEvents: [],
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
   * transport may use the returned transferables when it supports a transfer
   * list; the runtime fixture analyzer consumes the snapshot locally.
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
    return { message, transferables: [frame] };
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
    result = unknownAnalysisResult()
  }) {
    if (!nonEmptyString(requestId)) throw new TypeError('requestId must be a non-empty string');
    if (!finite(mediaTime) || mediaTime < 0) throw new TypeError('mediaTime must be a non-negative number');
    if (!nonEmptyString(analyzer)) throw new TypeError('analyzer must be a non-empty string');
    const state = isObject(capabilityState) ? capabilityState : {};
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
      result,
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
    transport = 'mv3-runtime-messaging'
  }) {
    return {
      ...base(TYPES.CAPABILITY_REPORT, sessionId),
      capabilities: {
        capture,
        transferableFrames: Boolean(transferableFrames),
        offscreen: Boolean(offscreen),
        inference: Boolean(inference),
        analyzer,
        transport
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
      Number.isInteger(message.dimensions.height) && message.dimensions.height > 0 && isObject(message.frame);
  }

  function isAnalyzerResult(message) {
    return hasBase(message, TYPES.ANALYZER_RESULT) && nonEmptyString(message.requestId) &&
      finite(message.mediaTime) && message.mediaTime >= 0 && nonEmptyString(message.analyzer) &&
      isObject(message.result) && isObject(message.capabilities || message.capabilityState);
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
    isFrameSample,
    isAnalyzerResult,
    isCapabilityReport,
    isRuntimeMessage
  });
}));
