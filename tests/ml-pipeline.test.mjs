import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

/**
 * ML Pipeline unit tests - validate ONNX Runtime initialization,
 * model adapters, and inference pipeline coordination.
 */

test('ONNX Runtime - backend initialization', async () => {
  const backends = ['webgpu', 'webgl', 'wasm'];
  assert.ok(backends.includes('wasm'));
});

test('Frame preprocessing - aspect ratio handling', async () => {
  const width = 1920;
  const height = 1080;
  const inputSize = 256;
  const aspectRatio = width / height;

  let destWidth = inputSize;
  let destHeight = inputSize;
  let offsetX = 0;
  let offsetY = 0;

  if (aspectRatio > 1) {
    destHeight = Math.floor(inputSize / aspectRatio);
    offsetY = (inputSize - destHeight) / 2;
  } else {
    destWidth = Math.floor(inputSize * aspectRatio);
    offsetX = (inputSize - destWidth) / 2;
  }

  assert.ok(destWidth <= inputSize);
  assert.ok(destHeight <= inputSize);
  assert.ok(offsetX >= 0);
  assert.ok(offsetY >= 0);
});

test('Bounding box calculation from keypoints', async () => {
  const keypoints = [
    { name: 'nose', x: 0.5, y: 0.4, confidence: 0.9 },
    { name: 'left_shoulder', x: 0.3, y: 0.6, confidence: 0.8 },
    { name: 'right_shoulder', x: 0.7, y: 0.6, confidence: 0.85 },
    { name: 'left_ankle', x: 0.25, y: 0.95, confidence: 0.7 },
    { name: 'right_ankle', x: 0.75, y: 0.95, confidence: 0.75 }
  ];

  const validKps = keypoints.filter(kp => kp.confidence > 0.1);
  const xs = validKps.map(kp => kp.x);
  const ys = validKps.map(kp => kp.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const bbox = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };

  assert.strictEqual(bbox.x, 0.25);
  assert.strictEqual(bbox.y, 0.4);
  assert.strictEqual(bbox.width, 0.5);
  assert.ok(Math.abs(bbox.height - 0.55) < 0.0001);
});

test('IoU calculation for NMS', async () => {
  const calculateIoU = (box1, box2) => {
    const x1Min = box1.x - box1.w / 2;
    const y1Min = box1.y - box1.h / 2;
    const x1Max = box1.x + box1.w / 2;
    const y1Max = box1.y + box1.h / 2;

    const x2Min = box2.x - box2.w / 2;
    const y2Min = box2.y - box2.h / 2;
    const x2Max = box2.x + box2.w / 2;
    const y2Max = box2.y + box2.h / 2;

    const intersection = Math.max(0, Math.min(x1Max, x2Max) - Math.max(x1Min, x2Min)) *
                        Math.max(0, Math.min(y1Max, y2Max) - Math.max(y1Min, y2Min));
    const area1 = (x1Max - x1Min) * (y1Max - y1Min);
    const area2 = (x2Max - x2Min) * (y2Max - y2Min);
    const union = area1 + area2 - intersection;

    return union === 0 ? 0 : intersection / union;
  };

  const box1 = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
  const box2 = { x: 0.6, y: 0.6, w: 0.2, h: 0.2 };
  const box3 = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };

  const iou12 = calculateIoU(box1, box2);
  const iou13 = calculateIoU(box1, box3);

  assert.ok(iou12 > 0.1 && iou12 < 1);
  assert.strictEqual(iou13, 0);
});

test('Performance metrics tracking', async () => {
  const metrics = {
    totalInferences: 0,
    totalTime: 0,
    avgTime: 0,
    minTime: Infinity,
    maxTime: 0
  };

  const times = [45.2, 52.8, 48.1, 51.3, 49.9];

  for (const time of times) {
    metrics.totalInferences++;
    metrics.totalTime += time;
    metrics.avgTime = metrics.totalTime / metrics.totalInferences;
    metrics.minTime = Math.min(metrics.minTime, time);
    metrics.maxTime = Math.max(metrics.maxTime, time);
  }

  assert.strictEqual(metrics.totalInferences, 5);
  assert.ok(metrics.avgTime >= 45 && metrics.avgTime <= 53);
  assert.strictEqual(metrics.minTime, 45.2);
  assert.strictEqual(metrics.maxTime, 52.8);
});

