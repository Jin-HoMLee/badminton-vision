# Runtime contract and local integration slice

This repository contains a local-first Chrome MV3 runtime foundation and a
small end-to-end runtime integration slice. It intentionally does not claim
that production player/shuttle computer vision is solved. The offscreen
analyzer is a committed deterministic fixture probe, not TrackNet, model
weights, court analytics, or a production CV model.

## Build and load

Requires Node.js 20 or newer and Chrome 148 or newer with MV3
offscreen-document and structured-clone messaging support:

```sh
npm run build
```

The command creates `dist/`, a loadable unpacked extension. The build checks
that the MV3 service worker and offscreen document plus its local fixture
scripts are present. In Chrome, open `chrome://extensions`, enable
**Developer mode**, choose **Load unpacked**, and select this repository's
`dist/` directory. Navigate to a YouTube `watch` page. The extension starts
automatically when it finds a video; no player control is required.

The focused runtime round-trip check is:

```sh
npm run runtime-smoke
```

It exercises the offscreen document, service-worker relay, fixture result,
missing-offscreen fallback, and capture backpressure/no-playback-mutation
invariants using deterministic Node harnesses. A full build and test gate is:

```sh
npm run check
```

## Playback boundary

`common/capabilities.js`, `content/video-discovery.js`, and `content/capture.js` own discovery and capture. The content runtime:

- observes the YouTube SPA and DOM for the current `HTMLVideoElement`;
- uses `requestVideoFrameCallback` when available and reads `mediaTime`, dimensions, and playback rate;
- throttles frame copies by wall-clock/media time and creates a real `ImageBitmap` snapshot;
- limits pending `createImageBitmap` operations with an explicit one-sample default (`maxInFlight`), reports backpressure, and never builds an unbounded queue;
- reports `timer-fallback` when `requestVideoFrameCallback` is unavailable, and `unavailable` when frame copying is unavailable;
- never pauses, seeks, mutes, changes playback rate, changes `src`, changes video styles, or replaces the player.

The overlay is a separate DOM sibling with `position: fixed`. It follows `getBoundingClientRect()` and re-anchors through `ResizeObserver`, window resize/scroll, fullscreen changes, mutations, navigation, and video replacement. It is deliberately a status chip rather than the eventual product UI.

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

The renderer never waits for inference and never seeks to catch up. Playback-rate changes therefore require no frame counter: both capture and rendering use media timestamps. Navigation and a replaced video get a new session and a clean watermark.

## Capability/fallback states

The runtime reports capture mode, offscreen availability, analyzer name,
inference availability, and fallback reasons. The expected ready state is
`analyzer: "fixture-probe-v1"` and `inference: true`, with the explicit
fallback `runtime-integration-probe-not-production-cv`; this is a local
plumbing signal, not a model-quality claim. Missing offscreen support reports
`analyzer: "none"` and `inference: false`. Missing frame-copy support,
disconnected runtime ports, invalid protocol messages, and analyzer errors
are visible in the status chip while playback remains untouched.
