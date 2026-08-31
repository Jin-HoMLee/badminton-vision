'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../index.js');

const {
  AnalysisError,
  SchemaValidationError,
  COARSE_SHOT_FAMILIES,
  COURT_LENGTH_M,
  COURT_WIDTH_M,
  LINE_WIDTH_M,
  createConfidence,
  createCoarseShotFeatures,
  createLineCallState,
  createRallyRecord,
  createStrokeEvent,
  createWinnerState,
  fitOuterCourtHomography,
  getCourtGeometry,
  getCourtLine,
  normalizeCourtPoint,
  denormalizeCourtPoint,
  classifyCoarseShot,
  calculateHighlightIndex,
  rankRallyHighlights,
  correctStrokeEvent,
  replaceCorrectedStrokeEvent,
  validateStrokeEvent,
  attributeRallyOutcome,
  createRallyStateMachine,
  analyzeRallyEvents,
} = core;

test('canonical court has BWF dimensions, line ownership, and all generated lines', () => {
  const geometry = getCourtGeometry();
  assert.equal(geometry.length_m, 13.4);
  assert.equal(geometry.width_m, 6.1);
  assert.equal(geometry.line_width_m, 0.04);
  assert.equal(geometry.net_y_m, 6.7);
  assert.equal(geometry.singles_width_m, 5.18);
  assert.deepEqual(geometry.outer_corner_order, [
    { x: 0, y: 0 },
    { x: 6.1, y: 0 },
    { x: 6.1, y: 13.4 },
    { x: 0, y: 13.4 },
  ]);

  const byId = Object.fromEntries(geometry.lines.map((line) => [line.id, line]));
  assert.equal(geometry.lines.length, 13);
  assert.deepEqual(byId['singles-side-left'].start, { x: 0.46, y: 0 });
  assert.deepEqual(byId['singles-side-right'].start, { x: 5.64, y: 0 });
  assert.equal(byId['doubles-long-service-line-near'].start.y, 0.76);
  assert.equal(byId['doubles-long-service-line-far'].start.y, 12.64);
  assert.deepEqual(byId['centre-line-near'].end, { x: 3.05, y: 4.72 });
  assert.deepEqual(byId['centre-line-far'].start, { x: 3.05, y: 8.68 });
  assert.deepEqual(byId['net'].normalized_start, { x: 0, y: 0.5 });
  assert.equal(byId['doubles-long-service-line-near'].line_ownership, 'line-is-part-of-the-area-it-bounds');
  assert.deepEqual(byId['doubles-long-service-line-near'].included_in, ['doubles-service-court']);
  assert.equal(byId['doubles-long-service-line-near'].doubles_only, true);
  assert.equal(byId['back-boundary-near'].included_in.includes('doubles-service-court'), false);
  assert.equal(byId['net'].line_ownership, 'physical-net-not-court-area');
  assert.equal(getCourtLine('does-not-exist'), null);

  const normalized = normalizeCourtPoint({ x: 3.05, y: 6.7 });
  assert.deepEqual(normalized, { x: 0.5, y: 0.5 });
  assert.deepEqual(denormalizeCourtPoint(normalized), { x: 3.05, y: 6.7 });
  assert.throws(() => core.createNormalizedPoint(1.01, 0.5), /\[0, 1\]/);
  assert.equal(LINE_WIDTH_M, 0.04);
  assert.equal(COURT_WIDTH_M, 6.1);
  assert.equal(COURT_LENGTH_M, 13.4);
});

