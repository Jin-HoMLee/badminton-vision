const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
global.BSOProtocol = protocol;
global.BSOCapabilities = {
  detectCapture(video, environment) {
    const bitmap = typeof environment.createImageBitmap === 'function';
    const callback = typeof video.requestVideoFrameCallback === 'function';
    return {
      mode: callback && bitmap ? 'request-video-frame-callback' : bitmap ? 'timer-fallback' : 'unavailable',
      available: bitmap,
      fallback: callback ? null : 'requestVideoFrameCallback-unavailable'
    };
  }
};
const { VideoCapture } = require('../src/extension/content/capture.js');

function tick(ms = 0) {
  return ms ? new Promise((resolve) => setTimeout(resolve, ms)) : new Promise((resolve) => setImmediate(resolve));
}

test('timer fallback captures ImageBitmap samples and reports bounded backpressure', async () => {
  let resolveBitmap;
  let createCalls = 0;
  const bitmapPromise = new Promise((resolve) => { resolveBitmap = resolve; });
  const sent = [];
  const statuses = [];
  const video = { currentTime: 9, videoWidth: 320, videoHeight: 180 };
  const frame = { width: 320, height: 180, close() { this.closed = true; } };
  const capture = new VideoCapture({
    video,
    sessionId: 'timer-session',
    sendSample: (...args) => sent.push(args),
    onStatus: (status) => statuses.push(status),
    environment: { createImageBitmap: () => { createCalls += 1; return bitmapPromise; } },
    fallbackIntervalMs: 1,
    minWallIntervalMs: 0,
    minMediaIntervalSeconds: 0,
    maxInFlight: 1
  });
  capture.start();
  await tick(8);
  assert.equal(capture.mode, 'timer-fallback');
  assert.equal(createCalls, 1);
  assert.equal(statuses.some((status) => status.status === 'backpressure'), true);
  resolveBitmap(frame);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  capture.stop();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].frameFormat, 'image-bitmap');
  assert.deepEqual(sent[0][1], [frame]);
});

test('stable transport fallback sends serializable pixels and releases the source bitmap', async () => {
  let callback;
  const sent = [];
  const statuses = [];
  const sourceFrame = { width: 640, height: 360, close() { this.closed = true; } };
  const video = {
    currentTime: 3,
    videoWidth: 640,
    videoHeight: 360,
    requestVideoFrameCallback(fn) { callback = fn; return 1; }
  };
  const capture = new VideoCapture({
    video,
    sessionId: 'stable-session',
    sendSample: (...args) => sent.push(args),
    onStatus: (status) => statuses.push(status),
    environment: { createImageBitmap: async () => sourceFrame },
    frameTransport: 'rgba-array-v1',
    prepareFrame: async (frame) => ({
      frame: { width: 2, height: 1, data: [1, 2, 3, 255, 4, 5, 6, 255] },
      frameFormat: 'rgba-array-v1',
      transferables: [],
      releaseSource: true
    }),
    minWallIntervalMs: 0,
    minMediaIntervalSeconds: 0
  });
  capture.start();
  callback(100, { mediaTime: 3.1, width: 640, height: 360 });
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].frameFormat, 'rgba-array-v1');
  assert.deepEqual(sent[0][1], []);
  assert.equal(sourceFrame.closed, true);
  assert.equal(statuses[0].frameTransport, 'rgba-array-v1');
  capture.stop();
});

test('queued frame callback cannot mutate playback or create a second in-flight bitmap', async () => {
  let callback;
  let createCalls = 0;
  let resolveBitmap;
  const pending = new Promise((resolve) => { resolveBitmap = resolve; });
  const statuses = [];
  const values = { currentTime: 3, paused: false, muted: false, playbackRate: 1, src: 'fixture' };
  const video = new Proxy({
    videoWidth: 640,
    videoHeight: 360,
    requestVideoFrameCallback(fn) { callback = fn; return 1; }
  }, {
    get(target, property) {
      return property in values ? values[property] : target[property];
    },
    set() {
      throw new Error('capture must not assign playback properties');
    }
  });
  const capture = new VideoCapture({
    video,
    sessionId: 'callback-session',
    onStatus: (status) => statuses.push(status),
    environment: { createImageBitmap: () => { createCalls += 1; return pending; } },
    minWallIntervalMs: 0,
    minMediaIntervalSeconds: 0,
    maxInFlight: 1
  });
  capture.start();
  const firstCallback = callback;
  firstCallback(100, { mediaTime: 3.1, width: 640, height: 360 });
  const secondCallback = callback;
  secondCallback(101, { mediaTime: 3.2, width: 640, height: 360 });
  assert.equal(createCalls, 1);
  assert.equal(statuses.some((status) => status.status === 'backpressure'), true);
  assert.deepEqual({ currentTime: video.currentTime, paused: video.paused, muted: video.muted, playbackRate: video.playbackRate, src: video.src }, values);
  resolveBitmap({ width: 640, height: 360 });
  await tick();
  capture.stop();
});
