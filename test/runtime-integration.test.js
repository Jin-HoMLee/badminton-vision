const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const protocol = require('../src/extension/common/protocol.js');
const tracking = require('../src/extension/common/player-tracking.js');
const protocolSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/common/protocol.js'), 'utf8');
const trackingSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/common/player-tracking.js'), 'utf8');
const analyzerSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/analyzer.js'), 'utf8');
const modelSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/fixture-model.js'), 'utf8');
const moveNetSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/movenet-adapter.js'), 'utf8');
const liteOpenPoseSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/lite-openpose-adapter.js'), 'utf8');
const shuttleSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/shuttle-tracking-adapter.js'), 'utf8');
const offscreenSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/offscreen.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/background/service-worker.js'), 'utf8');

function event() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); },
    emit(...args) { return listeners.map((listener) => listener(...args)); }
  };
}

function frame() {
  return {
    width: 2,
    height: 2,
    data: Uint8Array.from([
      255, 0, 0, 255, 0, 10, 0, 255,
      0, 0, 20, 255, 5, 5, 5, 255
    ]),
    close() { this.closed = true; }
  };
}

function loadOffscreen(chrome, { withProduction = false } = {}) {
  const context = vm.createContext({
    console,
    Promise,
    Uint8Array,
    setTimeout,
    clearTimeout,
    chrome,
    // Node-only plumbing harnesses opt into the explicit fixture diagnostic.
    BSO_DIAGNOSTIC_FIXTURE: true,
  });
  vm.runInContext(protocolSource, context, { filename: 'protocol.js' });
  vm.runInContext(trackingSource, context, { filename: 'player-tracking.js' });
  vm.runInContext(modelSource, context, { filename: 'fixture-model.js' });
  vm.runInContext(moveNetSource, context, { filename: 'movenet-adapter.js' });
  if (withProduction) {
    context.BSOLiteRuntimeReady = Promise.resolve({ loaded: true });
    vm.runInContext(liteOpenPoseSource, context, { filename: 'lite-openpose-adapter.js' });
    vm.runInContext(shuttleSource, context, { filename: 'shuttle-tracking-adapter.js' });
  }
  vm.runInContext(analyzerSource, context, { filename: 'analyzer.js' });
  vm.runInContext(offscreenSource, context, { filename: 'offscreen.js' });
  return context;
}

function waitForWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createServiceWorkerHarness({ withOffscreen = true, createDocument = null } = {}) {
  const swConnect = event();
  const swMessages = event();
  const offscreenMessages = event();
  const portMessages = [];
  const offscreenChrome = {
    runtime: {
      onMessage: offscreenMessages,
      sendMessage: async (message) => {
        swMessages.emit(message);
      }
    }
  };
  loadOffscreen(offscreenChrome);

  const swChrome = {
    runtime: {
      onConnect: swConnect,
      onMessage: swMessages,
      getContexts: async () => [],
      getURL: (url) => `chrome-extension://test/${url}`,
      sendMessage: async (message) => {
        offscreenMessages.emit(message);
      }
    },
    offscreen: withOffscreen ? { createDocument: createDocument || (async () => {}) } : undefined
  };
  const context = vm.createContext({
    console,
    Promise,
    Map,
    Error,
    setTimeout,
    clearTimeout,
    chrome: swChrome,
    importScripts(...scripts) {
      for (const script of scripts) {
        assert.equal(script, '../common/protocol.js');
        vm.runInContext(protocolSource, context, { filename: script });
      }
    }
  });
  vm.runInContext(workerSource, context, { filename: 'service-worker.js' });

  const port = {
    name: 'bso-runtime-v1',
    onMessage: event(),
    onDisconnect: event(),
    postMessage(...args) { portMessages.push(args); },
    disconnect() { this.onDisconnect.emit(); }
  };
  swConnect.emit(port);
  return { port, portMessages };
}

