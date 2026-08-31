# Runtime contract and local integration slice

This repository contains a local-first Chrome MV3 runtime foundation and a
small end-to-end runtime integration slice. It intentionally does not claim
that production player/shuttle computer vision is solved. The offscreen
analyzer is a committed deterministic fixture probe until a cleared model
artifact is available; it is not TrackNet, model weights, court analytics, or
a production CV model.

## Canonical build and load

`manifest.json` at the repository root is the only source manifest for the
public extension. `scripts/build.mjs` is the only packaging entrypoint; it
combines the design-system UI and runtime foundation into `dist/`:

```sh
npm run build
```

Do not use a runtime-only build command or create a second manifest. The old
runtime-only `build.mjs` and `src/extension/manifest.json` packaging path was
retired. Runtime modules remain under `src/extension/`, but are copied by the
canonical build only when referenced by the root manifest.

Requires Node.js 20 or newer and Chrome 148 or newer with MV3
offscreen-document support. Stable Chrome uses the serializable RGBA frame
fallback described below; structured-clone messaging is an optional channel
capability and is not declared in the public manifest. In Chrome, open
`chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and
select this repository's `dist/` directory. Navigate to a YouTube `watch`
page. The extension discovers a video automatically; no player control is
required.

The focused runtime round-trip check is:

```sh
npm run runtime-smoke
```

It rebuilds the canonical package and exercises the offscreen document,
service-worker relay, fixture result, missing-offscreen fallback, and capture
backpressure/no-playback-mutation invariants using deterministic Node
harnesses. The complete project check is:

```sh
npm run check
```

## UI/runtime seam

`src/runtime.js` owns the small `createRuntimeUiSeam()` adapter used by the
public content UI. The runtime controller sends capability and result
messages to this seam; the seam exposes analyzer identity, inference/fallback
state, the model-neutral result envelope, and synchronization age/stale state
to the existing popup, overlay, status, summary, and export surfaces. Manual
labels and fixture rows remain editable records; fixture results never become
production stroke/player claims.

The fixture analyzer is deliberately identified in the UI as **a runtime
integration probe, not production CV**. It reads captured pixels only to prove
the local boundary. It does not identify a player, shuttle, or shot. The
result envelope has a `players` array for zero or more future detections; each
future entry may carry a session-local `trackId`, confidence, and
`tracked`/`partial`/`unknown` state. The fixture returns an empty array and
unknown/partial state rather than inventing a single-person result.

## Multi-person pose contract and association

`common/player-tracking.js` is the model-neutral adapter boundary. It loads no
model and makes no detector choice. `normalizePoseObservation()` converts a
candidate detector pose to this versioned shape (pixel coordinates are inferred
when dimensions are present and a coordinate is greater than 1; adapters may
instead set `coordinateSpace: "pixel"` explicitly):

```js
{
  schema: "bso.pose.observation.v1", version: 1,
  sessionId, requestId, observationId, mediaTime,
  detector: { id, version, kind }, source: { id, version, kind },
  state: "tracked" | "partial" | "unknown", confidence: 0..1 | null,
  bbox: { x: 0..1, y: 0..1, width: 0..1, height: 0..1 } | null,
  keypoints: [{ name, x: 0..1, y: 0..1, confidence: 0..1 | null }]
}
```

`isPoseObservation()` rejects malformed normalized data at the adapter seam.
A tracked pose needs a box and confidence; incomplete or low-confidence data is
partial. Unknown data has no usable pose. Duplicate observation IDs and near-
identical boxes are deterministically collapsed, retaining the higher
confidence (then the lexicographically smaller ID), and are reported in
`duplicateObservations`.

`SessionPlayerTracker` is a deterministic session-local association primitive.
It defaults to four tracks (and permits 2–4), so court half, image side, or
player ordering is never an identity. Its documented method is
`gated-motion-box-keypoint-v1`: an observation must pass the normalized center
motion gate (`maxCenterDistance: 0.24`), box-size gate (each dimension ratio
0.25–4), box-or-center gate (IoU or motion), optional common-keypoint gate
(`keypointGate: 0.45`), and total cost gate (`maxCost: 0.82`). Assignment cost
is `0.45 * motion + 0.30 * (1 - IoU) + 0.25 * keypoint + confidence penalty`.
The global assignment is sorted by cost and stable IDs, with
`ambiguityMargin: 0.08`. A close alternative or a weak-evidence crossing
quarantines the affected observations: existing IDs remain `unknown` for that
frame and `association.identityRisk` is
`likely-id-switch-or-crossover`; the observation is never silently assigned to
the other player. A later separated frame can recover the old IDs using the
retained motion hint.

A missed track is `partial` with a bounded predicted box for up to two frames,
then `unknown`; it is retired only after eight missed frames. A low-confidence
new pose does not create a track. Empty detections, invalid detector output,
and a missing detector all remain unknown/partial. `processFrame({stale: true})`,
a duplicate request, or a media timestamp at/before the watermark is rejected
without mutating tracks. `reset("camera-cut")` or `cameraCut: true` clears the
association state and advances the session-local ID generation. Runtime
session end/video replacement must create a new tracker/session. Request IDs
and media timestamps are copied into every result, and all of this work is
synchronous and local to the offscreen analyzer; it never blocks or mutates
playback.

The offscreen HTML loads this contract before the MoveNet adapter and fixture
analyzer. `offscreen/movenet-adapter.js` decodes the official MultiPose output
shape (`[1, 6, 56]`), maps its padded coordinates back to the captured frame,
and feeds normalized observations to `SessionPlayerTracker`; its result is
placed under the existing model-neutral `analysis.result` envelope. The
adapter probes WebGPU, WebGL, and WASM with a real tensor operation before
loading a model, and drops stale or concurrent frames without mutating the
tracker. The public package currently selects the fixture because the official
MoveNet MultiPose weight release has no explicit redistribution license in the
model card or artifact metadata. The TensorFlow.js source license does not by
itself clear the weights, so no model, TensorFlow.js runtime, or CDN fallback
is bundled. This is an intentional release gate, not a production CV claim.

## MoveNet artifact release gate

The adapter contract is implemented and deterministic decoding/association is
tested, but the checkpoint is not shipped. The official MultiPose model card
(`https://storage.googleapis.com/movenet/MoveNet.MultiPose%20Model%20Card.pdf`)
describes the model and output shape but does not state a license, and the
TensorFlow.js MoveNet repository's Apache-2.0 notice covers its adapter source,
not necessarily Google's separately distributed weights. Until Google provides
an explicit weight redistribution grant or a model package with a clear license
and attribution notice, adding `model.json` or weight shards would violate the
launch brief's licensing gate. Do not replace this gate with a CDN URL.

