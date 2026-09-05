const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const adapter = require('../src/extension/offscreen/yolo-world-racket-adapter.js');

// The baked-artifact contract the tests exercise: output0 dims
// [1, 4 + vocabulary, 8400] (channel-major), box coordinates in 640-grid
// pixels, one sigmoid class score per baked racket-synonym vocabulary entry.
const VOCABULARY = adapter.DEFAULTS.prompts.length;
const ANCHORS = adapter.MODEL.outputAnchorCount;
const CHANNELS = adapter.MODEL.boxCoordinates + VOCABULARY;
const DIMS = [1, CHANNELS, ANCHORS];
const PLANE = 640 * 640;

function yoloIdentity() {
  return { id: adapter.MODEL.id, version: 1, kind: adapter.MODEL.kind, productionModel: false, detectionMethod: 'yolo-world-open-vocab-racket' };
}

function frame(width = 64, height = 36) {
  return { width, height, data: new Uint8Array(width * height * 4), close() { this.closed = true; } };
}

// A vocabulary-baked `output0` tensor with one confident racket-synonym
// prediction at `anchor`. Box channels 0-3 carry cx/cy/w/h in the model's
// 640x640 input grid; class channels 4+ carry the baked racket-synonym scores.
function outputWithDetection(confidence = 0.9, { anchor = 0, x = 432, y = 320, w = 96, h = 128, classChannel = 4 } = {}) {
  const data = new Float32Array(CHANNELS * ANCHORS);
  const put = (channel, value) => { data[channel * ANCHORS + anchor] = value; };
  put(0, x);
  put(1, y);
  put(2, w);
  put(3, h);
  put(classChannel, confidence);
  return { data, dims: DIMS };
}

function emptyOutput() {
  return { data: new Float32Array(CHANNELS * ANCHORS), dims: DIMS };
}

function ortHarness({ fetchImpl = null, outputTensor = emptyOutput(), runThrows = null, createThrows = null, sessionInputNames = ['images'], sessionOutputNames = ['output0'], createSession = null } = {}) {
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
    inputNames: sessionInputNames,
    outputNames: sessionOutputNames,
    async run() {
      if (runThrows) throw new Error(runThrows);
      return { output0: outputTensor };
    },
    release() { this.released = true; }
  };
  const ort = {
    Tensor,
    env: { wasm: {} },
    InferenceSession: {
      async create() {
        if (createThrows) throw new Error(createThrows);
        if (createSession) return createSession();
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
  assert.match(notice, /set_classes/);
  assert.match(notice, /8400/);
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  // The artifact itself must not be committed to the default package.
  assert.equal(fs.existsSync(path.join(ROOT, 'src/extension/offscreen/vendor/yolo-world/yolo_world_s_open_vocab.onnx')), false);
});

test('model identity documents the AGPL-3.0 experimental provenance, the baked vocabulary, and the evidence marker', () => {
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment: { ort: {} } });
  assert.equal(analyzer.identity.id, 'yolo-world-racket-detector-v1');
  assert.equal(analyzer.identity.license, 'AGPL-3.0');
  assert.equal(analyzer.identity.licenseStatus, 'agpl-3.0-experimental-source-disclosure');
  assert.equal(analyzer.identity.productionModel, false);
  assert.equal(analyzer.identity.experimental, true);
  assert.equal(analyzer.identity.detectionMethod, 'yolo-world-open-vocab-racket');
  assert.match(analyzer.identity.measuredPerFrame, /2-6 s\/frame/);
  assert.deepEqual(analyzer.identity.prompts, ['badminton racket', 'racket', 'player\'s racket', 'racquet']);
  assert.deepEqual(adapter.MODEL.inputShape, [1, 3, 640, 640], 'the images input is the standard NCHW export layout');
  assert.equal(adapter.MODEL.inputName, 'images');
  assert.equal(adapter.MODEL.outputName, 'output0');
});

test('input preparation produces planar NCHW 640x640 [0,1] pixels independent of source geometry', () => {
  const white = { width: 64, height: 36, channels: 4, data: new Uint8Array(64 * 36 * 4) };
  white.data.fill(255); // opaque white everywhere
  const input = adapter.createYoloInputPixels(white);
  assert.equal(input.length, 640 * 640 * 3);
  assert.equal(input[0], 1);
  assert.equal(input[PLANE - 1], 1); // end of the red plane is still white
  assert.equal(input[PLANE], 1); // the green plane starts at the plane offset
  assert.equal(input[3 * PLANE - 1], 1); // the blue plane ends at the last pixel
  assert.throws(() => adapter.createYoloInputPixels({ width: 0, height: 1, channels: 4, data: new Uint8Array(4) }), TypeError);
});

