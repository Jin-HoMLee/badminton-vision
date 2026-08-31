const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
const tracking = require('../src/extension/common/player-tracking.js');
global.BSOProtocol = protocol;
global.BSOPlayerTracking = tracking;
const openPose = require('../src/extension/offscreen/lite-openpose-adapter.js');

function heatmap(poses, { width = 32, height = 32 } = {}) {
  const values = new Float32Array(width * height * 19);
  poses.forEach((pose) => {
    pose.forEach(([channel, x, y, score = 0.9]) => {
      const index = (y * width + x) * 19 + channel;
      values[index] = Math.max(values[index], score);
    });
  });
  return values;
}

function pose(x, y, score = 0.9) {
  return Array.from({ length: 18 }, (_, channel) => [channel, x + (channel % 3), y + Math.floor(channel / 3), score]);
}

function fakeRuntime({ backendResults = {} } = {}) {
  const compiled = [];
  return {
    loaded: true,
    setWebGpuDevice() {},
    Tensor: class Tensor {
      constructor(data, shape) { this.data = data; this.shape = shape; this.deleted = false; }
      delete() { this.deleted = true; }
    },
    async loadAndCompile(url, options) {
      compiled.push([url, options.accelerator]);
      const result = backendResults[options.accelerator];
      if (result instanceof Error) throw result;
      if (result === false) throw new Error(`${options.accelerator} rejected`);
      return result || {
        isFullyAccelerated: true,
        async run() { return []; },
        delete() {}
      };
    },
    compiled
  };
}

test('cleared model decoder returns two normalized partial/tracked pose observations', () => {
  const values = heatmap([pose(4, 6), pose(22, 8)]);
  const decoded = openPose.decodeLiteOpenPoseOutput(values, [1, 32, 32, 19], {
    sessionId: 'decode', requestId: 'decode:1', mediaTime: 1
  });
  assert.equal(decoded.length, 2);
  assert.deepEqual(decoded.map((item) => item.state), ['tracked', 'tracked']);
  assert.equal(decoded[0].coordinateSpace, 'normalized');
  assert.equal(decoded[0].keypoints.length, 18);
  assert.equal(decoded[0].keypoints[0].name, 'nose');
  assert.ok(decoded[0].bbox.width > 0);
  assert.ok(decoded[1].bbox.x > decoded[0].bbox.x);
  assert.equal(decoded[0].detector.id, openPose.MODEL.id);
});

test('decoder preserves a low-confidence visible person as partial and rejects malformed output', () => {
  const values = heatmap([pose(10, 10, 0.1)]);
  const decoded = openPose.decodeLiteOpenPoseOutput(values, [1, 32, 32, 19], {
    minPoseScore: 0.25, minPartialPoseScore: 0.05, keypointScoreThreshold: 0.05
  });
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].state, 'partial');
  assert.throws(() => openPose.decodeLiteOpenPoseOutput(values, [1, 32, 32, 18]), /Unexpected/);
});

test('LiteRT backend selection records unsupported WebGL and falls back WebGPU to WASM', async () => {
  const runtime = fakeRuntime({ backendResults: { webgpu: false } });
  const statuses = [];
  const selected = await openPose.selectLiteRtBackend({
    runtime,
    modelUrl: 'chrome-extension://test/offscreen/vendor/lite-openpose/pose_256.tflite',
    environment: { navigator: { gpu: { async requestAdapter() { return { async requestDevice() { return {}; } }; } } } },
    onStatus: (status) => statuses.push(status)
  });
  assert.equal(selected.backend, 'wasm');
  assert.deepEqual(selected.attempted.map((item) => [item.name, item.ok]), [
    ['webgpu', false], ['webgl', false], ['wasm', true]
  ]);
  assert.deepEqual(selected.fallbacks, ['backend-webgpu-unavailable', 'backend-webgl-unavailable']);
  assert.equal(runtime.compiled[0][1], 'webgpu');
  assert.equal(runtime.compiled.at(-1)[1], 'wasm');
  assert.equal(statuses.at(-1).type, 'backend-selected');
});

