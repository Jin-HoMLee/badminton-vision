# Runtime contract and local integration slice

This repository contains the public local-first Chrome MV3 runtime and the
MVP pose/shuttle composition. The canonical offscreen analyzer is the bundled
Apache-2.0 Lightweight OpenPose LiteRT conversion composed with the bounded
local shuttle candidate/trajectory adapter; their local artifacts and runtime
are versioned under `src/extension/offscreen/vendor/`. Stroke, rally, and
winner computer vision remain unknown until a later event adapter or manual
review supplies evidence. The committed deterministic fixture remains only an
explicit plumbing diagnostic path (`BSO_DIAGNOSTIC_FIXTURE` is set only by
Node harnesses); the public browser package always has the production script.

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
offscreen-document support. The manifest injects one generated
`content.bundle.js` entrypoint; its guard makes declared injection and popup
recovery share one content/UI/listener instance per tab. Stable Chrome uses the
serializable RGBA frame fallback described below; structured-clone messaging is
an optional channel capability and is not declared in the public manifest. The manifest explicitly
allows `'wasm-unsafe-eval'` for the local LiteRT WebAssembly executor; without
that extension-page CSP permission, model initialization fails and the UI must
report unknown/fallback state. In Chrome, open `chrome://extensions`, enable
**Developer mode**, choose **Load unpacked**, and select this repository's
`dist/` directory. Navigate to a YouTube `watch` page. The extension discovers a
video automatically; no player control is required.

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

The offscreen HTML loads this contract before the LiteRT runtime loader,
Lightweight OpenPose adapter, local shuttle adapter, MoveNet seam, and fixture
analyzer. `offscreen/lite-openpose-adapter.js` decodes the cleared model's
`[1, 32, 32, 19]` heatmap output, groups torso-anchored local peaks into up to
four normalized candidates, and feeds them to `SessionPlayerTracker`; its
result is placed under the existing model-neutral `analysis.result` envelope.
It reports WebGPU compile failure, LiteRT's unsupported WebGL backend, and WASM
fallback separately, and drops stale or concurrent frames without mutating the
tracker. RGBA capture pixels are swapped into the artifact's BGR input contract
before the bounded 256x256 model tensor is created. The model card explicitly
clears the published conversion and source weights under Apache-2.0; `vendor/lite-openpose/MODEL-NOTICE.md` records the
source links and SHA-256. LiteRT.js 2.5.3 and both selected WASM executors are
Apache-2.0 and are packaged locally. The older `movenet-adapter.js` remains a
contract-tested seam only: its official checkpoint is not bundled because the
MoveNet model card does not state a weight redistribution license.

### Native runtime log classification

LiteRT's vendored WASM/WebGPU layers may print accelerator registration,
compilation, weight-transfer, or long numeric tensor lines to the offscreen
console. Those native diagnostics are not, by themselves, an inference failure:
the authoritative signal is the capability/result envelope (`runtime.status`,
`runtime.capabilities`, and `analysis.result`). The Emscripten bridge can send
these records through `console.error` even when they are prefixed `INFO`. The
`console.log`/`console.info` filter remains bounded by LiteRT component
prefixes and the XNNPACK delegate text; the `console.error` filter uses exact
patterns for the known LiteRT environment, CPU/GPU registry, compiled-model,
and XNNPACK records, plus the exact healthy WebGPU registration record.
Unrelated stderr INFO, warnings (including an unavailable optional NPU), and
errors remain visible. A genuine initialization or inference failure
emits a `fallback` phase with a reason and the popup shows
**Production inference unavailable** while leaving playback and manual labels
available.

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

## Shuttle candidate composition

`offscreen/shuttle-tracking-adapter.js` is the bounded model-neutral shuttle
component in the public offscreen composition. It uses a bounded RGBA scan,
compactness/contrast rejection, confidence scoring, and temporal continuity;
it emits `unknown` instead of extrapolating through cuts, stale or invalid
samples, missing/ambiguous candidates, and backpressure. It never upgrades a
shuttle candidate into a hit, stroke, landing, line call, rally end, or winner.
The composition runs it before pose on each accepted frame so an automatic
global cut can reset player association too. It is not TrackNet or a validated
production shuttle tracker; see [`docs/shuttle-tracking.md`](shuttle-tracking.md)
for the result shape, state-safety rules, latency budget, and limitations.

## Court calibration boundary

`analysis/index.js` is copied to the browser as `analysis-primitives.js` and
exposes the same BWF geometry and homography implementation as
`BVAnalysisPrimitives`. `src/calibration.js` is the small browser adapter used
by the content UI. It fits the four normalized video-image points in the
README §8 order (near-left, near-right, far-right, far-left) to the canonical
normalized court, validates the quadrilateral/conditioning, and projects all
13 generated lines while retaining their dimensions and line ownership
metadata.