## Court calibration boundary

`analysis/index.js` is copied to the browser as `analysis-primitives.js` and
exposes the same BWF geometry and homography implementation as
`BVAnalysisPrimitives`. `src/calibration.js` is the small browser adapter used
by the content UI. It fits the four normalized video-image points in the
README §8 order (near-left, near-right, far-right, far-left) to the canonical
normalized court, validates the quadrilateral/conditioning, and projects all
13 generated lines while retaining their dimensions and line ownership
metadata.

A locked result stores `videoKey`, normalized committed `seedPoints`, and the
serializable calibration matrices in the existing `bvState` local-storage
record. The content UI refits from stored seeds rather than trusting stored
matrices. Navigation, video replacement, and `CAMERA_CUT` clear this
video-local result; the overlay can only return to live court display after a
new four-click fit. Normalized coordinates are rendered through the existing
video client-rect anchor, so resize, theater, and fullscreen do not alter the
physical court or touch playback.

## Playback boundary

`common/capabilities.js`, `content/video-discovery.js`, and `content/capture.js`
own discovery and capture. The content runtime:

- observes the YouTube SPA and DOM for the current `HTMLVideoElement`;
- uses `requestVideoFrameCallback` when available and reads `mediaTime`, dimensions, and playback rate;
- throttles frame copies by wall-clock/media time and creates a real `ImageBitmap` snapshot;
- uses `rgba-array-v1` on stable Chrome, downsampling the captured bitmap to at most 4096 pixels before messaging; a channel that explicitly supports structured clone may retain the `image-bitmap` path;
- limits pending `createImageBitmap` operations with an explicit one-sample default (`maxInFlight`), reports backpressure, and never builds an unbounded queue;
- the offscreen scheduler allows one active inference and one newest pending frame, closes coalesced/stale bitmaps, and drops older work;
- reports `timer-fallback` when `requestVideoFrameCallback` is unavailable, and `unavailable` when frame copying is unavailable;
- never pauses, seeks, mutes, changes playback rate, changes `src`, changes video styles, or replaces the player.

