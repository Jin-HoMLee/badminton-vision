const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const protocol = require('../src/extension/common/protocol.js');
const tracking = require('../src/extension/common/player-tracking.js');

const ROOT = path.join(__dirname, '..');
const protocolSource = fs.readFileSync(path.join(ROOT, 'src/extension/common/protocol.js'), 'utf8');
const trackingSource = fs.readFileSync(path.join(ROOT, 'src/extension/common/player-tracking.js'), 'utf8');
const poseSelectorSource = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/pose-model-selector.js'), 'utf8');
const racketSelectorSource = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/racket-model-selector.js'), 'utf8');
const offscreenSource = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/offscreen.js'), 'utf8');

function event() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); },
    emit(...args) { return listeners.map((listener) => listener(...args)); }
  };
}

function waitForWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) await waitForWork();
}

function frame() {
  return { width: 2, height: 2, data: Uint8Array.from([255, 0, 0, 255, 0, 10, 0, 255, 0, 0, 20, 255, 5, 5, 5, 255]), close() { this.closed = true; } };
}

function poseResult(identity, sessionId, requestId, mediaTime) {
  const trackingResult = tracking.unknownTrackingResult({
    sessionId, requestId, mediaTime,
    detector: identity,
    reason: 'test-pose-observation'
  });
  return protocol.createAnalyzerResult({
    sessionId, requestId, mediaTime, status: 'ok', analyzer: identity.id,
    analyzerIdentity: identity, inferenceAvailable: true,
    result: {
      kind: identity.kind,
      state: 'tracked',
      players: [
        { trackId: `${sessionId}:p1`, state: 'tracked', bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.4 }, keypoints: [], confidence: 0.9 },
        { trackId: `${sessionId}:p2`, state: 'tracked', bbox: { x: 0.6, y: 0.2, width: 0.2, height: 0.4 }, keypoints: [], confidence: 0.9 }
      ],
      tracking: { ...trackingResult, state: 'tracked', players: [] },
      shuttle: { state: 'unknown', confidence: null },
      strokeEvents: [],
      shotFamily: 'unclassified',
      classificationConfidence: 0,
      geometryConfidence: 0
    }
  });
}

function poseAdapter() {
  const analyzer = class StubPoseAnalyzer {
    constructor() {
      this.identity = Object.freeze({ id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'lightweight-openpose', productionModel: true });
      this.analyzed = 0;
    }
    async initialize() { return { available: true, backend: 'wasm' }; }
    async analyze(sample) {
      this.analyzed += 1;
      return poseResult(this.identity, sample.sessionId, sample.requestId, sample.mediaTime);
    }
    resetSession() { return { ok: true }; }
    endSession() { return { ok: true }; }
    dispose() { this.disposed = true; }
  };
  analyzer.MODEL = Object.freeze({ id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'lightweight-openpose', modelUrl: './vendor/lite-openpose/pose_256.tflite' });
  return { LiteOpenPoseAnalyzer: analyzer };
}

function shuttleAdapter() {
  const adapter = class StubShuttleAdapter {
    constructor() {
      this.identity = Object.freeze({ id: 'local-shuttle-frame-difference-v1', version: 1, kind: 'bounded-temporal-pixel-heuristic', productionModel: false });
    }
    async analyze(sample) {
      return protocol.createAnalyzerResult({
        sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime,
        analyzer: this.identity.id, analyzerIdentity: this.identity, inferenceAvailable: true,
        result: { kind: 'bounded-temporal-pixel-heuristic', state: 'unknown', shuttle: { state: 'unknown', confidence: null, accepted: false, reason: 'no-candidate' } }
      });
    }
    resetSession() {}
    endSession() {}
    dispose() {}
  };
  adapter.LocalShuttleTrajectoryAdapter = adapter;
  return adapter;
}

function racketEvidence(marker, id) {
  return function build(sample) {
    return {
      state: 'tracked',
      confidence: 0.9,
      detections: [{ bbox: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 }, confidence: 0.9, state: 'tracked' }],
      detectionMethod: marker,
      reason: 'stub-racket-detection',
      segmentationAvailable: false,
      detector: this.identity,
      sessionId: String(sample?.sessionId || 'unknown-session'),
      requestId: String(sample?.requestId || 'unknown-request'),
      mediaTime: sample?.mediaTime
    };
  };
}

