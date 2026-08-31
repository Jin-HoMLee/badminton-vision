const test = require('node:test');
const assert = require('node:assert/strict');
const frameTransport = require('../src/extension/common/frame-transport.js');
const protocol = require('../src/extension/common/protocol.js');

test('stable-channel transport selects serializable RGBA without manifest warning', () => {
  const chromeApi = { runtime: { getManifest: () => ({ manifest_version: 3 }) } };
  assert.equal(frameTransport.supportsStructuredClone(chromeApi), false);
  assert.equal(frameTransport.selectTransport(chromeApi), 'rgba-array-v1');
});

test('explicit structured-clone capability retains the ImageBitmap path', () => {
  const chromeApi = { runtime: { getManifest: () => ({ message_serialization: 'structured_clone' }) } };
  assert.equal(frameTransport.supportsStructuredClone(chromeApi), true);
  assert.equal(frameTransport.selectTransport(chromeApi), 'image-bitmap');
});

test('stable fallback converts the captured bitmap to bounded plain RGBA data', async () => {
  let drawn;
  class FakeCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return {
        drawImage(...args) { drawn = args; },
        getImageData: () => ({
          width: 2,
          height: 1,
          data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 10, 20, 255])
        })
      };
    }
  }
  const bitmap = { width: 1920, height: 1080 };
  const prepared = await frameTransport.prepareFrame(bitmap, {
    mode: 'rgba-array-v1',
    maxPixels: 2,
    environment: { OffscreenCanvas: FakeCanvas }
  });

  assert.equal(prepared.frameFormat, 'rgba-array-v1');
  assert.deepEqual(prepared.transferables, []);
  assert.equal(prepared.releaseSource, true);
  assert.deepEqual(prepared.sourceDimensions, { width: 1920, height: 1080 });
  assert.deepEqual(prepared.frame, {
    width: 2,
    height: 1,
    data: [255, 0, 0, 255, 0, 10, 20, 255]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.frame)), prepared.frame);
  assert.equal(drawn[0], bitmap);
  assert.equal(drawn[3], 2);
  assert.equal(drawn[4], 1);

  const sample = protocol.createFrameSample({
    sessionId: 'stable-session',
    requestId: 'stable-session:1',
    mediaTime: 1,
    capturedAt: 2,
    width: prepared.frame.width,
    height: prepared.frame.height,
    frame: prepared.frame,
    frameFormat: prepared.frameFormat
  });
  assert.deepEqual(sample.transferables, []);
  assert.equal(protocol.isFrameSample(sample.message), true);
});
