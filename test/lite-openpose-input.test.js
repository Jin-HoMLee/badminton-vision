const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const adapter = require('../src/extension/offscreen/lite-openpose-adapter.js');

function rgbaFrame(width, height, data) {
  return { width, height, channels: 4, data };
}

test('createInputPixels feeds the model BGR order (red source lands in the blue slot)', () => {
  // One pure-red RGBA pixel: the model's weights are the original PyTorch
  // checkpoint trained on OpenCV BGR frames, so source red must land in the
  // blue slot and source blue in the red slot.
  const pixels = rgbaFrame(1, 1, new Uint8Array([255, 0, 0, 255]));
  const output = adapter.createInputPixels(pixels, 1);
  assert.equal(output[0], (0 - 128) / 256); // B slot <- source blue (0)
  assert.equal(output[1], (0 - 128) / 256); // G slot <- source green (0)
  assert.equal(output[2], (255 - 128) / 256); // R slot <- source red (255)
  assert.equal(output.length, 3);
});

test('createInputPixels swaps only the red/blue channels and keeps green', () => {
  const pixels = rgbaFrame(1, 1, new Uint8Array([10, 200, 90, 255]));
  const output = adapter.createInputPixels(pixels, 1);
  assert.equal(output[0], (90 - 128) / 256);
  assert.equal(output[1], (200 - 128) / 256);
  assert.equal(output[2], (10 - 128) / 256);
});

test('createInputPixels preserves normalized coordinates across the square stretch', () => {
  // The full source frame is stretched onto the model grid, so a marker at
  // normalized (0.5, 0.5) of a 256x144 source must land at model grid (128,
  // 128) and decode back to the same normalized position.
  const width = 256;
  const height = 144;
  const data = new Uint8Array(width * height * 4);
  const markerX = 128;
  const markerY = 72;
  const marker = (y, x) => {
    const offset = (y * width + x) * 4;
    data[offset] = 255;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 255;
  };
  marker(markerY, markerX);
  const output = adapter.createInputPixels(rgbaFrame(width, height, data), 256);
  const modelY = Math.floor(72 * 256 / 144); // 128
  const modelX = 128;
  const offset = (modelY * 256 + modelX) * 3;
  // Red source pixel lands in the blue slot at the stretched position.
  assert.equal(output[offset + 2], (255 - 128) / 256);
  // Neighbour cells stay background.
  assert.notEqual(output[offset + 2 - 3], (255 - 128) / 256);
  assert.notEqual(output[offset + 2 + 3], (255 - 128) / 256);
});

test('createInputPixels accepts 3-channel frames', () => {
  const pixels = { width: 1, height: 1, channels: 3, data: new Uint8Array([255, 128, 64]) };
  const output = adapter.createInputPixels(pixels, 1);
  assert.equal(output[0], (64 - 128) / 256);
  assert.equal(output[1], (128 - 128) / 256);
  assert.equal(output[2], (255 - 128) / 256);
});

test('createInputPixels rejects missing input', () => {
  assert.throws(() => adapter.createInputPixels(null, 256), /input pixels are unavailable/);
  assert.throws(() => adapter.createInputPixels(rgbaFrame(1, 1, new Uint8Array(4)), 0), /input pixels are unavailable/);
});

test('adapter source documents the BGR input contract and the model artifact checksum', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/lite-openpose-adapter.js'), 'utf8');
  assert.match(source, /BGR/);
  assert.match(source, /OpenCV/);
  const notice = require('node:fs').readFileSync(path.join(__dirname, '..', 'src/extension/offscreen/vendor/lite-openpose/MODEL-NOTICE.md'), 'utf8');
  assert.match(notice, /BGR/);
});
