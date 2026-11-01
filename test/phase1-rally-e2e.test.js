'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// End-to-end Phase-1 proof: corpus-derived evidence is fed through the actual
// offscreen LocalPoseShuttleAnalyzer composition. The pose/shuttle/racket
// adapters are deterministic evidence seams; the composition, protocol
// envelope, motion calculation, match gate, and rally state machine are real.
// No media or frames are read or persisted.
const ROOT = path.join(__dirname, '..');
const protocolSource = fs.readFileSync(path.join(ROOT, 'src/extension/common/protocol.js'), 'utf8');
const trackingSource = fs.readFileSync(path.join(ROOT, 'src/extension/common/player-tracking.js'), 'utf8');
const primitivesSource = fs.readFileSync(path.join(ROOT, 'analysis/index.js'), 'utf8');
const offscreenSource = fs.readFileSync(path.join(ROOT, 'src/extension/offscreen/offscreen.js'), 'utf8');

const SAMPLE_HZ = 8;
const DT = 1 / SAMPLE_HZ;
const SYNTHESIS_TAIL_SECONDS = 12;
const BADMINTON_KEYS = ['bwf-ws-2026', 'bwf-md-2026', 'bwf-md-2018'];
const RALLY_VIEWS = new Set(['court', 'court-edge', 'reverse-angle', 'low-angle-insert', 'low-sideline', 'net-level', 'side-camera']);