// Keep this source assertion independent of Chrome so a broken package cannot
// pass Node-only tests while omitting the offscreen document entrypoint.
test('packed source includes a local offscreen document and fixture analyzer', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/offscreen.html'), 'utf8');
  assert.match(html, /fixture-model\.js/);
  assert.match(html, /movenet-adapter\.js/);
  assert.match(html, /lite-runtime-loader\.js/);
  assert.match(html, /lite-openpose-adapter\.js/);
  assert.match(html, /shuttle-tracking-adapter\.js/);
  assert.match(html, /player-tracking\.js/);
  assert.match(html, /analyzer\.js/);
  assert.match(html, /offscreen\.js/);
  const modelPath = path.join(__dirname, '..', 'src/extension/offscreen/vendor/lite-openpose/pose_256.tflite');
  const modelNotice = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/vendor/lite-openpose/MODEL-NOTICE.md'), 'utf8');
  assert.ok(fs.statSync(modelPath).size > 1000000);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'), 'b5c200e7050f1e17884059bf3da72b14e842af555ad67a49f46a4a9b37aeb0cd');
  assert.match(modelNotice, /Apache-2\.0/);
  assert.match(modelNotice, /SHA-256/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/vendor/litert/LICENSE'), 'utf8'), /Apache License/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.background.service_worker, 'background/service-worker.js');
  assert.equal(manifest.permissions.includes('offscreen'), true);
  assert.equal(Object.hasOwn(manifest, 'message_serialization'), false);
  assert.equal(manifest.minimum_chrome_version, '148');
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
  assert.deepEqual(manifest.content_scripts[0].js, ['content.bundle.js']);
  const packedHtmlPath = path.join(__dirname, '..', 'dist/offscreen/offscreen.html');
  if (fs.existsSync(packedHtmlPath)) {
    assert.match(fs.readFileSync(packedHtmlPath, 'utf8'), /fixture-model\.js/);
    assert.match(fs.readFileSync(packedHtmlPath, 'utf8'), /movenet-adapter\.js/);
    assert.match(fs.readFileSync(packedHtmlPath, 'utf8'), /lite-openpose-adapter\.js/);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/analyzer.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/movenet-adapter.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/lite-openpose-adapter.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/vendor/lite-openpose/pose_256.tflite')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/vendor/litert/litert_wasm_internal.wasm')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/background/service-worker.js')), true);
  }
});

test('offscreen selects the cleared local analyzer when its package script is present', () => {
  const context = loadOffscreen({ runtime: {} }, { withProduction: true });
  const analyzer = context.BSOOffscreenAnalyzer.getActiveAnalyzer();
  assert.equal(analyzer.identity.id, 'lightweight-openpose-lite-256-v1');
  assert.equal(analyzer.identity.productionModel, true);
});