function racketAdapter({ id, marker, licenseStatus, counters }) {
  const analyzer = class StubRacketAnalyzer {
    constructor() {
      counters.constructed += 1;
      this.identity = Object.freeze({
        id, version: 1, kind: 'stub-racket-analyzer',
        detectionMethod: marker,
        productionModel: id === 'efficientdet-lite0-racket-v1',
        experimental: id !== 'efficientdet-lite0-racket-v1',
        licenseStatus
      });
      this.analyzed = 0;
    }
    async initialize() { return { available: true, backend: 'wasm', fallbacks: [] }; }
    async analyze(sample) {
      this.analyzed += 1;
      counters.analyzed += 1;
      return racketEvidence(marker, id).call(this, sample);
    }
    resetSession() { return { ok: true }; }
    endSession() { return { ok: true }; }
    dispose() { counters.disposed += 1; this.disposed = true; }
  };
  return { analyzer };
}

function createHarness({ storedRacketModel = null, ort = null, fetchImpl = null } = {}) {
  const storage = { bvSelectedRacketModel: storedRacketModel };
  const sent = [];
  const onMessage = event();
  const counters = { efficientdet: { constructed: 0, analyzed: 0, disposed: 0 }, yolo: { constructed: 0, analyzed: 0, disposed: 0 } };
  const efficientdet = racketAdapter({ id: 'efficientdet-lite0-racket-v1', marker: 'efficientdet-lite0-tennis-racket', licenseStatus: 'cleared-for-redistribution', counters: counters.efficientdet });
  const yolo = racketAdapter({ id: 'yolo-world-racket-detector-v1', marker: 'yolo-world-open-vocab-racket', licenseStatus: 'agpl-3.0-experimental-source-disclosure', counters: counters.yolo });
  efficientdet.analyzer.MODEL = Object.freeze({ id: 'efficientdet-lite0-racket-v1', modelUrl: './vendor/efficientdet-lite0/efficientdet_lite0.tflite' });
  yolo.analyzer.MODEL = Object.freeze({ id: 'yolo-world-racket-detector-v1', modelUrl: './vendor/yolo-world/yolo_world_s_open_vocab.onnx' });

  const chromeApi = {
    runtime: {
      onMessage,
      sendMessage: async (message) => { sent.push(message); }
    },
    storage: {
      local: {
        get: (keys, callback) => {
          const result = {};
          const wanted = Array.isArray(keys) ? keys : [keys];
          wanted.forEach((key) => { if (Object.prototype.hasOwnProperty.call(storage, key)) result[key] = storage[key]; });
          callback?.(result);
        },
        set: (value, callback) => { Object.assign(storage, value); callback?.(); }
      }
    }
  };
  const fetchFn = fetchImpl || (async () => ({ ok: false, status: 404 }));
  const context = vm.createContext({
    console,
    Promise,
    Map,
    Error,
    Uint8Array,
    Uint8ClampedArray,
    Float32Array,
    ArrayBuffer,
    URL,
    setTimeout,
    clearTimeout,
    chrome: chromeApi,
    location: { href: 'chrome-extension://test/offscreen/offscreen.html' },
    fetch: fetchFn,
    tf: {},
    ort,
    BSOLiteRuntimeReady: Promise.resolve({ loaded: true }),
    BSOLiteOpenPoseAdapter: poseAdapter(),
    BSOEfficientDetRacketAdapter: { EfficientDetRacketDetector: efficientdet.analyzer, MODEL: efficientdet.analyzer.MODEL },
    BSOYoloWorldRacketAdapter: { YoloWorldRacketAnalyzer: yolo.analyzer, MODEL: yolo.analyzer.MODEL },
    BSOShuttleTrackingAdapter: shuttleAdapter(),
    BSO_DIAGNOSTIC_FIXTURE: false
  });
  vm.runInContext(protocolSource, context, { filename: 'protocol.js' });
  vm.runInContext(trackingSource, context, { filename: 'player-tracking.js' });
  vm.runInContext(poseSelectorSource, context, { filename: 'pose-model-selector.js' });
  vm.runInContext(racketSelectorSource, context, { filename: 'racket-model-selector.js' });
  vm.runInContext(offscreenSource, context, { filename: 'offscreen.js' });
  return { context, sent, storage, onMessage, counters };
}

