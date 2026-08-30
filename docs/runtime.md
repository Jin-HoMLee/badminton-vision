# M0 runtime contract

This repository contains the first local-first Chrome MV3 runtime foundation. It intentionally has no TrackNet conversion, model weights, court analytics, or ONNX Runtime Web dependency. The offscreen analyzer is a mock seam so those choices can be de-risked independently.

## Build and load

Requires Node.js 20 or newer and Chrome with MV3 offscreen-document support:

```sh
npm run build
```

The command creates `dist/`, a loadable unpacked extension. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `dist/` directory. Navigate to a YouTube `watch` page. The extension starts automatically when it finds a video; no player control is required.

The test and build gate is:

```sh
npm run check
```

## Playback boundary

`common/capabilities.js`, `content/video-discovery.js`, and `content/capture.js` own discovery and capture. The content runtime:

- observes the YouTube SPA and DOM for the current `HTMLVideoElement`;
- uses `requestVideoFrameCallback` when available and reads `mediaTime`, dimensions, and playback rate;
- throttles frame copies by wall-clock/media time and creates an `ImageBitmap` without pausing, seeking, muting, changing playback rate, changing `src`, changing video styles, or replacing the player;
- reports `timer-fallback` when `requestVideoFrameCallback` is unavailable, and `unavailable` when frame copying is unavailable.

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
- `analysis.result`: `{ requestId, mediaTime, analyzedAt, status, analyzer, inferenceAvailable, result }`;
- `runtime.capabilities`: capture/offscreen/transferable-frame/inference capabilities and fallbacks;
- `runtime.status`: human-readable lifecycle and fallback status.

`createFrameSample()` returns `{ message, transferables }`. The frame is an `ImageBitmap` (or a compatible transferable frame object), never a base64 image. `RuntimeBridge` passes that explicit transfer list to transfer-capable `postMessage` implementations. The MV3 service-worker relay preserves the same message shape across the offscreen boundary; if a browser transport cannot preserve a transferable frame, the runtime reports the transport fallback rather than silently claiming inference availability. The mock analyzer only consumes the timestamp/metadata seam and returns an explicitly unclassified result.

## Synchronization and stale results

`common/synchronization.js` implements the `media-time-watermark` policy:

1. discard results from another session or older than the displayed timestamp;
2. hold results newer than the current media timestamp;
3. display the newest result at or before current `mediaTime`;
4. retain the last displayed result while inference lags, exposing `ageSeconds` and `stale` after 1.5 seconds;
5. reset the local timeline on a backward media-time jump.

The renderer never waits for inference and never seeks to catch up. Playback-rate changes therefore require no frame counter: both capture and rendering use media timestamps. Navigation and a replaced video get a new session and a clean watermark.

## Capability/fallback states

M0 reports capture mode, offscreen availability, analyzer name, inference availability, and fallback reasons. The expected initial analyzer state is `analyzer: "mock"` and `inference: false`; this is not a model-quality claim. Missing offscreen support, missing frame-copy support, disconnected runtime ports, invalid protocol messages, and mock analyzer errors are visible in the status chip while playback remains untouched.
