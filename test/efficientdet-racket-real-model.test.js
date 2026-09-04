const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
// This test runs the REAL vendored LiteRT WASM runtime and the REAL bundled
// EfficientDet-Lite0 model in Node (the same artifacts the offscreen document
// loads), through the production racket adapter's own input builder and
// decoder. It is the deterministic gate for the live racket-detection
// contract: a real tennis-racket frame yields tennis-racket boxes from the
// strict class filter, and a racket-free people frame yields none.
const ROOT = path.join(__dirname, '..');
const LITERT = path.join(ROOT, 'src/extension/offscreen/vendor/litert');
const MODEL = path.join(ROOT, 'src/extension/offscreen/vendor/efficientdet-lite0/efficientdet_lite0.tflite');
const RACKET_FIXTURE = path.join(__dirname, 'fixtures', 'racket-sample-256.bmp');
const POSE_FIXTURE = path.join(__dirname, 'fixtures', 'pose-sample-256.bmp');
const adapter = require(path.join(ROOT, 'src/extension/offscreen/efficientdet-racket-adapter.js'));

function bmpToRgba(file) {
  const buf = fs.readFileSync(file);
  const width = buf.readUInt32LE(18);
  const storedHeight = buf.readInt32LE(22);
  const height = Math.abs(storedHeight);
  assert.ok(height > 0 && width > 0, 'fixture BMP header must carry dimensions');
  const dataOffset = buf.readUInt32LE(10);
  const bpp = buf.readUInt16LE(28) / 8;
  const rowSize = Math.ceil(width * bpp / 4) * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    // Negative BMP heights are top-down; positive heights are bottom-up.
    // Respect the header so the model fixture is not turned upside down.
    const sourceY = storedHeight < 0 ? y : height - 1 - y;
    const srcRow = dataOffset + sourceY * rowSize;
    for (let x = 0; x < width; x += 1) {
      const offset = srcRow + x * bpp;
      const target = (y * width + x) * 4;
      rgba[target] = buf[offset + 2];
      rgba[target + 1] = buf[offset + 1];
      rgba[target + 2] = buf[offset];
      rgba[target + 3] = 255;
    }
  }
  return { width, height, channels: 4, data: rgba };
}

let runtime;
async function loadRuntime() {
  if (runtime) return runtime;
  globalThis.self = globalThis;
  globalThis.window = globalThis;
  globalThis.importScripts = function (url) {
    const require = createRequire(__filename);
    globalThis.ModuleFactory = require(url.replace(/^file:\/\//, ''));
  };
  const core = await import(pathToFileURL(path.join(LITERT, 'core.js')).href);
  await core.loadLiteRt('file://' + LITERT + '/');
  const model = await core.loadAndCompile(new Uint8Array(fs.readFileSync(MODEL)), { accelerator: 'wasm' });
  runtime = { core, model };
  return runtime;
}

/** Mirrors the production offscreen path: bounded RGBA frame -> input tensor
 * -> LiteRT WASM -> raw outputs -> decode with the strict class filter. */
async function runRacketAdapter(framePixels, { threshold } = {}) {
  const { core, model } = await loadRuntime();
  const input = adapter.createInputPixels(framePixels, 320);
  const tensor = new core.Tensor(input, [1, 320, 320, 3]);
  let outputs;
  try {
    outputs = await model.run(tensor);
    const scores = await outputs[0].toTypedArray();
    const boxes = await outputs[1].toTypedArray();
    return adapter.decodeEfficientDetOutput({ scores, boxes, confidenceThreshold: threshold || adapter.DEFAULTS.confidenceThreshold });
  } finally {
    if (outputs) outputs.forEach((output) => output.delete?.());
    tensor.delete();
  }
}

test('vendored LiteRT WASM runtime compiles the bundled EfficientDet artifact', { timeout: 60000 }, async () => {
  const { model } = await loadRuntime();
  assert.equal(typeof model.run, 'function');
});

test('real racket fixture decodes tennis-racket boxes with coherent confidence and geometry', { timeout: 120000 }, async () => {
  const framePixels = bmpToRgba(RACKET_FIXTURE);
  const result = await runRacketAdapter(framePixels);
  assert.ok(result.detections.length >= 1, 'racket fixture must produce at least one racket detection');
  const top = result.detections[0];
  assert.equal(top.class, 'tennis racket');
  assert.equal(top.classIndex, 42);
  // Measured on the vendored artifact with this input contract the top
  // confidence is ~0.685 and the decoded box spans the racket that fills the
  // fixture. Keep wide margins so the gate stays a real-inference contract
  // check rather than a snapshot of one float.
  assert.ok(top.confidence >= 0.6, `top racket confidence ${top.confidence} must clear 0.6`);
  assert.ok(top.bbox.width >= 0.4 && top.bbox.height >= 0.4, `racket box must be substantial, got ${JSON.stringify(top.bbox)}`);
  assert.ok(top.bbox.x >= 0 && top.bbox.y >= 0 && top.bbox.x + top.bbox.width <= 1 && top.bbox.y + top.bbox.height <= 1);
  assert.ok(result.detections.every((detection) => detection.class === 'tennis racket'), 'every emitted detection is the tennis-racket class');
});

test('racket-free people fixture never mislabels a person as a racket', { timeout: 120000 }, async () => {
  const framePixels = bmpToRgba(POSE_FIXTURE);
  const result = await runRacketAdapter(framePixels);
  assert.equal(result.detections.length, 0, 'people without a racket must not produce racket boxes');
  // The strongest tennis-racket class logit stays below the default 0.53
  // threshold on the people fixture (~0.517 measured); assert the margin so a
  // regression that inflates unrelated classes is caught even before NMS.
  const { core, model } = await loadRuntime();
  const input = adapter.createInputPixels(framePixels, 320);
  const tensor = new core.Tensor(input, [1, 320, 320, 3]);
  let outputs;
  try {
    outputs = await model.run(tensor);
    const scores = await outputs[0].toTypedArray();
    let max = -Infinity;
    for (let anchor = 0; anchor < 19206; anchor += 1) {
      max = Math.max(max, adapter.sigmoid(scores[anchor * 90 + 42]));
    }
    assert.ok(max < adapter.DEFAULTS.confidenceThreshold, `people-fixture max racket score ${max.toFixed(4)} must stay below the default threshold`);
  } finally {
    if (outputs) outputs.forEach((output) => output.delete?.());
    tensor.delete();
  }
});

test('real detector analyze() envelope carries session-scoped racket detections', { timeout: 120000 }, async () => {
  const { core, model } = await loadRuntime();
  const detector = new adapter.EfficientDetRacketDetector({
    runtime: { loaded: true, Tensor: core.Tensor, loadAndCompile: async () => model },
    backendOrder: ['wasm'],
    onStatus: () => {}
  });
  const framePixels = bmpToRgba(RACKET_FIXTURE);
  const envelope = await detector.analyze({
    sessionId: 'real-model-racket',
    requestId: 'real-model-racket:1',
    mediaTime: 3.5,
    frame: { width: framePixels.width, height: framePixels.height, channels: 4, data: framePixels.data }
  });
  assert.ok(envelope, 'analyze must return an envelope');
  assert.equal(envelope.state, 'tracked');
  assert.equal(envelope.detectionMethod, 'efficientdet-lite0-tennis-racket');
  assert.ok(Array.isArray(envelope.detections) && envelope.detections.length >= 1);
  assert.equal(envelope.sessionId, 'real-model-racket');
  assert.equal(envelope.requestId, 'real-model-racket:1');
  assert.equal(envelope.mediaTime, 3.5);
  detector.dispose();
});