test('four-point homography maps and round-trips representative court points', () => {
  const imageCorners = [
    { x: 100, y: 80 },
    { x: 1100, y: 120 },
    { x: 1020, y: 900 },
    { x: 180, y: 860 },
  ];
  const homography = fitOuterCourtHomography(imageCorners);
  const canonicalCorners = getCourtGeometry().outer_corner_order;
  for (let index = 0; index < 4; index += 1) {
    const mapped = homography.imageToCourt(imageCorners[index]);
    assert.ok(Math.hypot(mapped.x - canonicalCorners[index].x, mapped.y - canonicalCorners[index].y) < 1e-8);
  }

  const representative = { x: 2.2, y: 9.1 };
  const imagePoint = homography.courtToImage(representative);
  const roundTrip = homography.imageToCourt(imagePoint);
  assert.ok(Math.hypot(roundTrip.x - representative.x, roundTrip.y - representative.y) < 1e-9);
  const normalized = homography.imageToNormalizedCourt(imagePoint);
  assert.ok(Math.abs(normalized.x - representative.x / COURT_WIDTH_M) < 1e-9);
  assert.ok(Math.abs(normalized.y - representative.y / COURT_LENGTH_M) < 1e-9);
  assert.deepEqual(homography.normalizedCourtToImage(normalized), imagePoint);

  const projected = core.projectCourtLines(homography);
  assert.equal(projected.length, 13);
  const projectedCorner = projected.find((line) => line.id === 'doubles-side-left').start;
  assert.ok(Math.hypot(projectedCorner.x - imageCorners[0].x, projectedCorner.y - imageCorners[0].y) < 1e-9);
});

test('homography rejects duplicate, collinear, and near-singular seeds', () => {
  assert.throws(
    () => fitOuterCourtHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }]),
    (error) => error instanceof AnalysisError && error.code === 'duplicate-corner',
  );
  assert.throws(
    () => fitOuterCourtHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }]),
    (error) => error instanceof AnalysisError && error.code === 'collinear-corners',
  );
  assert.throws(
    () => fitOuterCourtHomography([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1e-10 }, { x: 0, y: 1e-10 }]),
    (error) => error instanceof AnalysisError && ['duplicate-corner', 'collinear-corners', 'near-singular'].includes(error.code),
  );
  assert.throws(
    () => fitOuterCourtHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]),
    (error) => error instanceof AnalysisError && error.code === 'invalid-order',
    'crossed corner order is rejected instead of silently producing a wrong court',
  );
  assert.throws(
    () => fitOuterCourtHomography([{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]),
    (error) => error instanceof AnalysisError && error.code === 'non-finite-point',
  );
});

test('confidence and public record schemas preserve unknown state', () => {
  assert.deepEqual(createConfidence(null), { value: null, status: 'unknown', reason: 'not-provided' });
  assert.deepEqual(createConfidence(0), { value: 0, status: 'known', reason: null });
  assert.deepEqual(createConfidence(1), { value: 1, status: 'known', reason: null });
  assert.throws(() => createConfidence(1.1), SchemaValidationError);

  const event = createStrokeEvent({
    event_id: 'e-1',
    rally_id: 'r-1',
    sequence: 0,
    player_id: 'player-a',
    shot_family: 'unknown',
    hit_media_time: 0,
    source: 'auto',
    status: 'unclassified',
  });
  assert.equal(event.classification_confidence.status, 'unknown');
  assert.equal(event.geometry_confidence.status, 'unknown');
  assert.equal(event.tracking_confidence, null);
  assert.equal(validateStrokeEvent(event).valid, true);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.classification_confidence), true);

  const lineCall = createLineCallState({
    state: 'unknown',
    timestamp_media_time: 0,
    landing_point: { x: 1.01, y: 0.5 },
    evidence: ['landing tracker unavailable'],
  });
  assert.equal(lineCall.state, 'unknown');
  assert.equal(lineCall.confidence.status, 'unknown');
  assert.equal(lineCall.distance_to_line_m, null);
  assert.deepEqual(lineCall.landing_point, { x: 1.01, y: 0.5 });

  const winner = createWinnerState({
    label: 'winner',
    player_id: 'player-a',
    confidence: null,
    evidence: [{ kind: 'final-landing', state: 'unknown' }],
  });
  assert.equal(winner.confidence.status, 'unknown');
  assert.throws(() => createWinnerState({ label: 'winner' }), /player_id/);
  assert.deepEqual(createWinnerState().label, 'unclassified');
});

