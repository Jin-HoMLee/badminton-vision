'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Focused gate for the offscreen Phase-1 wiring: with analysis-primitives.js
// loaded, LocalPoseShuttleAnalyzer feeds scene-change + player-persistence +
// motion evidence into the match/rally state machines and publishes
// result.match / result.rally / result.rallyEnd on the envelope. Without the
// primitives the historical unknown rally shape is preserved (covered by
// test/runtime-integration.test.js).
const ROOT = path.join(__dirname, '..');
const protocolSource = fs.readFileSync(path.join(ROOT, 'src/extension/common/protocol.js'), 'utf8');
const trackingSource = fs.readFileSync(path.join(ROOT, 'src/extension/common/player-tracking.js'), 'utf8');
const primitivesSource = fs.readFileSync(path.join(ROOT, 'analysis/index.js'), 'utf8');
const offscreenSource = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/offscreen.js'), 'utf8');

function loadOffscreen() {
  const runtime = {
    onMessage: { addListener() {} },
    sendMessage: async () => true,
  };
  const context = vm.createContext({
    console,
    Promise,
    Uint8Array,
    Uint8ClampedArray,
    setTimeout,
    clearTimeout,
    Math,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Map,
    Set,
    JSON,
    Date,
    Infinity,
    NaN,
    chrome: { runtime },
    BSO_DIAGNOSTIC_FIXTURE: true,
  });
  context.globalThis = context;
  vm.runInContext(protocolSource, context, { filename: 'protocol.js' });
  vm.runInContext(trackingSource, context, { filename: 'player-tracking.js' });
  vm.runInContext(primitivesSource, context, { filename: 'analysis-primitives.js' });
  vm.runInContext(offscreenSource, context, { filename: 'offscreen.js' });
  return context;
}

function player(trackId, x, y) {
  return {
    trackId,
    state: 'tracked',
    bbox: { x, y, width: 0.2, height: 0.5 },
    keypoints: [],
    confidence: 0.9,
    detector: { id: 'stub', version: 1, kind: 'pose-detector' },
    source: { id: 'stub', version: 1, kind: 'frame-source' },
  };
}

function stubShuttleAnalyzer() {
  return {
    identity: { id: 'stub-shuttle', version: 1, kind: 'stub' },
    async analyze() {
      return {
        analyzerIdentity: { id: 'stub-shuttle', version: 1, kind: 'stub' },
        result: { shuttle: { state: 'unknown', confidence: null, trajectory: [], reason: 'no-candidate', evidence: { sceneChange: 0.02 } } },
      };
    },
  };
}

function stubRacketAnalyzer() {
  return {
    identity: { id: 'efficientdet-lite0-racket-v1', version: 1, kind: 'racket-detector', detectionMethod: 'efficientdet-lite0-tennis-racket' },
    async analyze() {
      return { detectionMethod: 'efficientdet-lite0-tennis-racket', state: 'tracked', confidence: 0.6, detections: [{ confidence: 0.6, bbox: { x: 0.3, y: 0.3, width: 0.1, height: 0.1 } }] };
    },
  };
}

function stubPoseAnalyzer(frames) {
  let index = 0;
  return {
    identity: { id: 'stub-pose', version: 1, kind: 'pose-detector', productionModel: true },
    async analyze() {
      const frame = frames[index] || frames[frames.length - 1];
      index += 1;
      return {
        inferenceAvailable: true,
        status: 'ok',
        analyzerIdentity: { id: 'stub-pose', version: 1, kind: 'pose-detector', productionModel: true },
        result: {
          kind: 'lightweight-openpose',
          state: frame.players.length ? 'tracked' : 'unknown',
          players: frame.players,
          tracking: { schema: 'bso.player-tracking.result.v1', version: 1, state: frame.players.length ? 'tracked' : 'unknown', players: frame.players, accepted: true },
          strokeEvents: [],
        },
      };
    },
  };
}

