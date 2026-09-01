const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const protocol = require('../src/extension/common/protocol.js');
const protocolSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/common/protocol.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '..', 'src/extension/background/service-worker.js'), 'utf8');

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

function frame() {
  return {
    width: 2,
    height: 2,
    data: Uint8Array.from([255, 0, 0, 255, 0, 10, 0, 255, 0, 0, 20, 255, 5, 5, 5, 255]),
    close() { this.closed = true; }
  };
}

/**
 * Service-worker harness where the offscreen relay can fail (simulating a
 * closed/crashed offscreen document) a fixed number of times before the fake
 * offscreen becomes reachable again.
 */
function createRelayHarness({ relayFailures = 0, failFromAttempt = Infinity, createDocumentImpl = null } = {}) {
  const swConnect = event();
  const swMessages = event();
  const offscreenMessages = event();
  const portMessages = [];
  const receivedByOffscreen = [];
  let sendAttempts = 0;
  let createDocumentCalls = 0;
  let contexts = [];
  const offscreenChrome = {
    runtime: {
      onMessage: offscreenMessages,
      sendMessage: async () => {}
    }
  };
  const swChrome = {
    runtime: {
      onConnect: swConnect,
      onMessage: swMessages,
      getContexts: async () => contexts.slice(),
      getURL: (url) => `chrome-extension://test/${url}`,
      sendMessage: async (message) => {
        sendAttempts += 1;
        if (sendAttempts >= failFromAttempt && relayFailures > 0) {
          relayFailures -= 1;
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        receivedByOffscreen.push(message);
        offscreenMessages.emit(message);
      }
    },
    offscreen: {
      closeDocument: async () => {
        contexts = [];
      },
      createDocument: async (options) => {
        createDocumentCalls += 1;
        if (createDocumentImpl) await createDocumentImpl(options);
        contexts = [{ url: options.url }];
      }
    }
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
  return {
    port,
    portMessages,
    receivedByOffscreen,
    get createDocumentCalls() { return createDocumentCalls; },
    get sendAttempts() { return sendAttempts; }
  };
}

test('service worker recreates a closed offscreen document mid-session and re-establishes the session without fallback', async () => {
  const harness = createRelayHarness({ relayFailures: 1, failFromAttempt: 3 });
  harness.port.onMessage.emit(protocol.createSessionStart({
    sessionId: 'restart-session',
    capabilities: { capture: 'request-video-frame-callback', frameTransport: 'rgba-array-v1' }
  }));
  await waitForWork();
  await waitForWork();
  assert.equal(harness.createDocumentCalls, 1);
  // First frame relay succeeds.
  harness.port.onMessage.emit(protocol.createFrameSample({
    sessionId: 'restart-session', requestId: 'restart-session:1', mediaTime: 1,
    capturedAt: 1, width: 2, height: 2, frame: frame(), frameFormat: 'rgba-array-v1'
  }).message);
  await waitForWork();
  await waitForWork();
  assert.equal(harness.receivedByOffscreen.length, 2); // session start + frame
  assert.equal(harness.sendAttempts, 2);

  // The offscreen document dies (Chrome closes it); the next relay fails once.
  harness.port.onMessage.emit(protocol.createFrameSample({
    sessionId: 'restart-session', requestId: 'restart-session:2', mediaTime: 2,
    capturedAt: 2, width: 2, height: 2, frame: frame(), frameFormat: 'rgba-array-v1'
  }).message);
  await waitForWork();
  await waitForWork();
  await waitForWork();
  // A fresh document was created and the session was re-established before the
  // frame was retried: session start + retried frame.
  assert.equal(harness.createDocumentCalls, 2);
  const types = harness.receivedByOffscreen.map((message) => message.type);
  const sessionStarts = types.filter((type) => type === protocol.TYPES.SESSION_START);
  assert.equal(sessionStarts.length, 2);
  assert.equal(types[types.length - 1], protocol.TYPES.FRAME_SAMPLE);
  assert.equal(harness.receivedByOffscreen[harness.receivedByOffscreen.length - 1].requestId, 'restart-session:2');
  // No fallback status reached the content port.
  const fallbacks = harness.portMessages.filter(([message]) => message.type === protocol.TYPES.RUNTIME_STATUS && message.phase === 'fallback');
  assert.equal(fallbacks.length, 0);
  // Capability reports originate in the offscreen document. This worker-only
  // harness asserts the worker's ready status instead of inventing a report.
  const ready = harness.portMessages.find(([message]) => message.type === protocol.TYPES.RUNTIME_STATUS && message.phase === 'ready');
  assert.ok(ready);
  assert.equal(ready[0].capabilities.offscreen, true);
});

test('service worker reports the honest fallback when offscreen recreation fails mid-session', async () => {
  let documentCreates = 0;
  const harness = createRelayHarness({
    relayFailures: 1,
    failFromAttempt: 2,
    createDocumentImpl: async () => {
      documentCreates += 1;
      if (documentCreates > 1) throw new Error('offscreen-recreate-failed');
    }
  });
  harness.port.onMessage.emit(protocol.createSessionStart({
    sessionId: 'restart-fail-session',
    capabilities: { capture: 'timer-fallback', frameTransport: 'rgba-array-v1' }
  }));
  await waitForWork();
  await waitForWork();
  assert.equal(harness.createDocumentCalls, 1);
  harness.port.onMessage.emit(protocol.createFrameSample({
    sessionId: 'restart-fail-session', requestId: 'restart-fail-session:1', mediaTime: 1,
    capturedAt: 1, width: 2, height: 2, frame: frame(), frameFormat: 'rgba-array-v1'
  }).message);
  await waitForWork();
  await waitForWork();
  await waitForWork();
  assert.equal(harness.createDocumentCalls, 2);
  const fallback = harness.portMessages.find(([message]) => message.type === protocol.TYPES.RUNTIME_STATUS && message.phase === 'fallback');
  assert.ok(fallback, 'expected an explicit fallback status when recreation fails');
  assert.match(fallback[0].reason, /offscreen-recreate-failed/);
  const report = harness.portMessages.find(([message]) => message.type === protocol.TYPES.CAPABILITY_REPORT && message.capabilities.offscreen === false);
  assert.ok(report, 'expected an explicit offscreen=false capability report');
});

test('service worker does not loop restarts when the retried relay keeps failing', async () => {
  const harness = createRelayHarness({ relayFailures: 2, failFromAttempt: 2 });
  harness.port.onMessage.emit(protocol.createSessionStart({
    sessionId: 'no-loop-session',
    capabilities: { capture: 'timer-fallback', frameTransport: 'rgba-array-v1' }
  }));
  await waitForWork();
  await waitForWork();
  harness.port.onMessage.emit(protocol.createFrameSample({
    sessionId: 'no-loop-session', requestId: 'no-loop-session:1', mediaTime: 1,
    capturedAt: 1, width: 2, height: 2, frame: frame(), frameFormat: 'rgba-array-v1'
  }).message);
  await waitForWork();
  await waitForWork();
  await waitForWork();
  // One recreation attempt, then an honest fallback; no endless restart loop.
  assert.equal(harness.createDocumentCalls, 2);
  const fallback = harness.portMessages.find(([message]) => message.type === protocol.TYPES.RUNTIME_STATUS && message.phase === 'fallback');
  assert.ok(fallback);
});
