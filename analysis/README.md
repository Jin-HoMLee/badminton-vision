# Badminton analysis core

This directory is an isolated, dependency-free backend primitive module for a future offscreen analyzer. It has no MV3, YouTube DOM, frame capture, renderer, detector, tracker, model, server, or credential dependency.

## Run tests

From the repository root:

```sh
npm test --prefix analysis
```

The test entry point is the Node built-in test runner; no install step is needed (Node 18+).

## Public API

`analysis/index.js` is CommonJS so it can be loaded by an offscreen document or a small Node worker:

```js
const {
  getCourtGeometry,
  fitOuterCourtHomography,
  createStrokeEvent,
  rankRallyHighlights,
} = require('./analysis');
```

### Court and coordinates

The canonical court uses metres, `x` across the 6.10 m doubles width and `y` along the 13.40 m length. The near back boundary is `y = 0`, the net is `y = 6.70`, and the far back boundary is `y = 13.40`. `getCourtGeometry()` returns the fixed dimensions (including 1.55 m net-post height) and the generated 40 mm line center segments. Each line has `start`/`end` in metres, `normalized_start`/`normalized_end` (and normalized width) in court-normalized coordinates, its applicable format, and explicit line ownership. The generated set includes doubles and singles sidelines, both back boundaries, both short service lines, both doubles long-service lines, both centre-line segments, and the net.

`createNormalizedPoint(x, y)` validates a `[0, 1]` court-normalized point. Pass `{allowOutside: true}` only for an estimated point that may be outside the court. `normalizeCourtPoint` and `denormalizeCourtPoint` convert between normalized and metre coordinates without clamping.

`fitOuterCourtHomography(imageCorners)` expects four image points in the README order corresponding to `(0,0)`, `(6.10,0)`, `(6.10,13.40)`, `(0,13.40)`. Image points may be pixels or normalized image coordinates; all four only need to use the same unit. It returns a numerically normalized four-point `Homography` with `imageToCourt`, `courtToImage`, and normalized court convenience methods. Duplicate, collinear, non-convex, near-zero-area, singular, and non-finite seeds throw `AnalysisError` with a machine-readable `code`.

### Validated records and correction semantics

Factories return frozen, schema-validated records and do not mutate input. `validate*` functions return `{valid, errors}`. Confidence is normalized to `{value, status, reason}`: a missing value is `{value: null, status: 'unknown', ...}`, never an implicit `1`.

- `createStrokeEvent` follows the README stroke-feed fields and adds a stable `event_id`, nullable player/shot values for explicit unknown evidence, optional manual `label`, optional tracking confidence, channel evidence, and correction provenance. Missing values remain `null`/`unknown`; they are not defaulted to a confident observation.
- `correctStrokeEvent` preserves the same `event_id`, sets `source: 'corrected'` and `status: 'corrected'`, and appends a provenance entry. `replaceCorrectedStrokeEvent` replaces exactly one matching event in a collection and rejects duplicate IDs; it never appends a second corrected event.
- `createRallyRecord` carries completion/timestamps, event IDs, shot count/coarse-family summary, winner/error state, `winner`/`lose_reason` convenience fields, score context, nullable highlight index, aggregate confidence, and optional partial/camera-cut evidence metadata. A completed rally requires an end timestamp; `winner` mirrors the winner-state player ID.
- `createWinnerState` supports `winner`, `forced_error`, `unforced_error`, and `unclassified`. Classified outcomes require a player ID; unknown outcomes retain unknown confidence and evidence.
- `createLineCallState` supports `in`, `out`, and `unknown`, an optional relevant generated line ID when the upstream landing evidence is incomplete, normalized landing point, distance-to-line, timestamp, confidence, evidence, source, status, and provenance.

### Rally/event state machine

`createRallyStateMachine()` consumes normalized lifecycle observations (`rally_start`, `shot`, `landing`, `rally_end`, and `camera_cut`) and returns immutable snapshots. `analyzeRallyEvents(observations)` is the batch helper. Shot observations may carry accepted, suggested, corrected, partial, or unknown player/shuttle/shot/landing channel evidence; channel values and provenance are retained verbatim. Events are ordered by media time, then sequence, then event ID. Duplicate IDs are idempotently ignored, while a corrected duplicate replaces the same ID and appends correction provenance. A camera cut closes the current segment as `incomplete` with a cut boundary, never as a completed rally; finalization without an end marker also remains incomplete. Missing identity, timestamps, landing calls, outcomes, and confidence stay unknown.

`attributeRallyOutcome(input)` uses only accepted/corrected terminal evidence. An explicit accepted/manual/corrected outcome can classify a known winner. An accepted OUT landing can establish an error class only when forced/unforced evidence is supplied and the opponent is unambiguous; an accepted IN landing plus an explicit rally end can establish a winner. Otherwise the result is `unclassified` with evidence and an explanation reason.

### Coarse shot rule seam

`createCoarseShotFeatures` accepts already-derived observations (`landing_depth_m`, measured from the net on the receiving half; `flight_distance_m`, `apex_height_m`, `impact_height_m`, and `downward_speed_mps`). It can derive distance/depth from canonical metre points via `impact_point` and `landing_point`. `classifyCoarseShot` applies four documented deterministic rules in precedence order: net, smash, clear, drop. Missing features return `shot_family: 'unknown'`, `status: 'unclassified'`, and unknown confidence. The returned bounded confidence is a rule-support score, not a model probability and not evidence that an upstream detector/tracker is correct.

### Highlight ranking

`rankRallyHighlights(rallies, strokeEvents)` and its aliases `rankHighlights`/`scoreRallyHighlights` implement the README formula exactly and return component values/weights, score context, outcome evidence, partial-component reasons, sample size, and timestamps. Only completed rallies count. Fewer than ten completed rallies returns `{eligible: false, reason: 'insufficient-history'}` and no ranking. Length percentile is the inclusive deterministic rank `count(shot_count <= this shot count) / sample_size`. Only accepted/corrected event confidence contributes; each missing confidence or missing referenced event contributes `0`, so it cannot become `1`. Score-unavailable winner/forced-error pressure uses the README ordinary-state fallback `0.7` and marks `outcome_pressure` partial. Ties sort by descending index, then earlier end timestamp, then rally ID.