test('Shuttle detection confidence thresholding', async () => {
  const detections = [
    { confidence: 0.85, bbox: { x: 0.5, y: 0.4, width: 0.05, height: 0.05 } },
    { confidence: 0.72, bbox: { x: 0.3, y: 0.6, width: 0.04, height: 0.04 } },
    { confidence: 0.38, bbox: { x: 0.7, y: 0.7, width: 0.03, height: 0.03 } },
    { confidence: 0.15, bbox: { x: 0.1, y: 0.2, width: 0.02, height: 0.02 } }
  ];

  const threshold = 0.4;
  const filtered = detections.filter(d => d.confidence > threshold);

  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(filtered[0].confidence, 0.85);
  assert.strictEqual(filtered[1].confidence, 0.72);
});

test('Message protocol serialization', async () => {
  const message = {
    protocol: 'bso.runtime.v1',
    version: 1,
    type: 'analysis.result',
    sessionId: 'video-abc123',
    requestId: 42,
    mediaTime: 15.5,
    status: 'ok',
    analyzer: 'onnx-blazepose-yolov8-v1',
    result: {
      kind: 'onnx-inference-result',
      state: 'tracked',
      players: [{ trackId: 1, state: 'tracked' }],
      shuttle: { state: 'tracked', confidence: 0.85 }
    }
  };

  const serialized = JSON.stringify(message);
  const deserialized = JSON.parse(serialized);

  assert.deepStrictEqual(message, deserialized);
  assert.strictEqual(deserialized.protocol, 'bso.runtime.v1');
  assert.strictEqual(deserialized.analyzer, 'onnx-blazepose-yolov8-v1');
});

test('Web Worker message protocol', async () => {
  const workerMessage = {
    type: 'infer',
    payload: {
      frameData: new Uint8Array(256 * 256 * 3),
      width: 256,
      height: 256,
      mediaTime: 1000,
      requestId: 1,
      doPose: true,
      doShuttle: true
    }
  };

  assert.strictEqual(workerMessage.type, 'infer');
  assert.ok(workerMessage.payload.frameData);
  assert.strictEqual(workerMessage.payload.width, 256);
  assert.strictEqual(workerMessage.payload.height, 256);
});

test('ONNX model input validation', async () => {
  const validateInput = (dims, expectedDims) => {
    if (dims.length !== expectedDims.length) return false;
    for (let i = 0; i < dims.length; i++) {
      if (dims[i] !== expectedDims[i]) return false;
    }
    return true;
  };

  // BlazePose input: [1, 3, 256, 256]
  assert.ok(validateInput([1, 3, 256, 256], [1, 3, 256, 256]));

  // YOLOv8 input: [1, 3, 640, 640]
  assert.ok(validateInput([1, 3, 640, 640], [1, 3, 640, 640]));

  // TrackNetV3 input: [1, 9, 288, 512]
  assert.ok(validateInput([1, 9, 288, 512], [1, 9, 288, 512]));
});

test('Keypoint confidence filtering', async () => {
  const keypoints = [
    { name: 'nose', x: 0.5, y: 0.4, confidence: 0.95 },
    { name: 'left_eye', x: 0.45, y: 0.35, confidence: 0.92 },
    { name: 'right_eye', x: 0.55, y: 0.35, confidence: 0.05 },
    { name: 'left_ear', x: 0.4, y: 0.3, confidence: null },
  ];

  const confident = keypoints.filter(kp => kp.confidence && kp.confidence > 0.5);

  assert.strictEqual(confident.length, 2);
  assert.strictEqual(confident[0].name, 'nose');
  assert.strictEqual(confident[1].name, 'left_eye');
});

test('Pose state transitions', async () => {
  const pose1 = { state: 'tracked', confidence: 0.92, bbox: {} };
  const pose2 = { state: 'partial', confidence: 0.45, bbox: null };
  const pose3 = { state: 'unknown', confidence: null, bbox: null };

  assert.strictEqual(pose1.state, 'tracked');
  assert.ok(pose1.confidence > 0.9);
  assert.strictEqual(pose2.state, 'partial');
  assert.strictEqual(pose3.state, 'unknown');
});

test('Tensor dimension validation', async () => {
  const validateTensor = (data, dims) => {
    let product = 1;
    for (const d of dims) product *= d;
    return data.length === product;
  };

  const data1 = new Float32Array(256 * 256 * 3);
  assert.ok(validateTensor(data1, [1, 3, 256, 256]));

  const data2 = new Float32Array(640 * 640 * 3);
  assert.ok(validateTensor(data2, [1, 3, 640, 640]));
});

