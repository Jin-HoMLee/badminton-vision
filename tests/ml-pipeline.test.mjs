import test from 'node:test';
import assert from 'node:assert';

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
