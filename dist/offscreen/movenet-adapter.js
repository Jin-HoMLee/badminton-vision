/* global globalThis, BSOProtocol, BSOPlayerTracking */
(function installMoveNetAdapter(root, factory) {
  const api = factory(root.BSOProtocol, root.BSOPlayerTracking, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOMoveNetAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function moveNetAdapterFactory(protocol, trackingApi, defaultEnvironment) {
  'use strict';

  const MODEL = Object.freeze({
    schema: 'bso.movenet.model.v1',
    id: 'movenet-multipose-lightning-v1',
    version: 1,
    kind: 'local-tensorflowjs-graph-model',
    modelUrl: '../vendor/movenet-multipose-lightning/model.json',
    sourceUrl: 'https://tfhub.dev/google/tfjs-model/movenet/multipose/lightning/1',
    license: null,
    licenseStatus: 'not-cleared-for-redistribution',
    maxPoses: 6,
    outputShape: [1, 6, 56],
    inputMaxDimension: 256,
    inputDimensionDivisor: 32
  });
  const KEYPOINT_NAMES = Object.freeze([
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
  ]);
  const BACKENDS = Object.freeze(['webgpu', 'webgl', 'wasm']);
  const DEFAULTS = Object.freeze({
    minPoseScore: 0.25,
    minPartialPoseScore: 0.05,
    minVisibleKeypoints: 4,
    keypointScoreThreshold: 0.2,
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

  function closeFrame(frame) {
    if (frame && typeof frame.close === 'function') frame.close();
  }

  function disposeTensor(value, seen = new Set()) {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => disposeTensor(item, seen));
      return;
    }
    if (typeof value.dispose === 'function') value.dispose();
  }

  function localModelUrl(url) {
    if (typeof url !== 'string' || !url.trim()) throw new TypeError('MoveNet model URL must be a non-empty string');
    const value = url.trim();
    if (/^(?:https?:)?\/\//i.test(value) || /^https?:/i.test(value)) {
      throw new TypeError('MoveNet model URL must resolve to the locally vendored artifact');
    }
    return value;
  }

  function resolveLocalUrl(url, environment) {
    const value = localModelUrl(url);
    const href = environment?.location?.href;
    if (!href || typeof URL !== 'function') return value;
    const resolved = new URL(value, href);
    if (resolved.protocol !== 'chrome-extension:' && resolved.protocol !== 'file:') {
      throw new TypeError('MoveNet model URL resolved outside the extension package');
    }
    return resolved.toString();
  }

  async function readTensor(tensor) {
    if (tensor && typeof tensor.data === 'function') return tensor.data();
    if (tensor && typeof tensor.dataSync === 'function') return tensor.dataSync();
    throw new TypeError('MoveNet output tensor cannot be read');
  }

  /**
   * A backend is usable only after a real tensor operation completes on it.
   * Registration or `navigator.gpu` presence alone is not a capability probe.
   */
  async function probeBackend(tf, backendName) {
    let input = null;
    let output = null;
    try {
      if (!tf || typeof tf.setBackend !== 'function' || typeof tf.ready !== 'function' ||
          typeof tf.getBackend !== 'function' || typeof tf.tensor !== 'function') {
        throw new Error('TensorFlow.js backend probe API is unavailable');
      }
      const switched = await tf.setBackend(backendName);
      if (switched === false || tf.getBackend() !== backendName) throw new Error(`${backendName} backend did not activate`);
      await tf.ready();
      if (tf.getBackend() !== backendName) throw new Error(`${backendName} backend is not ready`);
      input = tf.tensor([1, 2, 3], [1, 3], 'float32');
      output = typeof tf.add === 'function' ? tf.add(input, input) :
        (typeof input.add === 'function' ? input.add(input) : null);
      if (!output) throw new Error(`${backendName} tensor operation is unavailable`);
      const values = await readTensor(output);
      if (!values || values.length !== 3 || !Array.from(values).every(finite)) {
        throw new Error(`${backendName} tensor operation returned invalid data`);
      }
      return { name: backendName, ok: true, reason: '' };
    } catch (error) {
      return {
        name: backendName,
        ok: false,
        reason: error instanceof Error ? error.message : String(error)
      };
    } finally {
      disposeTensor(output);
      disposeTensor(input);
    }
  }

  async function selectBackend({ tf, order = BACKENDS, probe = null, onStatus = () => {} } = {}) {
    if (!tf) return { backend: null, attempted: [], fallbacks: ['tensorflowjs-unavailable'] };
    const candidates = Array.from(new Set((Array.isArray(order) ? order : BACKENDS)
      .filter((name) => BACKENDS.includes(name))));
    const attempted = [];
    for (const name of candidates) {
      onStatus({ type: 'backend-probe', backend: name });
      const result = await (probe ? probe(name, tf) : probeBackend(tf, name));
      const normalized = result === true ? { name, ok: true, reason: '' } : {
        name,
        ok: Boolean(result?.ok),
        reason: result?.reason || (result?.ok ? '' : 'backend probe failed')
      };
      attempted.push(normalized);
      if (normalized.ok) {
        const fallbackNames = attempted.slice(0, -1).filter((item) => !item.ok).map((item) => `backend-${item.name}-unavailable`);
        onStatus({ type: 'backend-selected', backend: name, fallbacks: fallbackNames });
        return { backend: name, attempted, fallbacks: fallbackNames };
      }
      onStatus({ type: 'backend-unavailable', backend: name, reason: normalized.reason });
    }
    return {
      backend: null,
      attempted,
      fallbacks: attempted.map((item) => `backend-${item.name}-unavailable`)
    };
  }

  function dimensionGeometry(width, height, maxDimension = MODEL.inputMaxDimension) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new TypeError('MoveNet frame dimensions must be positive integers');
    }
    let resizedWidth;
    let resizedHeight;
    if (width >= height) {
      resizedWidth = maxDimension;
      resizedHeight = Math.max(1, Math.round(maxDimension * height / width));
    } else {
      resizedHeight = maxDimension;
      resizedWidth = Math.max(1, Math.round(maxDimension * width / height));
    }
    const divisor = MODEL.inputDimensionDivisor;
    const paddedWidth = Math.ceil(resizedWidth / divisor) * divisor;
    const paddedHeight = Math.ceil(resizedHeight / divisor) * divisor;
    return { width, height, resizedWidth, resizedHeight, paddedWidth, paddedHeight };
  }

  function normalizedNumber(value) {
    return Number(value.toFixed(6));
  }

  function mapX(value, geometry) {
    return normalizedNumber(clamp(value * geometry.paddedWidth / geometry.resizedWidth));
  }

  function mapY(value, geometry) {
    return normalizedNumber(clamp(value * geometry.paddedHeight / geometry.resizedHeight));
  }

  /** Decode the documented [1, instances, 56] MoveNet MultiPose output. */
  function decodeMoveNetOutput(values, shape, geometry, options = {}) {
    if (!Array.isArray(shape) || shape.length !== 3 || shape[0] !== 1 || shape[2] !== 56) {
      throw new Error(`Unexpected MoveNet MultiPose output shape: [${shape || ''}]`);
    }
    const instances = shape[1];
    if (!Number.isInteger(instances) || instances < 0 || instances > MODEL.maxPoses ||
        !values || values.length < instances * 56) {
      throw new Error('MoveNet MultiPose output has an invalid instance count');
    }
    const minPoseScore = options.minPoseScore ?? DEFAULTS.minPoseScore;
    const minPartialPoseScore = options.minPartialPoseScore ?? DEFAULTS.minPartialPoseScore;
    const keypointScoreThreshold = options.keypointScoreThreshold ?? DEFAULTS.keypointScoreThreshold;
    const detector = options.detector || { id: MODEL.id, version: MODEL.version, kind: MODEL.kind };
    const source = options.source || { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' };
    const requestId = String(options.requestId || 'unknown-request');
    const sessionId = String(options.sessionId || 'unknown-session');
    const mediaTime = options.mediaTime;
    const observations = [];
    for (let instance = 0; instance < instances; instance += 1) {
      const offset = instance * 56;
      const boxValues = [values[offset + 51], values[offset + 52], values[offset + 53], values[offset + 54]];
      const score = values[offset + 55];
      if (!boxValues.every(finite) || !finite(score) || score < minPartialPoseScore) continue;
      const keypoints = [];
      let visible = 0;
      for (let point = 0; point < KEYPOINT_NAMES.length; point += 1) {
        const pointOffset = offset + point * 3;
        const y = values[pointOffset];
        const x = values[pointOffset + 1];
        const pointScore = values[pointOffset + 2];
        if (!finite(x) || !finite(y)) continue;
        const confidence = finite(pointScore) ? clamp(pointScore) : null;
        if (confidence !== null && confidence >= keypointScoreThreshold) visible += 1;
        keypoints.push({
          name: KEYPOINT_NAMES[point],
          x: mapX(x, geometry),
          y: mapY(y, geometry),
          confidence
        });
      }
      const box = {
        xMin: mapX(boxValues[1], geometry),
        yMin: mapY(boxValues[0], geometry),
        xMax: mapX(boxValues[3], geometry),
        yMax: mapY(boxValues[2], geometry)
      };
      if (box.xMax <= box.xMin || box.yMax <= box.yMin) continue;
      observations.push({
        observationId: `${requestId}:pose-${instance}`,
        sessionId,
        requestId,
        mediaTime,
        coordinateSpace: 'normalized',
        bbox: box,
        keypoints,
        confidence: clamp(score),
        state: score >= minPoseScore && visible >= (options.minVisibleKeypoints ?? DEFAULTS.minVisibleKeypoints)
          ? 'tracked' : 'partial',
        detector,
        source
      });
    }
    return observations;
  }

  function fallbackTracking({ sessionId, requestId, mediaTime, reason }, api = trackingApi) {
    if (api && typeof api.unknownTrackingResult === 'function') {
      return api.unknownTrackingResult({
        sessionId, requestId, mediaTime,
        detector: { id: MODEL.id, version: MODEL.version, kind: MODEL.kind },
        source: { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' },
        reason
      });
    }
    return {
      schema: 'bso.player-tracking.result.v1', version: 1, sessionId, requestId, mediaTime,
      state: 'unknown', players: [], observations: [], duplicateObservations: [], invalidObservations: [],
      detector: { id: MODEL.id, version: MODEL.version, kind: MODEL.kind },
      source: { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' },
      association: { method: 'gated-motion-box-keypoint-v1', maxTracks: 4, identityRisk: 'none' },
      accepted: true, reason
    };
  }

  function unknownResult({ sessionId, requestId, mediaTime, reason, analyzerIdentity }) {
    const tracking = fallbackTracking({ sessionId, requestId, mediaTime, reason });
    const result = {
      kind: 'movenet-multipose-lightning',
      state: 'unknown',
      players: [],
      tracking,
      shuttle: { state: 'unknown', confidence: null },
      strokeEvents: [],
      shotFamily: 'unclassified',
      classificationConfidence: 0,
      geometryConfidence: 0,
      reason
    };
    if (protocol && typeof protocol.createAnalyzerResult === 'function') {
      return protocol.createAnalyzerResult({
        sessionId, requestId, mediaTime, status: 'fallback', analyzer: MODEL.id,
        analyzerIdentity, inferenceAvailable: false, result
      });
    }
    return { protocol: 'bso.runtime.v1', version: 1, type: 'analysis.result', sessionId,
      requestId, mediaTime, status: 'fallback', analyzer: MODEL.id, analyzerIdentity,
      inferenceAvailable: false, result };
  }

  class MoveNetMultiPoseLightningAnalyzer {
    constructor({
      tf = defaultEnvironment.tf,
      tracking = trackingApi,
      environment = defaultEnvironment,
      modelUrl = MODEL.modelUrl,
      modelLoader = null,
      backendOrder = BACKENDS,
      backendProbe = null,
      wasmPath = null,
      maxDimension = MODEL.inputMaxDimension,
      minPoseScore = DEFAULTS.minPoseScore,
      minPartialPoseScore = DEFAULTS.minPartialPoseScore,
      minVisibleKeypoints = DEFAULTS.minVisibleKeypoints,
      keypointScoreThreshold = DEFAULTS.keypointScoreThreshold,
      maxTracks = DEFAULTS.maxTracks,
      onStatus = () => {}
    } = {}) {
      this.tf = tf;
      this.tracking = tracking;
      this.environment = environment;
      this.modelUrl = localModelUrl(modelUrl);
      this.modelLoader = modelLoader;
      this.backendOrder = backendOrder;
      this.backendProbe = backendProbe;
      this.wasmPath = wasmPath;
      this.maxDimension = maxDimension;
      this.minPoseScore = minPoseScore;
      this.minPartialPoseScore = minPartialPoseScore;
      this.minVisibleKeypoints = minVisibleKeypoints;
      this.keypointScoreThreshold = keypointScoreThreshold;
      this.maxTracks = maxTracks;
      this.onStatus = onStatus;
      this.model = null;
      this.backend = null;
      this.initialization = null;
      this.failed = null;
      this.inFlight = false;
      this.inFlightMediaTime = null;
      this.lastMediaBySession = new Map();
      this.trackers = new Map();
      this.backendReport = null;
      this.identity = Object.freeze({
        id: MODEL.id,
        version: MODEL.version,
        kind: MODEL.kind,
        model: 'MoveNet MultiPose Lightning',
        modelVersion: MODEL.version,
        localArtifact: MODEL.modelUrl,
        sourceUrl: MODEL.sourceUrl,
        license: MODEL.license,
        licenseStatus: MODEL.licenseStatus,
        runtimeIntegrationTest: false,
        productionModel: true
      });
    }

    status(value) {
      try { this.onStatus(value); } catch (_) { /* status listeners cannot break inference */ }
    }

    configureWasm() {
      if (!this.tf?.wasm || typeof this.tf.wasm.setWasmPaths !== 'function') return;
      const path = this.wasmPath || (this.environment?.location?.href && typeof URL === 'function'
        ? new URL('../vendor/tfjs/', this.environment.location.href).toString()
        : '../vendor/tfjs/');
      this.tf.wasm.setWasmPaths(path);
    }

    async initialize() {
      if (this.initialization) return this.initialization;
      this.initialization = (async () => {
        if (!this.tf) {
          this.failed = 'tensorflowjs-not-loaded';
          this.status({ type: 'backend-failure', reason: this.failed, fallbacks: ['tensorflowjs-unavailable'] });
          return { available: false, reason: this.failed, fallbacks: ['tensorflowjs-unavailable'] };
        }
        try {
          this.configureWasm();
          this.backendReport = await selectBackend({
            tf: this.tf,
            order: this.backendOrder,
            probe: this.backendProbe,
            onStatus: (status) => this.status(status)
          });
          if (!this.backendReport.backend) {
            this.failed = 'no-usable-inference-backend';
            this.status({ type: 'backend-failure', reason: this.failed, fallbacks: this.backendReport.fallbacks });
            return { available: false, reason: this.failed, fallbacks: this.backendReport.fallbacks };
          }
          this.backend = this.backendReport.backend;
          const loader = this.modelLoader || ((url, options) => {
            if (typeof this.tf.loadGraphModel !== 'function') throw new Error('TensorFlow.js graph-model loader is unavailable');
            return this.tf.loadGraphModel(url, options);
          });
          const resolved = resolveLocalUrl(this.modelUrl, this.environment);
          this.model = await loader(resolved, { fromTFHub: false });
          if (!this.model || typeof this.model.execute !== 'function') throw new Error('Vendored MoveNet graph model did not load');
          this.status({ type: 'model-ready', backend: this.backend, model: MODEL.id });
          return { available: true, backend: this.backend, fallbacks: this.backendReport.fallbacks };
        } catch (error) {
          this.failed = error instanceof Error ? error.message : String(error);
          if (this.model && typeof this.model.dispose === 'function') this.model.dispose();
          this.model = null;
          this.status({ type: 'backend-failure', reason: this.failed, fallbacks: this.backendReport?.fallbacks || [] });
          return { available: false, reason: this.failed, fallbacks: this.backendReport?.fallbacks || [] };
        }
      })();
      return this.initialization;
    }

    trackerFor(sessionId) {
      let tracker = this.trackers.get(sessionId);
      if (!tracker) {
        if (!this.tracking || typeof this.tracking.SessionPlayerTracker !== 'function') {
          throw new Error('player tracking contract is unavailable');
        }
        tracker = new this.tracking.SessionPlayerTracker({ sessionId, maxTracks: this.maxTracks });
        this.trackers.set(sessionId, tracker);
      }
      return tracker;
    }

    resetSession(sessionId, reason = 'session-reset') {
      const tracker = this.trackers.get(sessionId);
      if (tracker) tracker.reset(reason);
      this.lastMediaBySession.delete(sessionId);
      return { sessionId, reason };
    }

    async inputTensor(frame) {
      const width = frame?.width;
      const height = frame?.height;
      const geometry = dimensionGeometry(width, height, this.maxDimension);
      if (!this.tf?.browser || typeof this.tf.browser.fromPixels !== 'function') {
        throw new Error('TensorFlow.js pixel input is unavailable');
      }
      if (!this.tf.image || typeof this.tf.image.resizeBilinear !== 'function' ||
          typeof this.tf.pad !== 'function' || typeof this.tf.expandDims !== 'function' ||
          typeof this.tf.cast !== 'function') {
        throw new Error('TensorFlow.js image operations are unavailable');
      }
      let image = null;
      let expanded = null;
      let resized = null;
      let padded = null;
      let input = null;
      try {
        image = this.tf.browser.fromPixels(frame, 3);
        expanded = this.tf.expandDims(image, 0);
        resized = this.tf.image.resizeBilinear(expanded, [geometry.resizedHeight, geometry.resizedWidth]);
        padded = this.tf.pad(resized, [[0, 0], [0, geometry.paddedHeight - geometry.resizedHeight],
          [0, geometry.paddedWidth - geometry.resizedWidth], [0, 0]]);
        input = this.tf.cast(padded, 'int32');
        const tensors = new Set();
        [image, expanded, resized, padded].forEach((tensor) => disposeTensor(tensor, tensors));
        image = null;
        expanded = null;
        resized = null;
        padded = null;
        return { input, geometry };
      } catch (error) {
        const tensors = new Set();
        [input, padded, resized, expanded, image].forEach((tensor) => disposeTensor(tensor, tensors));
        throw error;
      }
    }

    async infer(frame, context = {}) {
      const { input, geometry } = await this.inputTensor(frame);
      let output = null;
      try {
        output = this.model.execute(input);
        const tensor = Array.isArray(output) ? output[0] : output;
        if (!tensor || !Array.isArray(tensor.shape)) throw new Error('MoveNet graph model returned no tensor');
        const values = await readTensor(tensor);
        return decodeMoveNetOutput(values, tensor.shape, geometry, {
          sessionId: context.sessionId || 'unknown-session',
          requestId: context.requestId || 'unknown-request',
          mediaTime: context.mediaTime,
          minPoseScore: this.minPoseScore,
          minPartialPoseScore: this.minPartialPoseScore,
          minVisibleKeypoints: this.minVisibleKeypoints,
          keypointScoreThreshold: this.keypointScoreThreshold,
          detector: this.identity,
          source: { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' }
        });
      } finally {
        disposeTensor(output);
        disposeTensor(input);
      }
    }

    async analyze(sample) {
      const sessionId = String(sample?.sessionId || 'unknown-session');
      const requestId = String(sample?.requestId || 'unknown-request');
      const mediaTime = sample?.mediaTime;
      if (!finite(mediaTime) || mediaTime < 0) return unknownResult({ sessionId, requestId, mediaTime: 0, reason: 'invalid-media-time', analyzerIdentity: this.identity });
      if (sample?.cameraCut) this.resetSession(sessionId, 'camera-cut');
      if (this.inFlight) {
        this.status({ type: 'inference-status', status: 'backpressure', requestId, mediaTime, inFlightMediaTime: this.inFlightMediaTime });
        return null;
      }
      const previous = this.lastMediaBySession.get(sessionId);
      if (finite(previous) && mediaTime <= previous) {
        this.status({ type: 'inference-status', status: 'stale-result-dropped', requestId, mediaTime, watermark: previous });
        return null;
      }
      this.inFlight = true;
      this.inFlightMediaTime = mediaTime;
      try {
        const initialized = await this.initialize();
        if (!initialized.available) {
          return unknownResult({ sessionId, requestId, mediaTime, reason: initialized.reason, analyzerIdentity: this.identity });
        }
        const observations = await this.infer(sample.frame, sample);
        const tracker = this.trackerFor(sessionId);
        const tracked = tracker.processFrame({ sessionId, requestId, mediaTime, observations });
        this.lastMediaBySession.set(sessionId, mediaTime);
        const tracking = tracked.result;
        return protocol.createAnalyzerResult({
          sessionId, requestId, mediaTime, status: 'ok', analyzer: MODEL.id,
          analyzerIdentity: this.identity, inferenceAvailable: true,
          result: {
            kind: 'movenet-multipose-lightning',
            state: tracking.state,
            // The existing envelope exposes players directly for the overlay;
            // the full association evidence remains available under tracking.
            players: tracking.players,
            tracking,
            shuttle: { state: 'unknown', confidence: null },
            strokeEvents: [],
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
      if (this.model && typeof this.model.dispose === 'function') this.model.dispose();
      this.model = null;
      this.trackers.clear();
      this.lastMediaBySession.clear();
    }
  }

  return Object.freeze({
    MODEL,
    KEYPOINT_NAMES,
    BACKENDS,
    probeBackend,
    selectBackend,
    dimensionGeometry,
    decodeMoveNetOutput,
    MoveNetMultiPoseLightningAnalyzer,
    MoveNetAnalyzer: MoveNetMultiPoseLightningAnalyzer,
    closeFrame
  });
}));