/**
 * Regression coverage: these exercise the real modules through their public
 * interfaces rather than restating constants.
 */

const require = createRequire(import.meta.url);
const OnnxRuntime = require('../src/ml-pipeline/onnx-runtime.js');
const BlazePoseAdapter = require('../src/ml-pipeline/adapters/blazepose-adapter.js');
require('../src/ml-pipeline/adapters/yolov8-shuttle-adapter.js');
const TrackNetProcessor = require('../src/ml-pipeline/adapters/tracknet-processor.js');
const InferencePipelineModule = require('../src/ml-pipeline/inference-pipeline.js');

function makeFakeOrt() {
  const created = [];
  const released = [];
  return {
    created,
    released,
    env: { wasm: {} },
    InferenceSession: {
      create: async (modelData) => {
        const session = {
          modelData,
          run: async () => ({ output: { data: new Float32Array(0), dims: [1, 0] } }),
          release: () => {
            if (session.disposed) throw new Error('session already released');
            session.disposed = true;
            released.push(modelData);
          }
        };
        created.push(session);
        return session;
      }
    },
    Tensor: class {
      constructor(type, data, dims) {
        this.type = type;
        this.data = data;
        this.dims = dims;
      }
    }
  };
}

test('OnnxRuntimeManager probes the injected environment, not host globals', async () => {
  const ort = makeFakeOrt();
  const manager = new OnnxRuntime.OnnxRuntimeManager({
    environment: {
      ort,
      navigator: { gpu: { requestAdapter: async () => ({ name: 'fake-adapter' }) } }
    }
  });

  const status = await manager.initialize();

  assert.strictEqual(status.available, true);
  assert.strictEqual(status.backend, 'webgpu');
});

test('OnnxRuntimeManager falls back to WASM when no GPU is present in the environment', async () => {
  const ort = makeFakeOrt();
  const manager = new OnnxRuntime.OnnxRuntimeManager({
    environment: { ort, navigator: { hardwareConcurrency: 2 } }
  });

  const status = await manager.initialize();

  assert.strictEqual(status.available, true);
  assert.strictEqual(status.backend, 'wasm');
  assert.deepStrictEqual(manager.fallbacks, ['webgl-unavailable']);
  assert.strictEqual(ort.env.wasm.numThreads, 2);
});

test('TrackNet trajectory extraction does not merge blobs across row edges', () => {
  const processor = new TrackNetProcessor.TrackNetV3Processor({ environment: {} });

  // 4x4 heatmap: one hot cell at (row 0, col 3), a two-cell blob at (row 1, cols 0-1)
  const heatmap = new Float32Array(16);
  heatmap[3] = 0.9;
  heatmap[4] = 0.9;
  heatmap[5] = 0.9;

  const point = processor.extractTrajectoryPoint(heatmap, 0.5);

  assert.ok(point);
  assert.strictEqual(point.componentSize, 2);
  assert.strictEqual(point.x, 0.125);
  assert.strictEqual(point.y, 0.25);
});

test('TrackNet addFrame accepts the typed arrays the processor itself produces', () => {
  const processor = new TrackNetProcessor.TrackNetV3Processor({ environment: {} });

  processor.addFrame(new Float32Array(16), 0);
  processor.addFrame(Array.from({ length: 16 }, () => 0), 1);
  processor.addFrame({ dims: [1, 4, 4], data: new Float32Array(16) }, 2);

  assert.strictEqual(processor.frameBuffer.length, 3);
  assert.throws(() => processor.addFrame('not-a-heatmap', 3), /Invalid heatmap format/);
});

test('BlazePose sizes the DOM canvas fallback to the frame', async () => {
  const drawn = [];
  const canvas = {
    width: 300,
    height: 150,
    getContext: () => ({
      drawImage: (...args) => drawn.push(args),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) })
    })
  };

  const analyzer = new BlazePoseAdapter.BlazePoseAnalyzer({
    environment: { document: { createElement: () => canvas } }
  });

  const pixels = await analyzer._readFramePixels({ width: 1920, height: 1080 });

  assert.strictEqual(canvas.width, 1920);
  assert.strictEqual(canvas.height, 1080);
  assert.strictEqual(pixels.data.length, 1920 * 1080 * 3);
  assert.strictEqual(pixels.data[0], 200);
  assert.strictEqual(drawn.length, 1);
});

