# Local shuttle candidate and trajectory adapter

`src/extension/offscreen/shuttle-tracking-adapter.js` is a standalone,
model-neutral seam for a live MVP experiment. It consumes the same captured
frame sample shape used by the MV3 runtime and produces the existing
`analysis.result` envelope. It contains no model weights, TrackNet code, CDN
path, or network request. The canonical offscreen session loads this adapter
alongside the cleared LiteRT pose analyzer and composes both results without
coupling their evidence or identities.

## Contract

```js
const adapter = new BSOShuttleTrackingAdapter.LocalShuttleTrajectoryAdapter();
const result = await adapter.analyze({
  sessionId, requestId, mediaTime, capturedAt,
  dimensions: { width, height },
  frame,                 // RGBA object or readable ImageBitmap/VideoFrame
  frameFormat: "rgba-array-v1"
});
```

`processFrame(sample)` is also available for already-readable RGBA frames and
is useful for deterministic tests. The adapter returns a
`bso.runtime.v1` `analysis.result` envelope. Its model-neutral result retains
the normal top-level `players`, `tracking`, `strokeEvents`, shot-family, and
confidence fields; this shuttle-only adapter leaves player tracking as `null`
and does not invent stroke or player claims. The offscreen composition copies
this payload into the pose result while preserving the pose tracks and adds
explicit unknown `rally`, `rallyEnd`, and `winner` evidence until a later event
adapter supplies the required observations. The shuttle payload is:

```js
{
  state: "tracked" | "unknown",
  confidence: 0..1 | null,
  candidate: { x, y, bbox, confidence, evidence } | null,
  trajectory: [{ x, y, mediaTime, requestId, confidence, status }],
  accepted: boolean,
  reason: string,
  evidence: object
}
```

Coordinates and boxes are normalized to the captured frame. A candidate is
only emitted as `tracked` after a compact moving signal is found in two
successive readable frames and passes the continuity gate. The first candidate
is retained as an uncommitted anchor and returns `unknown`; it is not presented
as a trajectory until the next compatible candidate arrives.

## Bounded detection and state safety

The detector converts the current and previous frame to luminance, computes a
bounded temporal difference, and searches connected components for a small,
compact, high-contrast residual. It rejects components that are too large,
non-compact, low-confidence, or ambiguous. Confidence combines difference
strength, contrast against the frame, compactness, component size, and temporal
continuity; it is an evidence score, not a model probability or accuracy
estimate.

The default transport budget is 4,096 pixels per frame. Oversized readable
frames are nearest-neighbour bounded before detection, and the work is linear
in the bounded pixel count. There is one active asynchronous `analyze()` call;
a concurrent call returns `unknown` with `reason: "backpressure"` without
mutating state. The trajectory is capped at 32 points by default.

The adapter returns explicit `unknown` output and clears or quarantines its
state for:

- invalid samples, unreadable pixels, and frame dimension changes;
- explicit or detected camera cuts (large global frame difference);
- duplicate, stale, or backwards media timestamps, and stale captured times;
- missing candidates, candidate rejection, and ambiguous candidates;
- continuity jumps, excessive gaps, and insufficient confidence.

Stale and backpressure samples do not advance the timestamp watermark or
replace the previous frame. A valid frame after a reset establishes a new
baseline; it must obtain a fresh candidate anchor before a trajectory can be
accepted. No missing point is filled by extrapolation, and no result controls
playback.

## Latency and accuracy limitations

This is a low-latency **candidate proposal heuristic**, not a validated shuttle
tracker. Its intended work budget is one scan and one connected-component pass
over the 4,096-pixel transport, with no inference model startup. Actual latency
still depends on frame extraction, canvas readback, MV3 messaging, and the
browser's offscreen scheduler; this repository does not claim a device-specific
millisecond benchmark. Use the runtime's existing stale/backpressure status
rather than waiting for a result.

Accuracy is not benchmarked by this adapter. It is especially vulnerable to
video compression noise, motion blur, small or dark shuttle pixels, court
lights/reflections, player or racket motion, rapid shuttle displacement,
occlusion, zoom/crop changes, and camera cuts that are not globally obvious.
The old position can be visible in a frame difference, so the compact/high
contrast gates intentionally prefer rejection to guessing. A camera angle or
resolution change may cause a reset. A `tracked` result means only that this
bounded signal was temporally consistent; it does not establish shuttle
identity, hit time, landing point, line call, speed, or shot classification.
Those downstream claims must remain unknown until a separately validated
adapter and integration pass exist.

Focused deterministic coverage is in
`test/shuttle-tracking-adapter.test.js` and covers positive candidates,
static/large false positives, continuity quarantine, missing candidates,
ambiguous candidates, camera-cut reset, invalid/stale frames, automatic cut
detection, unknown output, and asynchronous backpressure.