async function sendAction(harness, action, modelId) {
  let response;
  const message = action.endsWith('Models') ? { action } : { action, modelId };
  harness.onMessage.emit(message, {}, (value) => { response = value; });
  await flush();
  return response;
}

function sessionStart(sessionId) {
  return protocol.createSessionStart({ sessionId, capabilities: { capture: 'request-video-frame-callback', transferableFrames: false, frameTransport: 'rgba-array-v1' } });
}

function frameSample(sessionId, requestId, mediaTime) {
  return protocol.createFrameSample({
    sessionId, requestId, mediaTime, capturedAt: mediaTime, width: 2, height: 2,
    frame: frame(), frameFormat: 'rgba-array-v1'
  }).message;
}

test('the untouched default path constructs and serves exactly the EfficientDet detector', async () => {
  const harness = createHarness({ ort: {}, fetchImpl: async (url) => ({ ok: String(url).includes('yolo_world_s_open_vocab.onnx'), status: 200 }) });
  harness.onMessage.emit(sessionStart('default-1'), {}, () => {});
  await flush();
  harness.onMessage.emit(frameSample('default-1', 'default-1:1', 1), {}, () => {});
  await flush();
  const result = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'default-1:1');
  assert.ok(result, 'a frame result is produced');
  assert.equal(result.result.racket.detectionMethod, 'efficientdet-lite0-tennis-racket');
  assert.equal(harness.counters.efficientdet.constructed, 1);
  assert.equal(harness.counters.efficientdet.analyzed, 1);
  // Even with the YOLO-World runtime AND artifact fully available, nothing on
  // the default path constructs or runs the experimental detector.
  assert.equal(harness.counters.yolo.constructed, 0, 'the experimental model is never constructed on the default path');
  assert.equal(harness.counters.yolo.analyzed, 0, 'the experimental model is never analyzed on the default path');
  assert.equal(harness.storage.bvSelectedRacketModel, null, 'no racket preference is written when the user changes nothing');
});

test('a popup racket model switch swaps the detector serving live frames mid-session', async () => {
  const harness = createHarness({ ort: {}, fetchImpl: async (url) => ({ ok: String(url).includes('yolo_world_s_open_vocab.onnx'), status: 200 }) });
  harness.onMessage.emit(sessionStart('switch-1'), {}, () => {});
  await flush();
  harness.onMessage.emit(frameSample('switch-1', 'switch-1:1', 1), {}, () => {});
  await flush();
  const first = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'switch-1:1');
  assert.equal(first.result.racket.detectionMethod, 'efficientdet-lite0-tennis-racket');

  const response = await sendAction(harness, 'switchRacketModel', 'yolo-world-racket-detector-v1');
  assert.equal(response.ok, true);
  assert.equal(response.modelId, 'yolo-world-racket-detector-v1');
  assert.equal(harness.storage.bvSelectedRacketModel, 'yolo-world-racket-detector-v1');
  assert.equal(harness.counters.efficientdet.disposed, 1, 'the replaced EfficientDet detector is disposed by the switcher');
  assert.equal(harness.counters.yolo.constructed, 1);

  harness.onMessage.emit(frameSample('switch-1', 'switch-1:2', 2), {}, () => {});
  await flush();
  const second = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'switch-1:2');
  assert.equal(second.result.racket.detectionMethod, 'yolo-world-open-vocab-racket');
  assert.equal(second.analyzerIdentity.components.racket.id, 'yolo-world-racket-detector-v1');
  assert.equal(harness.counters.yolo.analyzed, 1);
});

test('a switch to the experimental model is refused when its runtime is not bundled and keeps EfficientDet active', async () => {
  const harness = createHarness(); // no ort, artifact 404
  const response = await sendAction(harness, 'switchRacketModel', 'yolo-world-racket-detector-v1');
  assert.equal(response.ok, false);
  assert.equal(response.reason, 'onnx-runtime-web-not-loaded');
  assert.equal(harness.storage.bvSelectedRacketModel, null);
  assert.equal(harness.counters.yolo.constructed, 0, 'a refused switch never constructs the experimental model');
  harness.onMessage.emit(sessionStart('refused-1'), {}, () => {});
  await flush();
  harness.onMessage.emit(frameSample('refused-1', 'refused-1:1', 1), {}, () => {});
  await flush();
  const result = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'refused-1:1');
  assert.equal(result.result.racket.detectionMethod, 'efficientdet-lite0-tennis-racket');
});