test('correction updates one event id and appends provenance without duplication', () => {
  const original = createStrokeEvent({
    event_id: 'e-2',
    rally_id: 'r-1',
    sequence: 1,
    player_id: 'player-b',
    shot_family: 'drop',
    hit_media_time: 2.25,
    source: 'auto',
    status: 'suggested',
    classification_confidence: 0.3,
    geometry_confidence: 0.8,
  });
  const corrected = correctStrokeEvent(
    original,
    { shot_family: 'smash', classification_confidence: 0.95 },
    { reason: 'manual review', corrected_at_media_time: 3 },
  );
  assert.equal(corrected.event_id, original.event_id);
  assert.equal(corrected.source, 'corrected');
  assert.equal(corrected.status, 'corrected');
  assert.equal(corrected.shot_family, 'smash');
  assert.equal(corrected.correction_provenance.length, 1);
  assert.deepEqual(corrected.correction_provenance[0].changed_fields, ['shot_family', 'classification_confidence']);
  assert.throws(() => correctStrokeEvent(original, { event_id: 'e-other' }, { reason: 'bad' }), /preserve event_id/);

  const collection = replaceCorrectedStrokeEvent(
    [original, createStrokeEvent({
      event_id: 'e-3', rally_id: 'r-1', sequence: 2, player_id: 'player-a', shot_family: 'net',
      hit_media_time: 3, source: 'manual', status: 'accepted', classification_confidence: 1, geometry_confidence: 1,
    })],
    'e-2',
    { shot_family: 'clear' },
    { reason: 'second review' },
  );
  assert.equal(collection.length, 2);
  assert.equal(collection.filter((event) => event.event_id === 'e-2').length, 1);
  assert.equal(collection[0].shot_family, 'clear');
  assert.throws(() => replaceCorrectedStrokeEvent([original, original], 'e-2', {}, { reason: 'duplicate' }), /more than once/);
});

test('rally records validate completion, timestamps, outcome, and score context', () => {
  const rally = createRallyRecord({
    rally_id: 'r-10',
    start_media_time: 12,
    end_media_time: 18,
    status: 'completed',
    stroke_event_ids: ['e-10'],
    shot_count: 1,
    coarse_shot_families: ['clear'],
    winner_state: { label: 'forced_error', player_id: 'player-a', confidence: 0.7, status: 'accepted' },
    score_context: { state: 'tight', game_point: true, source: 'manual' },
    aggregate_confidence: 0,
    source: 'manual',
  });
  assert.equal(rally.status, 'completed');
  assert.equal(rally.winner_state.label, 'forced_error');
  assert.equal(rally.score_context.game_point, true);
  assert.equal(rally.aggregate_confidence.value, 0);
  assert.throws(() => createRallyRecord({ rally_id: 'bad', start_media_time: 1, status: 'completed' }), /end_media_time/);
  assert.throws(() => createRallyRecord({
    rally_id: 'bad-outcome', start_media_time: 1, end_media_time: 2, status: 'completed',
    winner_state: { label: 'winner' },
  }), /player_id/);
});

test('coarse feature seam has deterministic boundaries and unknown fallback', () => {
  assert.deepEqual(classifyCoarseShot(createCoarseShotFeatures({ landing_depth_m: 1.5, flight_distance_m: 3.5 })), {
    shot_family: 'net',
    status: 'classified',
    confidence: { value: 0.75, status: 'known', reason: null },
    rule: 'net: landing depth <= 1.5m and flight distance <= 3.5m',
    features_used: ['landing_depth_m', 'flight_distance_m'],
    explanation: 'Near-net landing and short travel matched the net rule.',
  });
  assert.equal(classifyCoarseShot({ impact_height_m: 1.5, downward_speed_mps: 5, flight_distance_m: 2 }).shot_family, 'smash');
  assert.equal(classifyCoarseShot({ landing_depth_m: 4.8, apex_height_m: 2 }).shot_family, 'clear');
  assert.equal(classifyCoarseShot({ landing_depth_m: 1.5001, apex_height_m: 2.5 }).shot_family, 'drop');
  const unknown = classifyCoarseShot({ landing_depth_m: 3 });
  assert.equal(unknown.shot_family, 'unknown');
  assert.equal(unknown.status, 'unclassified');
  assert.equal(unknown.confidence.status, 'unknown');
  assert.ok(unknown.explanation.includes('missing'));

  const derived = createCoarseShotFeatures({
    impact_point: { x: 3.05, y: 5 },
    landing_point: { x: 3.05, y: 10 },
    apex_height_m: 2.2,
  });
  assert.ok(derived.flight_distance_m > 0);
  assert.ok(derived.landing_depth_m > 0);
  assert.equal(COARSE_SHOT_FAMILIES.length, 4);
});