The design-system overlay is a separate DOM sibling with `position: fixed`. It
follows `getBoundingClientRect()` and re-anchors through `ResizeObserver`,
window resize/scroll, fullscreen changes, mutations, navigation, and video
replacement. Runtime status and result age are rendered through that existing
overlay rather than mounting a second runtime-only status element.

## Message protocol

`common/protocol.js` is the public contract. Every message has:

```js
{
  protocol: "bso.runtime.v1",
  version: 1,
  type: "...",
  sessionId: "video-local-session"
}
```

The message types are:

- `runtime.session.start` / `runtime.session.end`: video-local lifecycle;
- `capture.frame.sample`: `{ requestId, mediaTime, capturedAt, dimensions, frameFormat, frame }`;
- `analysis.result`: `{ requestId, mediaTime, analyzedAt, status, analyzer, analyzerIdentity, inferenceAvailable, capabilities, capabilityState, result }`;
- `runtime.capabilities`: capture/frame-transport/offscreen/transferable-frame/inference capabilities and fallbacks;
- `runtime.status`: human-readable lifecycle and fallback status.

`createFrameSample()` returns `{ message, transferables }`. The preferred
capture primitive is an `ImageBitmap`, never a base64 image. On stable Chrome,
`common/frame-transport.js` converts it to a bounded plain RGBA object before
MV3 JSON messaging, avoiding the silent `{}` conversion that would otherwise
make the offscreen frame unreadable. A channel that explicitly reports
`message_serialization: "structured_clone"` may send the bitmap with the
existing `transferables` contract. The service-worker relay preserves
the message shape across the offscreen boundary. The default offscreen analyzer is `fixture-probe-v1`:
it reads the local frame pixels (through a canvas for the bitmap path) and runs a deterministic sampled-RGB
checksum fixture. Results identify themselves as `runtime-integration-probe`,
set `runtimeIntegrationTest: true` and `productionModel: false`, and remain
explicitly unclassified. This is not a production player or shuttle CV model;
no TrackNet asset is used in the live runtime path.

## Synchronization and stale results

`common/synchronization.js` implements the `media-time-watermark` policy:

1. discard results from another session or older than the displayed timestamp;
2. hold results newer than the current media timestamp;
3. display the newest result at or before current `mediaTime`;
4. retain the last displayed result while inference lags, exposing `ageSeconds` and `stale` after 1.5 seconds;
5. reset the local timeline on a backward media-time jump.

The renderer never waits for inference and never seeks to catch up. Playback-rate changes therefore require no frame counter: both capture and rendering use media timestamps. Navigation and a replaced video get a new session and a clean watermark. The popup and overlay keep the analysis-behind age visible; fallback status says playback is unaffected.

## Capability/fallback states

The runtime reports capture mode, frame transport, offscreen availability,
analyzer name, inference availability, and fallback reasons. The expected
stable ready state is `frameTransport: "rgba-array-v1"`,
`analyzer: "fixture-probe-v1"`, and `inference: true`, with the explicit
fallback `runtime-integration-probe-not-production-cv`; this is a local
plumbing signal, not a model-quality claim. Missing offscreen support reports
`analyzer: "none"` and `inference: false`. Missing frame-copy support,
serialization canvas support, disconnected runtime ports, invalid protocol
messages, and analyzer errors are visible in the UI status surfaces while
playback remains untouched.
