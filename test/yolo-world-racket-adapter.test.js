const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const adapter = require('../src/extension/offscreen/yolo-world-racket-adapter.js');

function yoloIdentity() {
  return { id: adapter.MODEL.id, version: 1, kind: adapter.MODEL.kind, productionModel: false, detectionMethod: 'yolo-world-open-vocab-racket' };
}

function frame(width = 64, height = 36) {
  return { width, height, data: new Uint8Array(width * height * 4), close() { this.closed = true; } };
}

// A flat YOLO-style output buffer (8400 predictions x 85 floats) with one
// confident racket-like detection centered on the frame.
function outputWithDetection(confidence = 0.9, { x = 32, y = 18, w = 10, h = 10 } = {}) {
  const data = new Float32Array(adapter.MODEL.outputPredictionCount * adapter.MODEL.outputStride);
  const base = 0 * adapter.MODEL.outputStride;
  data[base] = x;
  data[base + 1] = y;
  data[base + 2] = w;
  data[base + 3] = h;
  data[base + 4] = confidence;
  return data;
}

function ortHarness({ fetchImpl, outputData = null, runThrows = null, createThrows = null } = {}) {
  class Tensor {
    constructor(type, data, dims) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
    dispose() {}
  }
  const session = {
    released: false,
    async run() {
      if (runThrows) throw new Error(runThrows);
      return { output0: { data: outputData } };
    },
    release() { this.released = true; }
  };
  const ort = {
    Tensor,
    env: { wasm: {} },
    InferenceSession: {
      async create() {
        if (createThrows) throw new Error(createThrows);
        return session;
      }
    }
  };
  const environment = {
    ort,
    location: { href: 'chrome-extension://test/offscreen/offscreen.html' },
    URL,
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }))
  };
  return { ort, session, environment };
}

test('the experimental artifact is not part of the default package but its license records are committed', () => {
  const notice = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/vendor/yolo-world/MODEL-NOTICE.md'), 'utf8');
  const license = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/vendor/yolo-world/LICENSE'), 'utf8');
  assert.match(notice, /EXPERIMENTAL/);
  assert.match(notice, /AGPL-3\.0/);
  assert.match(notice, /Ultralytics/);
  assert.match(notice, /never the default/);
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  // The artifact itself must not be committed to the default package.
  assert.equal(fs.existsSync(path.join(ROOT, 'src/extension/offscreen/vendor/yolo-world/yolo_world_s_open_vocab.onnx')), false);
});

test('model identity documents the AGPL-3.0 experimental provenance and the evidence marker', () => {
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment: { ort: {} } });
  assert.equal(analyzer.identity.id, 'yolo-world-racket-detector-v1');
  assert.equal(analyzer.identity.license, 'AGPL-3.0');
  assert.equal(analyzer.identity.licenseStatus, 'agpl-3.0-experimental-source-disclosure');
  assert.equal(analyzer.identity.productionModel, false);
  assert.equal(analyzer.identity.experimental, true);
  assert.equal(analyzer.identity.detectionMethod, 'yolo-world-open-vocab-racket');
  assert.match(analyzer.identity.measuredPerFrame, /2-6 s\/frame/);
  assert.deepEqual(analyzer.identity.prompts, ['badminton racket', 'racket', 'player\'s racket', 'racquet']);
});

test('input preparation resizes RGBA frames to the 640px grid normalized to [0,1]', () => {
  const pixels = { width: 64, height: 64, channels: 4, data: new Uint8Array(64 * 64 * 4) };
  pixels.data.fill(255); // opaque white everywhere
  const input = adapter.createYoloInputPixels(pixels);
  assert.equal(input.length, 640 * 640 * 3);
  assert.equal(input[0], 1);
  // Allocating white at the top-left means the first row is entirely 1.0.
  assert.equal(input[640 * 3 - 1], 1);
  // Bounded allocation and deterministic length for a different size.
  const red = { width: 1, height: 1, channels: 4, data: new Uint8Array([255, 0, 0, 255]) };
  const one = adapter.createYoloInputPixels(red);
  assert.equal(one.length, 640 * 640 * 3);
  assert.equal(one[0], 1);
  assert.equal(one[1], 0);
  assert.equal(one[2], 0);
  assert.throws(() => adapter.createYoloInputPixels({ width: 0, height: 1, channels: 4, data: new Uint8Array(4) }), TypeError);
});

