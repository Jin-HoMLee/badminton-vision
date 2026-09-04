const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
const tracking = require('../src/extension/common/player-tracking.js');
global.BSOProtocol = protocol;
global.BSOPlayerTracking = tracking;
const moveNet = require('../src/extension/offscreen/movenet-adapter.js');

function outputPose(x, { y = 0.2, score = 0.9, keypointScore = 0.9 } = {}) {
  const values = new Float32Array(56);
  for (let index = 0; index < 17; index += 1) {
    values[index * 3] = y + 0.02 * Math.min(index, 5);
    values[index * 3 + 1] = x + 0.01 * Math.min(index, 5);
    values[index * 3 + 2] = keypointScore;
  }
  values[51] = y;
  values[52] = x;
  values[53] = y + 0.5;
  values[54] = x + 0.1;
  values[55] = score;
  return values;
}

function output(poses) {
  const values = new Float32Array(poses.length * 56);
  poses.forEach((pose, index) => values.set(pose, index * 56));
  return values;
}

function sample(sessionId, requestId, mediaTime) {
  return {
    sessionId,
    requestId,
    mediaTime,
    frame: { width: 1000, height: 500, data: new Uint8Array(1000 * 500 * 4).fill(128) }
  };
}

function fakeTf({ supported = ['webgpu', 'webgl', 'wasm'] } = {}) {
  let backend = null;
  return {
    setBackend(name) {
      if (!supported.includes(name)) throw new Error(`${name} unavailable`);
      backend = name;
      return true;
    },
    async ready() {},
    getBackend() { return backend; },
    tensor() {
      return { data: async () => Float32Array.from([1, 2, 3]), dispose() {} };
    },
    add(value) { return { data: async () => Float32Array.from([2, 4, 6]), dispose() {} }; },
    loadGraphModel: async () => ({ execute() {}, dispose() {} })
  };
}

test('real backend probe requires an executing tensor and prefers WebGPU then WebGL then WASM', async () => {
  const tf = fakeTf({ supported: ['webgl'] });
  const statuses = [];
  const selected = await moveNet.selectBackend({ tf, onStatus: (status) => statuses.push(status) });
  assert.equal(selected.backend, 'webgl');
  assert.deepEqual(selected.attempted.map((item) => [item.name, item.ok]), [
    ['webgpu', false], ['webgl', true]
  ]);
  assert.deepEqual(selected.fallbacks, ['backend-webgpu-unavailable']);
  assert.equal(statuses.some((status) => status.type === 'backend-probe' && status.backend === 'webgpu'), true);
  assert.equal(statuses.at(-1).type, 'backend-selected');
});

test('MoveNet decoder converts two local poses into normalized boxes and 17 named keypoints', () => {
  const decoded = moveNet.decodeMoveNetOutput(
    output([outputPose(0.1), outputPose(0.7)]),
    [1, 2, 56],
    moveNet.dimensionGeometry(1000, 500),
    { sessionId: 'two', requestId: 'two:1', mediaTime: 1 }
  );
  assert.equal(decoded.length, 2);
  assert.deepEqual(decoded.map((pose) => pose.state), ['tracked', 'tracked']);
  assert.deepEqual(decoded.map((pose) => pose.bbox), [
    { xMin: 0.1, yMin: 0.2, xMax: 0.2, yMax: 0.7 },
    { xMin: 0.7, yMin: 0.2, xMax: 0.8, yMax: 0.7 }
  ]);
  assert.equal(decoded[0].keypoints.length, 17);
  assert.equal(decoded[0].keypoints[0].name, 'nose');
  assert.equal(decoded[0].keypoints[16].name, 'right_ankle');
});