test('offscreen composes production pose tracks with accepted shuttle evidence without event claims', async () => {
  const context = loadOffscreen({ runtime: {} }, { withProduction: true });
  const resets = [];
  const poseIdentity = { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose', productionModel: true };
  const shuttleIdentity = { id: 'local-shuttle-frame-difference-v1', version: 1, kind: 'bounded-temporal-pixel-heuristic', productionModel: false };
  const poseTracker = new tracking.SessionPlayerTracker({ sessionId: 'composition' });
  const pose = {
    identity: poseIdentity,
    async initialize() { return { available: true, backend: 'wasm', fallbacks: ['backend-webgpu-unavailable'] }; },
    resetSession(sessionId, reason) { resets.push(['pose', sessionId, reason]); poseTracker.reset(reason); },
    async analyze(sample) {
      const tracked = poseTracker.processFrame({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, cameraCut: sample.cameraCut, observations: [
        { observationId: `${sample.requestId}:a`, sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, coordinateSpace: 'normalized', bbox: { x: .1, y: .2, width: .2, height: .4 }, keypoints: [], confidence: .9, state: 'tracked', detector: poseIdentity, source: { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' } },
        { observationId: `${sample.requestId}:b`, sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, coordinateSpace: 'normalized', bbox: { x: .7, y: .2, width: .2, height: .4 }, keypoints: [], confidence: .9, state: 'tracked', detector: poseIdentity, source: { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' } }
      ] }).result;
      return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: poseIdentity.id, analyzerIdentity: poseIdentity, inferenceAvailable: true, result: { kind: 'lightweight-openpose', productionModel: true, state: tracked.state, players: tracked.players, tracking: tracked, strokeEvents: [], shotFamily: 'unclassified', classificationConfidence: 0, geometryConfidence: 0 } });
    }
  };
  const shuttle = {
    identity: shuttleIdentity,
    async analyze(sample) {
      return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: shuttleIdentity.id, analyzerIdentity: shuttleIdentity, inferenceAvailable: true, result: { kind: 'bounded-temporal-pixel-heuristic', state: 'tracked', shuttle: { state: 'tracked', confidence: .71, candidate: { x: .5, y: .5, accepted: true }, trajectory: [{ x: .4, y: .4 }, { x: .5, y: .5 }], accepted: true, reason: 'temporal-continuity', evidence: { continuity: .9 } } } });
    },
    resetSession(sessionId, reason) { resets.push(['shuttle', sessionId, reason]); }
  };
  const composite = new context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer({ poseAnalyzer: pose, shuttleAnalyzer: shuttle });
  assert.equal((await composite.initialize()).available, true);
  const first = await composite.analyze({ sessionId: 'composition', requestId: 'r1', mediaTime: 1, frame: frame() });
  assert.equal(first.analyzer, poseIdentity.id);
  assert.equal(first.inferenceAvailable, true);
  assert.equal(first.result.composition, 'pose-plus-shuttle-v1');
  assert.equal(first.result.players.length, 2);
  assert.equal(first.result.shuttle.state, 'tracked');
  assert.equal(first.result.rally.state, 'unknown');
  assert.equal(first.result.rallyEnd.state, 'unknown');
  assert.equal(first.result.winner.state, 'unknown');
  const afterCut = await composite.analyze({ sessionId: 'composition', requestId: 'r2', mediaTime: 2, cameraCut: true, frame: frame() });
  assert.equal(afterCut.result.players.length, 2);
  assert.deepEqual(resets.map((entry) => entry[0]), ['pose', 'shuttle']);
  const afterJump = await composite.analyze({ sessionId: 'composition', requestId: 'r3', mediaTime: 1, frame: frame() });
  assert.equal(afterJump.result.players.length, 2);
  assert.ok(resets.some((entry) => entry[2] === 'media-time-reset'));
});

test('production composition stays unknown and never switches to fixture on pose initialization failure', async () => {
  const context = loadOffscreen({ runtime: {} }, { withProduction: true });
  const poseIdentity = { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose', productionModel: true };
  const pose = { identity: poseIdentity, async initialize() { return { available: false, reason: 'local-model-artifact-unavailable' }; }, async analyze(sample) { return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: poseIdentity.id, analyzerIdentity: { ...poseIdentity, productionModel: false }, inferenceAvailable: false, status: 'fallback', result: { state: 'unknown', players: [], tracking: tracking.unknownTrackingResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, detector: poseIdentity, reason: 'local-model-artifact-unavailable' }), strokeEvents: [] } }); } };
  const shuttle = { identity: { id: 'local-shuttle-frame-difference-v1', version: 1, kind: 'bounded-temporal-pixel-heuristic' }, async analyze(sample) { return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: 'local-shuttle-frame-difference-v1', analyzerIdentity: this.identity, inferenceAvailable: true, result: { shuttle: { state: 'unknown', confidence: null, accepted: false, reason: 'no-candidate' } } }); } };
  const composite = new context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer({ poseAnalyzer: pose, shuttleAnalyzer: shuttle });
  assert.equal((await composite.initialize()).available, false);
  const result = await composite.analyze({ sessionId: 'unknown', requestId: 'r1', mediaTime: 1, frame: frame() });
  assert.equal(result.inferenceAvailable, false);
  assert.ok(result.capabilities);
  assert.equal(result.analyzer, poseIdentity.id);
  assert.equal(result.result.players.length, 0);
  assert.equal(result.result.shuttle.state, 'unknown');
  assert.notEqual(result.analyzer, 'fixture-probe-v1');
});

