# Spike A report: TrackNet browser feasibility

## Decision

TrackNet is **not ready for the M0/MVP live per-frame path**. The MIT
3-frame V3-compatible export was successfully converted and loaded in Chrome
WebGPU, but measured steady-state inference was about 1.0 s per 512×288 call.
The same model took about 10.1 s in WASM and failed in WebGL on an ONNX
`Resize(nearest)` implementation gap. A 30 fps stream has only 33.3 ms per
frame. This supports an experimental/offline mode, not a transparent live
fallback.

This conclusion is measured on one Apple-silicon MacBook Air with macOS
26.6.2, Chrome 151, and ONNX Runtime Web 1.29.0 using deterministic synthetic
frames. It is not an accuracy result and is not generalized to every device.

## What was tested

- `alenzenx/TrackNetV3`: MIT source and MIT 3-frame checkpoint; converted
  `model_best.pt` to a 58 MiB ONNX model with
  `[1,9,288,512] -> [1,3,288,512]`.
- `qaz812345/TrackNetV3`: MIT source and MIT checkpoint archive were obtained.
  Its checkpoint metadata is `seq_len=8,bg_mode=concat`, so it needs 8 frames
  plus a median background (`[1,27,H,W] -> [1,8,H,W]`) and is not silently
  treated as a 3-frame model. The converter rejects that mismatch.
- Official `AR4152/TrackNetV4`: MIT source reviewed. Its default model has the
  desired 3-frame shape and motion prompt, but the repository's current
  `docs/RESULT.md` has `#` placeholder weight links. No official checkpoint
  could be obtained for a browser run; its latency and accuracy remain
  unproven.
- ONNX Runtime Web `wasm`, `webgl`, and `webgpu` providers were exercised.
- Preprocessing, heatmap decoding, largest-component centroid selection, and
  rolling temporal tags have focused Node tests.

## Measured results

Real alenzenx 3-frame export, 512×288, synthetic moving bright-pixel input:

| Provider | Warm-up | Steady-state | Observation |
|---|---:|---:|---|
| Headed WebGPU | 1.236 s | 1.033–1.052 s, p50 1.043 s (n=2) | Succeeds |
| Headless WebGPU | 1.538 / 1.027 s | 1.010–1.033 s, p50 1.020 s (n=5) | Succeeds; headless GPU is not a target-device guarantee |
| Headless WASM | 10.202 s | 10.092–10.184 s, p50 10.138 s (n=2) | Succeeds, not live-capable |
| Headless WebGL | session creates | no sample | `Resize (packed) does not support mode: 'nearest'` |

The final WebGPU heatmap summaries were:

```text
centroids: (127,101), (228.53,131.13), (331.89,159.58)
maxima:    0.521,      0.819,          0.787
components: 1, 15, 19 pixels above threshold 0.5
```

The tiny committed fixture is not a model. It copied known red planes and
proved the provider path at both resolutions. A representative headed
512×288 run gave WebGPU 8.89 ms p50 and WebGL 29.66 ms p50; at 640×360 it gave
13.0 ms and 45.4 ms respectively. Headless WASM was 1.10 ms and 2.36 ms. These
figures must not be applied to TrackNet.

JS heap is recorded when Chrome exposes `performance.memory`; GPU memory is
not portable browser telemetry. Observed real-model heap deltas varied with
GC (roughly -13 MiB headed WebGPU and +42 MiB headless WASM). Treat these as
symptoms, not VRAM measurements.

## Integration contract

`src/contract.mjs` defines the proposed MV3 offscreen boundary:

- exactly three RGB/RGBA frame buffers and media timestamps;
- normalized frame-major NCHW `[1,9,H,W]` input;
- one output `[1,T,H,W]`/`[T,H,W]` heatmap tensor;
- threshold 0.5, largest 8-connected component, centroid plus raw argmax;
- rolling buffer emits after two prior frames; latest-frame target has zero
  target-frame delay after fill, center target has one-frame media delay;
- consumers must show result age and skip stale work, never pause/seek video.

## Reproduction

See [`README.md`](README.md) for fixture, browser, conversion, artifact SHA,
and V4 commands. The shortest self-contained check is:

```bash
npm install && npm test
npm run benchmark -- --all --port 4174 --cdp-port 9230 --iterations 20 --warmup 3
```

External weights are deliberately ignored by Git. No cloud inference or API
key is used. Remaining proof is real TrackNetV4 weights, product-footage
accuracy, frame transfer overhead, MV3 lifetime behavior, and end-to-end
result age during playback.