test('adapter runs a local graph-model input pipeline and disposes tensors after inference', async () => {
  let backend = null;
  let modelUrl = null;
  const disposed = [];
  function tensor(shape, values = [1, 2, 3]) {
    return {
      shape,
      data: async () => Float32Array.from(values),
      dispose() { disposed.push(this); }
    };
  }
  const values = output([outputPose(0.1), outputPose(0.7)]);
  const tf = {
    setBackend(name) { backend = name; return true; },
    async ready() {},
    getBackend() { return backend; },
    tensor: () => tensor([1, 3]),
    add: () => tensor([1, 3]),
    browser: { fromPixels: () => tensor([360, 640, 3]) },
    expandDims: () => tensor([1, 360, 640, 3]),
    image: { resizeBilinear: () => tensor([1, 144, 256, 3]) },
    pad: () => tensor([1, 160, 256, 3]),
    cast: () => tensor([1, 160, 256, 3]),
    loadGraphModel: async (url) => {
      modelUrl = url;
      return { execute: () => tensor([1, 2, 56], values), dispose() {} };
    }
  };
  const analyzer = new moveNet.MoveNetMultiPoseLightningAnalyzer({
    tf,
    tracking,
    environment: { location: { href: 'chrome-extension://test/offscreen/offscreen.html' } }
  });
  const initialized = await analyzer.initialize();
  assert.equal(initialized.available, true);
  assert.equal(initialized.backend, 'webgpu');
  assert.match(modelUrl, /tfhub\.dev.*movenet.*multipose.*lightning/i);
  const result = await analyzer.analyze(sample('pipeline', 'r1', 1));
  assert.equal(result.inferenceAvailable, true);
  assert.equal(result.result.players.length, 2);
  assert.ok(disposed.length >= 5);
});

test('adapter places two-player detections in analysis.result and retains session-local IDs', async () => {
  const frames = [
    [outputPose(0.1), outputPose(0.7)],
    [outputPose(0.2), outputPose(0.6)],
    [outputPose(0.62)]
  ];
  const analyzer = new moveNet.MoveNetMultiPoseLightningAnalyzer({
    tf: {},
    tracking,
    onStatus: () => {}
  });
  analyzer.initialize = async () => ({ available: true });
  analyzer.infer = async (frame, context) => {
    const poses = frames.shift();
    return moveNet.decodeMoveNetOutput(
      output(poses), [1, poses.length, 56], moveNet.dimensionGeometry(1000, 500), {
        sessionId: context.sessionId, requestId: context.requestId, mediaTime: context.mediaTime
      }
    );
  };
  const first = await analyzer.analyze(sample('match', 'r1', 1));
  const firstPlayers = first.result.players.filter((player) => player.bbox).sort((a, b) => a.bbox.x - b.bbox.x);
  assert.equal(first.type, protocol.TYPES.ANALYZER_RESULT);
  assert.equal(first.analyzer, moveNet.MODEL.id);
  assert.equal(first.inferenceAvailable, true);
  assert.equal(first.result.tracking.state, 'tracked');
  assert.equal(firstPlayers.length, 2);
  const ids = firstPlayers.map((player) => player.trackId);

  const second = await analyzer.analyze(sample('match', 'r2', 2));
  const secondPlayers = second.result.players.filter((player) => player.bbox).sort((a, b) => a.bbox.x - b.bbox.x);
  assert.deepEqual(secondPlayers.map((player) => player.trackId), ids);
  assert.equal(secondPlayers.every((player) => player.state === 'tracked'), true);

  const partial = await analyzer.analyze(sample('match', 'r3', 3));
  assert.equal(partial.result.players.some((player) => player.state === 'partial'), true);
  assert.equal(partial.result.players.length, 2);
});

