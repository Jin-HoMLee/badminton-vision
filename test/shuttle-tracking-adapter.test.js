const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
global.BSOProtocol = protocol;
const shuttle = require('../src/extension/offscreen/shuttle-tracking-adapter.js');

const WIDTH = 40;
const HEIGHT = 20;

function frame({ dots = [], fill = 0, block = null } = {}) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    data[pixel * 4] = fill;
    data[pixel * 4 + 1] = fill;
    data[pixel * 4 + 2] = fill;
    data[pixel * 4 + 3] = 255;
  }
  const points = block ? [block] : dots;
  points.forEach(({ x, y = 10, size = 3, value = 255 }) => {
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= WIDTH || py < 0 || py >= HEIGHT) continue;
        const offset = (py * WIDTH + px) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
      }
    }
  });
  return { width: WIDTH, height: HEIGHT, data };
}

function sample(requestId, mediaTime, pixels, extra = {}) {
  return {
    sessionId: 'shuttle-test',
    requestId,
    mediaTime,
    capturedAt: mediaTime * 1000 + 100,
    dimensions: { width: WIDTH, height: HEIGHT },
    frame: pixels,
    frameFormat: 'rgba-array-v1',
    ...extra
  };
}

function shuttleResult(message) {
  assert.equal(message.type, protocol.TYPES.ANALYZER_RESULT);
  return message.result.shuttle;
}

test('local adapter emits a model-neutral tracked candidate after temporal continuity', () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  const warmup = adapter.processFrame(sample('r0', 0, frame()));
  assert.equal(shuttleResult(warmup).state, 'unknown');
  assert.equal(shuttleResult(warmup).reason, 'warming-up');

  const anchor = adapter.processFrame(sample('r1', 0.1, frame({ dots: [{ x: 8 }] })));
  assert.equal(shuttleResult(anchor).state, 'unknown');
  assert.equal(shuttleResult(anchor).reason, 'candidate-needs-continuity');

  const tracked = adapter.processFrame(sample('r2', 0.2, frame({ dots: [{ x: 9 }] })));
  const shuttleResultValue = shuttleResult(tracked);
  assert.equal(tracked.analyzer, shuttle.MODEL.id);
  assert.equal(tracked.inferenceAvailable, true);
  assert.equal(tracked.result.modelNeutral, true);
  assert.equal(shuttleResultValue.state, 'tracked');
  assert.ok(shuttleResultValue.confidence >= shuttle.DEFAULTS.minTrackedConfidence);
  assert.equal(shuttleResultValue.accepted, true);
  assert.equal(shuttleResultValue.trajectory.length, 2);
  assert.ok(shuttleResultValue.trajectory[1].x > shuttleResultValue.trajectory[0].x);
  assert.equal(shuttleResultValue.candidate.accepted, true);
});

test('static highlights and oversized moving regions are rejected rather than treated as the shuttle', () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  adapter.processFrame(sample('r0', 0, frame({ dots: [{ x: 3, y: 3, size: 3 }] })));
  const staticResult = adapter.processFrame(sample('r1', 0.1, frame({ dots: [{ x: 3, y: 3, size: 3 }] })));
  assert.equal(shuttleResult(staticResult).state, 'unknown');
  assert.equal(shuttleResult(staticResult).reason, 'no-candidate');

  // A player-sized residual is deliberately not compact enough for this
  // bounded shuttle proposal, even though it has strong frame difference.
  const large = new shuttle.LocalShuttleTrajectoryAdapter();
  large.processFrame(sample('large-0', 0, frame()));
  const largeResult = large.processFrame(sample('large-1', 0.1, frame({ block: { x: 10, y: 2, size: 8 } })));
  const largeShuttle = shuttleResult(largeResult);
  assert.equal(largeShuttle.state, 'unknown');
  assert.equal(largeShuttle.reason, 'no-candidate');
  assert.ok(largeShuttle.evidence.rejected.some((candidate) => candidate.evidence || candidate.rejectionReason));
});

test('continuity gate quarantines a jump and missing candidates never become a prediction', () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  adapter.processFrame(sample('r0', 0, frame()));
  adapter.processFrame(sample('r1', 0.1, frame({ dots: [{ x: 8 }] })));
  assert.equal(shuttleResult(adapter.processFrame(sample('r2', 0.2, frame({ dots: [{ x: 9 }] })))).state, 'tracked');

  const jump = adapter.processFrame(sample('r3', 0.3, frame({ dots: [{ x: 34 }] })));
  assert.equal(shuttleResult(jump).state, 'unknown');
  assert.equal(shuttleResult(jump).reason, 'continuity-rejected');
  assert.equal(shuttleResult(jump).candidate, null);
  assert.equal(shuttleResult(jump).trajectory.length, 0);

  const afterJump = adapter.processFrame(sample('r4', 0.4, frame({ dots: [{ x: 35 }] })));
  assert.equal(shuttleResult(afterJump).state, 'unknown');
  assert.equal(shuttleResult(afterJump).reason, 'candidate-needs-continuity');

  const missing = adapter.processFrame(sample('r5', 0.5, frame()));
  assert.equal(shuttleResult(missing).state, 'unknown');
  assert.equal(shuttleResult(missing).reason, 'no-candidate');
  assert.equal(shuttleResult(missing).candidate, null);
  assert.equal(shuttleResult(missing).trajectory.length, 0);
});