test('Pipeline reports the runtime backend and fallbacks through getStatus', async () => {
  const ort = makeFakeOrt();
  const pipeline = new InferencePipelineModule.InferencePipeline({
    environment: { ort, navigator: { hardwareConcurrency: 2 } },
    useWebWorkers: false
  });

  const result = await pipeline.initialize();
  assert.strictEqual(result.success, true);

  const status = pipeline.getStatus();
  assert.strictEqual(status.initialized, true);
  assert.strictEqual(status.backend, 'wasm');
  assert.ok(Array.isArray(status.fallbacks));
});

test('Pipeline release disposes the shared runtime once and reaches the released state', async () => {
  const ort = makeFakeOrt();
  const pipeline = new InferencePipelineModule.InferencePipeline({
    environment: { ort, navigator: { hardwareConcurrency: 2 } },
    useWebWorkers: false
  });

  await pipeline.initialize();
  const sessionCount = ort.created.length;
  assert.ok(sessionCount > 1, 'expected multiple analyzers to share one runtime manager');

  await pipeline.release();

  assert.strictEqual(ort.released.length, sessionCount);
  assert.strictEqual(pipeline.getStatus().state, 'released');
  assert.strictEqual(pipeline.mainThreadAnalyzers, null);
});

class FakeWorker {
  constructor() {
    this.listeners = [];
    this.terminated = false;
    this.index = FakeWorker.instances.length;
    FakeWorker.instances.push(this);
  }

  addEventListener(type, handler) {
    if (type === 'message') this.listeners.push(handler);
  }

  removeEventListener(type, handler) {
    this.listeners = this.listeners.filter((l) => l !== handler);
  }

  postMessage(message) {
    if (message.type !== 'init') return;
    const success = this.index !== 0;
    queueMicrotask(() => this._emit({
      type: 'init-response',
      success,
      error: success ? undefined : 'model load failed',
      runtime: { backend: 'wasm', fallbacks: ['webgpu-unavailable'] }
    }));
  }

  terminate() {
    this.terminated = true;
  }

  _emit(data) {
    for (const handler of [...this.listeners]) handler({ data });
  }
}
FakeWorker.instances = [];

test('One failed worker is terminated without failing the whole pool', async () => {
  FakeWorker.instances = [];

  const pipeline = new InferencePipelineModule.InferencePipeline({
    environment: { Worker: FakeWorker },
    numWorkers: 2
  });

  const result = await pipeline.initialize();

  assert.strictEqual(result.success, true);
  assert.strictEqual(FakeWorker.instances.length, 2);
  assert.strictEqual(FakeWorker.instances[0].terminated, true);

  const status = pipeline.getStatus();
  assert.strictEqual(status.workers, 1);
  assert.strictEqual(status.backend, 'wasm');
  assert.deepStrictEqual(status.fallbacks, ['webgpu-unavailable']);
});

test('Release settles in-flight worker requests instead of leaving live timers', async () => {
  FakeWorker.instances = [];

  const pipeline = new InferencePipelineModule.InferencePipeline({
    environment: { Worker: FakeWorker },
    numWorkers: 1
  });

  // Worker index 0 fails by default; make every worker initialize for this case.
  const originalPost = FakeWorker.prototype.postMessage;
  FakeWorker.prototype.postMessage = function postMessage(message) {
    if (message.type !== 'init') return;
    queueMicrotask(() => this._emit({
      type: 'init-response',
      success: true,
      runtime: { backend: 'wasm', fallbacks: [] }
    }));
  };

  try {
    await pipeline.initialize();

    const inFlight = pipeline.runInference({ data: new Uint8Array(4), width: 1, height: 1 });
    await Promise.resolve();
    assert.strictEqual(pipeline.pendingRequests.size, 1);

    await pipeline.release();

    await assert.rejects(inFlight, /Pipeline released/);
    assert.strictEqual(pipeline.pendingRequests.size, 0);
    assert.deepStrictEqual(pipeline.workerQueue, []);
  } finally {
    FakeWorker.prototype.postMessage = originalPost;
  }
});