test('offscreen capability report preserves selected backend and explicit fallbacks', async () => {
  const sent = [];
  const onMessage = event();
  const context = loadOffscreen({ runtime: { onMessage, sendMessage: async (message) => { sent.push(message); } } }, { withProduction: true });
  const identity = { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose', productionModel: true };
  context.BSOOffscreenAnalyzer.setAnalyzer({
    identity,
    async initialize() { return { available: true, backend: 'wasm', fallbacks: ['backend-webgpu-unavailable', 'backend-webgl-unavailable'] }; },
    async analyze(sample) { return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: identity.id, analyzerIdentity: identity, inferenceAvailable: true, result: { state: 'unknown', players: [], tracking: tracking.unknownTrackingResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, detector: identity, reason: 'no-pose-evidence' }), shuttle: { state: 'unknown', confidence: null }, strokeEvents: [], rally: { state: 'unknown' }, rallyEnd: { state: 'unknown' }, winner: { state: 'unknown' } } }); }
  });
  onMessage.emit(protocol.createSessionStart({ sessionId: 'capability', capabilities: { capture: 'request-video-frame-callback', frameTransport: 'rgba-array-v1' } }));
  await waitForWork();
  const report = sent.find((message) => message.type === protocol.TYPES.CAPABILITY_REPORT);
  const status = sent.find((message) => message.type === protocol.TYPES.RUNTIME_STATUS && message.phase === 'ready');
  assert.equal(report.capabilities.inference, true);
  assert.equal(report.capabilities.analyzer, identity.id);
  assert.equal(report.capabilities.backend, 'wasm');
  assert.deepEqual(Array.from(report.fallbacks), ['backend-webgpu-unavailable', 'backend-webgl-unavailable']);
  assert.equal(status.capabilities.backend, 'wasm');
  assert.deepEqual(Array.from(status.capabilities.fallbacks), Array.from(report.fallbacks));
});

test('offscreen holds one newest frame until session initialization completes', async () => {
  const sent = [];
  const onMessage = event();
  const context = loadOffscreen({
    runtime: {
      onMessage,
      sendMessage: async (message) => { sent.push(message); }
    }
  });
  let releaseInitialization;
  const initialization = new Promise((resolve) => { releaseInitialization = resolve; });
  const analyzed = [];
  const identity = { id: 'test-start-gated-analyzer', version: 1, kind: 'test', runtimeIntegrationTest: true, productionModel: false };
  context.BSOOffscreenAnalyzer.setAnalyzer({
    identity,
    async initialize() {
      await initialization;
      return { available: true, backend: 'test' };
    },
    async analyze(sample) {
      analyzed.push(sample.requestId);
      return protocol.createAnalyzerResult({
        sessionId: sample.sessionId,
        requestId: sample.requestId,
        mediaTime: sample.mediaTime,
        analyzer: identity.id,
        analyzerIdentity: identity,
        inferenceAvailable: true,
        result: { state: 'unknown', players: [], tracking: tracking.unknownTrackingResult({
          sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, reason: 'test'
        }) }
      });
    }
  });
  onMessage.emit(protocol.createSessionStart({ sessionId: 'start-gated', capabilities: { capture: 'timer-fallback', frameTransport: 'rgba-array-v1' } }));
  await waitForWork();
  const held = frame();
  onMessage.emit(protocol.createFrameSample({
    sessionId: 'start-gated', requestId: 'start-gated:1', mediaTime: 1, capturedAt: 1,
    width: 2, height: 2, frame: held, frameFormat: 'rgba-array-v1'
  }).message);
  assert.deepEqual(analyzed, []);
  assert.equal(held.closed, undefined);
  releaseInitialization();
  await waitForWork();
  await waitForWork();
  assert.deepEqual(analyzed, ['start-gated:1']);
  assert.equal(held.closed, true);
  onMessage.emit(protocol.createSessionEnd({ sessionId: 'start-gated', reason: 'test-complete' }));
  await waitForWork();
});