function loadOffscreen() {
  const runtime = { onMessage: { addListener() {} }, sendMessage: async () => true };
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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function intervalContains(intervals, time) {
  return intervals.some((interval) => time >= interval.start && time < interval.end);
}

function buildViewKind(timeline) {
  const cuts = [...(timeline.sceneChanges || [])].sort((a, b) => a.start - b.start);
  const transitions = cuts.map((cut) => ({ time: (cut.start + cut.end) / 2, kind: cut.to }));
  const initial = cuts.length ? cuts[0].from : 'court';
  return function viewKind(time) {
    let kind = initial;
    for (const transition of transitions) {
      if (time >= transition.time) kind = transition.kind;
      else break;
    }
    return kind;
  };
}

function corpusFrames(timeline, { basketball = false } = {}) {
  const viewKind = buildViewKind(timeline);
  const rallyActive = Array.isArray(timeline.rallyActive) ? timeline.rallyActive : [];
  const courtView = Array.isArray(timeline.courtView) ? timeline.courtView : [];
  const sceneChanges = Array.isArray(timeline.sceneChanges) ? timeline.sceneChanges : [];
  const start = Math.min(timeline.window.start, timeline.window.end);
  const sourceEnd = Math.max(timeline.window.start, timeline.window.end);
  const end = basketball ? sourceEnd : sourceEnd + SYNTHESIS_TAIL_SECONDS;
  const frames = [];
  for (let time = start; time <= end + DT; time += DT) {
    const mediaTime = Math.round(time * 1000) / 1000;
    const inRally = intervalContains(rallyActive, mediaTime);
    const inCourtView = intervalContains(courtView, mediaTime);
    const sceneChange = intervalContains(sceneChanges, mediaTime);
    const playing = basketball || (inRally && RALLY_VIEWS.has(viewKind(mediaTime)));
    frames.push({
      mediaTime,
      playerCount: basketball ? 2 : playing ? 2 : inCourtView ? 1 : 0,
      motion: playing,
      racketDetected: basketball ? false : inCourtView,
      sceneChange,
    });
  }
  return frames;
}

function player(trackId, x, y) {
  return {
    trackId,
    state: 'tracked',
    bbox: { x, y, width: 0.2, height: 0.5 },
    keypoints: [],
    confidence: 0.9,
    detector: { id: 'phase1-corpus-pose-seam', version: 1, kind: 'pose-detector' },
    source: { id: 'phase1-corpus-frame-seam', version: 1, kind: 'frame-source' },
  };
}

function poseAnalyzerFor(frames) {
  let index = 0;
  const identity = { id: 'phase1-corpus-pose-seam', version: 1, kind: 'pose-detector', productionModel: false };
  return {
    identity,
    async initialize() { return { available: true, backend: 'deterministic-test-seam' }; },
    async analyze(sample) {
      const evidence = frames[Math.min(index++, frames.length - 1)];
      const players = evidence.playerCount > 1
        ? [player('a', 0.2 + ((evidence.mediaTime * 0.4) % 0.3), 0.3), player('b', 0.6 - ((evidence.mediaTime * 0.4) % 0.3), 0.3)]
        : evidence.playerCount === 1 ? [player('a', 0.4, 0.3)] : [];
      return {
        inferenceAvailable: true,
        status: 'ok',
        analyzer: identity.id,
        analyzerIdentity: identity,
        result: {
          kind: 'lightweight-openpose',
          productionModel: false,
          state: players.length ? 'tracked' : 'unknown',
          players,
          tracking: {
            schema: 'bso.player-tracking.result.v1',
            version: 1,
            sessionId: sample.sessionId,
            requestId: sample.requestId,
            mediaTime: sample.mediaTime,
            state: players.length ? 'tracked' : 'unknown',
            players,
            accepted: true,
          },
          strokeEvents: [],
        },
      };
    },
  };
}

function shuttleAnalyzer() {
  const identity = { id: 'phase1-corpus-shuttle-seam', version: 1, kind: 'shuttle-detector' };
  return {
    identity,
    async analyze(sample) {
      const cut = sample.corpusSceneChange === true;
      return {
        analyzerIdentity: identity,
        result: { shuttle: { state: 'unknown', confidence: null, trajectory: [], reason: cut ? 'camera-cut' : 'no-candidate', evidence: {} } },
      };
    },
  };
}

function racketAnalyzer() {
  const identity = { id: 'phase1-corpus-racket-seam', version: 1, kind: 'racket-detector', detectionMethod: 'efficientdet-lite0-tennis-racket' };
  return {
    identity,
    async analyze(sample) {
      const detections = sample.corpusRacketDetected
        ? [{ confidence: 0.6, bbox: { x: 0.3, y: 0.3, width: 0.1, height: 0.1 } }]
        : [];
      return { detectionMethod: identity.detectionMethod, state: detections.length ? 'tracked' : 'unknown', confidence: detections.length ? 0.6 : null, detections };
    },
  };
}

function sample(frame, requestId) {
  return {
    sessionId: 'phase1-corpus-e2e',
    requestId,
    mediaTime: frame.mediaTime,
    corpusSceneChange: frame.sceneChange,
    corpusRacketDetected: frame.racketDetected,
    frame: { width: 4, height: 4, data: new Uint8ClampedArray(64) },
  };
}

function unionTime(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let currentStart = null;
  let currentEnd = null;
  for (const interval of sorted) {
    if (currentStart === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
    } else if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      total += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  if (currentStart !== null) total += currentEnd - currentStart;
  return total;
}

function overlapTime(left, right) {
  let total = 0;
  for (const a of left) {
    for (const b of right) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (end > start) total += end - start;
    }
  }
  return total;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}

function evaluate(marked, emitted) {
  const markedTime = unionTime(marked);
  const emittedTime = unionTime(emitted);
  const overlap = overlapTime(marked, emitted);
  const startErrors = [];
  const endErrors = [];
  let splits = 0;
  let merges = 0;
  for (const mark of marked) {
    const overlapping = emitted.filter((entry) => Math.min(mark.end, entry.end) > Math.max(mark.start, entry.start));
    if (overlapping.length >= 2) splits += 1;
    if (overlapping.length) {
      const best = overlapping.reduce((bestEntry, entry) => {
        const bestOverlap = Math.min(bestEntry.end, mark.end) - Math.max(bestEntry.start, mark.start);
        const entryOverlap = Math.min(entry.end, mark.end) - Math.max(entry.start, mark.start);
        return entryOverlap > bestOverlap ? entry : bestEntry;
      }, overlapping[0]);
      startErrors.push(Math.abs(best.start - mark.start));
      endErrors.push(Math.abs(best.end - mark.end));
    }
  }
  for (const entry of emitted) {
    const overlapping = marked.filter((mark) => Math.min(mark.end, entry.end) > Math.max(mark.start, entry.start));
    if (overlapping.length >= 2) merges += 1;
  }
  return {
    recall: markedTime > 0 ? overlap / markedTime : null,
    precision: emittedTime > 0 ? overlap / emittedTime : null,
    startErrorP90: percentile(startErrors, 0.9),
    endErrorP90: percentile(endErrors, 0.9),
    splits,
    merges,
    mergeSplitRate: marked.length ? (splits + merges) / marked.length : 0,
    markedCount: marked.length,
    emittedCount: emitted.length,
  };
}

async function runCorpus(timeline, { basketball = false } = {}) {
  const context = loadOffscreen();
  const Analyzer = context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer;
  const frames = corpusFrames(timeline, { basketball });
  const analyzer = new Analyzer({
    environment: context,
    poseAnalyzer: poseAnalyzerFor(frames),
    shuttleAnalyzer: shuttleAnalyzer(),
    racketAnalyzer: racketAnalyzer(),
  });
  const initialized = await analyzer.initialize();
  assert.equal(initialized.available, true);
  const emittedById = new Map();
  let reachedMatchDetected = false;
  let observedEstimated = false;
  let duplicateResult = 'not-checked';
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const result = await analyzer.analyze(sample(frame, `corpus-${index}`));
    assert.ok(result, `${timeline.broadcast} frame should produce an analysis envelope`);
    reachedMatchDetected ||= result.result.match.state === 'MATCH DETECTED';
    if (result.result.rally.state === 'estimated') {
      observedEstimated = true;
      assert.equal(result.result.rally.source, 'estimated');
      assert.equal(result.result.rally.evidence_state, 'suggested');
      assert.equal(result.result.winner.state, 'unknown');
      assert.equal(result.result.outcome, 'unclassified');
    }
    const rally = result.result.rally;
    if (rally.state === 'estimated' && rally.status === 'completed' && Number.isFinite(rally.start_media_time) && Number.isFinite(rally.end_media_time)) {
      emittedById.set(rally.rally_id, { start: rally.start_media_time, end: rally.end_media_time });
    }
    if (index === 2) {
      const duplicate = await analyzer.analyze(sample(frame, `corpus-${index}-duplicate`));
      duplicateResult = duplicate;
    }
  }
  assert.equal(duplicateResult, null, `${timeline.broadcast} duplicate media timestamp must be dropped`);
  const emitted = [...emittedById.values()].sort((a, b) => a.start - b.start);
  return {
    emitted,
    reachedMatchDetected,
    observedEstimated,
    metrics: evaluate((timeline.rallyActive || []).map(({ start, end }) => ({ start, end })), emitted),
  };
}