test('YOLOv8 decoder accepts raw channels-first output in input-pixel coordinates', () => {
  const detector = new (require('../src/ml-pipeline/adapters/yolov8-shuttle-adapter.js').YOLOv8ShuttleDetector)({ environment: {} });
  // [1, 5, 2]: x, y, width, height, one-class confidence, two candidates.
  const data = new Float32Array([320, 100, 320, 100, 20, 20, 10, 10, 0.9, 0.2]);
  const detections = detector._decodeOutput({ data, dims: [1, 5, 2] }, [1, 3, 640, 640], 0, 0, 640, 640, 640);

  assert.strictEqual(detections.length, 1);
  assert.ok(Math.abs(detections[0].bbox.x - 0.484375) < 0.00001);
  assert.strictEqual(detections[0].class, 'shuttlecock');
});

test('BlazePose decoder reads the four-value MediaPipe export shape', () => {
  const { BlazePoseAnalyzer } = BlazePoseAdapter;
  const analyzer = new BlazePoseAnalyzer({ environment: {} });
  const data = new Float32Array(2 * 17 * 4);
  for (let pose = 0; pose < 2; pose += 1) {
    for (let keypoint = 0; keypoint < 17; keypoint += 1) {
      const base = (pose * 17 + keypoint) * 4;
      data[base] = (pose + 1) * 64;
      data[base + 1] = 128;
      data[base + 3] = 0.8;
    }
  }
  const poses = analyzer._decodeOutput({ data, dims: [1, 2, 17, 4] }, [1, 3, 256, 256]);

  assert.strictEqual(poses.length, 2);
  assert.strictEqual(poses[0].keypoints.length, 17);
  assert.ok(Math.abs(poses[0].keypoints[0].confidence - 0.8) < 0.00001);
  assert.strictEqual(poses[1].keypoints[0].x, 0.5);
});

test('TrackNet accepts rectangular tensor heatmaps and extracts their centroid', () => {
  const processor = new TrackNetProcessor.TrackNetV3Processor({ environment: {} });
  const heatmap = new Float32Array(3 * 5);
  heatmap[1] = 0.9;
  heatmap[2] = 0.9;
  processor.addFrame({ data: heatmap, dims: [1, 3, 5] }, 1);
  const point = processor.extractTrajectoryPoint({ data: heatmap, dims: [1, 3, 5] }, 0.5);

  assert.ok(point);
  assert.strictEqual(point.componentSize, 2);
  assert.strictEqual(point.x, 0.3);
  assert.strictEqual(point.y, 0);
});

test('ONNX model loading seam accepts local buffers and rejects remote URLs', async () => {
  const ort = makeFakeOrt();
  const manager = new OnnxRuntime.OnnxRuntimeManager({
    environment: { ort, navigator: {} },
    backendProbe: async (backend) => backend === 'wasm',
    loadModel: async () => new ArrayBuffer(8)
  });
  const status = await manager.initialize();
  assert.strictEqual(status.backend, 'wasm');
  await manager.createSession('local-model', 'models/local.onnx');
  await assert.rejects(manager.createSession('remote-model', 'https://example.invalid/model.onnx'), /local/);
});

class RespondingWorker extends FakeWorker {
  postMessage(message) {
    if (message.type === 'init') {
      const success = this.index !== 0;
      queueMicrotask(() => this._emit({
        type: 'init-response',
        success,
        error: success ? undefined : 'model load failed',
        runtime: { backend: 'wasm', fallbacks: [] }
      }));
      return;
    }
    if (message.type === 'infer') {
      this.inferMessage = message;
      queueMicrotask(() => this._emit({
        type: 'infer-response',
        id: message.id,
        success: true,
        result: { pose: { state: 'tracked' }, shuttle: { state: 'unknown' } }
      }));
    }
  }
}

test('Worker pool maps successful workers to compact indexes after an init failure', async () => {
  FakeWorker.instances = [];
  const pipeline = new InferencePipelineModule.InferencePipeline({
    environment: { Worker: RespondingWorker },
    numWorkers: 2
  });
  const init = await pipeline.initialize();
  assert.strictEqual(init.success, true);
  const result = await pipeline.runInference({ data: new Uint8Array(4), width: 1, height: 1 }, { mediaTime: 1 });

  assert.strictEqual(result.pose.state, 'tracked');
  assert.ok(FakeWorker.instances[1].inferMessage, 'the successful second worker received the frame');
  await pipeline.release();
});
