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
const selectorSource = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/pose-model-selector.js'), 'utf8');
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

async function flush(times = 4) {
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

function poseAdapter(id, kind, modelUrl) {
  const analyzer = class StubPoseAnalyzer {
    constructor() {
      this.identity = Object.freeze({ id, version: 1, kind, productionModel: true });
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
  analyzer.MODEL = Object.freeze({ id, version: 1, kind, modelUrl });
  analyzer.__identity = id;
  return { [id === 'lightweight-openpose-lite-256-v1' ? 'LiteOpenPoseAnalyzer' : id === 'movenet-multipose-lightning-v1' ? 'MoveNetMultiPoseLightningAnalyzer' : 'BlazePoseAnalyzer']: analyzer, MODEL: analyzer.MODEL };
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

function createHarness({ storedModel = null, fetchImpl = null } = {}) {
  const storage = { bvSelectedPoseModel: storedModel };
  const sent = [];
  const onMessage = event();
  const responses = [];
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
    fetch: fetchImpl || (async () => ({ ok: false, status: 404 })),
    // The offscreen document loads the vendored TensorFlow.js runtime.
    tf: {},
    // The LiteRT loader ships with the offscreen package.
    BSOLiteRuntimeReady: Promise.resolve({ loaded: true }),
    BSOLiteOpenPoseAdapter: poseAdapter('lightweight-openpose-lite-256-v1', 'lightweight-openpose', './vendor/lite-openpose/pose_256.tflite'),
    BSOMoveNetAdapter: poseAdapter('movenet-multipose-lightning-v1', 'movenet-multipose-lightning', './vendor/movenet-multipose-lightning/model.json'),
    BSOBlazePoseTfjsAdapter: poseAdapter('blazepose-tfjs-heavy-v1', 'blazepose', './vendor/blazepose-tfjs/model.json'),
    BSOShuttleTrackingAdapter: shuttleAdapter(),
    BSO_DIAGNOSTIC_FIXTURE: false
  });
  vm.runInContext(protocolSource, context, { filename: 'protocol.js' });
  vm.runInContext(trackingSource, context, { filename: 'player-tracking.js' });
  vm.runInContext(selectorSource, context, { filename: 'pose-model-selector.js' });
  vm.runInContext(offscreenSource, context, { filename: 'offscreen.js' });
  return { context, sent, storage, onMessage, responses };
}

async function sendAction(harness, action, modelId) {
  let response;
  const message = action === 'getAvailablePoseModels' ? { action } : { action, modelId };
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

test('a popup model switch swaps the analyzer serving live frames mid-session', async () => {
  const harness = createHarness({ fetchImpl: async (url) => ({ ok: String(url).includes('movenet-multipose-lightning/model.json'), status: 200 }) });
  harness.onMessage.emit(sessionStart('switch-live'), {}, () => {});
  await flush();
  harness.onMessage.emit(frameSample('switch-live', 'switch-live:1', 1), {}, () => {});
  await flush();
  const first = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'switch-live:1');
  assert.equal(first.analyzer, 'lightweight-openpose-lite-256-v1');
  assert.equal(first.result.kind, 'lightweight-openpose-pose-shuttle');

  const response = await sendAction(harness, 'switchPoseModel', 'movenet-multipose-lightning-v1');
  assert.equal(response.ok, true);
  assert.equal(response.modelId, 'movenet-multipose-lightning-v1');
  assert.equal(harness.storage.bvSelectedPoseModel, 'movenet-multipose-lightning-v1');

  harness.onMessage.emit(frameSample('switch-live', 'switch-live:2', 2), {}, () => {});
  await flush();
  const second = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'switch-live:2');
  assert.equal(second.analyzer, 'movenet-multipose-lightning-v1');
  assert.equal(second.analyzerIdentity.id, 'movenet-multipose-lightning-v1');
  assert.equal(second.result.kind, 'movenet-multipose-lightning-pose-shuttle');
  assert.equal(second.result.players.length, 2);
});

test('a switch to a model whose artifact is not bundled is refused and keeps the active model', async () => {
  const harness = createHarness(); // every artifact probe 404s
  const response = await sendAction(harness, 'switchPoseModel', 'movenet-multipose-lightning-v1');
  assert.equal(response.ok, false);
  assert.equal(response.reason, 'pose-model-artifacts-not-bundled');
  assert.equal(harness.storage.bvSelectedPoseModel, null);
  harness.onMessage.emit(sessionStart('switch-refused'), {}, () => {});
  await flush();
  harness.onMessage.emit(frameSample('switch-refused', 'switch-refused:1', 1), {}, () => {});
  await flush();
  const result = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'switch-refused:1');
  assert.equal(result.analyzer, 'lightweight-openpose-lite-256-v1');
});