test('offscreen Phase-1 composition recovers corpus boundaries with deterministic metrics', async () => {
  const results = {};
  for (const key of BADMINTON_KEYS) {
    const result = await runCorpus(readJson(`corpus/timelines/${key}.json`));
    results[key] = result;
    assert.equal(result.reachedMatchDetected, true, `${key} must reach MATCH DETECTED through offscreen composition`);
    assert.equal(result.observedEstimated, true, `${key} must emit estimated rally evidence`);
    assert.ok(result.metrics.recall >= 0.90, `${key} recall ${result.metrics.recall.toFixed(3)} must be >= 0.90`);
    assert.ok(result.metrics.precision >= 0.85, `${key} precision ${result.metrics.precision.toFixed(3)} must be >= 0.85`);
    assert.ok(result.metrics.startErrorP90 <= 2.0, `${key} p90 start error ${result.metrics.startErrorP90.toFixed(2)}s must be <= 2s`);
    assert.ok(result.metrics.endErrorP90 <= 3.0, `${key} p90 end error ${result.metrics.endErrorP90.toFixed(2)}s must be <= 3s`);
    assert.ok(result.metrics.mergeSplitRate < 0.10, `${key} merge/split rate ${result.metrics.mergeSplitRate.toFixed(3)} must be < 0.10`);
    // eslint-disable-next-line no-console
    console.log(`[phase1-e2e] ${key}: recall=${result.metrics.recall.toFixed(3)} precision=${result.metrics.precision.toFixed(3)} ` +
      `startErrP90=${result.metrics.startErrorP90.toFixed(2)}s endErrP90=${result.metrics.endErrorP90.toFixed(2)}s ` +
      `split=${result.metrics.splits} merge=${result.metrics.merges} emitted=${result.metrics.emittedCount}`);
  }
});

test('offscreen Phase-1 composition keeps the no-rally control empty', async () => {
  const result = await runCorpus(readJson('corpus/timelines/club-fixed-cam.json'));
  assert.deepEqual(result.emitted, []);
  assert.equal(result.metrics.markedCount, 0);
  assert.equal(result.metrics.emittedCount, 0);
});

test('offscreen Phase-1 composition never detects a badminton match in the basketball negative', async () => {
  const result = await runCorpus(readJson('corpus/timelines/negative-basketball.json'), { basketball: true });
  assert.equal(result.reachedMatchDetected, false, 'basketball negative must never reach MATCH DETECTED');
  assert.equal(result.observedEstimated, false, 'basketball negative must never emit estimated rally evidence');
  assert.deepEqual(result.emitted, []);
});

test('offscreen analysis is playback-neutral and session-stable', async () => {
  const context = loadOffscreen();
  const Analyzer = context.BSOOffscreenAnalyzer.LocalPoseShuttleAnalyzer;
  const frames = corpusFrames(readJson('corpus/timelines/bwf-ws-2026.json'));
  const analyzer = new Analyzer({ environment: context, poseAnalyzer: poseAnalyzerFor(frames), shuttleAnalyzer: shuttleAnalyzer(), racketAnalyzer: racketAnalyzer() });
  const playback = { currentTime: 17, paused: false, muted: false, playbackRate: 1, src: 'fixture' };
  const before = { ...playback };
  await analyzer.analyze({ ...sample(frames[0], 'stability-0'), playback });
  assert.deepEqual(playback, before, 'offscreen inference must not mutate playback state');

  const next = frames[1];
  const first = await analyzer.analyze(sample(next, 'stability-1'));
  const stale = await analyzer.analyze(sample(next, 'stability-duplicate'));
  assert.ok(first);
  assert.equal(stale, null, 'duplicate frame timestamps must be discarded');
  analyzer.resetSession('phase1-corpus-e2e', 'stability-reset');
  const afterReset = await analyzer.analyze(sample(frames[0], 'stability-reset-0'));
  assert.ok(afterReset, 'a reset session must accept a new timeline');
  assert.equal(afterReset.result.match.state, 'SEARCHING');
  analyzer.endSession('phase1-corpus-e2e', 'stability-end');
  analyzer.dispose();
});
