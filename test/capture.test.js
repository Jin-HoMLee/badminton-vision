const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
global.BSOProtocol = protocol;
global.BSOCapabilities = {
  detectCapture(video, environment) {
    return {
      mode: typeof video.requestVideoFrameCallback === 'function' && typeof environment.createImageBitmap === 'function'
        ? 'request-video-frame-callback' : 'unavailable',
      available: true,
      fallback: null
    };
  }
};
const { VideoCapture } = require('../src/extension/content/capture.js');

test('video capture samples requestVideoFrameCallback media timestamps without controlling playback', async () => {
  let callback;
  const sent = [];
  const statuses = [];
  const video = {
    currentTime: 7,
    videoWidth: 640,
    videoHeight: 360,
    requestVideoFrameCallback(fn) { callback = fn; return 1; }
  };
  const frame = { kind: 'ImageBitmap' };
  const capture = new VideoCapture({
    video,
    sessionId: 'session-1',
    sendSample: (...args) => sent.push(args),
    onStatus: (status) => statuses.push(status),
    environment: { createImageBitmap: async () => frame },
    minWallIntervalMs: 0,
    minMediaIntervalSeconds: 0
  });
  capture.start();
  assert.equal(typeof callback, 'function');
  callback(100, { mediaTime: 7.25, width: 640, height: 360 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].mediaTime, 7.25);
  assert.deepEqual(sent[0][1], [frame]);
  assert.equal(statuses[0].mode, 'request-video-frame-callback');
  capture.stop();
});
