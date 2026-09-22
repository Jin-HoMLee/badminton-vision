# Phase-1 match / rally state (scene change + player persistence)

The first honest Phase-1 product slice. Two pure, dependency-free state
machines in `analysis/index.js` consume the per-frame evidence the offscreen
composition already produces - the RGB-histogram scene-change signal, the
multi-person player tracks, racket/shuttle corroboration, and a coarse
player-motion signal - and emit a hysteretic match state plus estimated rally
boundaries. They form no court-view opinion and never invent strokes,
landings, line calls, or winners.

This supersedes the historical `rally: { state: "unknown", reason:
"rally-segmentation-not-available" }` placeholder in the live envelope while
preserving that shape as the fallback when `analysis-primitives.js` is absent.

## Design

### Match state machine (`createMatchStateMachine`)

Three explicit states: `SEARCHING`, `MATCH DETECTED`, `LOW CONFIDENCE`.

- `players >= 1` is the stable base signal. Sustained players move the machine
  out of `SEARCHING`; `players >= 2` raises the confidence score.
- Racket/shuttle observations are **corroboration, never a gate**: they upgrade
  `LOW CONFIDENCE` to `MATCH DETECTED` and raise confidence, but entry from
  `SEARCHING` is driven by players alone, and corroboration is sticky once
  observed so a later racket/shuttle outage never drops the match state.
- Hold windows: `~2 s` pose dropout, `~4 s` view interruption (scene change),
  `~60 s` abandon back to `SEARCHING`.

This is the negative-test discriminator: a basketball feed with persistent
people but no racket/shuttle corroboration reaches `LOW CONFIDENCE` and never
`MATCH DETECTED`, so it can never emit rallies.

### Rally state machine (`createPhase1RallyStateMachine`)

Gated on active match state and fed into the existing
`createRallyStateMachine`, so emitted rallies reuse the analysis core's record
model rather than a parallel event model.

- **Enter** on sustained two-player motion (`players >= 2` + motion) after a
  `~2 s` confirm window; the start is back-dated to the first sustained
  in-play frame (the analysis core orders by media time, not ingestion time,
  so late finalization is safe).
- **Hold** through a scene-change interruption up to `~6 s` (fitted from the
  report's `~4 s` starting value to the committed corpus's longest mid-rally
  insert, while remaining below every inter-rally gap) and through a pose
  dropout up to `~2 s`.
- **End** on `~6 s` of no in-play evidence (back-dated to the last in-play
  frame), or on a scene change that does not return within the hold window.

### Output markers

Every emitted rally carries `source: "estimated"` and
`evidence_state: "suggested"` (`'estimated'` was added to `EVENT_SOURCES` in
the analysis core). The live envelope adds `result.match` and populates
`result.rally` / `result.rallyEnd` with the estimated record; the content
script publishes a `data-bso-match-state` diagnostic attribute and the Stats
panel keeps rendering the estimated rally id/duration exactly as before.

### Motion signal (offscreen)

The offscreen composition computes a coarse motion score as the max
normalized bbox-center displacement of players matched by track id against the
previous accepted frame (`PLAYER_MOTION_DISPLACEMENT_THRESHOLD = 0.02`). The
rally machine smooths this over a `~2 s` window so the bursty between-stroke
motion of a real rally still reads as sustained motion.

## Acceptance

The behavioral regression gate is `tests/phase1-rally-state.test.mjs`: it
derives a deterministic frame-evidence stream from the committed corpus
(`rallyActive`, `courtView`, `sceneChanges`, with the scene-change shot labels
used to reconstruct which view shows the rally) and replays it through both
machines, reporting recall/precision/p90 boundary error/merge-split per
broadcast and asserting zero `MATCH DETECTED` on the basketball negative.

Committed targets, judged on the worst broadcast: recall `>= 0.90`, precision
`>= 0.85`, p90 start error `<= 2.0 s`, p90 end error `<= 3.0 s`, merge/split
`< 10%`, and zero `MATCH DETECTED` on the basketball negative. Focused unit
coverage for the hysteresis windows, gating, back-dating, and estimated/
suggested markers lives in `analysis/test/match-rally-state.test.js`.

## Honest limits

- The machine detects *play* (sustained two-player motion). The captain's
  `rallyActive` marks can include pre-rally service preparation and
  server-focus close-ups, so a marked interval's leading non-play context is
  legitimately not covered; the acceptance recall/error targets absorb this
  within their tolerances on the committed corpus.
- No court-view opinion is formed. Doubles and very short rallies remain
  weak/unsupported cases; nothing here implies a confirmed count.
