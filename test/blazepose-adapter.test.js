const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
const tracking = require('../src/extension/common/player-tracking.js');
global.BSOProtocol = protocol;
global.BSOPlayerTracking = tracking;
const blaze = require('../src/extension/offscreen/blazepose-adapter.js');

// Canonical MediaPipe BlazePose landmark indices for the 17 COCO pose names.
const CANONICAL = {
  nose: 0, left_eye: 2, right_eye: 5, left_ear: 7, right_ear: 8,
  left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16, left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26, left_ankle: 27, right_ankle: 28
};

function logit(probability) {
  return Math.log(probability / (1 - probability));
}

/**
 * Build the documented [1, 195] landmark output (39 landmarks x 5 values:
 * x, y, z, visibility, presence). Placed keypoints get a distinct position;
 * the remaining landmarks stay at 0,0 with zero visibility.
 */
function landmarkOutput(placements, options = {}) {
  const values = new Float32Array(39 * 5);
  const visibilityLogit = options.visibilityLogit == null ? logit(options.visibility || 0.9) : options.visibilityLogit;
  const presenceLogit = options.presenceLogit == null ? logit(options.presence || 0.9) : options.presenceLogit;
  for (const [blazeIndex, point] of Object.entries(placements)) {
    const offset = Number(blazeIndex) * 5;
    values[offset] = point.x;
    values[offset + 1] = point.y;
    values[offset + 2] = options.zAtLandmarks === false ? 0.95 : (point.z == null ? 0.5 : point.z);
    values[offset + 3] = visibilityLogit;
    values[offset + 4] = presenceLogit;
  }
  return values;
}

function defaultOptions(overrides = {}) {
  return Object.assign({
    sessionId: 'blaze-session',
    requestId: 'blaze:1',
    mediaTime: 1,
    minPoseScore: 0.25,
    minPartialPoseScore: 0.05,
    keypointScoreThreshold: 0.2,
    minVisibleKeypoints: 4,
    posePresence: 0.9
  }, overrides);
}

function poseAt(x, y) {
  return { x, y };
}

function twoPlayerPlacements() {
  const placements = {};
  Object.entries(CANONICAL).forEach(([name, blazeIndex]) => {
    const leftSide = name.indexOf('left_') === 0;
    const y = name.indexOf('_shoulder') > 0 || name.indexOf('_elbow') > 0 || name.indexOf('_wrist') > 0 || name.indexOf('nose') === 0 || name.indexOf('_eye') > 0 || name.indexOf('_ear') > 0 ? 0.25 : 0.65;
    placements[blazeIndex] = poseAt(leftSide ? 0.2 : 0.7, y);
  });
  return placements;
}

test('decoder reads the canonical BlazePose ordering into COCO-named keypoints', () => {
  const placements = twoPlayerPlacements();
  const decoded = blaze.decodeBlazePoseOutput(landmarkOutput(placements), defaultOptions());
  assert.equal(decoded.length, 1);
  const observation = decoded[0];
  assert.equal(observation.state, 'tracked');
  assert.equal(observation.coordinateSpace, 'normalized');
  const byName = {};
  observation.keypoints.forEach((keypoint) => { byName[keypoint.name] = keypoint; });

  // The identity table would read the face landmarks; the canonical mapping
  // must read shoulders from BlazePose indices 11/12, wrists 15/16, hips
  // 23/24, knees 25/26, and ankles 27/28.
  const expectations = [
    ['left_shoulder', 11], ['right_shoulder', 12], ['left_elbow', 13], ['right_elbow', 14],
    ['left_wrist', 15], ['right_wrist', 16], ['left_hip', 23], ['right_hip', 24],
    ['left_knee', 25], ['right_knee', 26], ['left_ankle', 27], ['right_ankle', 28],
    ['nose', 0], ['left_eye', 2], ['right_eye', 5], ['left_ear', 7], ['right_ear', 8]
  ];
  for (const [name, blazeIndex] of expectations) {
    assert.equal(byName[name].x, placements[blazeIndex].x, `${name} x comes from BlazePose index ${blazeIndex}`);
    assert.equal(byName[name].y, placements[blazeIndex].y, `${name} y comes from BlazePose index ${blazeIndex}`);
  }
  assert.equal(observation.keypoints.length, 17);
});

