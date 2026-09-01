const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
const synchronization = require('../src/extension/common/synchronization.js');
global.BSOProtocol = protocol;
global.BSOSynchronization = synchronization;
const { RuntimeBridge, RuntimeController } = require('../src/extension/content/runtime.js');

test('runtime bridge exposes the transfer list at the public offscreen boundary', () => {
  let sent;
  const fakePort = {
    onMessage: { addListener() {} },
    onDisconnect: { addListener() {} },
    postMessage(...args) { sent = args; }
  };
  const chromeApi = { runtime: { connect() { return fakePort; } } };
  const bridge = new RuntimeBridge({ chromeApi });
  assert.equal(bridge.start('session-1', { capture: 'request-video-frame-callback' }), true);
  const frame = { kind: 'ImageBitmap' };
  const sample = protocol.createFrameSample({
    sessionId: 'session-1', requestId: 'session-1:1', mediaTime: 3.25,
    capturedAt: 42, width: 2, height: 2, frame
  });
  assert.equal(bridge.sendFrameSample(sample.message, sample.transferables), true);
  assert.equal(sent[0].type, protocol.TYPES.FRAME_SAMPLE);
  assert.deepEqual(sent[1], [frame]);
  assert.equal(sent[0].mediaTime, 3.25);
});

test('runtime bridge makes the MV3 structured-clone copy fallback visible', () => {
  let sent;
  const statuses = [];
  const fakePort = {
    onMessage: { addListener() {} },
    onDisconnect: { addListener() {} },
    postMessage(...args) { sent = args; }
  };
  const chromeApi = { runtime: { connect() { return fakePort; } } };
  const bridge = new RuntimeBridge({ chromeApi, supportsTransferList: false, onStatus: (status) => statuses.push(status) });
  assert.equal(bridge.start('session-copy', {}), true);
  const frame = { kind: 'ImageBitmap' };
  const sample = protocol.createFrameSample({
    sessionId: 'session-copy', requestId: 'session-copy:1', mediaTime: 1,
    capturedAt: 42, width: 2, height: 2, frame
  });
  assert.equal(bridge.sendFrameSample(sample.message, sample.transferables), true);
  assert.equal(sent.length, 1);
  assert.equal(statuses.some((status) => status.type === 'frame-transport-fallback'), true);
});

test('runtime controller does not expose a result before media-time synchronization', () => {
  const messages = [];
  const controller = new RuntimeController({
    bridge: { end() {} },
    onRuntimeMessage: (message, view) => messages.push({ message, view }),
    onRuntimeView: (view) => messages.push({ view })
  });
  controller.sessionId = 'session-sync';
  controller.synchronizer = new synchronization.MediaTimestampSynchronizer({ sessionId: 'session-sync' });
  const result = protocol.createAnalyzerResult({
    sessionId: 'session-sync', requestId: 'session-sync:1', mediaTime: 20,
    analyzer: 'local-pose', inferenceAvailable: true, capabilities: { analyzer: 'local-pose', inference: true },
    result: { state: 'tracked', players: [], tracking: null }
  });

  controller.handleMessage(result);
  assert.equal(messages.length, 0, 'a result ahead of the first captured frame stays held');
  controller.handleMediaTime(20);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].view.result.requestId, 'session-sync:1');
});
