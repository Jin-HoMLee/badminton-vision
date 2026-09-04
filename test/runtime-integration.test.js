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

function loadOffscreen(chrome, { withProduction = false, runtimeReady = null } = {}) {
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
    context.BSOLiteRuntimeReady = Promise.resolve(runtimeReady || { loaded: true });
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
  assert.match(html, /efficientdet-racket-adapter\.js/);
  const racketModelPath = path.join(__dirname, '..', 'src/extension/offscreen/vendor/efficientdet-lite0/efficientdet_lite0.tflite');
  const racketNotice = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/vendor/efficientdet-lite0/MODEL-NOTICE.md'), 'utf8');
  assert.ok(fs.statSync(racketModelPath).size > 5000000);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(racketModelPath)).digest('hex'), '4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993');
  assert.match(racketNotice, /Apache-2\.0/);
  assert.match(racketNotice, /SHA-256/);
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
    assert.match(fs.readFileSync(packedHtmlPath, 'utf8'), /efficientdet-racket-adapter\.js/);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/analyzer.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/movenet-adapter.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/lite-openpose-adapter.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/efficientdet-racket-adapter.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/vendor/lite-openpose/pose_256.tflite')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/vendor/efficientdet-lite0/efficientdet_lite0.tflite')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/vendor/efficientdet-lite0/MODEL-NOTICE.md')), true);
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

test('composition emits real racket detections when a racket analyzer is present', async () => {
  const context = loadOffscreen({ runtime: {} }, { withProduction: true });
  const poseIdentity = { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose', productionModel: true };
  const shuttleIdentity = { id: 'local-shuttle-frame-difference-v1', version: 1, kind: 'bounded-temporal-pixel-heuristic', productionModel: false };
  const racketIdentity = { id: 'efficientdet-lite0-racket-v1', version: 1, kind: 'local-litert-tflite-racket-detector', productionModel: true };
  const pose = {
    identity: poseIdentity,
    async initialize() { return { available: true, backend: 'wasm' }; },
    async analyze(sample) {
      return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: poseIdentity.id, analyzerIdentity: poseIdentity, inferenceAvailable: true, result: { kind: 'lightweight-openpose', productionModel: true, state: 'unknown', players: [], tracking: tracking.unknownTrackingResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, detector: poseIdentity, reason: 'no-pose-evidence' }) } });
    }
  };
  const shuttle = { identity: shuttleIdentity, async analyze() { return null; } };
  const racket = {
    identity: racketIdentity,
    async initialize() { return { available: true, backend: 'wasm' }; },
    detections: [
      { bbox: { x: 0.31, y: 0.28, width: 0.2, height: 0.3 }, confidence: 0.71, class: 'tennis racket', classIndex: 42, state: 'tracked' }
    ],
    async analyze(sample) {
      return {
        state: 'tracked',
        confidence: 0.71,
        detections: this.detections,
        detectionMethod: 'efficientdet-lite0-tennis-racket',
        reason: 'coco-tennis-racket-detections',
        sessionId: sample.sessionId,
        requestId: sample.requestId,
        mediaTime: sample.mediaTime
      };
    },
    resetSession() {},
    endSession() {},
    dispose() {}
  };
  const composite = new context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer({ poseAnalyzer: pose, shuttleAnalyzer: shuttle, racketAnalyzer: racket });
  assert.equal((await composite.initialize()).available, true);
  const envelope = await composite.analyze({ sessionId: 'composition-racket', requestId: 'r1', mediaTime: 1, frame: frame() });
  assert.equal(envelope.result.racket.state, 'tracked');
  assert.equal(envelope.result.racket.detectionMethod, 'efficientdet-lite0-tennis-racket');
  assert.deepEqual(envelope.result.racket.detections, racket.detections);
  assert.equal(envelope.result.evidence.racket.available, true);
  assert.equal(envelope.result.evidence.racket.analyzer, 'efficientdet-lite0-racket-v1');
  assert.equal(composite.identity.components.racket.id, 'efficientdet-lite0-racket-v1');
});