test('decoder uses the sigmoid visibility channel, not the depth channel, as keypoint confidence', () => {
  const placements = twoPlayerPlacements();
  const visibility = 0.8;
  // z is near 1.0 for every landmark; if it were treated as confidence the
  // pose would look perfect regardless of actual visibility.
  const output = landmarkOutput(placements, { visibility, presence: 0.9 });
  for (let index = 0; index < 33; index += 1) output[index * 5 + 2] = 0.999;
  const decoded = blaze.decodeBlazePoseOutput(output, defaultOptions());
  const expected = Number((1 / (1 + Math.exp(-logit(visibility)))).toFixed(6));
  const byName = {};
  decoded[0].keypoints.forEach((keypoint) => { byName[keypoint.name] = keypoint; });
  assert.equal(byName.left_wrist.confidence, expected);
  assert.equal(byName.right_ankle.confidence, expected);
  assert.notEqual(byName.left_wrist.confidence, 0.999);
});

test('decoder gates the pose on the presence flag when supplied and falls back to mean visibility otherwise', () => {
  const placements = twoPlayerPlacements();
  const withPresence = blaze.decodeBlazePoseOutput(
    landmarkOutput(placements, { visibility: 0.9 }),
    defaultOptions({ posePresence: 0.9 })
  );
  assert.equal(withPresence[0].state, 'tracked');
  assert.equal(withPresence[0].confidence, 0.9);

  // A low presence flag keeps the pose below tracked even with visible joints.
  const gated = blaze.decodeBlazePoseOutput(
    landmarkOutput(placements, { visibility: 0.9 }),
    defaultOptions({ posePresence: 0.02 })
  );
  assert.notEqual(gated[0].state, 'tracked');

  // Without a presence flag the mean keypoint visibility decides.
  const fallback = blaze.decodeBlazePoseOutput(
    landmarkOutput(placements, { visibility: 0.9 }),
    defaultOptions({ posePresence: null })
  );
  assert.equal(fallback[0].state, 'tracked');
  assert.ok(fallback[0].confidence > 0.85 && fallback[0].confidence < 0.95);
});

test('decoder rejects outputs shorter than the documented 39-landmark layout', () => {
  const values = new Float32Array(99); // the pre-fix 33 x 3 layout
  assert.throws(() => blaze.decodeBlazePoseOutput(values, defaultOptions()), /too short/);
});

test('adapter feeds an RGBA array frame through a graph model and reports one tracked player', async () => {
  const disposed = [];
  function tensor(shape, values = new Float32Array(shape.reduce((a, b) => a * b, 1))) {
    return {
      shape,
      data: async () => values,
      dispose() { disposed.push(this); }
    };
  }
  let fromPixelsArg = null;
  let executedInput = null;
  const landmarkValues = landmarkOutput(twoPlayerPlacements(), { visibility: 0.9, presence: 0.9 });
  const tf = {
    setBackend: async () => true,
    ready: async () => {},
    getBackend: () => 'webgl',
    tensor: () => tensor([1, 3]),
    add: () => tensor([1, 3]),
    browser: { fromPixels(pixels) { fromPixelsArg = pixels; return tensor([256, 256, 3]); } },
    expandDims: (value) => value,
    image: { resizeBilinear: (value) => value },
    cast: (value) => value
  };
  const analyzer = new blaze.BlazePoseAnalyzer({ tf, tracking, environment: { location: { href: 'chrome-extension://test/offscreen/offscreen.html' } } });
  analyzer.initialize = async () => ({ available: true });
  analyzer.model = {
    execute(input) { executedInput = input; return [tensor([1, 39, 5], landmarkValues), tensor([1, 1], Float32Array.from([0.9]))]; },
    dispose() {}
  };

  const rgba = new Uint8Array(2 * 2 * 4).fill(255);
  const result = await analyzer.analyze({
    sessionId: 'blaze', requestId: 'blaze:1', mediaTime: 1,
    frame: { width: 2, height: 2, data: rgba }
  });
  assert.equal(result.inferenceAvailable, true);
  assert.equal(result.status, 'ok');
  assert.equal(result.analyzer, blaze.MODEL.id);
  assert.equal(result.result.state, 'tracked');
  assert.equal(result.result.players.length, 1);
  assert.equal(result.result.players[0].state, 'tracked');
  // The RGBA-array frame must reach TensorFlow.js as typed pixel data with
  // its original dimensions (stable Chrome's rgba-array-v1 transport).
  assert.ok(fromPixelsArg.data instanceof Uint8Array);
  assert.equal(fromPixelsArg.data.length, 16);
  assert.equal(fromPixelsArg.width, 2);
  assert.equal(fromPixelsArg.height, 2);
  assert.ok(executedInput);
  const keypointNames = result.result.players[0].keypoints.map((keypoint) => keypoint.name);
  assert.deepEqual(keypointNames, blaze.KEYPOINT_NAMES);
});