test('input preparation writes channel-major planes, not interleaved NHWC pixels', () => {
  // A 2x1 source row: red pixel then green pixel. Grid x=0 samples the red
  // pixel; grid x=320 lands exactly on the green pixel (source x = x * 2 / 640).
  const redGreen = { width: 2, height: 1, channels: 4, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) };
  const input = adapter.createYoloInputPixels(redGreen);
  assert.equal(input.length, 3 * PLANE);
  assert.equal(input[0], 1, 'red channel of the first grid pixel (pure red source sample)');
  assert.equal(input[PLANE], 0, 'the green channel lives at the plane offset, not at index 1');
  assert.equal(input[2 * PLANE], 0, 'the blue channel lives at the second plane offset');
  assert.equal(input[320], 0, 'red channel is 0 at the green source pixel (x=320)');
  assert.equal(input[PLANE + 320], 1, 'green channel is 1 at the green source pixel (x=320)');
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

test('processDetections normalizes model-grid coordinates (dividing by the grid, never the source frame)', () => {
  // All rows are in the model's 640x640 grid. A racket spanning source x
  // 0.60-0.75 / y 0.40-0.60 appears at grid center (432, 320) with size
  // (96, 128); unscale by 640, not by any source pixel dimension.
  const detections = adapter.processDetections([
    [432, 320, 96, 128, 0.9],
    [448, 328, 100, 120, 0.88], // overlaps the first -> NMS-suppressed
    [96, 480, 32, 32, 0.8], // distinct -> kept
    [320, 320, 32, 32, 0.2] // below the confidence threshold -> dropped
  ], adapter.DEFAULTS.inputResolution, { confidenceThreshold: 0.5, iouThreshold: 0.45, maxDetections: 4 });
  assert.equal(detections.length, 2);
  assert.equal(detections[0].confidence, 0.9);
  assert.deepEqual(detections[0].bbox, { x: 0.6, y: 0.4, width: 0.15, height: 0.2 });
  assert.equal(detections[1].confidence, 0.8);
  assert.equal(detections[1].bbox.x, 0.125);
  assert.equal(detections[1].bbox.y, 0.725);
  assert.ok(detections.every((d) => d.bbox.x >= 0 && d.bbox.y >= 0 && d.bbox.width <= 1 && d.bbox.height <= 1));
});

test('processDetections rejects malformed input and respects maxDetections', () => {
  assert.deepEqual(adapter.processDetections([], 640), []);
  assert.deepEqual(adapter.processDetections([{ not: 'an array' }], 640), []);
  assert.deepEqual(adapter.processDetections([[1, 2]], 640), []);
  const many = [];
  for (let i = 0; i < 10; i += 1) many.push([50, 50, 10, 10, 0.9]); // identical boxes collapse under NMS
  const limited = adapter.processDetections(many, 640, { maxDetections: 2 });
  assert.equal(limited.length, 1); // the overlapping cluster collapses to one
  // Distinct boxes stop at maxDetections after the confidence sort.
  const distinct = adapter.processDetections([
    [100, 100, 40, 40, 0.9], [200, 100, 40, 40, 0.85], [300, 100, 40, 40, 0.8], [400, 100, 40, 40, 0.75]
  ], 640, { maxDetections: 2 });
  assert.equal(distinct.length, 2);
});

test('decodeYoloOutput reads the channel-major tensor and takes the best baked racket-synonym score', () => {
  const data = new Float32Array(CHANNELS * ANCHORS);
  const put = (anchor, channel, value) => { data[channel * ANCHORS + anchor] = value; };
  // Anchor 0: box center (320, 320), synonyms 4..7 with the fourth winning.
  put(0, 0, 320);
  put(0, 1, 320);
  put(0, 2, 64);
  put(0, 3, 64);
  put(0, 4, 0.3);
  put(0, 5, 0.1);
  put(0, 6, 0.2);
  put(0, 7, 0.85);
  // Anchor 5: a second box, best synonym score 0.4.
  put(5, 0, 100);
  put(5, 1, 100);
  put(5, 2, 32);
  put(5, 3, 32);
  put(5, 4, 0.4);
  const rows = adapter.decodeYoloOutput({ data, dims: DIMS }, { vocabularySize: VOCABULARY });
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0][0], rows[0][1], rows[0][2], rows[0][3]], [320, 320, 64, 64]);
  assert.ok(Math.abs(rows[0][4] - 0.85) < 1e-6, 'the best racket-synonym channel wins');
  assert.deepEqual([rows[1][0], rows[1][1], rows[1][2], rows[1][3]], [100, 100, 32, 32]);
  assert.ok(Math.abs(rows[1][4] - 0.4) < 1e-6);
});

