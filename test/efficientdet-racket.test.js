const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const adapter = require('../src/extension/offscreen/efficientdet-racket-adapter.js');

const MODEL = adapter.MODEL;
const DEFAULTS = adapter.DEFAULTS;
const ROOT = path.join(__dirname, '..');

test('vendored EfficientDet racket artifact is present with a recorded notice and checksum', () => {
  const modelPath = path.join(ROOT, 'src/extension/offscreen/vendor/efficientdet-lite0/efficientdet_lite0.tflite');
  const stats = fs.statSync(modelPath);
  assert.ok(stats.size > 5000000, 'float16 artifact must be present');
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'),
    '4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993'
  );
  const notice = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/vendor/efficientdet-lite0/MODEL-NOTICE.md'), 'utf8');
  assert.match(notice, /Apache-2\.0/);
  assert.match(notice, /SHA-256/);
  assert.match(notice, /storage\.googleapis\.com\/mediapipe-models/);
  assert.match(notice, /tennis racket/);
  const license = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/vendor/efficientdet-lite0/LICENSE'), 'utf8');
  assert.match(license, /Apache License/);
  // The racket fixture used by the real-model gate is committed beside the
  // pose fixture and its provenance is recorded in the model notice.
  assert.ok(fs.statSync(path.join(ROOT, 'test/fixtures/racket-sample-256.bmp')).size > 100000);
});

test('model identity documents the cleared artifact and strict tennis-racket class filter', () => {
  assert.equal(MODEL.id, 'efficientdet-lite0-racket-v1');
  assert.equal(MODEL.licenseStatus, 'cleared-for-redistribution');
  assert.equal(MODEL.racketClassIndex, 42);
  assert.equal(MODEL.racketClassName, 'tennis racket');
  assert.equal(MODEL.classCount, 90);
  assert.equal(MODEL.anchorCount, 19206);
  assert.equal(DEFAULTS.confidenceThreshold, 0.53);
});

test('anchor generator reproduces the EfficientDet-Lite0 fixed-anchor geometry', () => {
  const anchors = adapter.generateAnchors();
  assert.equal(anchors.count, 19206);
  // Level blocks ascend level 3..7 with grids 40/20/10/5/3 (9 anchors/cell).
  assert.deepEqual(anchors.perLevel.map((level) => level.length / 4), [14400, 3600, 900, 225, 81]);
  // First anchor: level-3 first cell center (4, 4) with the smallest scale
  // octave at aspect 1.0 -> 24px box.
  assert.deepEqual(Array.from(anchors.flat.slice(0, 4)), [-8, -8, 16, 16]);
  // The last block ends at the level-7 last cell center (266.67, 266.67)
  // with the largest scale octave at aspect 0.5 (718px tall x 359px wide).
  const last = Array.from(anchors.flat.slice(-4));
  assert.ok(Math.abs(last[0] + 92.5212) < 0.001, `level-7 ymin ${last[0]}`);
  assert.ok(Math.abs(last[1] - 87.0727) < 0.001, `level-7 xmin ${last[1]}`);
  assert.ok(Math.abs(last[2] - 625.8545) < 0.001, `level-7 ymax ${last[2]}`);
  assert.ok(Math.abs(last[3] - 446.2606) < 0.001, `level-7 xmax ${last[3]}`);
  // Spot values equal the artifact's embedded DETECTOR_METADATA anchors
  // (normalized): anchor 0 is (y,x,h,w) = (0.0125, 0.0125, 0.075, 0.075).
  const normalized = (index) => {
    const offset = index * 4;
    const yMin = anchors.flat[offset];
    const xMin = anchors.flat[offset + 1];
    const yMax = anchors.flat[offset + 2];
    const xMax = anchors.flat[offset + 3];
    return [(yMin + yMax) / 2 / 320, (xMin + xMax) / 2 / 320, (yMax - yMin) / 320, (xMax - xMin) / 320];
  };
  assert.deepEqual(normalized(0).map((value) => Math.round(value * 1e6) / 1e6), [0.0125, 0.0125, 0.075, 0.075]);
  const lastNormalized = normalized(19205);
  assert.ok(Math.abs(lastNormalized[0] - 0.833333) < 1e-5);
  assert.ok(Math.abs(lastNormalized[2] - 2.244924) < 1e-4);
  assert.ok(Math.abs(lastNormalized[3] - 1.122462) < 1e-4);
});