test('composition keeps the pose proxy only when no racket analyzer runs, and never invents detections', async () => {
  const context = loadOffscreen({ runtime: {} }, { withProduction: true });
  const poseIdentity = { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose', productionModel: true };
  const shuttleIdentity = { id: 'local-shuttle-frame-difference-v1', version: 1, kind: 'bounded-temporal-pixel-heuristic', productionModel: false };
  const poseTracker = new tracking.SessionPlayerTracker({ sessionId: 'proxy' });
  const pose = {
    identity: poseIdentity,
    async initialize() { return { available: true, backend: 'wasm' }; },
    async analyze(sample) {
      const players = [{
        trackId: 1,
        state: 'tracked',
        bbox: { x: .1, y: .2, width: .2, height: .4 },
        keypoints: [{ name: 'right_wrist', x: .31, y: .28, confidence: .9 }, { name: 'right_elbow', x: .4, y: .3, confidence: .9 }]
      }];
      void poseTracker;
      return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: poseIdentity.id, analyzerIdentity: poseIdentity, inferenceAvailable: true, result: { kind: 'lightweight-openpose', productionModel: true, state: 'tracked', players, tracking: { state: 'tracked', accepted: true, players } } });
    }
  };
  const shuttle = { identity: shuttleIdentity, async analyze() { return null; } };
  // A racket analyzer that runs but finds nothing replaces the wrist/elbow
  // proxy with an honest unknown (no orange keypoint proxy for empty frames).
  const honestRacket = {
    identity: { id: 'efficientdet-lite0-racket-v1', version: 1, kind: 'local-litert-tflite-racket-detector' },
    async initialize() { return { available: true }; },
    async analyze(sample) {
      return { state: 'unknown', confidence: null, detections: [], detectionMethod: 'efficientdet-lite0-tennis-racket', reason: 'no-tennis-racket-detection', sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime };
    }
  };
  const withDetector = new context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer({ poseAnalyzer: pose, shuttleAnalyzer: shuttle, racketAnalyzer: honestRacket });
  const detectedResult = await withDetector.analyze({ sessionId: 'proxy-detector', requestId: 'r1', mediaTime: 1, frame: frame() });
  assert.equal(detectedResult.result.racket.state, 'unknown');
  assert.equal(Array.isArray(detectedResult.result.racket.hands), false, 'no pose proxy when the real detector reports no racket');
  // Without any racket analyzer the composition retains the historical
  // pose-derived proxy as degraded fallback evidence.
  const withoutDetector = new context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer({ poseAnalyzer: pose, shuttleAnalyzer: shuttle, racketAnalyzer: null });
  const proxyResult = await withoutDetector.analyze({ sessionId: 'proxy-only', requestId: 'r1', mediaTime: 1, frame: frame() });
  assert.equal(proxyResult.result.racket.state, 'partial');
  assert.ok(Array.isArray(proxyResult.result.racket.hands) && proxyResult.result.racket.hands.length === 1, 'degraded fallback keeps the wrist/elbow proxy');
});

test('composition keeps the pose proxy when the racket artifact is present but cannot initialize', async () => {
  const context = loadOffscreen({ runtime: {} }, { withProduction: true });
  const poseIdentity = { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose', productionModel: true };
  const shuttleIdentity = { id: 'local-shuttle-frame-difference-v1', version: 1, kind: 'bounded-temporal-pixel-heuristic', productionModel: false };
  const pose = {
    identity: poseIdentity,
    async initialize() { return { available: true, backend: 'wasm' }; },
    async analyze(sample) {
      const players = [{
        trackId: 1,
        state: 'tracked',
        bbox: { x: .1, y: .2, width: .2, height: .4 },
        keypoints: [{ name: 'right_wrist', x: .31, y: .28, confidence: .9 }, { name: 'right_elbow', x: .4, y: .3, confidence: .9 }]
      }];
      return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: poseIdentity.id, analyzerIdentity: poseIdentity, inferenceAvailable: true, result: { kind: 'lightweight-openpose', productionModel: true, state: 'tracked', players, tracking: { state: 'tracked', accepted: true, players } } });
    }
  };
  const shuttle = { identity: shuttleIdentity, async analyze() { return null; } };
  // A racket detector whose artifact cannot start (fetch/compile failure)
  // emits no detectionMethod-marked envelope, exactly like the adapter on
  // initialize() failure; the composition must keep the wrist/elbow proxy.
  const stuckRacket = {
    identity: { id: 'efficientdet-lite0-racket-v1', version: 1, kind: 'local-litert-tflite-racket-detector' },
    async initialize() { return { available: false, reason: 'model-compile-failed', fallbacks: ['backend-wasm-unavailable'] }; },
    async analyze(sample) {
      return { state: 'unknown', confidence: null, detections: [], detectionMethod: null, reason: 'model-compile-failed', sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime };
    }
  };
  const composite = new context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer({ poseAnalyzer: pose, shuttleAnalyzer: shuttle, racketAnalyzer: stuckRacket });
  const initialized = await composite.initialize();
  assert.equal(initialized.available, true, 'pose availability is unaffected by a racket init failure');
  assert.equal(initialized.racketAvailable, false);
  const envelope = await composite.analyze({ sessionId: 'proxy-init-failure', requestId: 'r1', mediaTime: 1, frame: frame() });
  assert.equal(envelope.result.racket.state, 'partial');
  assert.equal(envelope.result.racket.detectionMethod, undefined, 'no authoritative detector envelope replaces the proxy');
  assert.ok(Array.isArray(envelope.result.racket.hands) && envelope.result.racket.hands.length === 1, 'the wrist/elbow proxy stays while the artifact cannot run');
  assert.equal(envelope.result.evidence.racket.available, false);
});

