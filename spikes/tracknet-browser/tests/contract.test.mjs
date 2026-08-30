import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHeatmaps, preprocessFrames, TemporalWindowBuffer } from '../src/contract.mjs';

function frame(width, height, pixels = []) {
  const data = new Uint8Array(width * height * 4);
  data.fill(7);
  for (const [x, y, r, g, b] of pixels) {
    const i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width, height, data };
}

test('preprocess packs three RGB frames as normalized frame-major planes', () => {
  const values = preprocessFrames([
    frame(2, 1, [[0, 0, 255, 3, 9]]),
    frame(2, 1, [[1, 0, 5, 128, 250]]),
    frame(2, 1),
  ], { width: 2, height: 1 });
  assert.deepEqual(Array.from(values).map((value) => Number(value.toFixed(6))), [1, 7 / 255, 3 / 255, 7 / 255, 9 / 255, 7 / 255, 7 / 255, 5 / 255, 7 / 255, 128 / 255, 7 / 255, 250 / 255, 7 / 255, 7 / 255, 7 / 255, 7 / 255, 7 / 255, 7 / 255].map((value) => Number(value.toFixed(6))));
});

test('preprocess uses nearest-neighbour resize and rejects non-three-frame windows', () => {
  assert.throws(() => preprocessFrames([frame(1, 1)], { width: 1, height: 1 }), /exactly 3 frames/);
  const values = preprocessFrames([frame(1, 1, [[0, 0, 255, 0, 0]]), frame(1, 1), frame(1, 1)], { width: 2, height: 2 });
  assert.equal(values[0], 1);
  assert.equal(values[3], 1);
});

test('decode chooses the largest thresholded component and reports its peak', () => {
  const heatmap = new Float32Array(4 * 5);
  // Two-pixel component at x=1..2 and a one-pixel higher-confidence noise peak.
  heatmap[1 * 5 + 1] = 0.8;
  heatmap[1 * 5 + 2] = 0.7;
  heatmap[3 * 5 + 4] = 0.99;
  const [decoded] = decodeHeatmaps(heatmap, [1, 1, 4, 5]);
  assert.equal(decoded.detected, true);
  assert.equal(decoded.activePixels, 2);
  assert.equal(decoded.x, 1.5);
  assert.equal(decoded.y, 1);
  assert.equal(decoded.peakX, 1);
  assert.equal(decoded.peakY, 1);
  assert.ok(Math.abs(decoded.max - 0.99) < 1e-5);
});

test('decode reports no detection when every value is below threshold', () => {
  const [decoded] = decodeHeatmaps(new Float32Array([0.1, 0.2, 0.3, 0.4]), [1, 1, 2, 2]);
  assert.equal(decoded.detected, false);
  assert.equal(decoded.x, null);
  assert.equal(decoded.y, null);
  assert.equal(decoded.activePixels, 0);
  assert.ok(Math.abs(decoded.max - 0.4) < 1e-5);
});

test('temporal buffer emits rolling windows with explicit media-time semantics', () => {
  const buffer = new TemporalWindowBuffer(3);
  assert.equal(buffer.push('a', 10), null);
  assert.equal(buffer.push('b', 20), null);
  assert.deepEqual(buffer.push('c', 30), {
    frames: ['a', 'b', 'c'], mediaTimes: [10, 20, 30], targetMediaTime: 30, centerMediaTime: 20, initialFrameDelay: 2,
  });
  assert.deepEqual(buffer.push('d', 40).frames, ['b', 'c', 'd']);
  buffer.reset();
  assert.equal(buffer.push('e', 50), null);
});
