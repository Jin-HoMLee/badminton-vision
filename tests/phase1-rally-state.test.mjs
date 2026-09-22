import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createRequire } from "node:module";

// Behavioral regression for the Phase-1 camera-grammar match/rally state
// machines, judged against the committed per-broadcast timeline corpus. This
// is an offline test: it derives a deterministic frame-evidence stream from
// the committed interval marks (rally-active, court-view, scene-change) and
// replays it through the two pure state machines. It does not validate the
// underlying pose / scene-change detectors - those need a live replay - only
// the temporal state machines that consume their evidence.
//
// Frame-evidence projection (documented, not a claim about detector quality):
//   - inside a marked rallyActive interval AND a court-view interval  -> 2 players, motion
//   - inside a court-view interval but not rallyActive               -> 1 player, no motion
//   - outside court-view (close-up/replay/crowd)                     -> 0 players
//   - inside a scene-change interval                                 -> scene_change flag
//   - inside court-view                                              -> racket corroboration (badminton rackets visible)
//   - basketball negative                                            -> persistent players, NO racket/shuttle corroboration
const require = createRequire(import.meta.url);
const { createMatchStateMachine, createPhase1RallyStateMachine } = require("../analysis/index.js");

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const SAMPLE_HZ = 8;
const DT = 1 / SAMPLE_HZ;
// Let the trailing rally's inactivity timer elapse so the final emitted rally
// is finalized rather than left in_progress at the measured window edge. The
// metrics are still scored against the committed rallyActive marks.
const SYNTHESIS_TAIL_SECONDS = 12;
const BADMINTON_KEYS = ["bwf-ws-2026", "bwf-md-2026", "bwf-md-2018"];
// Camera angles that still show the live rally (both players visible). These
// free-text shot labels come from the committed scene-change marks; everything
// else (close-up, crowd, coaches, bench, replay, graphic) hides the rally.
const RALLY_VIEWS = new Set(["court", "court-edge", "reverse-angle", "low-angle-insert", "low-sideline", "net-level", "side-camera"]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(projectRoot, relativePath), "utf8"));
}

function intervalContains(intervals, t) {
  return intervals.some((interval) => t >= interval.start && t < interval.end);
}

// Reconstruct, from the ordered scene-change marks, which shot is on screen at
// a media time. Before the first cut the first mark's `from` holds; after each
// cut (at its interval midpoint) the mark's `to` holds.
function buildViewKind(timeline) {
  const cuts = [...(timeline.sceneChanges || [])].sort((a, b) => a.start - b.start);
  const transitions = cuts.map((cut) => ({ t: (cut.start + cut.end) / 2, kind: cut.to }));
  const initial = cuts.length ? cuts[0].from : "court";
  return function viewKind(t) {
    let kind = initial;
    for (const transition of transitions) {
      if (t >= transition.t) kind = transition.kind;
      else break;
    }
    return kind;
  };
}

function synthesizeTimeline(timeline) {
  const { window } = timeline;
  const rallyActive = Array.isArray(timeline.rallyActive) ? timeline.rallyActive : [];
  const courtView = Array.isArray(timeline.courtView) ? timeline.courtView : [];
  const sceneChanges = Array.isArray(timeline.sceneChanges) ? timeline.sceneChanges : [];
  const viewKind = buildViewKind(timeline);
  const frames = [];
  const start = Math.min(window.start, window.end);
  const end = Math.max(window.start, window.end) + SYNTHESIS_TAIL_SECONDS;
  for (let t = start; t <= end + DT; t += DT) {
    const mediaTime = Math.round(t * 1000) / 1000;
    const inRally = intervalContains(rallyActive, mediaTime);
    const inCourtView = intervalContains(courtView, mediaTime);
    const sceneChange = intervalContains(sceneChanges, mediaTime);
    const rallyView = RALLY_VIEWS.has(viewKind(mediaTime));
    const playing = inRally && rallyView;
    frames.push({
      media_time: mediaTime,
      player_count: playing ? 2 : inCourtView ? 1 : 0,
      motion: playing,
      scene_change: sceneChange,
      racket_detected: inCourtView || playing,
      shuttle_tracked: false
    });
  }
  return frames;
}

function synthesizeBasketballNegative(verifiedTransitions, window) {
  const transitions = (verifiedTransitions || []).map((entry) => entry.t).sort((a, b) => a - b);
  const frames = [];
  const start = Math.min(window.start, window.end);
  const end = Math.max(window.start, window.end);
  for (let t = start; t <= end + DT; t += DT) {
    const mediaTime = Math.round(t * 1000) / 1000;
    const sceneChange = transitions.some((cut) => mediaTime >= cut && mediaTime < cut + DT);
    // Hardest negative: persistent players are present (basketball players are
    // people too), but there is never any badminton corroboration.
    frames.push({
      media_time: mediaTime,
      player_count: 2,
      motion: true,
      scene_change: sceneChange,
      racket_detected: false,
      shuttle_tracked: false
    });
  }
  return frames;
}

