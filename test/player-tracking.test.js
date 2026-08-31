const test = require('node:test');
const assert = require('node:assert/strict');
const tracking = require('../src/extension/common/player-tracking.js');

function pose(id, x, { confidence = 0.9, y = 0.2, width = 0.1, keypoints = true, state = 'tracked' } = {}) {
  return {
    observationId: id,
    coordinateSpace: 'normalized',
    bbox: { x, y, width, height: 0.3 },
    confidence,
    state,
    keypoints: keypoints ? [
      { name: 'nose', x: x + width / 2, y: y + 0.06, confidence: 0.9 },
      { name: 'hip', x: x + width / 2, y: y + 0.22, confidence: 0.9 }
    ] : []
  };
}

function frame(sessionId, requestId, mediaTime, observations, extra = {}) {
  return { sessionId, requestId, mediaTime, observations, ...extra };
}

function playersByX(result) {
  return result.players.filter((player) => player.bbox).sort((a, b) => a.bbox.x - b.bbox.x);
}

test('normalization produces a validated versioned normalized pose and explicit unknown state', () => {
  const normalized = tracking.normalizePoseObservation({
    observationId: 'det:7',
    sessionId: 'session-1',
    requestId: 'request-7',
    mediaTime: 12.5,
    coordinateSpace: 'pixel',
    frame: { width: 1000, height: 500 },
    bbox: { xMin: 100, yMin: 50, xMax: 300, yMax: 450 },
    keypoints: [{ name: 'nose', x: 200, y: 100, confidence: 0.8 }],
    confidence: 0.92,
    state: 'tracked',
    detector: { id: 'candidate-pose', version: 3 },
    source: { id: 'camera-main', version: 1, kind: 'video-frame' }
  });
  assert.equal(normalized.schema, tracking.OBSERVATION_SCHEMA);
  assert.deepEqual(normalized.bbox, { x: 0.1, y: 0.1, width: 0.2, height: 0.8 });
  assert.deepEqual(normalized.keypoints[0], { name: 'nose', x: 0.2, y: 0.2, confidence: 0.8 });
  assert.equal(normalized.detector.id, 'candidate-pose');
  assert.equal(normalized.source.id, 'camera-main');
  assert.equal(normalized.state, 'tracked');
  assert.equal(tracking.isPoseObservation(normalized), true);

  const unknown = tracking.normalizePoseObservation({
    observationId: 'missing', sessionId: 'session-1', requestId: 'request-8', mediaTime: 13,
    state: 'unknown', detector: 'not-selected', source: 'camera-main'
  });
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.bbox, null);
  assert.equal(unknown.confidence, null);
  assert.equal(tracking.isPoseObservation(unknown), true);
});

test('two players retain session-local IDs through ordinary motion and detection reorder', () => {
  const tracker = new tracking.SessionPlayerTracker({ sessionId: 'match' });
  const first = tracker.processFrame(frame('match', 'r1', 1, [pose('a', 0.1), pose('b', 0.7)])).result;
  const firstPlayers = playersByX(first);
  assert.equal(firstPlayers.length, 2);
  const leftId = firstPlayers[0].trackId;
  const rightId = firstPlayers[1].trackId;

  const second = tracker.processFrame(frame('match', 'r2', 2, [pose('b-next', 0.61), pose('a-next', 0.19)])).result;
  const secondPlayers = playersByX(second);
  assert.deepEqual(secondPlayers.map((player) => player.trackId), [leftId, rightId]);
  assert.deepEqual(secondPlayers.map((player) => player.state), ['tracked', 'tracked']);
  assert.deepEqual(second.association.matched.map((match) => match.trackId).sort(), [leftId, rightId].sort());
  assert.equal(second.players.some((player) => Object.hasOwn(player, 'courtHalf')), false);
  assert.equal(tracking.isTrackingResult(second), true);
});

test('default capacity supports four simultaneous players without using court half identity', () => {
  const tracker = new tracking.SessionPlayerTracker({ sessionId: 'doubles' });
  const observations = [0.04, 0.27, 0.5, 0.73, 0.86].map((x, index) => pose(`p${index}`, x, { width: 0.08 }));
  const result = tracker.processFrame(frame('doubles', 'r1', 1, observations)).result;
  assert.equal(result.players.length, 4);
  assert.equal(result.association.maxTracks, 4);
  assert.equal(new Set(result.players.map((player) => player.trackId)).size, 4);
  assert.equal(result.players.every((player) => !Object.hasOwn(player, 'courtHalf')), true);
});