function makeHighlightFixture({ missingConfidence = false } = {}) {
  const rallies = [];
  const events = [];
  for (let rallyIndex = 0; rallyIndex < 10; rallyIndex += 1) {
    const rallyId = `r-${rallyIndex + 1}`;
    const shotCount = rallyIndex + 1;
    const families = rallyIndex === 9 ? [...COARSE_SHOT_FAMILIES] : ['clear'];
    const eventIds = [];
    for (let shotIndex = 0; shotIndex < shotCount; shotIndex += 1) {
      const eventId = `e-${rallyIndex + 1}-${shotIndex + 1}`;
      eventIds.push(eventId);
      const missing = missingConfidence && rallyIndex === 9 && shotIndex === 0;
      events.push(createStrokeEvent({
        event_id: eventId,
        rally_id: rallyId,
        sequence: shotIndex,
        player_id: shotIndex % 2 ? 'player-b' : 'player-a',
        shot_family: families[shotIndex % families.length],
        hit_media_time: rallyIndex * 10 + shotIndex,
        source: 'auto',
        status: 'accepted',
        classification_confidence: 0.8,
        geometry_confidence: missing ? null : 0.8,
        tracking_confidence: missing ? null : 0.8,
      }));
    }
    rallies.push(createRallyRecord({
      rally_id: rallyId,
      start_media_time: rallyIndex * 10,
      end_media_time: rallyIndex * 10 + shotCount,
      status: 'completed',
      stroke_event_ids: eventIds,
      shot_count: shotCount,
      coarse_shot_families: families,
      winner_state: rallyIndex === 9 ? { label: 'winner', player_id: 'player-a', confidence: 0.8, status: 'accepted' } : {},
      score_context: rallyIndex === 9 ? { state: 'ordinary', source: 'manual' } : undefined,
    }));
  }
  return { rallies, events };
}

test('highlight scoring is deterministic, explainable, and confidence-aware', () => {
  const fixture = makeHighlightFixture();
  const top = calculateHighlightIndex(fixture.rallies[9], fixture.rallies, fixture.events);
  assert.equal(top.eligible, true);
  assert.equal(top.sample_size, 10);
  assert.equal(top.index, 91);
  assert.deepEqual(top.components, {
    length_percentile: 1,
    variety: 1,
    outcome_pressure: 0.7,
    mean_tracking_confidence: 0.8,
  });
  assert.deepEqual(top.partial_components, []);
  assert.deepEqual(top.source_timestamp, { start_media_time: 90, end_media_time: 100 });

  const repeated = calculateHighlightIndex(fixture.rallies[9], fixture.rallies, fixture.events);
  assert.deepEqual(repeated, top);
  const ranked = rankRallyHighlights(fixture.rallies, fixture.events);
  assert.equal(ranked.eligible, true);
  assert.equal(ranked.results.length, 10);
  assert.equal(ranked.results[0].rally_id, 'r-10');

  const missing = makeHighlightFixture({ missingConfidence: true });
  const lower = calculateHighlightIndex(missing.rallies[9], missing.rallies, missing.events);
  assert.equal(lower.components.mean_tracking_confidence, 0.72);
  assert.ok(lower.index < top.index);
  assert.deepEqual(lower.partial_components, ['mean_tracking_confidence']);

  const scoreUnknown = makeHighlightFixture();
  scoreUnknown.rallies[9] = createRallyRecord({ ...scoreUnknown.rallies[9], score_context: undefined });
  const partialOutcome = calculateHighlightIndex(scoreUnknown.rallies[9], scoreUnknown.rallies, scoreUnknown.events);
  assert.equal(partialOutcome.components.outcome_pressure, 0.7);
  assert.deepEqual(partialOutcome.partial_components, ['outcome_pressure']);
});

