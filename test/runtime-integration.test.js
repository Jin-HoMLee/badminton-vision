const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const protocol = require('../src/extension/common/protocol.js');
const tracking = require('../src/extension/common/player-tracking.js');
const protocolSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/common/protocol.js'), 'utf8');
const trackingSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/common/player-tracking.js'), 'utf8');
const analyzerSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/analyzer.js'), 'utf8');
const modelSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/fixture-model.js'), 'utf8');
const moveNetSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/movenet-adapter.js'), 'utf8');
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

function loadOffscreen(chrome) {
  const context = vm.createContext({
    console,
    Promise,
    Uint8Array,
    setTimeout,
    clearTimeout,
    chrome,
  });
  vm.runInContext(protocolSource, context, { filename: 'protocol.js' });
  vm.runInContext(trackingSource, context, { filename: 'player-tracking.js' });
  vm.runInContext(modelSource, context, { filename: 'fixture-model.js' });
  vm.runInContext(moveNetSource, context, { filename: 'movenet-adapter.js' });
  vm.runInContext(analyzerSource, context, { filename: 'analyzer.js' });
  vm.runInContext(offscreenSource, context, { filename: 'offscreen.js' });
  return context;
}

function waitForWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createServiceWorkerHarness({ withOffscreen = true } = {}) {
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
    offscreen: withOffscreen ? { createDocument: async () => {} } : undefined
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
  assert.match(html, /player-tracking\.js/);
  assert.match(html, /analyzer\.js/);
  assert.match(html, /offscreen\.js/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.background.service_worker, 'background/service-worker.js');
  assert.equal(manifest.permissions.includes('offscreen'), true);
  assert.equal(Object.hasOwn(manifest, 'message_serialization'), false);
  assert.equal(manifest.minimum_chrome_version, '148');
  assert.equal(manifest.content_scripts[0].js.includes('content.js'), true);
  assert.equal(manifest.content_scripts[0].js.includes('content/runtime.js'), true);
  assert.equal(manifest.content_scripts[0].js.includes('common/frame-transport.js'), true);
  const packedHtmlPath = path.join(__dirname, '..', 'dist/offscreen/offscreen.html');
  if (fs.existsSync(packedHtmlPath)) {
    assert.match(fs.readFileSync(packedHtmlPath, 'utf8'), /fixture-model\.js/);
    assert.match(fs.readFileSync(packedHtmlPath, 'utf8'), /movenet-adapter\.js/);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/analyzer.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/offscreen/movenet-adapter.js')), true);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist/background/service-worker.js')), true);
  }
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