test('analyzer loads local cleared artifact, tracks two players, resets camera IDs, and disposes runtime resources', async () => {
  const outputs = [heatmap([pose(3, 5), pose(22, 7)]), heatmap([pose(5, 5), pose(20, 7)]), heatmap([pose(5, 5)])];
  const deleted = [];
  const runtime = {
    loaded: true,
    Tensor: class Tensor {
      constructor(data, shape) { this.data = data; this.shape = shape; }
      delete() { deleted.push('input'); }
    },
    async loadAndCompile(url, options) {
      assert.match(url, /pose_256\.tflite$/);
      assert.equal(options.accelerator, 'wasm');
      return {
        isFullyAccelerated: true,
        async run(input) {
          assert.equal(input.shape.join(','), '1,256,256,3');
          const index = outputs.shift();
          const tensor = {
            shape: [1, 32, 32, 19],
            async moveTo() {
              return { toTypedArray: () => index, delete() { deleted.push('host-output'); } };
            },
            delete() { deleted.push('output'); }
          };
          return [tensor];
        },
        delete() { deleted.push('model'); }
      };
    },
    compiled: []
  };
  const analyzer = new openPose.LiteOpenPoseAnalyzer({
    runtime,
    environment: { location: { href: 'chrome-extension://test/offscreen/offscreen.html' } },
    backendOrder: ['wasm']
  });
  assert.equal((await analyzer.initialize()).available, true);
  const frame = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
  const first = await analyzer.analyze({ sessionId: 'match', requestId: 'r1', mediaTime: 1, frame });
  const ids = first.result.players.filter((player) => player.bbox).map((player) => player.trackId);
  assert.equal(first.inferenceAvailable, true);
  assert.equal(ids.length, 2);
  const second = await analyzer.analyze({ sessionId: 'match', requestId: 'r2', mediaTime: 2, frame });
  assert.deepEqual(second.result.players.filter((player) => player.bbox).map((player) => player.trackId), ids);
  const cameraReset = await analyzer.analyze({ sessionId: 'match', requestId: 'r3', mediaTime: 1, cameraCut: true, frame });
  assert.equal(cameraReset.result.players.length, 1);
  assert.notEqual(cameraReset.result.players[0].trackId, ids[0]);
  analyzer.dispose();
  assert.ok(deleted.includes('input'));
  assert.ok(deleted.includes('host-output'));
  assert.ok(deleted.includes('output'));
  assert.ok(deleted.includes('model'));
});

test('missing runtime reports unavailable production inference without fixture identity', async () => {
  const analyzer = new openPose.LiteOpenPoseAnalyzer({
    runtimeReady: Promise.resolve(null),
    environment: { location: { href: 'chrome-extension://test/offscreen/offscreen.html' } }
  });
  const initialized = await analyzer.initialize();
  assert.equal(initialized.available, false);
  const result = await analyzer.analyze({ sessionId: 'missing', requestId: 'r1', mediaTime: 1, frame: {} });
  assert.equal(result.status, 'fallback');
  assert.equal(result.analyzer, openPose.MODEL.id);
  assert.equal(result.inferenceAvailable, false);
  assert.equal(result.analyzerIdentity.productionModel, false);
  assert.match(result.result.reason, /litert-runtime-unavailable/);
});

test('missing local checkpoint reports unavailable artifact rather than selecting fixture or claiming CV', async () => {
  const analyzer = new openPose.LiteOpenPoseAnalyzer({
    runtime: {
      loaded: true,
      async loadAndCompile() { throw new Error('local-model-artifact-unavailable'); }
    },
    modelUrl: './vendor/lite-openpose/missing.tflite',
    environment: { location: { href: 'chrome-extension://test/offscreen/offscreen.html' } },
    backendOrder: ['wasm']
  });
  const initialized = await analyzer.initialize();
  assert.equal(initialized.available, false);
  assert.match(initialized.reason, /local-model-artifact-unavailable/);
  const result = await analyzer.analyze({ sessionId: 'missing-artifact', requestId: 'r1', mediaTime: 1, frame: {} });
  assert.equal(result.inferenceAvailable, false);
  assert.equal(result.analyzerIdentity.productionModel, false);
  assert.equal(result.result.tracking.state, 'unknown');
});