test('offscreen fixture probe returns deterministic local results with capability state', async () => {
  const sent = [];
  const onMessage = event();
  const chrome = {
    runtime: {
      onMessage,
      sendMessage: async (message) => { sent.push(message); }
    }
  };
  loadOffscreen(chrome);
  const start = protocol.createSessionStart({
    sessionId: 'probe-session',
    pageUrl: 'https://www.youtube.com/watch?v=fixture',
    capabilities: { capture: 'request-video-frame-callback', transferableFrames: false, frameTransport: 'rgba-array-v1' }
  });
  onMessage.emit(start);
  await waitForWork();
  const sample = protocol.createFrameSample({
    sessionId: 'probe-session',
    requestId: 'probe-session:1',
    mediaTime: 12.5,
    capturedAt: 100,
    width: 2,
    height: 2,
    frame: frame(),
    frameFormat: 'rgba-array-v1'
  });
  onMessage.emit(sample.message);
  await waitForWork();
  await waitForWork();

  const result = sent.find((message) => message.type === protocol.TYPES.ANALYZER_RESULT);
  assert.ok(result);
  assert.equal(result.requestId, 'probe-session:1');
  assert.equal(result.mediaTime, 12.5);
  assert.equal(result.analyzer, 'fixture-probe-v1');
  assert.equal(result.analyzerIdentity.runtimeIntegrationTest, true);
  assert.equal(result.analyzerIdentity.productionModel, false);
  assert.equal(result.capabilities.offscreen, true);
  assert.equal(result.capabilities.inference, true);
  assert.equal(result.capabilities.frameTransport, 'rgba-array-v1');
  assert.equal(result.result.kind, 'runtime-integration-probe');
  assert.equal(result.result.productionModel, false);
  assert.equal(result.result.state, 'partial');
  assert.equal(Array.isArray(result.result.players), true);
  assert.equal(result.result.players.length, 0);
  assert.equal(result.result.tracking.schema, 'bso.player-tracking.result.v1');
  assert.equal(result.result.tracking.state, 'unknown');
  assert.equal(result.result.tracking.players.length, 0);
  assert.equal(result.result.tracking.detector.id, 'fixture-probe-v1');
  assert.equal(result.result.tracking.source.id, 'captured-frame');
  assert.equal(result.result.shuttle.state, 'unknown');
  assert.equal(result.result.probe.checksum, 1466837309);
  assert.equal(result.result.probe.sampledPixels, 4);
});

test('offscreen scheduler coalesces pending frames, drops stale samples, and closes every bitmap', async () => {
  const sent = [];
  const onMessage = event();
  const chrome = {
    runtime: {
      onMessage,
      sendMessage: async (message) => { sent.push(message); }
    }
  };
  const context = loadOffscreen(chrome);
  let release;
  const firstAnalysis = new Promise((resolve) => { release = resolve; });
  const analyzed = [];
  context.BSOOffscreenAnalyzer.setAnalyzer({
    identity: { id: 'test-analyzer', version: 1, kind: 'test', runtimeIntegrationTest: true, productionModel: false },
    async analyze(message) {
      analyzed.push(message.requestId);
      if (message.requestId === 'scheduler:1') await firstAnalysis;
      return protocol.createAnalyzerResult({
        sessionId: message.sessionId,
        requestId: message.requestId,
        mediaTime: message.mediaTime,
        analyzer: 'test-analyzer',
        analyzerIdentity: this.identity,
        inferenceAvailable: true,
        result: { state: 'unknown', players: [], tracking: tracking.unknownTrackingResult({
          sessionId: message.sessionId, requestId: message.requestId, mediaTime: message.mediaTime,
          reason: 'test'
        }) }
      });
    }
  });
  const session = protocol.createSessionStart({ sessionId: 'scheduler', capabilities: { capture: 'timer-fallback', frameTransport: 'rgba-array-v1' } });
  onMessage.emit(session);
  await waitForWork();
  const first = frame();
  const pending = frame();
  const newest = frame();
  onMessage.emit(protocol.createFrameSample({ sessionId: 'scheduler', requestId: 'scheduler:1', mediaTime: 1, capturedAt: 1, width: 2, height: 2, frame: first, frameFormat: 'rgba-array-v1' }).message);
  await waitForWork();
  onMessage.emit(protocol.createFrameSample({ sessionId: 'scheduler', requestId: 'scheduler:2', mediaTime: 2, capturedAt: 2, width: 2, height: 2, frame: pending, frameFormat: 'rgba-array-v1' }).message);
  onMessage.emit(protocol.createFrameSample({ sessionId: 'scheduler', requestId: 'scheduler:3', mediaTime: 3, capturedAt: 3, width: 2, height: 2, frame: newest, frameFormat: 'rgba-array-v1' }).message);
  assert.equal(pending.closed, true);
  release();
  await waitForWork();
  await waitForWork();
  assert.deepEqual(analyzed, ['scheduler:1', 'scheduler:3']);
  assert.equal(first.closed, true);
  assert.equal(newest.closed, true);
  const stale = frame();
  onMessage.emit(protocol.createFrameSample({ sessionId: 'scheduler', requestId: 'scheduler:stale', mediaTime: 3, capturedAt: 4, width: 2, height: 2, frame: stale, frameFormat: 'rgba-array-v1' }).message);
  assert.equal(stale.closed, true);
  assert.deepEqual(analyzed, ['scheduler:1', 'scheduler:3']);
  onMessage.emit(protocol.createSessionEnd({ sessionId: 'scheduler', reason: 'test-complete' }));
  await waitForWork();
  assert.equal(sent.some((message) => message.type === protocol.TYPES.RUNTIME_STATUS && message.phase === 'ended'), true);
});