test('a switch to the work-in-progress BlazePose model is refused even when its artifact loads', async () => {
  const harness = createHarness({ fetchImpl: async () => ({ ok: true, status: 200 }) });
  const response = await sendAction(harness, 'switchPoseModel', 'blazepose-tfjs-heavy-v1');
  assert.equal(response.ok, false);
  assert.equal(response.reason, 'pose-model-work-in-progress');
  assert.equal(response.modelId, 'blazepose-tfjs-heavy-v1');
  assert.equal(harness.storage.bvSelectedPoseModel, null);
  harness.onMessage.emit(sessionStart('wip-refused'), {}, () => {});
  await flush();
  harness.onMessage.emit(frameSample('wip-refused', 'wip-refused:1', 1), {}, () => {});
  await flush();
  const result = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'wip-refused:1');
  assert.equal(result.analyzer, 'lightweight-openpose-lite-256-v1');
});

test('the stored pose-model preference is re-applied when a session starts', async () => {
  const harness = createHarness({
    storedModel: 'movenet-multipose-lightning-v1',
    fetchImpl: async (url) => ({ ok: String(url).includes('movenet-multipose-lightning/model.json'), status: 200 })
  });
  harness.onMessage.emit(sessionStart('restored'), {}, () => {});
  await flush();
  const report = harness.sent.find((message) => message.type === protocol.TYPES.CAPABILITY_REPORT);
  assert.equal(report.capabilities.inference, true);
  assert.equal(report.capabilities.analyzer, 'movenet-multipose-lightning-v1');
  harness.onMessage.emit(frameSample('restored', 'restored:1', 1), {}, () => {});
  await flush();
  const result = harness.sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT && message.requestId === 'restored:1');
  assert.equal(result.analyzer, 'movenet-multipose-lightning-v1');
  assert.equal(harness.storage.bvSelectedPoseModel, 'movenet-multipose-lightning-v1');
});

test('an unavailable stored pose-model preference converges back to the production default at session start', async () => {
  const harness = createHarness({ storedModel: 'movenet-multipose-lightning-v1' }); // artifact probe 404s
  harness.onMessage.emit(sessionStart('converged'), {}, () => {});
  await flush();
  const report = harness.sent.find((message) => message.type === protocol.TYPES.CAPABILITY_REPORT);
  assert.equal(report.capabilities.analyzer, 'lightweight-openpose-lite-256-v1');
  assert.equal(harness.storage.bvSelectedPoseModel, 'lightweight-openpose-lite-256-v1');
});

test('a stored work-in-progress preference is refused and converges to the production default at session start', async () => {
  // BlazePose's artifact loads (fetch all-200), so without the work-in-progress
  // gate this stored preference would re-activate BlazePose on every reload
  // and re-wedge pose detection. The gate must refuse it and converge the
  // stored key back to the production default.
  const harness = createHarness({
    storedModel: 'blazepose-tfjs-heavy-v1',
    fetchImpl: async () => ({ ok: true, status: 200 })
  });
  harness.onMessage.emit(sessionStart('wip-converged'), {}, () => {});
  await flush();
  const report = harness.sent.find((message) => message.type === protocol.TYPES.CAPABILITY_REPORT);
  assert.equal(report.capabilities.analyzer, 'lightweight-openpose-lite-256-v1');
  assert.equal(harness.storage.bvSelectedPoseModel, 'lightweight-openpose-lite-256-v1');
});

test('getAvailablePoseModels reports per-model availability and the active model', async () => {
  const harness = createHarness({
    fetchImpl: async (url) => ({ ok: String(url).includes('movenet-multipose-lightning/model.json'), status: String(url).includes('movenet') ? 200 : 404 })
  });
  harness.onMessage.emit(sessionStart('list'), {}, () => {});
  await flush();
  const response = await sendAction(harness, 'getAvailablePoseModels');
  assert.equal(response.ok, true);
  assert.equal(response.currentModel, 'lightweight-openpose-lite-256-v1');
  const byId = {};
  response.models.forEach((model) => { byId[model.id] = model; });
  assert.equal(byId['lightweight-openpose-lite-256-v1'].available, true);
  assert.equal(byId['movenet-multipose-lightning-v1'].available, true);
  assert.equal(byId['blazepose-tfjs-heavy-v1'].available, false);
  assert.equal(byId['blazepose-tfjs-heavy-v1'].reason, 'pose-model-work-in-progress');
});