test('highlight ranking refuses to score fewer than ten completed rallies', () => {
  const fixture = makeHighlightFixture();
  const result = rankRallyHighlights(fixture.rallies.slice(0, 9), fixture.events);
  assert.deepEqual(result, {
    eligible: false,
    reason: 'insufficient-history',
    sample_size: 9,
    minimum_sample_size: 10,
    results: [],
  });
  const inProgress = createRallyRecord({ rally_id: 'in-progress', start_media_time: 100, status: 'in_progress' });
  const individual = calculateHighlightIndex(inProgress, [...fixture.rallies.slice(0, 9), inProgress], fixture.events);
  assert.equal(individual.reason, 'rally-not-completed');
  assert.equal(individual.index, null);
});

test('rally state machine orders shots, consumes partial evidence, and de-duplicates events', () => {
  const machine = createRallyStateMachine();
  machine.ingest([
    { type: 'rally_start', rally_id: 'r-state', media_time: 10 },
    { type: 'shot', event_id: 'late', player_id: 'player-b', shot_family: 'drop', hit_media_time: 12, status: 'accepted', source: 'auto' },
    { type: 'shot', event_id: 'early', player: { state: 'unknown' }, shot: { state: 'partial' }, hit_media_time: 11, status: 'partial', source: 'auto' },
    { type: 'shot', event_id: 'late', player_id: 'player-b', shot_family: 'drop', hit_media_time: 12, status: 'accepted', source: 'auto' },
    { type: 'rally_end', media_time: 14 },
  ]);
  const result = machine.finalize();
  assert.deepEqual(result.rallies[0].stroke_event_ids, ['early', 'late']);
  assert.equal(result.rallies[0].shot_count, 2);
  assert.equal(result.rallies[0].evidence_state, 'partial');
  assert.equal(result.rallies[0].winner_state.label, 'unclassified');
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.events.find((event) => event.event_id === 'early').player_id, null);
  assert.equal(result.events.find((event) => event.event_id === 'early').shot_family, 'unknown');
});

test('camera cuts close an incomplete rally without pretending it ended', () => {
  const result = analyzeRallyEvents([
    { type: 'rally_start', rally_id: 'before-cut', media_time: 20 },
    { type: 'shot', event_id: 'cut-shot', player_id: 'player-a', shot_family: 'clear', hit_media_time: 21, status: 'accepted' },
    { type: 'camera_cut', camera_cut_id: 'cut-1', media_time: 22 },
    { type: 'shot', event_id: 'after-cut', player_id: 'player-b', shot_family: 'net', hit_media_time: 23, status: 'accepted' },
    { type: 'rally_end', media_time: 24 },
  ]);
  assert.equal(result.camera_cuts.length, 1);
  assert.equal(result.rallies.length, 2);
  assert.equal(result.rallies[0].status, 'incomplete');
  assert.equal(result.rallies[0].termination, 'camera_cut');
  assert.equal(result.rallies[0].end_media_time, null);
  assert.equal(result.rallies[0].boundary_media_time, 22);
  assert.equal(result.rallies[1].status, 'completed');
});