test('service worker relays start, serializable frame sample, result, and ordered end marker', async () => {
  const harness = createServiceWorkerHarness();
  const { port, portMessages } = harness;
  const session = protocol.createSessionStart({
    sessionId: 'round-trip',
    pageUrl: 'https://www.youtube.com/watch?v=fixture',
    capabilities: { capture: 'request-video-frame-callback', transferableFrames: false, frameTransport: 'rgba-array-v1' }
  });
  port.onMessage.emit(session);
  await waitForWork();
  port.onMessage.emit(protocol.createFrameSample({
    sessionId: 'round-trip',
    requestId: 'round-trip:1',
    mediaTime: 4.25,
    capturedAt: 10,
    width: 2,
    height: 2,
    frame: frame(),
    frameFormat: 'rgba-array-v1'
  }).message);
  await waitForWork();
  await waitForWork();
  const result = portMessages.find(([message]) => message.type === protocol.TYPES.ANALYZER_RESULT);
  assert.ok(result);
  assert.equal(result[0].requestId, 'round-trip:1');
  assert.equal(result[0].mediaTime, 4.25);
  assert.equal(result[0].analyzer, 'fixture-probe-v1');
  assert.equal(result[0].capabilities.offscreen, true);
  assert.equal(result[0].capabilities.frameTransport, 'rgba-array-v1');

  port.onMessage.emit(protocol.createSessionEnd({ sessionId: 'round-trip', reason: 'test-complete' }));
  await waitForWork();
  await waitForWork();
  const resultIndex = portMessages.findIndex(([message]) => message.type === protocol.TYPES.ANALYZER_RESULT);
  const endedIndex = portMessages.findIndex(([message]) => message.type === protocol.TYPES.RUNTIME_STATUS && message.phase === 'ended');
  assert.ok(resultIndex >= 0);
  assert.ok(endedIndex > resultIndex);
});

test('service worker reports explicit fallback when offscreen is unavailable', async () => {
  const harness = createServiceWorkerHarness({ withOffscreen: false });
  const session = protocol.createSessionStart({ sessionId: 'fallback-session', capabilities: { capture: 'timer-fallback' } });
  harness.port.onMessage.emit(session);
  await waitForWork();
  await waitForWork();
  const report = harness.portMessages.find(([message]) => message.type === protocol.TYPES.CAPABILITY_REPORT);
  const status = harness.portMessages.find(([message]) => message.type === protocol.TYPES.RUNTIME_STATUS);
  assert.equal(report[0].capabilities.offscreen, false);
  assert.equal(report[0].capabilities.inference, false);
  assert.equal(report[0].capabilities.analyzer, 'none');
  assert.equal(status[0].phase, 'fallback');
  assert.match(status[0].reason, /offscreen/);
});

test('service worker closes frames held during failed offscreen startup', async () => {
  let releaseStartup;
  const startup = new Promise((resolve) => { releaseStartup = resolve; });
  const harness = createServiceWorkerHarness({
    createDocument: async () => {
      await startup;
      throw new Error('offscreen-startup-failed');
    }
  });
  harness.port.onMessage.emit(protocol.createSessionStart({ sessionId: 'startup-failure', capabilities: { capture: 'timer-fallback', frameTransport: 'rgba-array-v1' } }));
  await waitForWork();
  const held = frame();
  harness.port.onMessage.emit(protocol.createFrameSample({
    sessionId: 'startup-failure', requestId: 'startup-failure:1', mediaTime: 1,
    capturedAt: 1, width: 2, height: 2, frame: held, frameFormat: 'rgba-array-v1'
  }).message);
  assert.equal(held.closed, undefined);
  releaseStartup();
  await waitForWork();
  await waitForWork();
  assert.equal(held.closed, true);
  const status = harness.portMessages.find(([message]) => message.type === protocol.TYPES.RUNTIME_STATUS && message.phase === 'fallback');
  assert.match(status[0].reason, /offscreen-startup-failed/);
  harness.port.onMessage.emit(protocol.createSessionEnd({ sessionId: 'startup-failure', reason: 'test-complete' }));
  await waitForWork();
});
