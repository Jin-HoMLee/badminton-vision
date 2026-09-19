const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
global.BSOProtocol = protocol;
const shuttle = require('../src/extension/offscreen/shuttle-tracking-adapter.js');
const sceneChangeEvidence = require('./fixtures/scene-change-evidence.json');

const WIDTH = 40;
const HEIGHT = 20;
const CANONICAL_BWF_IDS = ['bwf-ws-2026', 'bwf-md-2026', 'bwf-md-2018'];

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

function twoToneFrame(invert = false, first = [0, 0, 0], second = [255, 255, 255]) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  const half = Math.floor(WIDTH / 2);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const left = x < half;
      const value = (left !== invert) ? first : second;
      const offset = (y * WIDTH + x) * 4;
      data[offset] = value[0];
      data[offset + 1] = value[1];
      data[offset + 2] = value[2];
      data[offset + 3] = 255;
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

function shuttleResult(message) {
  assert.equal(message.type, protocol.TYPES.ANALYZER_RESULT);
  return message.result.shuttle;
}

function mergeGroundTruth(broadcast) {
  const spans = broadcast.handMarkedTransitions.map((transition) => ({
    start: transition.start,
    end: transition.end,
    sources: [transition.source]
  }));
  const uncertain = [];
  for (const transition of broadcast.verifiedTransitions) {
    if (transition.verdict === 'real') {
      spans.push({
        start: transition.t - sceneChangeEvidence.verifiedCandidateWindowSeconds,
        end: transition.t + sceneChangeEvidence.verifiedCandidateWindowSeconds,
        sources: [transition.source]
      });
    } else if (transition.verdict === 'uncertain') {
      uncertain.push(transition.t);
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const transitions = [];
  for (const span of spans) {
    const previous = transitions.at(-1);
    if (previous && span.start <= previous.end + sceneChangeEvidence.matchToleranceSeconds) {
      previous.end = Math.max(previous.end, span.end);
      previous.sources = [...new Set([...previous.sources, ...span.sources])];
    } else {
      transitions.push({ ...span, sources: span.sources.slice() });
    }
  }
  return { transitions, uncertain };
}

function courtViewContains(broadcast, mediaTime) {
  return broadcast.courtView.some((interval) => mediaTime >= interval.start && mediaTime < interval.end);
}

function scoreSceneChanges(broadcast, threshold) {
  const truth = mergeGroundTruth(broadcast);
  const events = shuttle.detectSceneChangeEvents(broadcast.samples, threshold);
  const hits = new Array(truth.transitions.length).fill(false);
  const falseEvents = [];
  let uncertainHits = 0;
  for (const event of events) {
    let matched = false;
    truth.transitions.forEach((transition, index) => {
      if (event.t >= transition.start - sceneChangeEvidence.matchToleranceSeconds &&
          event.t <= transition.end + sceneChangeEvidence.matchToleranceSeconds) {
        hits[index] = true;
        matched = true;
      }
    });
    if (matched) continue;
    if (truth.uncertain.some((time) => Math.abs(time - event.t) <= sceneChangeEvidence.matchToleranceSeconds)) {
      uncertainHits += 1;
      continue;
    }
    falseEvents.push(event);
  }
  const courtSeconds = broadcast.courtView.reduce((sum, interval) => sum + interval.end - interval.start, 0);
  const detected = hits.filter(Boolean).length;
  return {
    events: events.length,
    transitions: truth.transitions.length,
    detected,
    recall: truth.transitions.length ? detected / truth.transitions.length : null,
    falseEvents: falseEvents.length,
    falseInCourt: falseEvents.filter((event) => courtViewContains(broadcast, event.t)).length,
    falsePer60Seconds: courtSeconds ? falseEvents.length / (courtSeconds / 60) : null,
    uncertainHits
  };
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

test('RGB histogram distance detects a genuine broadcast cut and quarantines downstream trajectory state', () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  adapter.processFrame(sample('r0', 0, frame({ fill: 0 })));
  adapter.processFrame(sample('r1', 0.1, frame({ dots: [{ x: 8 }] })));
  const tracked = adapter.processFrame(sample('r2', 0.2, frame({ dots: [{ x: 9 }] })));
  assert.equal(shuttleResult(tracked).state, 'tracked');

  const cut = adapter.processFrame(sample('r3', 0.3, frame({ fill: 255 })));
  const value = shuttleResult(cut);
  assert.equal(value.state, 'unknown');
  assert.equal(value.reason, 'camera-cut');
  assert.equal(value.confidence, null);
  assert.equal(value.candidate, null);
  assert.equal(value.trajectory.length, 0);
  assert.equal(value.evidence.sceneChange >= 0.15, true);
  assert.equal(value.evidence.cameraCut, true);
  assert.equal(value.evidence.sceneChangeThreshold, 0.15);
});

test('checksum-backed cross-broadcast histogram gate meets the 0.15 entry bound', () => {
  assert.equal(sceneChangeEvidence.candidateThreshold, shuttle.DEFAULTS.sceneChangeThreshold);
  assert.equal(sceneChangeEvidence.debounceSeconds, shuttle.SCENE_CHANGE_DEBOUNCE_SECONDS);
  assert.match(sceneChangeEvidence.broadcastManifestChecksum, /^[0-9a-f]{64}$/);
  assert.equal(sceneChangeEvidence.broadcasts.length, 5);
  assert.deepEqual(
    sceneChangeEvidence.broadcasts
      .filter((broadcast) => CANONICAL_BWF_IDS.includes(broadcast.id))
      .map((broadcast) => broadcast.id)
      .sort(),
    CANONICAL_BWF_IDS.slice().sort()
  );
  assert.deepEqual(
    sceneChangeEvidence.broadcasts
      .filter((broadcast) => broadcast.sceneChangesComplete === false)
      .map((broadcast) => broadcast.id),
    ['negative-basketball']
  );

  for (const broadcast of sceneChangeEvidence.broadcasts) {
    assert.match(broadcast.id, /^(bwf-ws-2026|bwf-md-2026|bwf-md-2018|club-fixed-cam|negative-basketball)$/);
    assert.match(broadcast.url, /^https:\/\/www\.youtube\.com\/watch\?v=/);
    assert.ok(broadcast.sourceChecksums.passA, `${broadcast.id} is missing its pass-A checksum`);
    assert.ok(broadcast.sourceChecksums.timeline, `${broadcast.id} is missing its timeline checksum`);
    assert.equal(typeof broadcast.sceneChangesComplete, 'boolean');
    assert.ok(broadcast.samples.every((sample) => sample.hd >= sceneChangeEvidence.candidateThreshold));
    assert.equal(
      Number(broadcast.courtView.reduce((sum, interval) => sum + interval.end - interval.start, 0).toFixed(1)),
      broadcast.courtViewSeconds,
      `${broadcast.id} court-view duration must match its intervals`
    );

    if (CANONICAL_BWF_IDS.includes(broadcast.id)) {
      assert.equal(broadcast.sceneChangesComplete, true, `${broadcast.id} must remain in the scored gate`);
    }
    if (broadcast.sceneChangesComplete === false) continue;

    const score = scoreSceneChanges(broadcast, shuttle.DEFAULTS.sceneChangeThreshold);
    if (score.transitions > 0) {
      assert.ok(score.recall >= 0.90, `${broadcast.id} recall ${score.recall.toFixed(4)} < 0.90`);
    }
    assert.ok(score.falsePer60Seconds == null || score.falsePer60Seconds <= 1,
      `${broadcast.id} false-event rate ${score.falsePer60Seconds} > 1 per 60 seconds`);
    assert.ok(score.falseInCourt <= 1, `${broadcast.id} has repeated court-view false events`);
    assert.equal(score.falseEvents, 0, `${broadcast.id} has an unmarked scene-change event`);
  }
});

test('histogram scene change rejects the old mean-luminance false positive during fast court motion', () => {
  const previous = twoToneFrame(false);
  const current = twoToneFrame(true);
  const detected = shuttle.detectCandidates({ ...current, channels: 4 }, { ...previous, channels: 4 });
  assert.equal(detected.cameraCut, false);
  assert.equal(detected.evidence.cameraCut, false);
  assert.equal(detected.sceneChange, 0);
  // Every pixel moved between black and white, which made the old signal
  // cross both of its cut gates despite this being the same colour scene.
  assert.equal(detected.evidence.meanDifference, 1);
  assert.equal(detected.evidence.changedFraction, 1);
});

test('scene-change boolean is debounced by the quarantined baseline and resets for the new scene', () => {
  const adapter = new shuttle.LocalShuttleTrajectoryAdapter();
  adapter.processFrame(sample('r0', 0, frame({ fill: 0 })));
  const cut = adapter.processFrame(sample('r1', 0.1, frame({ fill: 255 })));
  assert.equal(shuttleResult(cut).reason, 'camera-cut');

  // The cut frame is the new baseline. Holding the new camera view must not
  // emit another boolean cut, even though the previous result was quarantined.
  const held = adapter.processFrame(sample('r2', 0.2, frame({ fill: 255 })));
  assert.equal(shuttleResult(held).reason, 'no-candidate');
  assert.equal(shuttleResult(held).evidence.sceneChange, 0);
  assert.equal(shuttleResult(held).evidence.cameraCut, false);

  // A reset clears the baseline, so the next frame warms up instead of
  // comparing against the old camera scene.
  adapter.reset('test-reset');
  const warmed = adapter.processFrame(sample('r3', 0.3, frame({ fill: 255 })));
  assert.equal(shuttleResult(warmed).reason, 'warming-up');
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