test('winner and error attribution requires accepted evidence and preserves uncertainty', () => {
  const makeEvent = (id, player, time, status = 'accepted') => createStrokeEvent({
    event_id: id, rally_id: 'r-outcome', sequence: time, player_id: player, shot_family: 'clear',
    hit_media_time: time, source: 'auto', status,
  });
  const forced = attributeRallyOutcome({
    events: [makeEvent('a', 'player-a', 1), makeEvent('b', 'player-b', 2)],
    landing_call: { state: 'out', status: 'accepted', timestamp_media_time: 2, confidence: 0.9 },
    error_type: 'forced_error',
  });
  assert.equal(forced.winner_state.label, 'forced_error');
  assert.equal(forced.winner_state.player_id, 'player-a');

  const winner = attributeRallyOutcome({
    events: [makeEvent('a', 'player-a', 1)],
    landing_call: { state: 'in', status: 'accepted', timestamp_media_time: 1 },
    termination: 'rally_end',
  });
  assert.equal(winner.winner_state.label, 'winner');
  assert.equal(winner.winner_state.player_id, 'player-a');

  const uncertain = attributeRallyOutcome({
    events: [makeEvent('a', 'player-a', 1), makeEvent('b', null, 2)],
    landing_call: { state: 'unknown', status: 'unknown', timestamp_media_time: 2 },
  });
  assert.equal(uncertain.winner_state.label, 'unclassified');
  assert.equal(uncertain.winner_state.player_id, null);
  assert.equal(uncertain.winner_state.confidence.status, 'unknown');
  assert.match(uncertain.reason, /unknown/);

  const suggested = attributeRallyOutcome({
    events: [makeEvent('a', 'player-a', 1), makeEvent('b', 'player-b', 2, 'suggested')],
    landing_call: { state: 'out', status: 'suggested', timestamp_media_time: 2 },
    error_type: 'unforced_error',
  });
  assert.equal(suggested.winner_state.label, 'unclassified');
  assert.equal(suggested.winner_state.player_id, null);

  const explicitUnknown = attributeRallyOutcome({
    events: [makeEvent('a', 'player-a', 1)],
    landing_call: { state: 'in', status: 'accepted', timestamp_media_time: 1 },
    termination: 'rally_end',
    outcome: 'unclassified',
  });
  assert.equal(explicitUnknown.winner_state.label, 'unclassified');
  assert.equal(explicitUnknown.winner_state.player_id, null);
});

test('corrections replace one state-machine event and retain provenance', () => {
  const machine = createRallyStateMachine();
  machine.ingest([
    { type: 'rally_start', rally_id: 'r-correct', media_time: 1 },
    { type: 'shot', event_id: 'same-id', player_id: 'player-a', shot_family: 'drop', hit_media_time: 2, status: 'accepted' },
    { type: 'rally_end', media_time: 3 },
    { type: 'shot', event_id: 'same-id', shot_family: 'smash', status: 'corrected', source: 'corrected', correction_reason: 'reviewed label' },
  ]);
  const result = machine.finalize();
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].shot_family, 'smash');
  assert.equal(result.events[0].player_id, 'player-a');
  assert.equal(result.events[0].correction_provenance.length, 1);
  assert.equal(result.rallies.length, 1);
});

test('highlight score pressure and missing score remain explainable', () => {
  const fixture = makeHighlightFixture();
  const ordinary = calculateHighlightIndex(fixture.rallies[9], fixture.rallies, fixture.events);
  const tight = createRallyRecord({ ...fixture.rallies[9], score_context: { state: 'tight', game_point: true, source: 'manual' } });
  const pressured = calculateHighlightIndex(tight, fixture.rallies, fixture.events);
  assert.equal(pressured.components.outcome_pressure, 1);
  assert.equal(pressured.partial_components.includes('outcome_pressure'), false);
  assert.ok(pressured.index > ordinary.index);

  const missingScore = createRallyRecord({ ...fixture.rallies[9], score_context: null });
  const partial = calculateHighlightIndex(missingScore, fixture.rallies, fixture.events);
  assert.equal(partial.components.outcome_pressure, 0.7);
  assert.deepEqual(partial.partial_components, ['outcome_pressure']);
});
