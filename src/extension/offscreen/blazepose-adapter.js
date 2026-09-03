/* global globalThis, BSOProtocol, BSOPlayerTracking */
(function installBlazePoseAdapter(root, factory) {
  const api = factory(root.BSOProtocol, root.BSOPlayerTracking, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOBlazePoseAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function blazePoseAdapterFactory(protocol, trackingApi, defaultEnvironment) {
  'use strict';

  const MODEL = Object.freeze({
    schema: 'bso.blazepose.model.v1',
    id: 'blazepose-tfjs-heavy-v1',
    version: 1,
    kind: 'local-tensorflowjs-graph-model',
    modelUrl: '../vendor/blazepose-tfjs/model.json',
    sourceUrl: 'https://tfhub.dev/mediapipe/tfjs-model/blazepose/3d_human_pose_lite/1',
    license: 'Apache-2.0',
    licenseStatus: 'cleared-for-redistribution',
    maxPoses: 1,
    outputShape: [1, 195],
    inputDimension: 256
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
    if (typeof url !== 'string' || !url.trim()) throw new TypeError('BlazePose model URL must be a non-empty string');
    const value = url.trim();
    if (/^(?:https?:)?\/\//i.test(value) || /^https?:/i.test(value)) {
      throw new TypeError('BlazePose model URL must resolve to the locally vendored artifact');
    }
    return value;
  }

  function resolveLocalUrl(url, environment) {
    const value = localModelUrl(url);
    const href = environment?.location?.href;
    if (!href || typeof URL !== 'function') return value;
    const resolved = new URL(value, href);
    if (resolved.protocol !== 'chrome-extension:' && resolved.protocol !== 'file:') {
      throw new TypeError('BlazePose model URL resolved outside the extension package');
    }
    return resolved.toString();
  }

  async function readTensor(tensor) {
    if (tensor && typeof tensor.data === 'function') return tensor.data();
    if (tensor && typeof tensor.dataSync === 'function') return tensor.dataSync();
    throw new TypeError('BlazePose output tensor cannot be read');
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

  function normalizedNumber(value) {
    return Number(value.toFixed(6));
  }

  /**
   * Decode the BlazePose output (195 values = 33 keypoints * 3 (x, y, z) + 65 body flags + 26 hand flags).
   * For 2D badminton pose detection, we extract the 33 keypoints but treat z as confidence score.
   */
  function decodeBlazePoseOutput(values, options = {}) {
    if (!values || values.length < 33 * 3) {
      throw new Error('BlazePose output is too short: expected at least 99 values');
    }

    const minPoseScore = options.minPoseScore ?? DEFAULTS.minPoseScore;
    const minPartialPoseScore = options.minPartialPoseScore ?? DEFAULTS.minPartialPoseScore;
    const keypointScoreThreshold = options.keypointScoreThreshold ?? DEFAULTS.keypointScoreThreshold;
    const detector = options.detector || { id: MODEL.id, version: MODEL.version, kind: MODEL.kind };
    const source = options.source || { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' };
    const requestId = String(options.requestId || 'unknown-request');
    const sessionId = String(options.sessionId || 'unknown-session');
    const mediaTime = options.mediaTime;

    const keypoints = [];
    let visible = 0;
    let totalConfidence = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    // BlazePose outputs 33 keypoints (vs COCO's 17). Map them to COCO format for compatibility.
    // BlazePose keypoints: 0-10 (upper body), 11-16 (lower body + some repeats), 17-32 (hand landmarks)
    // We'll use the core 17 COCO keypoints by mapping BlazePose indices
    const blaze_to_coco = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

    for (let cocoIdx = 0; cocoIdx < KEYPOINT_NAMES.length; cocoIdx += 1) {
      const blazeIdx = blaze_to_coco[cocoIdx] || cocoIdx;
      const offset = blazeIdx * 3;
      const x = values[offset];
      const y = values[offset + 1];
      // BlazePose outputs z (depth) as third value; we'll use it as confidence
      const confidence = clamp(values[offset + 2] || 0);

      if (finite(x) && finite(y)) {
        keypoints.push({
          name: KEYPOINT_NAMES[cocoIdx],
          x: normalizedNumber(clamp(x)),
          y: normalizedNumber(clamp(y)),
          confidence
        });
        if (confidence >= keypointScoreThreshold) visible += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        totalConfidence += confidence;
      } else {
        keypoints.push({
          name: KEYPOINT_NAMES[cocoIdx],
          x: 0,
          y: 0,
          confidence: 0
        });
      }
    }

    const poseScore = totalConfidence / Math.max(1, KEYPOINT_NAMES.length);

    // If no valid keypoints, return unknown state
    if (keypoints.length === 0) {
      return [];
    }

    const bbox = {
      x: normalizedNumber(clamp(Math.max(0, minX - 0.05))),
      y: normalizedNumber(clamp(Math.max(0, minY - 0.05))),
      width: normalizedNumber(clamp(Math.min(1, maxX + 0.05) - Math.max(0, minX - 0.05))),
      height: normalizedNumber(clamp(Math.min(1, maxY + 0.05) - Math.max(0, minY - 0.05)))
    };

    return [{
      observationId: `${requestId}:pose-0`,
      sessionId,
      requestId,
      mediaTime,
      coordinateSpace: 'normalized',
      bbox,
      keypoints,
      confidence: normalizedNumber(clamp(poseScore)),
      state: poseScore >= minPoseScore && visible >= (options.minVisibleKeypoints ?? DEFAULTS.minVisibleKeypoints)
        ? 'tracked' : poseScore >= minPartialPoseScore && visible >= 2 ? 'partial' : 'unknown',
      detector,
      source
    }];
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
      kind: 'blazepose',
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

  class BlazePoseAnalyzer {
    constructor({
      tf = defaultEnvironment.tf,
      tracking = trackingApi,
      environment = defaultEnvironment,
      modelUrl = MODEL.modelUrl,
      modelLoader = null,
      backendOrder = BACKENDS,
      backendProbe = null,
      wasmPath = null,
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
        model: 'BlazePose Heavy',
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
          if (!this.model || typeof this.model.execute !== 'function') throw new Error('Vendored BlazePose graph model did not load');
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
      if (!this.tf?.browser || typeof this.tf.browser.fromPixels !== 'function') {
        throw new Error('TensorFlow.js pixel input is unavailable');
      }
      if (!this.tf.image || typeof this.tf.image.resizeBilinear !== 'function' ||
          typeof this.tf.expandDims !== 'function' || typeof this.tf.cast !== 'function') {
        throw new Error('TensorFlow.js image operations are unavailable');
      }

      const width = frame?.width;
      const height = frame?.height;
      if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        throw new TypeError('BlazePose frame dimensions must be positive integers');
      }

      let image = null;
      let expanded = null;
      let resized = null;
      let input = null;
      try {
        image = this.tf.browser.fromPixels(frame, 3);
        expanded = this.tf.expandDims(image, 0);
        resized = this.tf.image.resizeBilinear(expanded, [MODEL.inputDimension, MODEL.inputDimension]);
        input = this.tf.cast(resized, 'float32');
        const tensors = new Set();
        [image, expanded, resized].forEach((tensor) => disposeTensor(tensor, tensors));
        image = null;
        expanded = null;
        resized = null;
        return input;
      } catch (error) {
        const tensors = new Set();
        [input, resized, expanded, image].forEach((tensor) => disposeTensor(tensor, tensors));
        throw error;
      }
    }

    async infer(frame, context = {}) {
      const input = await this.inputTensor(frame);
      let output = null;
      try {
        output = this.model.execute(input);
        const tensor = Array.isArray(output) ? output[0] : output;
        if (!tensor) throw new Error('BlazePose graph model returned no tensor');
        const values = await readTensor(tensor);
        return decodeBlazePoseOutput(values, {
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
            kind: 'blazepose',
            state: tracking.state,
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
    decodeBlazePoseOutput,
    BlazePoseAnalyzer,
    BlazePose: BlazePoseAnalyzer
  });
}));