function sample(requestId, mediaTime) {
  return { sessionId: 'phase1-test', requestId, mediaTime, frame: { width: 4, height: 4, data: new Uint8ClampedArray(64) } };
}

test('offscreen composition publishes match and estimated rally when primitives are loaded', async () => {
  const context = loadOffscreen();
  const Analyzer = context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer;

  const frames = [];
  // 6s of two moving players (match confirms, rally arms, starts, plays), then 8s idle.
  for (let t = 0; t < 14; t += 0.125) {
    const playing = t < 6;
    frames.push({
      players: playing
        ? [player('a', 0.2 + ((t * 0.4) % 0.3), 0.3), player('b', 0.6 - ((t * 0.4) % 0.3), 0.3)]
        : [],
    });
  }

  const analyzer = new Analyzer({
    environment: context,
    poseAnalyzer: stubPoseAnalyzer(frames),
    shuttleAnalyzer: stubShuttleAnalyzer(),
    racketAnalyzer: stubRacketAnalyzer(),
  });

  let lastEnvelope = null;
  let reachedMatchDetected = false;
  let requestId = 0;
  for (let t = 0; t < 14; t += 0.125) {
    lastEnvelope = await analyzer.analyze(sample(`r${requestId}`, t));
    requestId += 1;
    if (lastEnvelope.result.match && lastEnvelope.result.match.state === 'MATCH DETECTED') reachedMatchDetected = true;
  }

  assert.ok(lastEnvelope, 'analyzer must return an envelope');
  const result = lastEnvelope.result;
  assert.ok(result.match, 'result.match must be present');
  assert.equal(reachedMatchDetected, true, 'match must reach MATCH DETECTED during play');
  assert.ok(result.rally, 'result.rally must be present');
  assert.equal(result.rally.state, 'estimated');
  assert.equal(result.rally.source, 'estimated');
  assert.equal(result.rally.evidence_state, 'suggested');
  assert.ok(Number.isFinite(result.rally.start_media_time), 'rally start is back-dated to a media time');
  assert.ok(Number.isFinite(result.rally.end_media_time), 'rally end is back-dated to a media time');
  assert.ok(result.rally.end_media_time > result.rally.start_media_time);
  assert.equal(result.rallyEnd.state, 'estimated');
  assert.equal(result.winner.state, 'unknown', 'Phase 1 must never fabricate a winner');
  assert.equal(result.outcome, 'unclassified');
});

test('offscreen composition keeps unknown rally shape when primitives are absent', async () => {
  // Reload without analysis-primitives.js to exercise the historical fallback.
  const runtime = { onMessage: { addListener() {} }, sendMessage: async () => true };
  const context = vm.createContext({
    console, Promise, Uint8Array, Uint8ClampedArray, setTimeout, clearTimeout,
    Math, Object, Array, Number, String, Boolean, Map, Set, JSON, Date, Infinity, NaN,
    chrome: { runtime },
    BSO_DIAGNOSTIC_FIXTURE: true,
  });
  context.globalThis = context;
  vm.runInContext(protocolSource, context, { filename: 'protocol.js' });
  vm.runInContext(trackingSource, context, { filename: 'player-tracking.js' });
  vm.runInContext(offscreenSource, context, { filename: 'offscreen.js' });

  const Analyzer = context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer;
  const analyzer = new Analyzer({
    environment: context,
    poseAnalyzer: stubPoseAnalyzer([{ players: [player('a', 0.3, 0.3), player('b', 0.6, 0.3)] }]),
    shuttleAnalyzer: stubShuttleAnalyzer(),
    racketAnalyzer: null,
  });
  const envelope = await analyzer.analyze(sample('r0', 0));
  assert.equal(envelope.result.rally.state, 'unknown');
  assert.equal(envelope.result.rally.reason, 'rally-segmentation-not-available');
  assert.equal(envelope.result.match.state, 'unknown');
});