test('a racket run exception keeps the pose proxy for that frame and later detections replace it', async () => {
  const context = loadOffscreen({ runtime: {} }, { withProduction: true });
  const poseIdentity = { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose', productionModel: true };
  const shuttleIdentity = { id: 'local-shuttle-frame-difference-v1', version: 1, kind: 'bounded-temporal-pixel-heuristic', productionModel: false };
  const statuses = [];
  const pose = {
    identity: poseIdentity,
    async initialize() { return { available: true, backend: 'wasm' }; },
    async analyze(sample) {
      const players = [{
        trackId: 1,
        state: 'tracked',
        bbox: { x: .1, y: .2, width: .2, height: .4 },
        keypoints: [{ name: 'right_wrist', x: .31, y: .28, confidence: .9 }, { name: 'right_elbow', x: .4, y: .3, confidence: .9 }]
      }];
      return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: poseIdentity.id, analyzerIdentity: poseIdentity, inferenceAvailable: true, result: { kind: 'lightweight-openpose', productionModel: true, state: 'tracked', players, tracking: { state: 'tracked', accepted: true, players } } });
    }
  };
  const shuttle = { identity: shuttleIdentity, async analyze() { return null; } };
  let calls = 0;
  const runFailureRacket = {
    identity: { id: 'efficientdet-lite0-racket-v1', version: 1, kind: 'local-litert-tflite-racket-detector' },
    onStatus: () => {},
    async initialize() { return { available: true, backend: 'wasm' }; },
    async analyze(sample) {
      calls += 1;
      if (calls === 1) {
        // Exactly the marker-free envelope the adapter returns when its
        // model.run throws: that frame is not authoritative detector
        // evidence, so the composition must keep the wrist/elbow proxy.
        return { state: 'unknown', confidence: null, detections: [], detectionMethod: null, reason: 'device-lost', sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime };
      }
      return { state: 'tracked', confidence: 0.71, detections: [{ bbox: { x: 0.31, y: 0.28, width: 0.2, height: 0.3 }, confidence: 0.71, class: 'tennis racket', classIndex: 42, state: 'tracked' }], detectionMethod: 'efficientdet-lite0-tennis-racket', reason: 'coco-tennis-racket-detections', sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime };
    }
  };
  const composite = new context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer({ poseAnalyzer: pose, shuttleAnalyzer: shuttle, racketAnalyzer: runFailureRacket, onStatus: (value) => statuses.push(value) });
  // A genuine detector failure raised while analyzing a frame is forwarded
  // with the frame session so the offscreen status router can surface it.
  runFailureRacket.onStatus({ type: 'inference-failure', sessionId: 'run-exception', requestId: 'r0', mediaTime: 0.5, reason: 'device-lost' });
  const failedFrame = await composite.analyze({ sessionId: 'run-exception', requestId: 'r1', mediaTime: 1, frame: frame() });
  assert.equal(failedFrame.result.racket.state, 'partial', 'the proxy stays for a frame whose racket run failed');
  assert.ok(Array.isArray(failedFrame.result.racket.hands) && failedFrame.result.racket.hands.length === 1);
  assert.equal(failedFrame.result.racket.detectionMethod, undefined);
  const recoveredFrame = await composite.analyze({ sessionId: 'run-exception', requestId: 'r2', mediaTime: 2, frame: frame() });
  assert.equal(recoveredFrame.result.racket.state, 'tracked', 'a later completed run replaces the proxy');
  assert.equal(recoveredFrame.result.racket.detections.length, 1);
  const forwarded = statuses.find((value) => value.component === 'racket' && value.type === 'inference-failure');
  assert.ok(forwarded, 'racket failures are forwarded to the analyzer status router');
  assert.equal(forwarded.sessionId, 'run-exception');
  assert.equal(forwarded.reason, 'device-lost');
});

