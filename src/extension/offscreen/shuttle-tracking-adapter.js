/* global globalThis, BSOProtocol */
(function installLocalShuttleAdapter(root, factory) {
  const api = factory(root.BSOProtocol, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOShuttleTrackingAdapter = api;
  root.BSOLocalShuttleAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function shuttleAdapterFactory(protocol, defaultEnvironment) {
  'use strict';

  // This is a bounded pixel heuristic, not a learned model. It deliberately
  // has no model weights or network path and is kept separate from the pose
  // and offscreen orchestration seams until its evidence is validated.
  const MODEL = Object.freeze({
    schema: 'bso.shuttle.local-adapter.v1',
    id: 'local-shuttle-frame-difference-v1',
    version: 1,
    kind: 'bounded-temporal-pixel-heuristic',
    modelNeutral: true,
    runtimeIntegrationTest: false,
    productionModel: false,
    algorithm: 'compact-moving-contrast-with-gated-temporal-continuity'
  });

  const DEFAULTS = Object.freeze({
    maxPixels: 4096,
    minPixelDifference: 0.12,
    cutMeanDifference: 0.32,
    cutChangedFraction: 0.5,
    minCandidateConfidence: 0.46,
    minTrackedConfidence: 0.52,
    maxContinuityDistance: 0.24,
    maxGapSeconds: 1.25,
    ambiguityMargin: 0.08,
    minCandidatePixels: 1,
    maxCandidatePixels: 32,
    maxCandidateFraction: 0.018,
    minCompactness: 0.2,
    maxCandidates: 8,
    maxTrajectoryPoints: 32
  });

  const SOURCE = Object.freeze({ id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' });

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function positiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  function nonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function rounded(value, places = 6) {
    if (!finite(value)) return null;
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }

  function copy(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(copy);
    const result = {};
    Object.keys(value).forEach((key) => { result[key] = copy(value[key]); });
    return result;
  }

  function targetDimensions(width, height, maxPixels) {
    const limit = positiveInteger(maxPixels) ? maxPixels : DEFAULTS.maxPixels;
    if (width * height <= limit) return { width, height };
    const scale = Math.sqrt(limit / (width * height));
    let targetWidth = Math.max(1, Math.round(width * scale));
    let targetHeight = Math.max(1, Math.round(height * scale));
    while (targetWidth * targetHeight > limit) {
      if (targetWidth >= targetHeight && targetWidth > 1) targetWidth -= 1;
      else if (targetHeight > 1) targetHeight -= 1;
      else break;
    }
    return { width: targetWidth, height: targetHeight };
  }

  function validPixelData(frame) {
    if (!isObject(frame) || !positiveInteger(frame.width) || !positiveInteger(frame.height) ||
        !frame.data || typeof frame.data.length !== 'number') return false;
    const pixels = frame.width * frame.height;
    const channels = frame.data.length / pixels;
    if (!Number.isInteger(channels) || channels < 3) return false;
    for (let index = 0; index < frame.data.length; index += 1) {
      if (!finite(Number(frame.data[index]))) return false;
    }
    return true;
  }

  function directPixels(frame) {
    if (!validPixelData(frame)) return null;
    return {
      width: frame.width,
      height: frame.height,
      data: frame.data,
      channels: frame.data.length / (frame.width * frame.height)
    };
  }

  function resizePixels(pixels, maxPixels) {
    const target = targetDimensions(pixels.width, pixels.height, maxPixels);
    if (target.width === pixels.width && target.height === pixels.height) return pixels;
    const data = new Array(target.width * target.height * pixels.channels);
    for (let y = 0; y < target.height; y += 1) {
      const sourceY = Math.min(pixels.height - 1, Math.floor(y * pixels.height / target.height));
      for (let x = 0; x < target.width; x += 1) {
        const sourceX = Math.min(pixels.width - 1, Math.floor(x * pixels.width / target.width));
        const sourceOffset = (sourceY * pixels.width + sourceX) * pixels.channels;
        const targetOffset = (y * target.width + x) * pixels.channels;
        for (let channel = 0; channel < pixels.channels; channel += 1) {
          data[targetOffset + channel] = Number(pixels.data[sourceOffset + channel]);
        }
      }
    }
    return { width: target.width, height: target.height, data, channels: pixels.channels };
  }

  function createCanvas(width, height, environment) {
    const source = environment || defaultEnvironment;
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
   * Read either the stable-channel RGBA transport or an ImageBitmap/VideoFrame.
   * The result is capped before detection so the work stays suitable for an
   * offscreen document and never depends on a remote or uncleared model.
   */
  async function readFramePixels(frame, {
    environment = defaultEnvironment,
    maxPixels = DEFAULTS.maxPixels
  } = {}) {
    const direct = directPixels(frame);
    if (direct) return resizePixels(direct, maxPixels);
    if (!isObject(frame) || !positiveInteger(frame.width) || !positiveInteger(frame.height)) return null;
    const dimensions = targetDimensions(frame.width, frame.height, maxPixels);
    const canvas = createCanvas(dimensions.width, dimensions.height, environment);
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof context.drawImage !== 'function' || typeof context.getImageData !== 'function') return null;
    try {
      context.drawImage(frame, 0, 0, dimensions.width, dimensions.height);
      const image = context.getImageData(0, 0, dimensions.width, dimensions.height);
      return directPixels(image);
    } catch (_) {
      return null;
    }
  }

  function luminance(data, offset) {
    // Rec. 601 is adequate for separating a small white shuttle from the
    // mostly static court/video background and avoids a colour-model claim.
    return clamp((0.299 * Number(data[offset]) + 0.587 * Number(data[offset + 1]) +
      0.114 * Number(data[offset + 2])) / 255);
  }

  function chroma(data, offset) {
    const red = Number(data[offset]);
    const green = Number(data[offset + 1]);
    const blue = Number(data[offset + 2]);
    return (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
  }

  function boxForComponent(component, width, height) {
    return {
      x: rounded(component.minX / width),
      y: rounded(component.minY / height),
      width: rounded((component.maxX - component.minX + 1) / width),
      height: rounded((component.maxY - component.minY + 1) / height)
    };
  }

  function confidenceFor(component, stats, options) {
    const change = clamp(component.meanDifference / Math.max(options.minPixelDifference, 0.001));
    const contrast = clamp((component.contrast - 0.06) / 0.5);
    const compactness = clamp((component.compactness - options.minCompactness) / (1 - options.minCompactness));
    const small = 1 - clamp((component.pixelCount - options.minCandidatePixels) /
      Math.max(1, options.maxCandidatePixels - options.minCandidatePixels));
    const edgePenalty = component.edge ? 0.85 : 1;
    return rounded(clamp((0.38 * change + 0.3 * contrast + 0.2 * compactness + 0.12 * small) * edgePenalty));
  }

  function frameStatistics(current, previous, options) {
    const total = current.width * current.height;
    const currentLuma = new Array(total);
    const differences = new Array(total);
    let currentMean = 0;
    let differenceMean = 0;
    let differenceSquareMean = 0;
    let changed = 0;
    for (let pixel = 0; pixel < total; pixel += 1) {
      const offset = pixel * current.channels;
      const value = luminance(current.data, offset);
      const previousValue = luminance(previous.data, pixel * previous.channels);
      const difference = Math.abs(value - previousValue);
      currentLuma[pixel] = value;
      differences[pixel] = difference;
      currentMean += value;
      differenceMean += difference;
      differenceSquareMean += difference * difference;
      if (difference >= options.minPixelDifference) changed += 1;
    }
    currentMean /= total;
    differenceMean /= total;
    differenceSquareMean /= total;
    return {
      currentLuma,
      differences,
      currentMean,
      differenceMean,
      differenceStd: Math.sqrt(Math.max(0, differenceSquareMean - differenceMean * differenceMean)),
      changedFraction: changed / total
    };
  }

  function componentCandidates(current, previous, stats, options) {
    const total = current.width * current.height;
    const threshold = Math.max(options.minPixelDifference,
      stats.differenceMean + stats.differenceStd * 1.5);
    const visited = new Uint8Array(total);
    const candidates = [];
    const rejected = [];
    const neighborOffsets = [-1, 0, 1];

    function eligible(pixel) {
      const value = stats.currentLuma[pixel];
      const difference = stats.differences[pixel];
      const offset = pixel * current.channels;
      const distinct = Math.abs(value - stats.currentMean) >= 0.1;
      // The chroma branch keeps synthetic/real coloured shuttle highlights
      // usable while the luminance branches reject most player-sized texture.
      return difference >= threshold && (value >= Math.max(0.55, stats.currentMean + 0.12) ||
        value <= Math.min(0.35, stats.currentMean - 0.12) || distinct || chroma(current.data, offset) >= 0.18);
    }

    for (let start = 0; start < total; start += 1) {
      if (visited[start] || !eligible(start)) continue;
      const queue = [start];
      visited[start] = 1;
      const pixels = [];
      let minX = current.width;
      let minY = current.height;
      let maxX = 0;
      let maxY = 0;
      let differenceSum = 0;
      let lumaSum = 0;
      let weightSum = 0;
      let weightedX = 0;
      let weightedY = 0;
      while (queue.length) {
        const pixel = queue.pop();
        const x = pixel % current.width;
        const y = Math.floor(pixel / current.width);
        const value = stats.currentLuma[pixel];
        const difference = stats.differences[pixel];
        pixels.push(pixel);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        differenceSum += difference;
        lumaSum += value;
        const weight = difference * (0.35 + value);
        weightSum += weight;
        weightedX += x * weight;
        weightedY += y * weight;
        for (const dy of neighborOffsets) {
          for (const dx of neighborOffsets) {
            if (!dx && !dy) continue;
            const neighborX = x + dx;
            const neighborY = y + dy;
            if (neighborX < 0 || neighborX >= current.width || neighborY < 0 || neighborY >= current.height) continue;
            const neighbor = neighborY * current.width + neighborX;
            if (!visited[neighbor] && eligible(neighbor)) {
              visited[neighbor] = 1;
              queue.push(neighbor);
            }
          }
        }
      }
      const pixelCount = pixels.length;
      const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
      const compactness = pixelCount / Math.max(1, boxArea);
      const meanDifference = differenceSum / pixelCount;
      const meanLuma = lumaSum / pixelCount;
      const contrast = Math.abs(meanLuma - stats.currentMean);
      const edge = minX === 0 || minY === 0 || maxX === current.width - 1 || maxY === current.height - 1;
      const component = {
        x: rounded((weightSum ? weightedX / weightSum : (minX + maxX) / 2) / current.width),
        y: rounded((weightSum ? weightedY / weightSum : (minY + maxY) / 2) / current.height),
        bbox: boxForComponent({ minX, minY, maxX, maxY }, current.width, current.height),
        pixelCount,
        meanDifference: rounded(meanDifference),
        maxDifference: rounded(Math.max(...pixels.map((pixel) => stats.differences[pixel]))),
        meanLuma: rounded(meanLuma),
        contrast: rounded(contrast),
        compactness: rounded(compactness),
        edge,
        rejected: false
      };
      // Keep the absolute cap for the normal 4096-pixel transport, but do not
      // make a tiny deterministic fixture reject a 3x3 shuttle solely because
      // its frame has fewer pixels than the production capture budget.
      const maxPixelsForComponent = Math.max(options.maxCandidatePixels, Math.floor(total * options.maxCandidateFraction));
      const tooLarge = pixelCount > maxPixelsForComponent;
      if (pixelCount < options.minCandidatePixels || tooLarge || compactness < options.minCompactness) {
        component.rejected = true;
        component.rejectionReason = tooLarge ? 'candidate-too-large' : 'candidate-not-compact';
        rejected.push(component);
        continue;
      }
      component.confidence = confidenceFor(component, stats, options);
      if (component.confidence < options.minCandidateConfidence) {
        component.rejected = true;
        component.rejectionReason = 'candidate-confidence-too-low';
        rejected.push(component);
        continue;
      }
      candidates.push(component);
    }

    candidates.sort((a, b) => b.confidence - a.confidence || a.pixelCount - b.pixelCount || a.y - b.y || a.x - b.x);
    return {
      candidates: candidates.slice(0, options.maxCandidates),
      rejected,
      threshold: rounded(threshold)
    };
  }

  /**
   * Detect compact moving candidates in two already-readable frame samples.
   * This helper is deterministic and intentionally returns no prediction when
   * a previous frame is unavailable or the scene looks like a camera cut.
   */
  function detectCandidates(current, previous, options = {}) {
    const settings = Object.assign({}, DEFAULTS, options);
    if (!current || !previous || current.width !== previous.width || current.height !== previous.height) {
      return { candidates: [], rejected: [], cameraCut: false, reason: 'frame-history-unavailable' };
    }
    const stats = frameStatistics(current, previous, settings);
    const cameraCut = stats.differenceMean >= settings.cutMeanDifference &&
      stats.changedFraction >= settings.cutChangedFraction;
    if (cameraCut) {
      return {
        candidates: [],
        rejected: [],
        cameraCut: true,
        reason: 'camera-cut',
        evidence: {
          meanDifference: rounded(stats.differenceMean),
          changedFraction: rounded(stats.changedFraction)
        }
      };
    }
    const detected = componentCandidates(current, previous, stats, settings);
    return {
      ...detected,
      cameraCut: false,
      reason: detected.candidates.length ? 'candidate-detected' : 'no-candidate',
      evidence: {
        meanDifference: rounded(stats.differenceMean),
        changedFraction: rounded(stats.changedFraction),
        threshold: detected.threshold,
        candidateCount: detected.candidates.length,
        rejectedCount: detected.rejected.length
      }
    };
  }

  function candidateView(candidate, accepted = false) {
    if (!candidate) return null;
    return {
      x: candidate.x,
      y: candidate.y,
      bbox: copy(candidate.bbox),
      confidence: candidate.confidence,
      pixelCount: candidate.pixelCount,
      accepted,
      evidence: {
        meanDifference: candidate.meanDifference,
        maxDifference: candidate.maxDifference,
        meanLuma: candidate.meanLuma,
        contrast: candidate.contrast,
        compactness: candidate.compactness,
        edge: candidate.edge
      }
    };
  }

  function unknownShuttle(reason, evidence = {}) {
    return {
      state: 'unknown',
      confidence: null,
      candidate: null,
      candidates: [],
      trajectory: [],
      accepted: false,
      reason,
      evidence: copy(evidence)
    };
  }

  function unknownEnvelope(sample, reason, analyzerIdentity = MODEL, status = 'fallback', inferenceAvailable = false, evidence = {}) {
    const sessionId = String(sample?.sessionId || 'unknown-session');
    const requestId = String(sample?.requestId || 'unknown-request');
    const mediaTime = finite(sample?.mediaTime) && sample.mediaTime >= 0 ? sample.mediaTime : 0;
    const result = {
      kind: MODEL.kind,
      modelNeutral: true,
      runtimeIntegrationTest: false,
      productionModel: false,
      state: 'unknown',
      players: [],
      tracking: null,
      shuttle: unknownShuttle(reason, evidence),
      strokeEvents: [],
      shotFamily: 'unclassified',
      classificationConfidence: 0,
      geometryConfidence: 0,
      detector: copy(analyzerIdentity),
      reason
    };
    if (protocol && typeof protocol.createAnalyzerResult === 'function') {
      return protocol.createAnalyzerResult({
        sessionId,
        requestId,
        mediaTime,
        status,
        analyzer: MODEL.id,
        analyzerIdentity,
        inferenceAvailable,
        result
      });
    }
    return {
      protocol: 'bso.runtime.v1',
      version: 1,
      type: 'analysis.result',
      sessionId,
      requestId,
      mediaTime,
      analyzedAt: Date.now(),
      status,
      analyzer: MODEL.id,
      analyzerIdentity,
      inferenceAvailable: Boolean(inferenceAvailable),
      capabilities: {},
      capabilityState: {},
      result
    };
  }

  function validSample(sample) {
    if (!isObject(sample)) return false;
    if (!nonEmptyString(String(sample.sessionId || '')) || !nonEmptyString(String(sample.requestId || ''))) return false;
    if (!finite(sample.mediaTime) || sample.mediaTime < 0) return false;
    if (sample.capturedAt != null && !finite(sample.capturedAt)) return false;
    if (sample.dimensions && (!positiveInteger(sample.dimensions.width) || !positiveInteger(sample.dimensions.height))) return false;
    return true;
  }

  class LocalShuttleTrajectoryAdapter {
    constructor({
      environment = defaultEnvironment,
      protocolApi = protocol,
      options = {},
      maxPixels,
      minPixelDifference,
      cutMeanDifference,
      cutChangedFraction,
      minCandidateConfidence,
      minTrackedConfidence,
      maxContinuityDistance,
      maxGapSeconds,
      ambiguityMargin,
      minCandidatePixels,
      maxCandidatePixels,
      maxCandidateFraction,
      minCompactness,
      maxCandidates,
      maxTrajectoryPoints,
      onStatus = () => {}
    } = {}) {
      this.environment = environment;
      this.protocol = protocolApi;
      this.options = Object.assign({}, DEFAULTS, options, {
        ...(maxPixels == null ? {} : { maxPixels }),
        ...(minPixelDifference == null ? {} : { minPixelDifference }),
        ...(cutMeanDifference == null ? {} : { cutMeanDifference }),
        ...(cutChangedFraction == null ? {} : { cutChangedFraction }),
        ...(minCandidateConfidence == null ? {} : { minCandidateConfidence }),
        ...(minTrackedConfidence == null ? {} : { minTrackedConfidence }),
        ...(maxContinuityDistance == null ? {} : { maxContinuityDistance }),
        ...(maxGapSeconds == null ? {} : { maxGapSeconds }),
        ...(ambiguityMargin == null ? {} : { ambiguityMargin }),
        ...(minCandidatePixels == null ? {} : { minCandidatePixels }),
        ...(maxCandidatePixels == null ? {} : { maxCandidatePixels }),
        ...(maxCandidateFraction == null ? {} : { maxCandidateFraction }),
        ...(minCompactness == null ? {} : { minCompactness }),
        ...(maxCandidates == null ? {} : { maxCandidates }),
        ...(maxTrajectoryPoints == null ? {} : { maxTrajectoryPoints })
      });
      this.environment = environment;
      this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
      this.identity = Object.freeze({ ...MODEL });
      this.sessionId = null;
      this.previousPixels = null;
      this.previousDimensions = null;
      this.lastMediaTime = -Infinity;
      this.lastCapturedAt = -Infinity;
      this.seenRequests = new Set();
      this.lastCandidate = null;
      this.trajectory = [];
      this.quarantined = false;
      this.inFlight = false;
      this.generation = 0;
    }

    status(value) {
      try { this.onStatus(value); } catch (_) { /* status listeners cannot break the adapter */ }
    }

    reset(reason = 'session-reset') {
      this.previousPixels = null;
      this.previousDimensions = null;
      this.lastMediaTime = -Infinity;
      this.lastCapturedAt = -Infinity;
      this.seenRequests.clear();
      this.lastCandidate = null;
      this.trajectory = [];
      this.quarantined = false;
      this.generation += 1;
      this.status({ type: 'shuttle-state-reset', reason, generation: this.generation });
      return { reason, generation: this.generation };
    }

    resetSession(sessionId, reason = 'session-reset') {
      if (sessionId != null) this.sessionId = String(sessionId);
      return this.reset(reason);
    }

    unknown(sample, reason, status = 'fallback', inferenceAvailable = false, evidence = {}) {
      const envelope = unknownEnvelope(sample, reason, this.identity, status, inferenceAvailable, evidence);
      this.status({ type: 'shuttle-result', status: 'unknown', reason, requestId: sample?.requestId, mediaTime: sample?.mediaTime });
      return envelope;
    }

    result(sample, shuttle, reason = '') {
      const sessionId = String(sample.sessionId);
      const requestId = String(sample.requestId);
      const mediaTime = sample.mediaTime;
      const analysis = {
        kind: MODEL.kind,
        modelNeutral: true,
        runtimeIntegrationTest: false,
        productionModel: false,
        state: shuttle.state,
        players: [],
        tracking: null,
        shuttle,
        strokeEvents: [],
        shotFamily: 'unclassified',
        classificationConfidence: 0,
        geometryConfidence: 0,
        detector: copy(this.identity),
        reason
      };
      const resultEnvelope = this.protocol && typeof this.protocol.createAnalyzerResult === 'function'
        ? this.protocol.createAnalyzerResult({
          sessionId,
          requestId,
          mediaTime,
          status: 'ok',
          analyzer: MODEL.id,
          analyzerIdentity: this.identity,
          inferenceAvailable: true,
          result: analysis
        })
        : {
          protocol: 'bso.runtime.v1', version: 1, type: 'analysis.result', sessionId, requestId, mediaTime,
          analyzedAt: Date.now(), status: 'ok', analyzer: MODEL.id, analyzerIdentity: this.identity,
          inferenceAvailable: true, capabilities: {}, capabilityState: {}, result: analysis
        };
      this.status({ type: 'shuttle-result', status: shuttle.state, confidence: shuttle.confidence, requestId, mediaTime });
      return resultEnvelope;
    }

    prepareSession(sample) {
      const sessionId = String(sample.sessionId);
      if (this.sessionId === null) this.sessionId = sessionId;
      if (sessionId !== this.sessionId) {
        this.sessionId = sessionId;
        this.reset('session-changed');
      }
    }

    rejectAndQuarantine(sample, reason, evidence = {}, pixels = null) {
      this.lastCandidate = null;
      this.trajectory = [];
      this.quarantined = true;
      if (pixels) {
        this.previousPixels = pixels;
        this.previousDimensions = { width: pixels.width, height: pixels.height };
      }
      return this.unknown(sample, reason, 'ok', true, evidence);
    }

    quarantine(reason = 'quarantined') {
      this.lastCandidate = null;
      this.trajectory = [];
      this.quarantined = true;
      return reason;
    }

    processFrame(sample, pixels = null) {
      if (!validSample(sample)) {
        this.reset('invalid-frame-sample');
        return this.unknown(sample, 'invalid-frame-sample');
      }
      this.prepareSession(sample);
      if (sample.stale === true) {
        this.quarantine('stale-frame');
        return this.unknown(sample, 'stale-frame', 'fallback', false);
      }
      if (sample.backpressure === true) {
        return this.unknown(sample, 'backpressure', 'fallback', false);
      }
      if (this.seenRequests.has(String(sample.requestId))) {
        return this.unknown(sample, 'duplicate-request', 'fallback', false);
      }
      if (sample.mediaTime <= this.lastMediaTime ||
          (sample.capturedAt != null && sample.capturedAt < this.lastCapturedAt)) {
        this.quarantine('stale-frame');
        return this.unknown(sample, 'stale-frame', 'fallback', false);
      }
      if (!pixels) pixels = directPixels(sample.frame);
      if (pixels) pixels = resizePixels(pixels, this.options.maxPixels);
      if (!pixels) {
        this.reset('invalid-frame');
        return this.unknown(sample, 'invalid-frame', 'fallback', false);
      }
      if (sample.dimensions && (sample.dimensions.width !== pixels.width || sample.dimensions.height !== pixels.height)) {
        // The serializable transport reports the prepared frame dimensions, so
        // a mismatch indicates a corrupt sample rather than a resize to bridge.
        this.reset('frame-dimensions-mismatch');
        return this.unknown(sample, 'frame-dimensions-mismatch', 'fallback', false);
      }
      if (sample.cameraCut === true) {
        this.lastMediaTime = sample.mediaTime;
        this.lastCapturedAt = sample.capturedAt == null ? this.lastCapturedAt : sample.capturedAt;
        this.seenRequests.add(String(sample.requestId));
        return this.rejectAndQuarantine(sample, 'camera-cut', {}, pixels);
      }
      if (this.previousPixels &&
          (this.previousPixels.width !== pixels.width || this.previousPixels.height !== pixels.height)) {
        this.lastMediaTime = sample.mediaTime;
        this.lastCapturedAt = sample.capturedAt == null ? this.lastCapturedAt : sample.capturedAt;
        this.seenRequests.add(String(sample.requestId));
        return this.rejectAndQuarantine(sample, 'frame-dimensions-changed', {}, pixels);
      }

      this.seenRequests.add(String(sample.requestId));
      if (this.seenRequests.size > 128) this.seenRequests.delete(this.seenRequests.values().next().value);
      this.lastMediaTime = sample.mediaTime;
      if (sample.capturedAt != null) this.lastCapturedAt = sample.capturedAt;

      if (!this.previousPixels) {
        this.previousPixels = pixels;
        this.previousDimensions = { width: pixels.width, height: pixels.height };
        return this.unknown(sample, 'warming-up', 'ok', true, { candidateCount: 0 });
      }

      const detected = detectCandidates(pixels, this.previousPixels, this.options);
      this.previousPixels = pixels;
      this.previousDimensions = { width: pixels.width, height: pixels.height };
      if (detected.cameraCut) return this.rejectAndQuarantine(sample, 'camera-cut', detected.evidence);
      if (!detected.candidates.length) {
        return this.rejectAndQuarantine(sample, 'no-candidate', {
          ...detected.evidence,
          rejected: detected.rejected.map((candidate) => candidateView(candidate, false))
        });
      }

      const best = detected.candidates[0];
      const second = detected.candidates[1];
      const ambiguous = second && best.confidence - second.confidence <= this.options.ambiguityMargin;
      if (ambiguous) {
        return this.rejectAndQuarantine(sample, 'ambiguous-candidates', {
          ...detected.evidence,
          candidates: detected.candidates.map((candidate) => candidateView(candidate, false))
        });
      }

      if (!this.lastCandidate || this.quarantined) {
        this.lastCandidate = {
          ...copy(best),
          mediaTime: sample.mediaTime,
          requestId: String(sample.requestId)
        };
        this.trajectory = [];
        this.quarantined = false;
        return this.unknown(sample, 'candidate-needs-continuity', 'ok', true, {
          ...detected.evidence,
          candidate: candidateView(best, false)
        });
      }

      const dt = sample.mediaTime - this.lastCandidate.mediaTime;
      if (!finite(dt) || dt <= 0 || dt > this.options.maxGapSeconds) {
        return this.rejectAndQuarantine(sample, 'continuity-gap', {
          ...detected.evidence,
          gapSeconds: rounded(dt)
        });
      }
      const predicted = {
        x: clamp(this.lastCandidate.x + (this.lastCandidate.x - (this.trajectory.at(-2)?.x ?? this.lastCandidate.x)) *
          Math.min(1, dt / Math.max(1e-6, this.lastCandidate.mediaTime - (this.trajectory.at(-2)?.mediaTime ?? this.lastCandidate.mediaTime)))),
        y: clamp(this.lastCandidate.y + (this.lastCandidate.y - (this.trajectory.at(-2)?.y ?? this.lastCandidate.y)) *
          Math.min(1, dt / Math.max(1e-6, this.lastCandidate.mediaTime - (this.trajectory.at(-2)?.mediaTime ?? this.lastCandidate.mediaTime))))
      };
      const distance = Math.hypot(best.x - predicted.x, best.y - predicted.y);
      const continuity = clamp(1 - distance / this.options.maxContinuityDistance);
      const confidence = rounded(clamp(0.58 * best.confidence + 0.42 * continuity));
      const evidence = {
        ...detected.evidence,
        predicted: { x: rounded(predicted.x), y: rounded(predicted.y) },
        distance: rounded(distance),
        continuity: rounded(continuity),
        candidate: candidateView(best, false)
      };
      if (distance > this.options.maxContinuityDistance || confidence < this.options.minTrackedConfidence) {
        return this.rejectAndQuarantine(sample, distance > this.options.maxContinuityDistance ? 'continuity-rejected' : 'confidence-insufficient', evidence);
      }

      const previousCandidate = this.lastCandidate;
      this.lastCandidate = { ...copy(best), mediaTime: sample.mediaTime, requestId: String(sample.requestId) };
      const point = {
        x: best.x,
        y: best.y,
        mediaTime: sample.mediaTime,
        requestId: String(sample.requestId),
        confidence,
        status: 'tracked'
      };
      if (!this.trajectory.length) {
        this.trajectory.push({
          x: previousCandidate.x,
          y: previousCandidate.y,
          mediaTime: previousCandidate.mediaTime,
          requestId: previousCandidate.requestId,
          confidence: previousCandidate.confidence,
          status: 'anchor'
        });
      }
      this.trajectory.push(point);
      if (this.trajectory.length > this.options.maxTrajectoryPoints) this.trajectory.splice(0, this.trajectory.length - this.options.maxTrajectoryPoints);
      const shuttle = {
        state: 'tracked',
        confidence,
        candidate: candidateView(best, true),
        candidates: [candidateView(best, true)],
        trajectory: copy(this.trajectory),
        accepted: true,
        reason: 'temporal-continuity',
        evidence
      };
      return this.result(sample, shuttle, 'temporal-continuity');
    }

    async analyze(sample) {
      if (this.inFlight) return this.unknown(sample, 'backpressure', 'fallback', false);
      this.inFlight = true;
      try {
        const pixels = await readFramePixels(sample?.frame, {
          environment: this.environment,
          maxPixels: this.options.maxPixels
        });
        return this.processFrame(sample, pixels);
      } finally {
        this.inFlight = false;
      }
    }

    update(sample) { return this.processFrame(sample); }
    track(sample) { return this.processFrame(sample); }
    dispose() {
      this.reset('disposed');
      this.sessionId = null;
    }
  }

  return Object.freeze({
    MODEL,
    DEFAULTS,
    SOURCE,
    readFramePixels,
    detectCandidates,
    LocalShuttleTrajectoryAdapter,
    ShuttleTrajectoryAdapter: LocalShuttleTrajectoryAdapter,
    ShuttleTrackingAdapter: LocalShuttleTrajectoryAdapter,
    createAdapter: (options) => new LocalShuttleTrajectoryAdapter(options),
    unknownEnvelope,
    unknownShuttle
  });
}));
