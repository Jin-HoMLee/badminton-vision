/* global globalThis, BSOProtocol, BSOPlayerTracking */
(function installLiteOpenPoseAdapter(root, factory) {
  const api = factory(root.BSOProtocol, root.BSOPlayerTracking, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOLiteOpenPoseAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function liteOpenPoseAdapterFactory(protocol, trackingApi, defaultEnvironment) {
  'use strict';

  // The checkpoint is the explicit Apache-2.0 LiteRT conversion documented in
  // vendor/lite-openpose/MODEL-NOTICE.md. It is not MoveNet, YOLO, or RTMO.
  const MODEL = Object.freeze({
    schema: 'bso.litert.model.v1',
    id: 'lightweight-openpose-lite-256-v1',
    version: 1,
    kind: 'local-litert-tflite-multipose',
    modelUrl: './vendor/lite-openpose/pose_256.tflite',
    sourceUrl: 'https://huggingface.co/litert-community/lightweight-openpose',
    sourceModelUrl: 'https://github.com/Daniil-Osokin/lightweight-human-pose-estimation.pytorch',
    license: 'Apache-2.0',
    licenseStatus: 'cleared-for-redistribution',
    inputShape: [1, 256, 256, 3],
    outputShape: [1, 32, 32, 19],
    maxPoses: 4,
    keypointCount: 18
  });
  const KEYPOINT_NAMES = Object.freeze([
    'nose', 'neck', 'right_shoulder', 'right_elbow', 'right_wrist',
    'left_shoulder', 'left_elbow', 'left_wrist', 'right_hip',
    'right_knee', 'right_ankle', 'left_hip', 'left_knee', 'left_ankle',
    'right_eye', 'left_eye', 'right_ear', 'left_ear'
  ]);
  const BACKENDS = Object.freeze(['webgpu', 'webgl', 'wasm']);
  const DEFAULTS = Object.freeze({
    inputDimension: 256,
    gridDimension: 32,
    keypointScoreThreshold: 0.2,
    minPoseScore: 0.25,
    minPartialPoseScore: 0.05,
    minVisibleKeypoints: 4,
    minPartialKeypoints: 2,
    maxPeaksPerKeypoint: 4,
    maxPoses: 4,
    clusterDistance: 0.24,
    assignmentDistance: 0.38,
    maxTracks: 4
  });

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizedNumber(value) {
    return Number(value.toFixed(6));
  }

  function dispose(value, seen = new Set()) {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => dispose(item, seen));
      if (typeof value.delete === 'function') value.delete();
      return;
    }
    if (typeof value.delete === 'function') value.delete();
    else if (typeof value.dispose === 'function') value.dispose();
  }

  function localUrl(url) {
    if (typeof url !== 'string' || !url.trim()) throw new TypeError('LiteRT model URL must be a non-empty string');
    const value = url.trim();
    if (/^(?:https?:)?\/\//i.test(value) || /^https?:/i.test(value)) {
      throw new TypeError('LiteRT model URL must resolve to the locally vendored artifact');
    }
    return value;
  }

  function resolveLocalUrl(url, environment) {
    const value = localUrl(url);
    const href = environment?.location?.href;
    if (!href || typeof URL !== 'function') return value;
    const resolved = new URL(value, href);
    if (resolved.protocol !== 'chrome-extension:' && resolved.protocol !== 'file:') {
      throw new TypeError('LiteRT model URL resolved outside the extension package');
    }
    return resolved.toString();
  }

  function dimensions(frame) {
    const width = Number(frame?.width);
    const height = Number(frame?.height);
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new TypeError('LiteRT frame dimensions must be positive integers');
    }
    return { width, height };
  }

  function directPixels(frame) {
    const size = dimensions(frame);
    if (!frame?.data) return null;
    const channels = frame.data.length / (size.width * size.height);
    if (!Number.isInteger(channels) || channels < 3) return null;
    return { ...size, data: frame.data, channels };
  }

  async function readFramePixels(frame, environment = defaultEnvironment) {
    const direct = directPixels(frame);
    if (direct) return direct;
    const size = dimensions(frame);
    const Canvas = environment?.OffscreenCanvas;
    let canvas = typeof Canvas === 'function' ? new Canvas(size.width, size.height) : null;
    if (!canvas && environment?.document?.createElement) {
      canvas = environment.document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
    }
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof context.drawImage !== 'function' || typeof context.getImageData !== 'function') return null;
    context.drawImage(frame, 0, 0, size.width, size.height);
    const image = context.getImageData(0, 0, size.width, size.height);
    return directPixels(image);
  }

  /**
   * LiteRT's model input is NHWC RGB, normalized as (pixel - 128) / 256. The
   * capture boundary is already capped to 4096 pixels; this bounded nearest
   * neighbour copy does not allocate a frame-sized intermediate tensor.
   */
  function createInputPixels(pixels, dimension = DEFAULTS.inputDimension) {
    if (!pixels || !Number.isInteger(dimension) || dimension < 1) throw new TypeError('input pixels are unavailable');
    const output = new Float32Array(dimension * dimension * 3);
    for (let y = 0; y < dimension; y += 1) {
      const sourceY = Math.min(pixels.height - 1, Math.floor(y * pixels.height / dimension));
      for (let x = 0; x < dimension; x += 1) {
        const sourceX = Math.min(pixels.width - 1, Math.floor(x * pixels.width / dimension));
        const sourceOffset = (sourceY * pixels.width + sourceX) * pixels.channels;
        const targetOffset = (y * dimension + x) * 3;
        output[targetOffset] = ((Number(pixels.data[sourceOffset]) || 0) - 128) / 256;
        output[targetOffset + 1] = ((Number(pixels.data[sourceOffset + 1]) || 0) - 128) / 256;
        output[targetOffset + 2] = ((Number(pixels.data[sourceOffset + 2]) || 0) - 128) / 256;
      }
    }
    return output;
  }

  function shapeOf(output) {
    if (!output) return null;
    if (Array.isArray(output.shape)) return output.shape;
    if (output.shape && typeof output.shape.length === 'number') return Array.from(output.shape);
    // @litertjs/core exposes Tensor dimensions through its public `type`
    // descriptor rather than a Tensor.shape property. Keep the direct shape
    // branch for injected/test runtimes, but use the real descriptor in the
    // packaged browser path so the model output is decoded instead of being
    // reported as an unsupported result.
    const dimensions = output.type?.layout?.dimensions;
    if (typeof dimensions === 'function') {
      const value = dimensions();
      if (value && typeof value.length === 'number') return Array.from(value);
    }
    if (dimensions && typeof dimensions.length === 'number') return Array.from(dimensions);
    return null;
  }

  async function outputData(output) {
    if (output && typeof output.toTypedArray === 'function') return output.toTypedArray();
    if (output && typeof output.data === 'function') return output.data();
    if (output && typeof output.dataSync === 'function') return output.dataSync();
    if (output && ArrayBuffer.isView(output)) return output;
    throw new TypeError('LiteRT output tensor cannot be read');
  }

  function valueAt(values, width, channels, channel, x, y) {
    return Number(values[(y * width + x) * channels + channel]);
  }

  function isPeak(values, width, height, channels, channel, x, y, score) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && valueAt(values, width, channels, channel, nx, ny) > score) return false;
      }
    }
    return true;
  }

  function peaksForChannel(values, width, height, channels, channel, options) {
    const threshold = options.keypointScoreThreshold ?? DEFAULTS.keypointScoreThreshold;
    const candidates = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const score = valueAt(values, width, channels, channel, x, y);
        if (finite(score) && score >= threshold && isPeak(values, width, height, channels, channel, x, y, score)) {
          candidates.push({
            channel,
            name: KEYPOINT_NAMES[channel],
            x: normalizedNumber((x + 0.5) / width),
            y: normalizedNumber((y + 0.5) / height),
            score: clamp(score)
          });
        }
      }
    }
    // A flat one-cell/synthetic output should still decode deterministically.
    if (!candidates.length) {
      let best = null;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const score = valueAt(values, width, channels, channel, x, y);
          if (finite(score) && score >= threshold && (!best || score > best.score)) best = { channel, name: KEYPOINT_NAMES[channel], x: normalizedNumber((x + 0.5) / width), y: normalizedNumber((y + 0.5) / height), score: clamp(score) };
        }
      }
      if (best) candidates.push(best);
    }
    return candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x).slice(0, options.maxPeaksPerKeypoint ?? DEFAULTS.maxPeaksPerKeypoint);
  }

  function pointDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clusterCenter(cluster) {
    if (!cluster.points.length) return { x: 0, y: 0 };
    const total = cluster.points.reduce((sum, point) => sum + Math.max(0.01, point.score), 0);
    return {
      x: cluster.points.reduce((sum, point) => sum + point.x * Math.max(0.01, point.score), 0) / total,
      y: cluster.points.reduce((sum, point) => sum + point.y * Math.max(0.01, point.score), 0) / total
    };
  }

  function addToCluster(cluster, point) {
    const existing = cluster.points.find((candidate) => candidate.channel === point.channel);
    if (!existing || point.score > existing.score) {
      if (existing) cluster.points[cluster.points.indexOf(existing)] = point;
      else cluster.points.push(point);
    }
  }

  /**
   * Decode the Apache-2.0 Lightweight OpenPose LiteRT output. This published
   * conversion intentionally contains heatmaps only (no PAF tensor), so pose
   * grouping uses confidence-ranked local peaks and a spatial gate. It can
   * return up to four partial poses; the session tracker supplies continuity
   * and quarantines ambiguous crossings rather than inventing identity.
   */
  function decodeLiteOpenPoseOutput(values, shape, options = {}) {
    const normalizedShape = Array.from(shape || []);
    if (normalizedShape.length !== 4 || normalizedShape[0] !== 1 || normalizedShape[3] !== MODEL.outputShape[3]) {
      throw new Error(`Unexpected Lightweight OpenPose output shape: [${normalizedShape.join(', ')}]`);
    }
    const height = normalizedShape[1];
    const width = normalizedShape[2];
    if (!Number.isInteger(height) || !Number.isInteger(width) || height < 1 || width < 1 || !values || values.length < height * width * MODEL.keypointCount) {
      throw new Error('Lightweight OpenPose output has invalid heatmap dimensions');
    }
    const channels = normalizedShape[3];
    const peaks = Array.from({ length: MODEL.keypointCount }, (_, channel) => peaksForChannel(values, width, height, channels, channel, options));
    // The published LiteRT conversion contains heatmaps but deliberately no
    // PAF tensor. Use one strong torso anchor per person, then assign each
    // joint to its nearest fixed anchor. Keeping the anchor fixed prevents a
    // limb or a second person's peak from dragging a cluster across players.
    const maxPoses = options.maxPoses ?? DEFAULTS.maxPoses;
    const anchorChannels = [1, 5, 8, 11];
    const anchorPool = (peaks[1].length >= 2 ? peaks[1] : anchorChannels.flatMap((channel) => peaks[channel]))
      .slice().sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    const clusters = [];
    const seedDistance = options.clusterDistance ?? DEFAULTS.clusterDistance;
    anchorPool.forEach((point) => {
      if (clusters.length >= maxPoses) return;
      if (clusters.some((cluster) => pointDistance(cluster.anchor, point) < seedDistance * 0.7)) return;
      clusters.push({ anchor: point, points: [point] });
    });
    if (!clusters.length) {
      const strongest = peaks.flat().sort((a, b) => b.score - a.score || a.channel - b.channel);
      if (strongest[0]) clusters.push({ anchor: strongest[0], points: [strongest[0]] });
    }
    const remaining = peaks.flat().filter((point) => !clusters.some((cluster) => cluster.points.includes(point)))
      .sort((a, b) => b.score - a.score || a.channel - b.channel || a.y - b.y || a.x - b.x);
    const assignmentDistance = options.assignmentDistance ?? DEFAULTS.assignmentDistance;
    remaining.forEach((point) => {
      const candidates = clusters.map((cluster, index) => ({ cluster, index, distance: pointDistance(cluster.anchor, point) }))
        .filter((candidate) => candidate.distance <= assignmentDistance)
        .sort((a, b) => a.distance - b.distance || a.index - b.index);
      if (candidates.length) addToCluster(candidates[0].cluster, point);
    });
    const minPartialKeypoints = options.minPartialKeypoints ?? DEFAULTS.minPartialKeypoints;
    const minVisibleKeypoints = options.minVisibleKeypoints ?? DEFAULTS.minVisibleKeypoints;
    const requestId = String(options.requestId || 'unknown-request');
    const sessionId = String(options.sessionId || 'unknown-session');
    const detector = options.detector || { id: MODEL.id, version: MODEL.version, kind: MODEL.kind };
    const source = options.source || { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' };
    return clusters.map((cluster, index) => {
      const points = cluster.points.slice().sort((a, b) => a.channel - b.channel);
      const score = points.reduce((sum, point) => sum + point.score, 0) / Math.max(1, points.length);
      const minX = Math.max(0, Math.min(...points.map((point) => point.x)) - 0.08);
      const minY = Math.max(0, Math.min(...points.map((point) => point.y)) - 0.08);
      const maxX = Math.min(1, Math.max(...points.map((point) => point.x)) + 0.08);
      const maxY = Math.min(1, Math.max(...points.map((point) => point.y)) + 0.08);
      const keypoints = points.map((point) => ({ name: point.name, x: point.x, y: point.y, confidence: point.score }));
      return {
        observationId: `${requestId}:pose-${index}`,
        sessionId,
        requestId,
        mediaTime: options.mediaTime,
        coordinateSpace: 'normalized',
        bbox: { x: normalizedNumber(minX), y: normalizedNumber(minY), width: normalizedNumber(maxX - minX), height: normalizedNumber(maxY - minY) },
        keypoints,
        confidence: normalizedNumber(score),
        state: score >= (options.minPoseScore ?? DEFAULTS.minPoseScore) && points.length >= minVisibleKeypoints ? 'tracked' : points.length >= minPartialKeypoints ? 'partial' : 'unknown',
        detector,
        source
      };
    }).filter((pose) => pose.state !== 'unknown')
      .sort((a, b) => a.bbox.x - b.bbox.x || a.bbox.y - b.bbox.y);
  }

  async function webGpuDevice(environment) {
    const gpu = environment?.navigator?.gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') throw new Error('WebGPU unavailable');
    const adapter = await gpu.requestAdapter();
    if (!adapter || typeof adapter.requestDevice !== 'function') throw new Error('WebGPU adapter unavailable');
    return adapter.requestDevice();
  }

  function normalizeBackendResult(name, result) {
    if (result === true) return { name, ok: true, reason: '' };
    return { name, ok: Boolean(result?.ok), reason: result?.reason || (result?.ok ? '' : `${name} backend probe failed`), model: result?.model || null };
  }

  /** Compile each real backend candidate, explicitly treating WebGL as not
   * implemented by LiteRT.js rather than pretending WebGPU or WASM is WebGL. */
  async function selectLiteRtBackend({ runtime, modelUrl, environment = defaultEnvironment, order = BACKENDS, backendProbe = null, onStatus = () => {} } = {}) {
    if (!runtime || typeof runtime.loadAndCompile !== 'function') return { backend: null, attempted: [], fallbacks: ['litert-runtime-unavailable'] };
    const candidates = Array.from(new Set((Array.isArray(order) ? order : BACKENDS).filter((name) => BACKENDS.includes(name))));
    const attempted = [];
    for (const name of candidates) {
      onStatus({ type: 'backend-probe', backend: name });
      let result;
      if (backendProbe) result = await backendProbe(name, runtime);
      else if (name === 'webgl') result = { ok: false, reason: 'litert-webgl-backend-unsupported' };
      else {
        try {
          if (name === 'webgpu') {
            const device = await webGpuDevice(environment);
            if (typeof runtime.setWebGpuDevice !== 'function') throw new Error('LiteRT WebGPU device binding unavailable');
            runtime.setWebGpuDevice(device);
          }
          const model = await runtime.loadAndCompile(modelUrl, { accelerator: name });
          // A non-fully-accelerated WebGPU compile is LiteRT's WASM fallback.
          // Dispose it here and let the explicit WASM candidate report itself.
          if (name === 'webgpu' && model && model.isFullyAccelerated === false) {
            dispose(model);
            result = { ok: false, reason: 'webgpu-model-not-fully-accelerated' };
          } else result = { ok: true, model };
        } catch (error) {
          result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
        }
      }
      const normalized = normalizeBackendResult(name, result);
      attempted.push(normalized);
      if (normalized.ok) {
        const fallbacks = attempted.slice(0, -1).map((item) => `backend-${item.name}-unavailable`);
        onStatus({ type: 'backend-selected', backend: name, fallbacks });
        return { backend: name, model: normalized.model || result?.model || null, attempted, fallbacks };
      }
      onStatus({ type: 'backend-unavailable', backend: name, reason: normalized.reason });
    }
    return { backend: null, model: null, attempted, fallbacks: attempted.map((item) => `backend-${item.name}-unavailable`) };
  }

  function unknownResult({ sessionId, requestId, mediaTime, reason, analyzerIdentity }) {
    const unavailableIdentity = {
      ...(analyzerIdentity || {}),
      kind: 'local-model-unavailable',
      available: false,
      productionModel: false
    };
    const tracking = trackingApi && typeof trackingApi.unknownTrackingResult === 'function'
      ? trackingApi.unknownTrackingResult({ sessionId, requestId, mediaTime, detector: unavailableIdentity, source: { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' }, reason })
      : { schema: 'bso.player-tracking.result.v1', version: 1, sessionId, requestId, mediaTime, state: 'unknown', players: [], observations: [], duplicateObservations: [], invalidObservations: [], association: { method: 'gated-motion-box-keypoint-v1', maxTracks: 4, identityRisk: 'none' }, accepted: true, reason };
    const result = {
      kind: 'lightweight-openpose',
      runtimeIntegrationTest: false,
      productionModel: false,
      state: 'unknown',
      players: [],
      tracking,
      shuttle: { state: 'unknown', confidence: null },
      strokeEvents: [],
      rally: { state: 'unknown', confidence: null, reason: 'rally-segmentation-not-available' },
      rallyEnd: { state: 'unknown', confidence: null, reason: 'rally-end-evidence-not-available' },
      winner: { state: 'unknown', confidence: null, reason: 'winner-evidence-not-available' },
      outcome: 'unclassified',
      shotFamily: 'unclassified',
      classificationConfidence: 0,
      geometryConfidence: 0,
      reason
    };
    if (protocol && typeof protocol.createAnalyzerResult === 'function') {
      return protocol.createAnalyzerResult({ sessionId, requestId, mediaTime, status: 'fallback', analyzer: MODEL.id, analyzerIdentity: unavailableIdentity, inferenceAvailable: false, result });
    }
    return { protocol: 'bso.runtime.v1', version: 1, type: 'analysis.result', sessionId, requestId, mediaTime, status: 'fallback', analyzer: MODEL.id, analyzerIdentity: unavailableIdentity, inferenceAvailable: false, result };
  }

  class LiteOpenPoseAnalyzer {
    constructor({
      runtime = null,
      runtimeReady = defaultEnvironment.BSOLiteRuntimeReady,
      environment = defaultEnvironment,
      modelUrl = MODEL.modelUrl,
      wasmPath = './vendor/litert/',
      backendOrder = BACKENDS,
      backendProbe = null,
      maxDimension = DEFAULTS.inputDimension,
      maxTracks = DEFAULTS.maxTracks,
      keypointScoreThreshold = DEFAULTS.keypointScoreThreshold,
      minPoseScore = DEFAULTS.minPoseScore,
      minPartialPoseScore = DEFAULTS.minPartialPoseScore,
      minVisibleKeypoints = DEFAULTS.minVisibleKeypoints,
      onStatus = () => {}
    } = {}) {
      this.runtime = runtime;
      this.runtimeReady = runtimeReady;
      this.environment = environment;
      this.modelUrl = localUrl(modelUrl);
      this.wasmPath = localUrl(wasmPath);
      this.backendOrder = backendOrder;
      this.backendProbe = backendProbe;
      this.maxDimension = maxDimension;
      this.maxTracks = maxTracks;
      this.keypointScoreThreshold = keypointScoreThreshold;
      this.minPoseScore = minPoseScore;
      this.minPartialPoseScore = minPartialPoseScore;
      this.minVisibleKeypoints = minVisibleKeypoints;
      this.onStatus = onStatus;
      this.model = null;
      this.backend = null;
      this.backendReport = null;
      this.initialization = null;
      this.failed = null;
      this.inFlight = false;
      this.inFlightMediaTime = null;
      this.lastMediaBySession = new Map();
      this.trackers = new Map();
      this.identity = Object.freeze({
        id: MODEL.id,
        version: MODEL.version,
        kind: MODEL.kind,
        model: 'Lightweight OpenPose LiteRT conversion',
        modelVersion: MODEL.version,
        localArtifact: MODEL.modelUrl,
        sourceUrl: MODEL.sourceUrl,
        sourceModelUrl: MODEL.sourceModelUrl,
        license: MODEL.license,
        licenseStatus: MODEL.licenseStatus,
        runtime: '@litertjs/core 2.5.3',
        runtimeLicense: 'Apache-2.0',
        runtimeIntegrationTest: false,
        productionModel: true
      });
    }

    status(value) {
      try { this.onStatus(value); } catch (_) { /* status observers cannot break inference */ }
    }

    async initialize() {
      if (this.initialization) return this.initialization;
      this.initialization = (async () => {
        try {
          const runtime = this.runtime || (this.runtimeReady ? await this.runtimeReady : null);
          if (!runtime) throw new Error('litert-runtime-unavailable');
          this.runtime = runtime;
          // The loader normally initializes LiteRT before this point. Injected
          // runtimes may expose loadLiteRt themselves, so support that seam too.
          const runtimeLoaded = runtime.loaded === true || runtime.loadAndCompile?.__bsoLoaded === true;
          if (typeof runtime.loadLiteRt === 'function' && !runtimeLoaded) {
            const wasmUrl = resolveLocalUrl(this.wasmPath, this.environment);
            await runtime.loadLiteRt(wasmUrl);
            if (runtime.loadAndCompile) runtime.loadAndCompile.__bsoLoaded = true;
          }
          const modelUrl = resolveLocalUrl(this.modelUrl, this.environment);
          this.backendReport = await selectLiteRtBackend({ runtime, modelUrl, environment: this.environment, order: this.backendOrder, backendProbe: this.backendProbe, onStatus: (value) => this.status(value) });
          if (!this.backendReport.backend || !this.backendReport.model) {
            throw new Error(this.backendReport.attempted.at(-1)?.reason || 'no-usable-inference-backend');
          }
          this.backend = this.backendReport.backend;
          this.model = this.backendReport.model;
          this.status({ type: 'model-ready', backend: this.backend, model: MODEL.id });
          return { available: true, backend: this.backend, fallbacks: this.backendReport.fallbacks };
        } catch (error) {
          this.failed = error instanceof Error ? error.message : String(error);
          dispose(this.model);
          this.model = null;
          this.status({ type: 'model-failure', reason: this.failed, fallbacks: this.backendReport?.fallbacks || ['local-model-artifact-unavailable'] });
          return { available: false, reason: this.failed, fallbacks: this.backendReport?.fallbacks || ['local-model-artifact-unavailable'] };
        }
      })();
      return this.initialization;
    }

    trackerFor(sessionId) {
      let tracker = this.trackers.get(sessionId);
      if (!tracker) {
        if (!trackingApi || typeof trackingApi.SessionPlayerTracker !== 'function') throw new Error('player tracking contract is unavailable');
        tracker = new trackingApi.SessionPlayerTracker({ sessionId, maxTracks: this.maxTracks });
        this.trackers.set(sessionId, tracker);
      }
      return tracker;
    }

    resetSession(sessionId, reason = 'session-reset') {
      const id = sessionId == null ? null : String(sessionId);
      const tracker = id === null ? null : this.trackers.get(id);
      if (tracker) tracker.reset(reason);
      if (id !== null) this.lastMediaBySession.delete(id);
      return { sessionId: id, reason };
    }

    endSession(sessionId, reason = 'session-end') {
      const id = sessionId == null ? null : String(sessionId);
      this.resetSession(id, reason);
      if (id !== null) this.trackers.delete(id);
      return { sessionId: id, reason };
    }

    async infer(frame, context = {}) {
      const pixels = await readFramePixels(frame, this.environment);
      if (!pixels) throw new Error('frame-pixels-unavailable');
      if (!this.runtime?.Tensor || typeof this.model?.run !== 'function') throw new Error('LiteRT tensor/model API is unavailable');
      const inputPixels = createInputPixels(pixels, this.maxDimension);
      const input = new this.runtime.Tensor(inputPixels, [1, this.maxDimension, this.maxDimension, 3]);
      let outputs = null;
      let hostOutput = null;
      try {
        outputs = await this.model.run(input);
        const output = Array.isArray(outputs) ? outputs[0] : outputs;
        const shape = shapeOf(output);
        hostOutput = output && typeof output.moveTo === 'function' ? await output.moveTo('wasm') : output;
        const values = await outputData(hostOutput);
        return decodeLiteOpenPoseOutput(values, shape, {
          sessionId: context.sessionId || 'unknown-session',
          requestId: context.requestId || 'unknown-request',
          mediaTime: context.mediaTime,
          detector: this.identity,
          source: { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' },
          keypointScoreThreshold: this.keypointScoreThreshold,
          minPoseScore: this.minPoseScore,
          minPartialPoseScore: this.minPartialPoseScore,
          minVisibleKeypoints: this.minVisibleKeypoints
        });
      } finally {
        const seen = new Set();
        dispose(hostOutput, seen);
        if (hostOutput !== outputs) dispose(outputs, seen);
        dispose(input, seen);
      }
    }

    async analyze(sample) {
      const sessionId = String(sample?.sessionId || 'unknown-session');
      const requestId = String(sample?.requestId || 'unknown-request');
      const mediaTime = sample?.mediaTime;
      if (!finite(mediaTime) || mediaTime < 0) return unknownResult({ sessionId, requestId, mediaTime: 0, reason: 'invalid-media-time', analyzerIdentity: this.identity });
      if (sample?.cameraCut) this.resetSession(sessionId, 'camera-cut');
      const previous = this.lastMediaBySession.get(sessionId);
      if (finite(previous) && mediaTime < previous) this.resetSession(sessionId, 'media-time-reset');
      if (this.inFlight) {
        this.status({ type: 'inference-status', status: 'backpressure', requestId, mediaTime, inFlightMediaTime: this.inFlightMediaTime });
        return null;
      }
      const watermark = this.lastMediaBySession.get(sessionId);
      if (finite(watermark) && mediaTime <= watermark) {
        this.status({ type: 'inference-status', status: 'stale-result-dropped', requestId, mediaTime, watermark });
        return null;
      }
      this.inFlight = true;
      this.inFlightMediaTime = mediaTime;
      try {
        const initialized = await this.initialize();
        if (!initialized.available) return unknownResult({ sessionId, requestId, mediaTime, reason: initialized.reason, analyzerIdentity: this.identity });
        const observations = await this.infer(sample.frame, sample);
        const tracked = this.trackerFor(sessionId).processFrame({ sessionId, requestId, mediaTime, observations });
        this.lastMediaBySession.set(sessionId, mediaTime);
        const tracking = tracked.result;
        return protocol.createAnalyzerResult({
          sessionId, requestId, mediaTime, status: 'ok', analyzer: MODEL.id, analyzerIdentity: this.identity, inferenceAvailable: true,
          result: {
            kind: 'lightweight-openpose',
            runtimeIntegrationTest: false,
            productionModel: true,
            state: tracking.state,
            players: tracking.players,
            tracking,
            shuttle: { state: 'unknown', confidence: null },
            strokeEvents: [],
            rally: { state: 'unknown', confidence: null, reason: 'rally-segmentation-not-available' },
            rallyEnd: { state: 'unknown', confidence: null, reason: 'rally-end-evidence-not-available' },
            winner: { state: 'unknown', confidence: null, reason: 'winner-evidence-not-available' },
            outcome: 'unclassified',
            shotFamily: 'unclassified',
            classificationConfidence: 0,
            geometryConfidence: 0,
            detector: this.identity
          }
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.failed = reason;
        this.status({ type: 'inference-failure', requestId, mediaTime, reason });
        return unknownResult({ sessionId, requestId, mediaTime, reason, analyzerIdentity: this.identity });
      } finally {
        this.inFlight = false;
        this.inFlightMediaTime = null;
      }
    }

    dispose() {
      dispose(this.model);
      this.model = null;
      this.trackers.clear();
      this.lastMediaBySession.clear();
    }
  }

  return Object.freeze({
    MODEL,
    KEYPOINT_NAMES,
    BACKENDS,
    readFramePixels,
    createInputPixels,
    decodeLiteOpenPoseOutput,
    selectLiteRtBackend,
    LiteOpenPoseAnalyzer,
    LiteRTAnalyzer: LiteOpenPoseAnalyzer
  });
}));