test('createInputPixels normalizes RGBA with the artifact input contract (pixel - 127.5) / 127.5', () => {
  const pixels = { width: 1, height: 1, channels: 4, data: new Uint8Array([255, 128, 0, 255]) };
  const output = adapter.createInputPixels(pixels, 1);
  assert.equal(output.length, 3);
  assert.equal(output[0], Math.fround((255 - 127.5) / 127.5));
  assert.equal(output[1], Math.fround((128 - 127.5) / 127.5));
  assert.equal(output[2], Math.fround((0 - 127.5) / 127.5));
  // Red source pixels stay in the red slot (RGB contract, unlike the BGR
  // Lightweight OpenPose artifact) and negative-free values map to [-1, 1].
  assert.ok(output[0] > 0 && output[2] < 0 && output[0] <= 1 && output[2] >= -1);
});

test('createInputPixels keeps channel order and bounds a truncated buffer', () => {
  const pixels = { width: 2, height: 2, channels: 4, data: new Uint8Array(2 * 2 * 4) };
  pixels.data.fill(10);
  const output = adapter.createInputPixels(pixels, 2);
  assert.equal(output.length, 12);
  assert.equal(output[0], output[2]); // red and blue slots both derive from their own channels
  assert.throws(() => adapter.createInputPixels({ width: 2, height: 2, channels: 4, data: new Uint8Array(4) }), /truncated/);
  assert.throws(() => adapter.createInputPixels(null, 320), /input pixels are unavailable/);
});

test('decode emits nothing when no tennis-racket class score clears the threshold', () => {
  const anchors = adapter.generateAnchors();
  const scores = new Float32Array(anchors.count * 90);
  const boxes = new Float32Array(anchors.count * 4);
  const result = adapter.decodeEfficientDetOutput({ scores, boxes });
  assert.deepEqual(result.detections, []);
});

test('decode class filter never relabels another COCO class as a racket', () => {
  // Regression guard for the class-filter bug: a high-confidence "person"
  // (class 0) or "sports ball" (class 36) prediction with a weak tennis-racket
  // score must not be emitted as a racket detection.
  const anchors = adapter.generateAnchors();
  const boxes = new Float32Array(anchors.count * 4);
  const scores = new Float32Array(anchors.count * 90);
  scores[0 * 90 + 0] = 8; // person: sigmoid(8) ~ 0.9997
  scores[1 * 90 + 36] = 7; // sports ball
  scores[0 * 90 + 42] = -4; // tennis racket class stays cold
  const result = adapter.decodeEfficientDetOutput({ scores, boxes });
  assert.deepEqual(result.detections, []);
  // A warm tennis-racket class at the same anchor is the only thing emitted.
  scores[0 * 90 + 42] = 2; // sigmoid(2) ~ 0.881
  const emitted = adapter.decodeEfficientDetOutput({ scores, boxes }).detections;
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].class, 'tennis racket');
  assert.equal(emitted[0].classIndex, 42);
  assert.ok(Math.abs(emitted[0].confidence - 0.880797) < 0.001);
});

test('decode anchors a racket detection to its anchor box and applies NMS', () => {
  const anchors = adapter.generateAnchors();
  const boxes = new Float32Array(anchors.count * 4);
  const scores = new Float32Array(anchors.count * 90);
  // A strong response on two adjacent level-3 anchors decodes to nearby boxes
  // that NMS collapses to the stronger detection.
  scores[0 * 90 + 42] = 4;
  scores[1 * 90 + 42] = 3.5;
  const result = adapter.decodeEfficientDetOutput({ scores, boxes });
  assert.equal(result.detections.length, 1);
  const detection = result.detections[0];
  assert.ok(detection.confidence > 0.9);
  assert.ok(detection.bbox.width > 0 && detection.bbox.height > 0);
  assert.ok(detection.bbox.x >= 0 && detection.bbox.y >= 0);
  assert.ok(detection.bbox.x + detection.bbox.width <= 1);
  assert.ok(detection.bbox.y + detection.bbox.height <= 1);
  // Far-apart anchors survive NMS independently.
  scores[(40 * 40 * 9 - 1) * 90 + 42] = 4; // last level-3 anchor
  const two = adapter.decodeEfficientDetOutput({ scores, boxes });
  assert.equal(two.detections.length, 2);
});

test('decode rejects malformed outputs and out-of-range parameters', () => {
  const anchors = adapter.generateAnchors();
  assert.throws(() => adapter.decodeEfficientDetOutput({ scores: new Float32Array(3), boxes: new Float32Array(anchors.count * 4) }), /class output length/);
  assert.throws(() => adapter.decodeEfficientDetOutput({ scores: new Float32Array(anchors.count * 90), boxes: new Float32Array(2) }), /box output length/);
  assert.throws(() => adapter.decodeEfficientDetOutput({ scores: new Float32Array(anchors.count * 90), boxes: new Float32Array(anchors.count * 4), confidenceThreshold: 1.5 }), /confidence threshold/);
  assert.throws(() => adapter.decodeEfficientDetOutput({ scores: new Float32Array(anchors.count * 90), boxes: new Float32Array(anchors.count * 4), classIndex: 90 }), /class index/);
});