test('short occlusion emits partial state and recovers the original ID', () => {
  const tracker = new tracking.SessionPlayerTracker({ sessionId: 'occlusion' });
  const first = tracker.processFrame(frame('occlusion', 'r1', 1, [pose('a', 0.1), pose('b', 0.7)])).result;
  const leftId = playersByX(first)[0].trackId;
  const missing = tracker.processFrame(frame('occlusion', 'r2', 2, [pose('b2', 0.66)])).result;
  const leftDuringOcclusion = missing.players.find((player) => player.trackId === leftId);
  assert.equal(leftDuringOcclusion.state, 'partial');
  assert.equal(leftDuringOcclusion.missedFrames, 1);
  assert.equal(missing.association.identityRisk, 'none');

  const recovered = tracker.processFrame(frame('occlusion', 'r3', 3, [pose('a3', 0.2), pose('b3', 0.62)])).result;
  const leftAfterRecovery = recovered.players.find((player) => player.trackId === leftId);
  assert.equal(leftAfterRecovery.state, 'tracked');
  assert.equal(leftAfterRecovery.observationId, 'a3');
});

test('crossover ambiguity is quarantined as unknown instead of silently swapping IDs', () => {
  const tracker = new tracking.SessionPlayerTracker({ sessionId: 'cross' });
  tracker.processFrame(frame('cross', 'r0', 0, [pose('a0', 0.2, { keypoints: false }), pose('b0', 0.7, { keypoints: false })]));
  const moving = tracker.processFrame(frame('cross', 'r1', 1, [pose('a1', 0.3, { keypoints: false }), pose('b1', 0.6, { keypoints: false })])).result;
  const ids = playersByX(moving).map((player) => player.trackId);
  const crossover = tracker.processFrame(frame('cross', 'r2', 2, [
    pose('a2', 0.47, { width: 0.1, keypoints: false }),
    pose('b2', 0.53, { width: 0.1, keypoints: false })
  ])).result;
  assert.equal(crossover.association.identityRisk, 'likely-id-switch-or-crossover');
  assert.deepEqual(new Set(crossover.association.ambiguousTrackIds), new Set(ids));
  assert.equal(crossover.players.every((player) => player.state === 'unknown'), true);

  const recovered = tracker.processFrame(frame('cross', 'r3', 3, [
    pose('a3', 0.6, { keypoints: false }), pose('b3', 0.4, { keypoints: false })
  ])).result;
  assert.equal(recovered.players.find((player) => player.trackId === ids[0]).state, 'tracked');
  assert.equal(recovered.players.find((player) => player.trackId === ids[1]).state, 'tracked');
});

test('duplicate, low-confidence, missing, and unknown observations remain explicit', () => {
  const tracker = new tracking.SessionPlayerTracker({ sessionId: 'quality' });
  const duplicate = tracker.processFrame(frame('quality', 'r1', 1, [
    pose('z-low', 0.2, { confidence: 0.6 }), pose('a-high', 0.2, { confidence: 0.9 })
  ])).result;
  assert.equal(duplicate.players.length, 1);
  assert.equal(duplicate.observations.length, 1);
  assert.deepEqual(duplicate.duplicateObservations, [{ duplicateObservationId: 'z-low', keptObservationId: 'a-high' }]);

  const low = tracker.processFrame(frame('quality', 'r2', 2, [pose('low', 0.4, { confidence: 0.1 })])).result;
  assert.equal(low.players[0].state, 'partial');
  assert.equal(low.players[0].confidence, null);

  const unknown = tracker.processFrame(frame('quality', 'r3', 3, [{ observationId: 'u', state: 'unknown' }])).result;
  assert.equal(unknown.observations[0].state, 'unknown');
  assert.equal(unknown.players[0].state, 'partial');

  const empty = new tracking.SessionPlayerTracker({ sessionId: 'empty' }).processFrame(frame('empty', 'r1', 1, [])).result;
  assert.equal(empty.state, 'unknown');
  assert.deepEqual(empty.players, []);
});

test('stale and duplicate requests do not mutate tracks; reset and camera cuts create new IDs', () => {
  const tracker = new tracking.SessionPlayerTracker({ sessionId: 'reset' });
  const first = tracker.processFrame(frame('reset', 'r1', 10, [pose('a', 0.1)])).result;
  const oldId = first.players[0].trackId;
  const stale = tracker.processFrame(frame('reset', 'r0', 9, [pose('a-old', 0.9)]));
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'stale-frame');
  assert.equal(stale.result.players[0].trackId, oldId);
  assert.equal(stale.result.players[0].state, 'unknown');
  const duplicate = tracker.processFrame(frame('reset', 'r1', 10, [pose('again', 0.9)]));
  assert.equal(duplicate.reason, 'duplicate-request');
  assert.equal(duplicate.result.players[0].trackId, oldId);

  const reset = tracker.processFrame(frame('reset', 'r2', 1, [pose('new', 0.8)], { cameraCut: true })).result;
  assert.notEqual(reset.players[0].trackId, oldId);
  assert.equal(reset.players[0].trackId, 'reset:s1:player-1');
  assert.equal(reset.mediaTime, 1);
});
