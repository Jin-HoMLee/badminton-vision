const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');

test('frame sample contract keeps a transferable frame out of JSON encodings', () => {
  const frame = { kind: 'ImageBitmap-double' };
  const sample = protocol.createFrameSample({
    sessionId: 'session-1',
    requestId: 'session-1:1',
    mediaTime: 12.5,
    capturedAt: 1000,
    width: 1280,
    height: 720,
    frame
  });

  assert.equal(sample.message.protocol, 'bso.runtime.v1');
  assert.equal(sample.message.type, protocol.TYPES.FRAME_SAMPLE);
  assert.deepEqual(sample.message.dimensions, { width: 1280, height: 720 });
  assert.equal(sample.message.mediaTime, 12.5);
  assert.equal(sample.message.frame, frame);
  assert.deepEqual(sample.transferables, [frame]);
  assert.equal(protocol.isFrameSample(sample.message), true);
  assert.equal(protocol.isRuntimeMessage(sample.message), true);
});

test('invalid frame metadata is rejected at the boundary', () => {
  assert.throws(() => protocol.createFrameSample({
    sessionId: 'session-1', requestId: 'request-1', mediaTime: -1,
    width: 1, height: 1, frame: {}
  }), /mediaTime/);
  assert.equal(protocol.isFrameSample({ protocol: protocol.PROTOCOL, version: 1,
    type: protocol.TYPES.FRAME_SAMPLE, sessionId: 's', requestId: 'r', mediaTime: 1,
    capturedAt: 1, dimensions: { width: 1, height: 1 } }), false);
});

test('analyzer result carries media time and the explicit stale policy', () => {
  const result = protocol.createAnalyzerResult({
    sessionId: 'session-1', requestId: 'request-1', mediaTime: 4,
    result: { shotFamily: 'unclassified' }
  });
  assert.equal(result.type, protocol.TYPES.ANALYZER_RESULT);
  assert.equal(result.mediaTime, 4);
  assert.equal(result.inferenceAvailable, false);
  assert.equal(result.analyzerIdentity, 'mock');
  assert.deepEqual(result.capabilities, {});
  assert.equal(result.stalePolicy.name, 'media-time-watermark');
  assert.equal(protocol.isAnalyzerResult(result), true);
});

test('default analyzer result is model-neutral and multi-person capable', () => {
  const result = protocol.createAnalyzerResult({ sessionId: 'session-1', requestId: 'request-2', mediaTime: 4 });
  assert.equal(result.result.schema, 'bso.analysis.result.v1');
  assert.equal(Array.isArray(result.result.players), true);
  assert.equal(result.result.players.length, 0);
  assert.equal(result.result.state, 'partial');
  assert.equal(result.result.shuttle.state, 'unknown');
});
