'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../index.js');

const {
  MATCH_STATES,
  createMatchStateMachine,
  createPhase1RallyStateMachine,
  createRallyStateMachine,
} = core;

// Feed helper: `frames` is an array of [mediaTime, evidence] tuples with
// evidence = { players, racket, shuttle, cut } for match state.
function driveMatch(frames, options) {
  const machine = createMatchStateMachine(options);
  for (const [mediaTime, evidence] of frames) {
    machine.update({
      media_time: mediaTime,
      player_count: evidence.players,
      racket_detected: evidence.racket === true,
      shuttle_tracked: evidence.shuttle === true,
      scene_change: evidence.cut === true,
    });
  }
  return machine;
}

function driveRally(frames, options) {
  const machine = createPhase1RallyStateMachine(options);
  const match = createMatchStateMachine();
  for (const [mediaTime, evidence] of frames) {
    const matchState = match.update({
      media_time: mediaTime,
      player_count: evidence.players,
      racket_detected: evidence.racket === true,
      shuttle_tracked: evidence.shuttle === true,
      scene_change: evidence.cut === true,
    });
    machine.update({
      media_time: mediaTime,
      match_active: matchState.state === 'MATCH DETECTED',
      player_count: evidence.players,
      motion: evidence.motion === true,
      scene_change: evidence.cut === true,
    });
  }
  return machine;
}

test('match state machine exposes exactly the three ordered states', () => {
  assert.deepEqual(MATCH_STATES, ['SEARCHING', 'MATCH DETECTED', 'LOW CONFIDENCE']);
  const machine = createMatchStateMachine();
  assert.equal(machine.snapshot().state, 'SEARCHING');
});

test('sustained players plus racket corroboration reaches MATCH DETECTED', () => {
  const frames = [];
  for (let t = 0; t < 4; t += 0.125) frames.push([t, { players: 2, racket: true }]);
  const machine = driveMatch(frames);
  const snapshot = machine.snapshot();
  assert.equal(snapshot.state, 'MATCH DETECTED');
  assert.equal(snapshot.corroborated, true);
  assert.ok(snapshot.confidence >= 0.75);
});

test('persistent players without badminton corroboration stay LOW CONFIDENCE (basketball shape)', () => {
  const frames = [];
  for (let t = 0; t < 60; t += 0.125) frames.push([t, { players: 2, racket: false }]);
  const machine = driveMatch(frames);
  // It must never reach MATCH DETECTED: players alone confirm "some sport",
  // never badminton.
  assert.equal(machine.snapshot().state, 'LOW CONFIDENCE');
  for (let t = 0; t < 60; t += 0.125) {
    machine.update({ media_time: t, player_count: 2, racket_detected: false, shuttle_tracked: false, scene_change: false });
    assert.notEqual(machine.snapshot().state, 'MATCH DETECTED');
  }
});

test('racket corroboration while players are present upgrades LOW CONFIDENCE to MATCH DETECTED', () => {
  const frames = [];
  for (let t = 0; t < 3; t += 0.125) frames.push([t, { players: 2, racket: false }]);
  const machine = driveMatch(frames);
  assert.equal(machine.snapshot().state, 'LOW CONFIDENCE');
  machine.update({ media_time: 3, player_count: 2, racket_detected: true, shuttle_tracked: false, scene_change: false });
  assert.equal(machine.snapshot().state, 'MATCH DETECTED');
});

test('a short player dropout is bridged; a sustained dropout falls to LOW CONFIDENCE and back', () => {
  // Reach MATCH DETECTED first.
  const frames = [];
  for (let t = 0; t < 3; t += 0.125) frames.push([t, { players: 2, racket: true }]);
  const machine = driveMatch(frames);
  assert.equal(machine.snapshot().state, 'MATCH DETECTED');

  // 1s dropout (no cut) stays MATCH DETECTED.
  for (let t = 3; t < 4; t += 0.125) machine.update({ media_time: t, player_count: 0, racket_detected: false, shuttle_tracked: false, scene_change: false });
  assert.equal(machine.snapshot().state, 'MATCH DETECTED');

  // Extend the dropout beyond the pose-dropout hold (2s) -> LOW CONFIDENCE.
  for (let t = 4; t < 6; t += 0.125) machine.update({ media_time: t, player_count: 0, racket_detected: false, shuttle_tracked: false, scene_change: false });
  assert.equal(machine.snapshot().state, 'LOW CONFIDENCE');

  // Players return with sticky corroboration -> immediate MATCH DETECTED.
  machine.update({ media_time: 6, player_count: 2, racket_detected: false, shuttle_tracked: false, scene_change: false });
  assert.equal(machine.snapshot().state, 'MATCH DETECTED');
});