test('decodeYoloOutput refuses artifacts whose real metadata does not match the baked racket contract', () => {
  const vocabulary = { vocabularySize: VOCABULARY };
  // A vanilla 80-class export has 84 channels; its class-0 (person) scores
  // must never be decodable as rackets.
  assert.throws(
    () => adapter.decodeYoloOutput({ data: new Float32Array(84 * ANCHORS), dims: [1, 84, ANCHORS] }, vocabulary),
    /yolo-model-output-contract-mismatch/
  );
  // A legacy 85-channel (objectness) export is refused the same way.
  assert.throws(
    () => adapter.decodeYoloOutput({ data: new Float32Array(85 * ANCHORS), dims: [1, 85, ANCHORS] }, vocabulary),
    /yolo-model-output-contract-mismatch/
  );
  // A wrong anchor count for the 640 grid is refused too.
  assert.throws(
    () => adapter.decodeYoloOutput({ data: new Float32Array(CHANNELS * 2100), dims: [1, CHANNELS, 2100] }, vocabulary),
    /yolo-model-output-contract-mismatch/
  );
  // A 1-class bake does not match this adapter's 4-entry vocabulary.
  assert.throws(
    () => adapter.decodeYoloOutput({ data: new Float32Array(5 * ANCHORS), dims: [1, 5, ANCHORS] }, vocabulary),
    /yolo-model-output-contract-mismatch/
  );
  assert.throws(() => adapter.decodeYoloOutput(null, vocabulary), /yolo-model-output-unavailable/);
});

test('an unbaked 80-class artifact is never relabeled: a person-class score is refused, not emitted as a racket', async () => {
  // What would previously have been misdecoded: a plain (unbaked) export whose
  // channel 4 is COCO class-0 "person" firing at 0.95 on a mid-frame anchor.
  const data = new Float32Array(84 * ANCHORS);
  const anchor = 3000;
  data[anchor] = 432;
  data[ANCHORS + anchor] = 320;
  data[2 * ANCHORS + anchor] = 96;
  data[3 * ANCHORS + anchor] = 128;
  data[4 * ANCHORS + anchor] = 0.95;
  const { environment, session } = ortHarness({ outputTensor: { data, dims: [1, 84, ANCHORS] } });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const result = await analyzer.analyze({ sessionId: 'unbaked-1', requestId: 'r1', mediaTime: 1, frame: frame(1280, 720) });
  assert.equal(result.state, 'unknown');
  assert.deepEqual(result.detections, []);
  assert.equal(result.detectionMethod, null, 'no completed run: the proxy stays for this frame');
  assert.match(result.reason, /yolo-model-output-contract-mismatch/);
  assert.equal(session.released, true, 'the unusable session is dropped');
});

test('decoded racket boxes are normalized to the full source frame and never depend on its pixel size', async () => {
  const { environment, session } = ortHarness({ outputTensor: outputWithDetection() });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  // The same grid-space detection must land at the same full-frame positions
  // for every source resolution: a racket spanning source x 0.60-0.75 and
  // y 0.40-0.60 (grid center 432, 320; size 96, 128) unscales to /640, not to
  // the source width or height.
  for (const [width, height] of [[1280, 720], [1920, 1080], [64, 36], [640, 640]]) {
    const result = await analyzer.analyze({
      sessionId: `geom-${width}x${height}`, requestId: 'r', mediaTime: width / 1000, frame: frame(width, height)
    });
    assert.equal(result.state, 'tracked');
    assert.equal(result.detectionMethod, 'yolo-world-open-vocab-racket');
    assert.equal(result.reason, 'open-vocabulary-racket-detections');
    assert.equal(result.detections.length, 1);
    const box = result.detections[0].bbox;
    assert.equal(box.x, 0.6);
    assert.equal(box.y, 0.4);
    assert.equal(box.width, 0.15);
    assert.equal(box.height, 0.2);
    assert.equal(result.detections[0].confidence, 0.9);
  }
  assert.equal(session.released, false, 'the session stays active across frames');
});

test('a completed run with a confident detection emits tracked racket evidence in the shared envelope', async () => {
  const { environment, session } = ortHarness({ outputTensor: outputWithDetection(0.9) });
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
  assert.equal(result.detections[0].source, 'yolo-world-racket-detector');
  assert.equal(result.detector.id, adapter.MODEL.id);
  assert.equal(result.sessionId, 's1');
  assert.equal(result.requestId, 'r1');
  assert.equal(result.mediaTime, 12.5);
  assert.equal(result.segmentationAvailable, false);
  assert.ok(session.released === false); // still active for the next frame
});