test('offscreen surfaces genuine racket failures as status without flipping the pose capability', async () => {
  const sent = [];
  const onMessage = event();
  const runtimeReady = {
    loaded: true,
    async loadAndCompile() {
      return { async run() { throw new Error('no-frame-in-this-test'); } };
    }
  };
  const context = loadOffscreen({
    runtime: {
      onMessage,
      sendMessage: async (message) => { sent.push(message); }
    }
  }, { withProduction: true, runtimeReady });
  onMessage.emit(protocol.createSessionStart({ sessionId: 'racket-status', capabilities: { capture: 'timer-fallback', frameTransport: 'rgba-array-v1' } }));
  await waitForWork();
  await waitForWork();
  const analyzer = context.BSOOffscreenAnalyzer.getActiveAnalyzer();
  assert.equal(analyzer.initializationState.available, true, 'the pose backend must be healthy for the capability-preservation assertion');
  const countStatuses = () => sent.filter((message) => message.type === protocol.TYPES.RUNTIME_STATUS).length;
  const before = countStatuses();
  analyzer.status({ component: 'racket', type: 'inference-status', status: 'backpressure', sessionId: 'racket-status', requestId: 'x', mediaTime: 1, inFlightMediaTime: 1 });
  analyzer.status({ component: 'shuttle', type: 'shuttle-failure', sessionId: 'racket-status', reason: 'shuttle-noise' });
  assert.equal(countStatuses(), before, 'per-frame racket/shuttle noise stays off the status channel');
  analyzer.status({ component: 'racket', type: 'inference-failure', sessionId: 'racket-status', requestId: 'r1', mediaTime: 1, reason: 'device-lost' });
  const surfaced = sent.filter((message) => message.type === protocol.TYPES.RUNTIME_STATUS && String(message.reason || '').indexOf('racket-inference-failure') === 0).pop();
  assert.ok(surfaced, 'a genuine run failure surfaces as runtime status');
  assert.equal(surfaced.sessionId, 'racket-status');
  assert.equal(surfaced.phase, 'ready', 'a racket failure must not flip the global pose phase');
  assert.equal(surfaced.capabilities.inference, true);
  assert.equal(surfaced.capabilities.analyzer, 'lightweight-openpose-lite-256-v1');
  assert.equal(surfaced.capabilities.backend, 'wasm');
  assert.match(surfaced.message, /Racket detection is unavailable/);
  assert.match(surfaced.reason, /^racket-inference-failure:/);
  analyzer.status({ component: 'racket', type: 'model-failure', sessionId: 'racket-status', reason: 'model-compile-failed' });
  const initFailure = sent.filter((message) => message.type === protocol.TYPES.RUNTIME_STATUS && String(message.reason || '').indexOf('racket-model-failure') === 0).pop();
  assert.ok(initFailure, 'a racket initialization failure surfaces the same way');
  assert.equal(initFailure.phase, 'ready');
  assert.equal(initFailure.capabilities.inference, true);
});

test('composition survives a failing racket analyzer without failing the frame', async () => {
  const context = loadOffscreen({ runtime: {} }, { withProduction: true });
  const poseIdentity = { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose', productionModel: true };
  const shuttleIdentity = { id: 'local-shuttle-frame-difference-v1', version: 1, kind: 'bounded-temporal-pixel-heuristic', productionModel: false };
  const pose = {
    identity: poseIdentity,
    async initialize() { return { available: true, backend: 'wasm' }; },
    async analyze(sample) {
      return protocol.createAnalyzerResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, analyzer: poseIdentity.id, analyzerIdentity: poseIdentity, inferenceAvailable: true, result: { kind: 'lightweight-openpose', productionModel: true, state: 'unknown', players: [], tracking: tracking.unknownTrackingResult({ sessionId: sample.sessionId, requestId: sample.requestId, mediaTime: sample.mediaTime, detector: poseIdentity, reason: 'no-pose-evidence' }) } });
    }
  };
  const shuttle = { identity: shuttleIdentity, async analyze() { return null; } };
  const failingRacket = {
    identity: { id: 'efficientdet-lite0-racket-v1', version: 1, kind: 'local-litert-tflite-racket-detector' },
    async initialize() { return { available: true }; },
    async analyze() { throw new Error('racket-runtime-failure'); }
  };
  const composite = new context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer({ poseAnalyzer: pose, shuttleAnalyzer: shuttle, racketAnalyzer: failingRacket });
  const envelope = await composite.analyze({ sessionId: 'composition-racket-fail', requestId: 'r1', mediaTime: 1, frame: frame() });
  assert.ok(envelope, 'the frame still produces a result');
  assert.equal(envelope.inferenceAvailable, true, 'pose inference remains available');
  assert.equal(envelope.result.racket.state, 'unknown');
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