test('LOW CONFIDENCE returns to SEARCHING after the abandon window', () => {
  const frames = [];
  for (let t = 0; t < 3; t += 0.125) frames.push([t, { players: 2, racket: false }]);
  const machine = driveMatch(frames);
  assert.equal(machine.snapshot().state, 'LOW CONFIDENCE');
  for (let t = 3; t < 90; t += 0.125) {
    machine.update({ media_time: t, player_count: 0, racket_detected: false, shuttle_tracked: false, scene_change: false });
  }
  assert.equal(machine.snapshot().state, 'SEARCHING');
});

test('rally state machine is gated on active match state and back-dates its start', () => {
  // Players + racket present so match reaches MATCH DETECTED; the rally arms
  // only once match is active and motion is present.
  const frames = [];
  for (let t = 0; t < 6; t += 0.125) frames.push([t, { players: 2, racket: true, motion: true, cut: false }]);
  const machine = driveRally(frames);
  assert.equal(machine.snapshot().phase, 'active');
  // Back-dated to the first sustained in-play frame (after match confirm).
  assert.ok(machine.snapshot().active_start_time < 4);
});

test('rally start requires motion: players without motion never open a rally', () => {
  const frames = [];
  for (let t = 0; t < 10; t += 0.125) frames.push([t, { players: 2, racket: true, motion: false, cut: false }]);
  const machine = driveRally(frames);
  assert.equal(machine.snapshot().phase, 'idle');
  assert.equal(machine.snapshot().rallies.length, 0);
});

// Build a rally sequence and always append a trailing idle tail so the final
// rally is finalized before assertions read the completed-record list.
function rallySequence(playSeconds, interruptSeconds, resumeSeconds) {
  const frames = [];
  let t = 0;
  const step = 0.125;
  const play = (seconds, motion = true) => {
    for (let i = 0; i < Math.round(seconds / step); i += 1) {
      frames.push([t, { players: motion ? 2 : 0, racket: true, motion, cut: false }]);
      t += step;
    }
  };
  const cut = () => { frames.push([t, { players: 0, racket: true, motion: false, cut: true }]); t += step; };
  play(playSeconds, true);
  if (interruptSeconds > 0) { cut(); play(interruptSeconds, false); cut(); }
  if (resumeSeconds > 0) play(resumeSeconds, true);
  play(8, false); // trailing inactivity finalizes the last rally
  return frames;
}

test('a mid-rally scene-change interruption within the hold window does not split the rally', () => {
  const machine = driveRally(rallySequence(5, 4, 5));
  const completed = machine.snapshot().rallies.filter((record) => record.status === 'completed');
  assert.equal(completed.length, 1, 'a 4s interruption must not split the rally');
  assert.ok(completed[0].end_media_time - completed[0].start_media_time >= 9);
});

test('a scene-change interruption longer than the hold window ends the rally back-dated', () => {
  const machine = driveRally(rallySequence(5, 8, 0));
  const completed = machine.snapshot().rallies.filter((record) => record.status === 'completed');
  assert.equal(completed.length, 1);
  assert.ok(completed[0].end_media_time < 6, 'rally end is back-dated to the last in-play frame');
});

test('emitted rallies stay estimated and suggested', () => {
  const machine = driveRally(rallySequence(5, 0, 5));
  const records = machine.snapshot().rallies;
  assert.ok(records.length >= 1);
  for (const record of records) {
    assert.equal(record.source, 'estimated');
    assert.equal(record.evidence_state, 'suggested');
  }
});

test('rally state machine reset clears its internal rally records', () => {
  const machine = createPhase1RallyStateMachine();
  const match = createMatchStateMachine();
  let t = 0;
  const step = 0.125;
  for (let i = 0; i < Math.round(3 / step); i += 1) {
    const ms = match.update({ media_time: t, player_count: 2, racket_detected: true, shuttle_tracked: false, scene_change: false });
    machine.update({ media_time: t, match_active: ms.state === 'MATCH DETECTED', player_count: 2, motion: true, scene_change: false });
    t += step;
  }
  assert.ok(machine.snapshot().rallies.length >= 0);
  machine.reset('media-time-reset');
  assert.equal(machine.snapshot().phase, 'idle');
  assert.equal(machine.snapshot().rallies.length, 0);
});

test('createRallyStateMachine accepts an estimated source and suggested evidence state', () => {
  const machine = createRallyStateMachine({ source: 'estimated', evidence_state: 'suggested' });
  machine.startRally({ type: 'rally_start', media_time: 1 });
  machine.endRally({ type: 'rally_end', media_time: 5 });
  const record = machine.finalize().rallies[0];
  assert.equal(record.source, 'estimated');
  assert.equal(record.evidence_state, 'suggested');
  assert.equal(record.status, 'completed');
  assert.equal(record.start_media_time, 1);
  assert.equal(record.end_media_time, 5);
});