test('ambiguous candidates and camera cuts reset the trajectory state', () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  adapter.processFrame(sample('r0', 0, frame()));
  const ambiguous = adapter.processFrame(sample('r1', 0.1, frame({ dots: [{ x: 6 }, { x: 28 }] })));
  assert.equal(shuttleResult(ambiguous).state, 'unknown');
  assert.equal(shuttleResult(ambiguous).reason, 'ambiguous-candidates');

  // Explicit cut is quarantined even if the pixels happen to contain a bright
  // compact object; it is never bridged into the old trajectory.
  const cut = adapter.processFrame(sample('r2', 0.2, frame({ dots: [{ x: 7 }] }), { cameraCut: true }));
  assert.equal(shuttleResult(cut).state, 'unknown');
  assert.equal(shuttleResult(cut).reason, 'camera-cut');
  assert.equal(shuttleResult(cut).trajectory.length, 0);

  const freshAnchor = adapter.processFrame(sample('r3', 0.3, frame({ dots: [{ x: 8 }] })));
  assert.equal(shuttleResult(freshAnchor).state, 'unknown');
  assert.equal(shuttleResult(freshAnchor).reason, 'candidate-needs-continuity');
  const fresh = adapter.processFrame(sample('r4', 0.4, frame({ dots: [{ x: 9 }] })));
  assert.equal(shuttleResult(fresh).state, 'tracked');
  assert.equal(shuttleResult(fresh).trajectory[0].requestId, 'r3');
});

test('invalid, stale, and backwards samples do not mutate the accepted trajectory', () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  adapter.processFrame(sample('r0', 0, frame()));
  adapter.processFrame(sample('r1', 0.1, frame({ dots: [{ x: 8 }] })));
  const tracked = adapter.processFrame(sample('r2', 0.2, frame({ dots: [{ x: 9 }] })));
  assert.equal(shuttleResult(tracked).state, 'tracked');
  const before = shuttleResult(tracked).trajectory;

  const stale = adapter.processFrame(sample('stale', 0.1, frame({ dots: [{ x: 30 }] })));
  assert.equal(shuttleResult(stale).reason, 'stale-frame');
  const nextAnchor = adapter.processFrame(sample('r3', 0.3, frame({ dots: [{ x: 10 }] })));
  assert.equal(shuttleResult(nextAnchor).state, 'unknown');
  assert.equal(shuttleResult(nextAnchor).reason, 'candidate-needs-continuity');
  const next = adapter.processFrame(sample('r3b', 0.35, frame({ dots: [{ x: 11 }] })));
  assert.equal(shuttleResult(next).state, 'tracked');
  assert.equal(shuttleResult(next).trajectory.length, 2);
  assert.equal(shuttleResult(next).trajectory[0].requestId, 'r3');
  assert.equal(before.length, 2);

  const invalid = adapter.processFrame(sample('invalid', 0.4, { width: WIDTH, height: HEIGHT, data: [1, 2, 3] }));
  assert.equal(shuttleResult(invalid).state, 'unknown');
  assert.equal(shuttleResult(invalid).reason, 'invalid-frame');
  const resumed = adapter.processFrame(sample('r4', 0.5, frame({ dots: [{ x: 11 }] })));
  assert.equal(shuttleResult(resumed).reason, 'warming-up');
});

test('automatic global frame change is treated as a camera cut and first samples are unknown', () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  const first = adapter.processFrame(sample('r0', 0, frame({ fill: 0 })));
  assert.equal(shuttleResult(first).state, 'unknown');
  const cut = adapter.processFrame(sample('r1', 0.1, frame({ fill: 255 })));
  assert.equal(shuttleResult(cut).state, 'unknown');
  assert.equal(shuttleResult(cut).reason, 'camera-cut');
  assert.equal(shuttleResult(cut).confidence, null);
});

test('async analyzer drops concurrent work as backpressure without changing state', async () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  const firstPromise = adapter.analyze(sample('r0', 0, frame()));
  const dropped = await adapter.analyze(sample('r1', 0.1, frame({ dots: [{ x: 8 }] })));
  assert.equal(shuttleResult(dropped).state, 'unknown');
  assert.equal(shuttleResult(dropped).reason, 'backpressure');
  assert.equal(shuttleResult(dropped).accepted, false);
  await firstPromise;

  const anchor = await adapter.analyze(sample('r2', 0.2, frame({ dots: [{ x: 8 }] })));
  assert.equal(shuttleResult(anchor).reason, 'candidate-needs-continuity');
});