test('a frame whose racket-synonym scores stay below the confidence threshold yields no racket detections', async () => {
  // Simulates an arbitrary-object/person frame as far as this adapter can see
  // it: the model answered, but no baked racket channel cleared the bar.
  const { environment, session } = ortHarness({ outputTensor: outputWithDetection(0.42) });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const result = await analyzer.analyze({ sessionId: 's2', requestId: 'r2', mediaTime: 1, frame: frame(1280, 720) });
  assert.equal(result.state, 'unknown');
  assert.equal(result.detectionMethod, 'yolo-world-open-vocab-racket', 'the model ran and answered');
  assert.equal(result.reason, 'no-yolo-world-racket-detection');
  assert.deepEqual(result.detections, []);
  assert.equal(session.released, false);
});

test('a completed run that finds no racket keeps the detector marker as an honest unknown', async () => {
  const { environment } = ortHarness({ outputTensor: emptyOutput() });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const result = await analyzer.analyze({ sessionId: 's3', requestId: 'r3', mediaTime: 1, frame: frame() });
  assert.equal(result.state, 'unknown');
  assert.equal(result.detectionMethod, 'yolo-world-open-vocab-racket'); // the model ran and answered
  assert.equal(result.reason, 'no-yolo-world-racket-detection');
  assert.deepEqual(result.detections, []);
});

test('an artifact exposing a runtime text input is refused at initialize with an explicit contract reason', async () => {
  // A dynamic (unbaked) export keeps a txt_feats input; this adapter only runs
  // the vocabulary-baked single-input artifact.
  const { environment } = ortHarness({ sessionInputNames: ['images', 'txt_feats'] });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const initialized = await analyzer.initialize();
  assert.equal(initialized.available, false);
  assert.match(initialized.reason, /yolo-model-input-contract-mismatch/);
  const result = await analyzer.analyze({ sessionId: 's4', requestId: 'r4', mediaTime: 2, frame: frame() });
  assert.equal(result.state, 'unknown');
  assert.equal(result.detectionMethod, null);
  assert.match(result.reason, /yolo-model-input-contract-mismatch/);
});

test('a missing prepared artifact is an explicit unavailable state with no detector marker', async () => {
  const { environment } = ortHarness({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const result = await analyzer.analyze({ sessionId: 's5', requestId: 'r5', mediaTime: 2, frame: frame() });
  assert.equal(result.state, 'unknown');
  assert.equal(result.detectionMethod, null); // no completed run: proxy stays
  assert.equal(result.reason, 'yolo-world-artifact-not-bundled');
});

test('a missing ONNX Runtime Web runtime is an explicit unavailable state', async () => {
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment: { location: { href: 'chrome-extension://test/offscreen/offscreen.html' }, URL } });
  const initialized = await analyzer.initialize();
  assert.equal(initialized.available, false);
  assert.equal(initialized.reason, 'yolo-world-runtime-not-bundled');
  const result = await analyzer.analyze({ sessionId: 's6', requestId: 'r6', mediaTime: 3, frame: frame() });
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
  const { environment, session, ort } = ortHarness({ outputTensor: outputWithDetection(), runThrows: 'device-lost' });
  const analyzer = new adapter.YoloWorldRacketAnalyzer({ environment });
  const invalid = await analyzer.analyze({ sessionId: 's7', requestId: 'r7', mediaTime: -1, frame: frame() });
  assert.equal(invalid.state, 'unknown');
  assert.equal(invalid.detectionMethod, null);
  assert.equal(invalid.reason, 'invalid-media-time');
  // Run exception: no authoritative evidence and the failed session is dropped.
  const failed = await analyzer.analyze({ sessionId: 's8', requestId: 'r8', mediaTime: 4, frame: frame() });
  assert.equal(failed.state, 'unknown');
  assert.equal(failed.detectionMethod, null);
  assert.match(failed.reason, /device-lost/);
  assert.equal(session.released, true);
  // The next frame initializes a fresh session (the ort harness returns a new one).
  const session2 = {
    released: false,
    inputNames: ['images'],
    outputNames: ['output0'],
    async run() { return { output0: outputWithDetection() }; },
    release() { this.released = true; }
  };
  ort.InferenceSession.create = async () => session2;
  const recovered = await analyzer.analyze({ sessionId: 's8', requestId: 'r8', mediaTime: 5, frame: frame() });
  assert.equal(recovered.state, 'tracked');
  assert.equal(recovered.detectionMethod, 'yolo-world-open-vocab-racket');
  assert.equal(recovered.detections[0].bbox.x, 0.6);
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