test('IoU computation handles overlap, disjoint, containment, and degenerate boxes', () => {
  assert.equal(adapter.computeIoU({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }), 1);
  assert.equal(adapter.computeIoU({ x: 0, y: 0, width: 0.1, height: 0.1 }, { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }), 0);
  // Contained box: IoU = area(inner) / area(outer).
  const contained = adapter.computeIoU({ x: 0, y: 0, width: 0.4, height: 0.4 }, { x: 0.1, y: 0.1, width: 0.1, height: 0.1 });
  assert.ok(Math.abs(contained - 0.0625) < 1e-9);
  assert.equal(adapter.computeIoU(null, { x: 0, y: 0, width: 0.1, height: 0.1 }), 0);
  assert.equal(adapter.computeIoU({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0.1, height: 0.1 }), 0);
});

test('processDetections filters by confidence, normalizes, sorts, and applies NMS', () => {
  const imageWidth = 640;
  const imageHeight = 360;
  const detections = adapter.processDetections([
    [100, 100, 50, 50, 0.9],
    [110, 105, 52, 48, 0.88], // overlapping with the first -> NMS-suppressed
    [500, 200, 30, 30, 0.8], // distinct -> kept
    [300, 300, 30, 30, 0.2] // below threshold -> dropped
  ], imageWidth, imageHeight, { confidenceThreshold: 0.5, iouThreshold: 0.45, maxDetections: 4 });
  assert.equal(detections.length, 2);
  assert.equal(detections[0].confidence, 0.9);
  assert.equal(detections[1].confidence, 0.8);
  assert.ok(detections.every((d) => d.bbox.x >= 0 && d.bbox.y >= 0 && d.bbox.width <= 1 && d.bbox.height <= 1));
});

test('processDetections rejects malformed input and respects maxDetections', () => {
  assert.deepEqual(adapter.processDetections([], 640, 360), []);
  assert.deepEqual(adapter.processDetections([{ not: 'an array' }], 640, 360), []);
  assert.deepEqual(adapter.processDetections([[1, 2]], 640, 360), []);
  const many = [];
  for (let i = 0; i < 10; i += 1) many.push([50, 50, 10, 10, 0.9]); // identical boxes collapse under NMS
  const limited = adapter.processDetections(many, 640, 360, { maxDetections: 2 });
  assert.equal(limited.length, 1); // the overlapping cluster collapses to one
  // Distinct boxes stop at maxDetections after the confidence sort.
  const distinct = adapter.processDetections([
    [100, 100, 40, 40, 0.9], [200, 100, 40, 40, 0.85], [300, 100, 40, 40, 0.8], [400, 100, 40, 40, 0.75]
  ], 640, 360, { maxDetections: 2 });
  assert.equal(distinct.length, 2);
});

test('parseYoloOutput keeps only predictions with positive confidence and emits normalized rows', () => {
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment: { ort: {} } });
  const buffer = new Float32Array(adapter.MODEL.outputPredictionCount * adapter.MODEL.outputStride);
  buffer[0 * adapter.MODEL.outputStride + 4] = 0.7;
  buffer[3 * adapter.MODEL.outputStride + 4] = -0.2;
  const rows = analyzer.parseYoloOutput(Array.from(buffer));
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(rows[0][4] - 0.7) < 1e-6);
  assert.equal(rows[0].length, 5);
});

test('a completed run with a confident detection emits tracked racket evidence in the shared envelope', async () => {
  const { environment, session } = ortHarness({ outputData: outputWithDetection(0.9) });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const result = await analyzer.analyze({
    sessionId: 's1', requestId: 'r1', mediaTime: 12.5,
    frame: frame(64, 36)
  });
  assert.equal(result.state, 'tracked');
  assert.equal(result.detectionMethod, 'yolo-world-open-vocab-racket');
  assert.equal(result.reason, 'open-vocabulary-racket-detections');
  assert.equal(result.detections.length, 1);
  assert.equal(result.detections[0].confidence, 0.9);
  assert.ok(result.detections[0].bbox.x >= 0 && result.detections[0].bbox.x <= 1);
  assert.equal(result.detector.id, adapter.MODEL.id);
  assert.equal(result.sessionId, 's1');
  assert.equal(result.requestId, 'r1');
  assert.equal(result.mediaTime, 12.5);
  assert.equal(result.segmentationAvailable, false);
  assert.ok(session.released === false); // still active for the next frame
});