test('a switch to the experimental model is refused when its artifact is not bundled', async () => {
  const harness = createHarness({ ort: {}, fetchImpl: async () => ({ ok: false, status: 404 }) });
  const response = await sendAction(harness, 'switchRacketModel', 'yolo-world-racket-detector-v1');
  assert.equal(response.ok, false);
  assert.equal(response.reason, 'racket-model-artifacts-not-bundled');
  assert.equal(harness.counters.yolo.constructed, 0);
});

test('the stored racket-model preference is re-applied when a session starts', async () => {
  const harness = createHarness({
    storedRacketModel: 'yolo-world-racket-detector-v1',
    ort: {},
    fetchImpl: async (url) => ({ ok: String(url).includes('yolo_world_s_open_vocab.onnx'), status: 200 })
  });
  harness.onMessage.emit(sessionStart('restored-1'), {}, () => {});
  await flush();
  harness.onMessage.emit(frameSample('restored-1', 'restored-1:1', 1), {}, () => {});
  await flush();
  const result = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'restored-1:1');
  assert.equal(result.result.racket.detectionMethod, 'yolo-world-open-vocab-racket');
  assert.equal(harness.storage.bvSelectedRacketModel, 'yolo-world-racket-detector-v1');
  assert.equal(harness.counters.yolo.constructed, 1);
});

test('an unavailable stored experimental preference converges back to the production default at session start', async () => {
  // ort missing, artifact 404: the stored YOLO-World preference must not leak
  // into the runtime. The session falls back to EfficientDet and the stored
  // key converges to it.
  const harness = createHarness({ storedRacketModel: 'yolo-world-racket-detector-v1' });
  harness.onMessage.emit(sessionStart('converged-1'), {}, () => {});
  await flush();
  harness.onMessage.emit(frameSample('converged-1', 'converged-1:1', 1), {}, () => {});
  await flush();
  const result = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'converged-1:1');
  assert.equal(result.result.racket.detectionMethod, 'efficientdet-lite0-tennis-racket');
  assert.equal(harness.storage.bvSelectedRacketModel, 'efficientdet-lite0-racket-v1');
  assert.equal(harness.counters.yolo.constructed, 0);
});

test('getAvailableRacketModels reports per-model availability and the active model', async () => {
  const harness = createHarness();
  harness.onMessage.emit(sessionStart('list-1'), {}, () => {});
  await flush();
  const response = await sendAction(harness, 'getAvailableRacketModels');
  assert.equal(response.ok, true);
  assert.equal(response.currentModel, 'efficientdet-lite0-racket-v1');
  const byId = {};
  response.models.forEach((model) => { byId[model.id] = model; });
  assert.equal(byId['efficientdet-lite0-racket-v1'].available, true);
  assert.equal(byId['efficientdet-lite0-racket-v1'].current, true);
  assert.equal(byId['efficientdet-lite0-racket-v1'].experimental, false);
  assert.equal(byId['yolo-world-racket-detector-v1'].available, false);
  assert.equal(byId['yolo-world-racket-detector-v1'].reason, 'onnx-runtime-web-not-loaded');
  assert.equal(byId['yolo-world-racket-detector-v1'].experimental, true);
});

test('a racket switch leaves pose and shuttle evidence on the frame unchanged', async () => {
  const harness = createHarness({ ort: {}, fetchImpl: async (url) => ({ ok: String(url).includes('yolo_world_s_open_vocab.onnx'), status: 200 }) });
  harness.onMessage.emit(sessionStart('multi-1'), {}, () => {});
  await flush();
  const response = await sendAction(harness, 'switchRacketModel', 'yolo-world-racket-detector-v1');
  assert.equal(response.ok, true);
  harness.onMessage.emit(frameSample('multi-1', 'multi-1:1', 1), {}, () => {});
  await flush();
  const result = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'multi-1:1');
  assert.equal(result.analyzer, 'lightweight-openpose-lite-256-v1');
  assert.equal(result.result.players.length, 2, 'pose players still flow after the racket model swap');
  assert.equal(result.result.shuttle.state, 'unknown');
});
