# Runtime contract and local integration slice

This repository contains a local-first Chrome MV3 runtime foundation and a
small end-to-end runtime integration slice. It intentionally does not claim
that production player/shuttle computer vision is solved. The offscreen
analyzer is a committed deterministic fixture probe, not TrackNet, model
weights, court analytics, or a production CV model.

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
offscreen-document and structured-clone messaging support. In Chrome, open
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
- limits pending `createImageBitmap` operations with an explicit one-sample default (`maxInFlight`), reports backpressure, and never builds an unbounded queue;
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
- `runtime.capabilities`: capture/offscreen/transferable-frame/inference capabilities and fallbacks;
- `runtime.status`: human-readable lifecycle and fallback status.

`createFrameSample()` returns `{ message, transferables }`. The frame is an
`ImageBitmap` (or a compatible transferable frame object), never a base64
image. Chrome MV3 runtime ports have no transfer-list parameter, so the
manifest opts into Chrome 148+'s structured-clone messaging and the bridge
reports that the hop may copy the bitmap. The service-worker relay preserves
the message shape across the offscreen boundary. The default offscreen analyzer is `fixture-probe-v1`:
it reads the local bitmap through a canvas and runs a deterministic sampled-RGB
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

The runtime reports capture mode, offscreen availability, analyzer name,
inference availability, and fallback reasons. The expected ready state is
`analyzer: "fixture-probe-v1"` and `inference: true`, with the explicit
fallback `runtime-integration-probe-not-production-cv`; this is a local
plumbing signal, not a model-quality claim. Missing offscreen support reports
`analyzer: "none"` and `inference: false`. Missing frame-copy support,
disconnected runtime ports, invalid protocol messages, and analyzer errors
are visible in the UI status surfaces while playback remains untouched.