test('a completed run that finds no racket keeps the detector marker as an honest unknown', async () => {
  const { environment } = ortHarness({ outputData: new Float32Array(adapter.MODEL.outputPredictionCount * adapter.MODEL.outputStride) });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const result = await analyzer.analyze({ sessionId: 's2', requestId: 'r2', mediaTime: 1, frame: frame() });
  assert.equal(result.state, 'unknown');
  assert.equal(result.detectionMethod, 'yolo-world-open-vocab-racket'); // the model ran and answered
  assert.equal(result.reason, 'no-yolo-world-racket-detection');
  assert.deepEqual(result.detections, []);
});

test('a missing prepared artifact is an explicit unavailable state with no detector marker', async () => {
  const { environment } = ortHarness({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const result = await analyzer.analyze({ sessionId: 's3', requestId: 'r3', mediaTime: 2, frame: frame() });
  assert.equal(result.state, 'unknown');
  assert.equal(result.detectionMethod, null); // no completed run: proxy stays
  assert.equal(result.reason, 'yolo-world-artifact-not-bundled');
});

test('a missing ONNX Runtime Web runtime is an explicit unavailable state', async () => {
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment: { location: { href: 'chrome-extension://test/offscreen/offscreen.html' }, URL } });
  const initialized = await analyzer.initialize();
  assert.equal(initialized.available, false);
  assert.equal(initialized.reason, 'yolo-world-runtime-not-bundled');
  const result = await analyzer.analyze({ sessionId: 's4', requestId: 'r4', mediaTime: 3, frame: frame() });
  assert.equal(result.detectionMethod, null);
});

test('resolveOnnxRuntime accepts a document ort global and reports when none is bundled', async () => {
  const ort = { env: { wasm: {} }, InferenceSession: {} };
  const withOrt = await adapter.resolveOnnxRuntime({ ort });
  assert.equal(withOrt.ort, ort);
  const without = await adapter.resolveOnnxRuntime({ location: { href: 'chrome-extension://test/offscreen/offscreen.html' }, URL });
  assert.equal(without.ort, null);
  assert.equal(without.reason, 'yolo-world-runtime-not-bundled');
});

test('invalid media times are refused before inference and a run exception drops the session for retry', async () => {
  const { environment, session, ort } = ortHarness({ outputData: outputWithDetection(), runThrows: 'device-lost' });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const invalid = await analyzer.analyze({ sessionId: 's5', requestId: 'r5', mediaTime: -1, frame: frame() });
  assert.equal(invalid.state, 'unknown');
  assert.equal(invalid.detectionMethod, null);
  assert.equal(invalid.reason, 'invalid-media-time');
  // Run exception: no authoritative evidence and the failed session is dropped.
  const failed = await analyzer.analyze({ sessionId: 's6', requestId: 'r6', mediaTime: 4, frame: frame() });
  assert.equal(failed.state, 'unknown');
  assert.equal(failed.detectionMethod, null);
  assert.match(failed.reason, /device-lost/);
  assert.equal(session.released, true);
  // The next frame initializes a fresh session (the ort harness returns a new one).
  const session2 = { released: false, async run() { return { output0: { data: outputWithDetection() } }; }, release() { this.released = true; } };
  ort.InferenceSession.create = async () => session2;
  const recovered = await analyzer.analyze({ sessionId: 's6', requestId: 'r6', mediaTime: 5, frame: frame() });
  assert.equal(recovered.state, 'tracked');
  assert.equal(recovered.detectionMethod, 'yolo-world-open-vocab-racket');
});

test('racketDetection clamps and normalizes bounding boxes', () => {
  const detection = adapter.racketDetection({ x: -0.4, y: 2, width: 3, height: -1 }, 1.7, 'racket-0');
  assert.equal(detection.bbox.x, 0);
  assert.equal(detection.bbox.y, 1);
  assert.equal(detection.bbox.width, 1);
  assert.equal(detection.bbox.height, 0);
  assert.equal(detection.confidence, 1);
  assert.equal(detection.source, 'yolo-world-racket-detector');
});