function runStateMachines(frames) {
  const match = createMatchStateMachine();
  const rally = createPhase1RallyStateMachine();
  let reachedMatchDetected = false;
  for (const frame of frames) {
    const matchState = match.update({
      media_time: frame.media_time,
      player_count: frame.player_count,
      racket_detected: frame.racket_detected,
      shuttle_tracked: frame.shuttle_tracked,
      scene_change: frame.scene_change
    });
    if (matchState.state === "MATCH DETECTED") reachedMatchDetected = true;
    rally.update({
      media_time: frame.media_time,
      match_active: matchState.state === "MATCH DETECTED",
      player_count: frame.player_count,
      motion: frame.motion,
      scene_change: frame.scene_change
    });
  }
  const snapshot = rally.snapshot();
  const emitted = snapshot.rallies
    .filter((record) => record.status === "completed" && record.end_media_time !== null)
    .map((record) => ({ start: record.start_media_time, end: record.end_media_time, source: record.source, evidence_state: record.evidence_state }));
  return { match, rally, emitted, reachedMatchDetected };
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
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index];
}

function evaluateBroadcast(marked, emitted) {
  const markedTime = unionTime(marked);
  const emittedTime = unionTime(emitted);
  const overlap = overlapTime(marked, emitted);
  const recall = markedTime > 0 ? overlap / markedTime : (emitted.length ? 0 : 1);
  const precision = emittedTime > 0 ? overlap / emittedTime : (emitted.length ? 0 : 1);

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
  const mergeSplitRate = marked.length ? (splits + merges) / marked.length : 0;

  return {
    recall,
    precision,
    startErrorP90: percentile(startErrors, 0.9),
    endErrorP90: percentile(endErrors, 0.9),
    splits,
    merges,
    mergeSplitRate,
    markedCount: marked.length,
    emittedCount: emitted.length
  };
}

test("phase-1 match and rally state machines recover per-broadcast rally boundaries", async () => {
  const broadcasts = await readJson("corpus/broadcasts.json");
  const results = {};
  for (const key of BADMINTON_KEYS) {
    const timeline = await readJson(`corpus/timelines/${key}.json`);
    const frames = synthesizeTimeline(timeline);
    const run = runStateMachines(frames);
    const marked = (timeline.rallyActive || []).map((entry) => ({ start: entry.start, end: entry.end }));
    const metrics = evaluateBroadcast(marked, run.emitted);
    results[key] = { ...metrics, reachedMatchDetected: run.reachedMatchDetected };
    // Every emitted rally must stay visibly estimated and suggested.
    for (const entry of run.emitted) {
      assert.equal(entry.source, "estimated", `${key} emitted rally must be source "estimated"`);
      assert.equal(entry.evidence_state, "suggested", `${key} emitted rally must be evidence_state "suggested"`);
    }
  }

  // The committed acceptance targets, judged on the worst broadcast.
  const worstRecall = Math.min(...BADMINTON_KEYS.map((key) => results[key].recall));
  const worstPrecision = Math.min(...BADMINTON_KEYS.map((key) => results[key].precision));
  const worstStartError = Math.max(...BADMINTON_KEYS.map((key) => results[key].startErrorP90 ?? 0));
  const worstEndError = Math.max(...BADMINTON_KEYS.map((key) => results[key].endErrorP90 ?? 0));
  const worstMergeSplit = Math.max(...BADMINTON_KEYS.map((key) => results[key].mergeSplitRate));

  // Report each broadcast separately (a pooled mean cannot hide a failing feed).
  for (const key of BADMINTON_KEYS) {
    const result = results[key];
    // eslint-disable-next-line no-console
    console.log(`[phase1] ${key}: recall=${result.recall.toFixed(3)} precision=${result.precision.toFixed(3)} ` +
      `startErrP90=${result.startErrorP90 == null ? "-" : result.startErrorP90.toFixed(2)}s ` +
      `endErrP90=${result.endErrorP90 == null ? "-" : result.endErrorP90.toFixed(2)}s ` +
      `split=${result.splits} merge=${result.merges} mergeSplitRate=${result.mergeSplitRate.toFixed(3)} ` +
      `matchDetected=${result.reachedMatchDetected}`);
  }

  assert.ok(worstRecall >= 0.90, `worst-broadcast rally recall ${worstRecall.toFixed(3)} must be >= 0.90`);
  assert.ok(worstPrecision >= 0.85, `worst-broadcast rally precision ${worstPrecision.toFixed(3)} must be >= 0.85`);
  assert.ok(worstStartError <= 2.0, `worst-broadcast p90 start error ${worstStartError.toFixed(2)}s must be <= 2.0s`);
  assert.ok(worstEndError <= 3.0, `worst-broadcast p90 end error ${worstEndError.toFixed(2)}s must be <= 3.0s`);
  assert.ok(worstMergeSplit < 0.10, `worst-broadcast merge/split rate ${worstMergeSplit.toFixed(3)} must be < 0.10`);
  for (const key of BADMINTON_KEYS) {
    assert.equal(results[key].reachedMatchDetected, true, `${key} must reach MATCH DETECTED`);
  }
});

test("phase-1 match state never reaches MATCH DETECTED on the basketball negative", async () => {
  const timeline = await readJson("corpus/timelines/negative-basketball.json");
  const verified = await readJson("corpus/verified/negative-basketball.json");
  const frames = synthesizeBasketballNegative(verified.verdicts, timeline.window);
  const run = runStateMachines(frames);
  assert.equal(run.reachedMatchDetected, false, "basketball negative must never reach MATCH DETECTED");
  assert.equal(run.emitted.length, 0, "basketball negative must emit no rallies");
});