test('adapter wraps the serializable RGBA frame transport as typed pixel data for TensorFlow.js', async () => {
  let fromPixelsArg = null;
  function tensor() {
    return { dispose() {} };
  }
  const tf = {
    browser: { fromPixels(pixels) { fromPixelsArg = pixels; return tensor(); } },
    image: { resizeBilinear: () => tensor() },
    pad: () => tensor(),
    expandDims: () => tensor(),
    cast: () => tensor()
  };
  const analyzer = new moveNet.MoveNetMultiPoseLightningAnalyzer({ tf, tracking });
  const rgba = new Uint8Array(2 * 2 * 4).fill(255);
  const input = await analyzer.inputTensor({ width: 2, height: 2, data: rgba });
  assert.ok(input);
  assert.ok(fromPixelsArg.data instanceof Uint8Array);
  assert.equal(fromPixelsArg.data.length, 16);
  assert.equal(fromPixelsArg.width, 2);
  assert.equal(fromPixelsArg.height, 2);
});

test('adapter preserves partial/unknown states and resets IDs on a camera reset', async () => {
  const analyzer = new moveNet.MoveNetMultiPoseLightningAnalyzer({ tf: {}, tracking });
  analyzer.initialize = async () => ({ available: true });
  analyzer.infer = async (frame) => frame.detections;
  const firstObservation = moveNet.decodeMoveNetOutput(output([outputPose(0.2)]), [1, 1, 56], moveNet.dimensionGeometry(1000, 500), {
    sessionId: 'reset', requestId: 'r1', mediaTime: 1
  });
  const partialObservation = moveNet.decodeMoveNetOutput(output([outputPose(0.2, { keypointScore: 0.05 })]), [1, 1, 56], moveNet.dimensionGeometry(1000, 500), {
    sessionId: 'reset', requestId: 'r2', mediaTime: 2
  });
  const first = await analyzer.analyze({ ...sample('reset', 'r1', 1), frame: { width: 1000, height: 500, detections: firstObservation } });
  const oldId = first.result.players[0].trackId;
  const partial = await analyzer.analyze({ ...sample('reset', 'r2', 2), frame: { width: 1000, height: 500, detections: partialObservation } });
  assert.equal(partial.result.players[0].state, 'partial');
  analyzer.resetSession('reset', 'camera-cut');
  const afterReset = await analyzer.analyze({ ...sample('reset', 'r3', 1), frame: { width: 1000, height: 500, detections: firstObservation } });
  assert.notEqual(afterReset.result.players[0].trackId, oldId);
  assert.equal(afterReset.result.players[0].trackId, 'reset:s1:player-1');
});

test('adapter enforces one in-flight analysis, drops stale media time, and reports backend failure honestly', async () => {
  const statuses = [];
  let resolveInference;
  const pending = new Promise((resolve) => { resolveInference = resolve; });
  const analyzer = new moveNet.MoveNetMultiPoseLightningAnalyzer({ tf: {}, tracking, onStatus: (status) => statuses.push(status) });
  analyzer.initialize = async () => ({ available: true });
  analyzer.infer = () => pending;
  const firstPromise = analyzer.analyze({ ...sample('flow', 'r1', 1), frame: {} });
  const dropped = await analyzer.analyze({ ...sample('flow', 'r2', 2), frame: {} });
  assert.equal(dropped, null);
  assert.equal(statuses.some((status) => status.status === 'backpressure'), true);
  resolveInference([]);
  const first = await firstPromise;
  assert.equal(first.result.tracking.state, 'unknown');
  const stale = await analyzer.analyze({ ...sample('flow', 'r0', 1), frame: {} });
  assert.equal(stale, null);
  assert.equal(statuses.some((status) => status.status === 'stale-result-dropped'), true);

  const failure = new moveNet.MoveNetMultiPoseLightningAnalyzer({
    tf: fakeTf(), tracking,
    backendProbe: async () => ({ ok: false, reason: 'driver rejected backend' })
  });
  const initialized = await failure.initialize();
  assert.equal(initialized.available, false);
  const result = await failure.analyze(sample('failed', 'r1', 1));
  assert.equal(result.status, 'fallback');
  assert.equal(result.inferenceAvailable, false);
  assert.equal(result.result.tracking.state, 'unknown');
  assert.match(result.result.reason, /no-usable-inference-backend/);
});