Calibration is an optional map capability, not an inference prerequisite. The
pose, shuttle candidate/trajectory, and racket evidence adapters run through
the offscreen analyzer without seed points or a calibration. The explicit
video-local court lifecycle is `uncalibrated` → `setup` → `calibrated`; starting
setup with an existing fit is `recalibrating`. The map exposes **Set up court**
in the first-use states and **Recalibrate court** once a committed fit exists.

A locked result stores `videoKey`, normalized committed `seedPoints`, and the
serializable calibration matrices in the existing `bvState` local-storage
record. The content UI refits from stored seeds rather than trusting stored
matrices. Navigation, video replacement, and `CAMERA_CUT` clear this
video-local result. During setup, reset, camera-cut invalidation, or a changed
draft, map-relative player/shuttle output and projected lines are withheld
until the new four-click fit is locked; cancelling a recalibration restores the
prior fit. Raw video evidence remains mounted throughout. Normalized
coordinates are rendered through the existing video client-rect anchor, so
resize, theater, and fullscreen do not alter the physical court or touch
playback.

## Playback boundary

`common/capabilities.js`, `content/video-discovery.js`, and `content/capture.js`
own discovery and capture. The content runtime:

- observes the YouTube SPA and DOM for the current `HTMLVideoElement`;
- uses `requestVideoFrameCallback` when available and reads `mediaTime`, dimensions, and playback rate;
- throttles frame copies by wall-clock/media time and creates a real `ImageBitmap` snapshot;
- uses `rgba-array-v1` on stable Chrome, downsampling the captured bitmap to a 256px long edge (at most 65,536 pixels) before messaging; a channel that explicitly supports structured clone may retain the `image-bitmap` path;
- limits pending `createImageBitmap` operations with an explicit one-sample default (`maxInFlight`), reports backpressure, and never builds an unbounded queue;
- the offscreen scheduler allows one active inference and one newest pending frame, closes coalesced/stale bitmaps, and drops older work;
- reports `timer-fallback` when `requestVideoFrameCallback` is unavailable, and `unavailable` when frame copying is unavailable;
- never pauses, seeks, mutes, changes playback rate, changes `src`, changes video styles, or replaces the player.

Capture backpressure is a bounded healthy condition while local inference catches up, and a media-time reset is a resynchronization state; neither is reported as production inference failure. Actual bridge, capture, or analyzer errors retain the explicit fallback state.

The design-system overlay is a separate DOM sibling with `position: fixed`. It
re-anchors through `ResizeObserver`, window resize/scroll/orientation,
fullscreen/transition changes, layout mutations, navigation, and video
replacement. `BVRuntime.videoContentRect()` accounts for the video element's
intrinsic aspect ratio and `object-fit`/`object-position`, so normalized pose and
shuttle coordinates stay on the rendered YouTube pixels rather than a
letterbox. Runtime status and result age are rendered through that existing
overlay rather than mounting a second runtime-only status element.

The live evidence SVG is rebuilt on each newly selected synchronized result:
accepted runtime player keypoints are drawn with a named skeleton, a player box
is drawn only when the runtime supplies a valid box, and explicit shuttle
trajectory/candidate and racket fields are consumed without creating detections
or confidence. Pose, player-box, racket, shuttle, and court-projection
visibility switches are independent persisted UI state; court projection is
additionally guarded by a committed calibration, while the raw pose/shuttle/
racket layers remain available uncalibrated. Missing fields remain
`unknown` or `unavailable`; the SVG and every child use `pointer-events: none`
so court seeding and playback remain safe.

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
the message shape across the offscreen boundary. The canonical offscreen
analyzer is the local `lightweight-openpose-lite-256-v1` pose path composed
with `local-shuttle-frame-difference-v1`. It reads the local frame pixels,
creates the model's bounded 256x256 RGB input, runs LiteRT locally, and returns
normalized two-player-capable pose observations plus the shuttle adapter's
accepted candidate/trajectory. Its result identifies `productionModel: true`
only when pose inference succeeds; an artifact/backend failure returns unknown
pose observations and `inferenceAvailable: false` without selecting the
fixture. The shuttle may still return a separately accepted bounded candidate,
but never a stroke or rally claim. The explicit `fixture-probe-v1` diagnostic
reads local pixels only to prove plumbing, identifies itself as
`runtime-integration-probe`, and never produces player/shuttle/shot claims.
It is not selected when production initialization or inference fails.
No TrackNet asset is used in the live runtime path.

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
`analyzer: "lightweight-openpose-lite-256-v1"`, and `inference: true`, with
backend status identifying WebGPU or WASM. LiteRT's WebGL path is explicitly
reported as unsupported rather than mislabeled. The capability snapshot also
carries the selected shuttle component and backend fallbacks. If the local
artifact/runtime or backend is unavailable, capability state reports
`inference: false` and `analyzer: "none"`; results carry an unavailable identity
and unknown pose state without a fixture substitution. The fixture's explicit diagnostics state uses
`runtime-integration-probe-not-production-cv`. Missing frame-copy support,
serialization canvas support, disconnected runtime ports, invalid protocol
messages, and analyzer errors are visible in the UI status surfaces while
playback remains untouched.
