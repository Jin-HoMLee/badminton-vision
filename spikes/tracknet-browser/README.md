# Spike A — TrackNet in Chrome MV3/offscreen

This directory is isolated from the MV3 runtime. It measures the browser
inference contract only; it does not capture YouTube video, control playback,
or add a cloud inference service.

## Result in one sentence

**TrackNet is not suitable for M0/MVP as a per-frame automatic tracker on the
measured Mac/Chrome environment.** The 3-frame MIT V3-compatible ONNX export
runs in WebGPU, but at about 1.0 s steady-state per call at 512×288; WASM is
about 10.1 s and the graph fails on WebGL. That is far above a 33.3 ms/frame
30-fps budget. Browser feasibility is therefore proven for an offline or very
sparse fallback, not for the promised live suggestion path.

The timing statement above is measured evidence for one Apple-silicon Mac,
Chrome 151, ONNX Runtime Web 1.29.0, and synthetic input frames. It is not a
claim about all hardware or tracking accuracy.

## Reproduce the fixture path

From this directory:

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.fixture.txt
.venv/bin/python scripts/make_fixture.py
npm test
npm run benchmark -- --all --port 4174 --cdp-port 9230 --iterations 20 --warmup 3
```

The last command launches Chrome, serves the local page and writes a JSON
result under `results/`. Set `CHROME_PATH` if Chrome is not at the platform
default. Add `--headed` to exercise a headed GPU browser; `--all` runs WASM,
WebGL and WebGPU. For the 640×360 fixture, use its matching static model:

```bash
npm run benchmark -- --all --model /fixtures/tracknet_fixture_640x360.onnx \
  --resolutions 640x360 --port 4174 --cdp-port 9230
```

The committed ONNX fixtures are 408-byte contract fixtures, not tracking
models. They copy each input frame's red plane into one output heatmap, which
makes known peaks available for automated post-processing checks. They must
not be used to infer TrackNet accuracy.

## Obtain and convert the MIT 3-frame V3-compatible checkpoint

The tested 3-frame candidate is the `alenzenx/TrackNetV3` repository. Its
README links a Google Drive checkpoint and its repository `LICENSE` is MIT.
Weights are not committed here. Downloading is explicit and local:

```bash
# Source code is only used by the conversion script; keep it outside this repo.
git clone https://github.com/alenzenx/TrackNetV3.git /tmp/alenzenx-TrackNetV3
.venv/bin/pip install -r requirements.v3.txt
.venv/bin/python scripts/download_gdrive.py \
  --id 1NDe_Wsl6n9l8qLBywjzCnBHcWAQ_Bqq5 \
  --output artifacts/alenzenx-tracknetv3.pt
.venv/bin/python scripts/convert_alenzenx_v3.py \
  --source /tmp/alenzenx-TrackNetV3 \
  --checkpoint artifacts/alenzenx-tracknetv3.pt \
  --output artifacts/alenzenx-tracknetv3.onnx
npm run benchmark -- --all --headed \
  --model /artifacts/alenzenx-tracknetv3.onnx \
  --resolutions 512x288 --port 4174 --cdp-port 9230 \
  --iterations 20 --warmup 3
```

The downloaded checkpoint observed in this spike has:

- SHA-256 `ff3fc5687cc83cda19095116881d564ed7fe60de3d013fd4d6a801e88299dc68`;
- `model_name=TrackNetV2`, `num_frame=3`, `input_type=2d` in its checkpoint
  metadata (the repository presents the architecture as TrackNetV3);
- output ONNX SHA-256 is `6ec8b8edcfc47db4668d046e959f956fa48e982378637f4ca37b1b69bf921816`
  for this conversion and is written to the sidecar metadata; the model is
  intentionally ignored by Git (about 58 MiB).

The exact artifact is external and may change or disappear. Verify the SHA
before using a result. The browser receives only a local `/artifacts/...` URL;
no frame or inference request goes to Google Drive or another service.

## Candidate paths and conversion status

| Path | Source/weights provenance | Browser contract | Spike finding |
|---|---|---|---|
| `alenzenx/TrackNetV3` 3-frame tracker | MIT source; README links Google Drive weights; checkpoint metadata is recorded above | `[1,9,288,512]` RGB → `[1,3,288,512]` heatmaps | Exported and benchmarked. WebGPU works but is ~1.0 s steady; WASM ~10.1 s; WebGL fails on `Resize (packed) ... nearest`. |
| `qaz812345/TrackNetV3` tracker + rectifier | MIT `LICENSE` explicitly covers pretrained checkpoints; Google Drive zip id `1CfzE87a0f6LhBp0kniSl1-89zaLCZ8cA`, observed SHA-256 `8de68d34ea2457e368e22947f1309143d60a6a7f9ddccd31cd526d4c4571bcc4` | Intended MVP contract would need 3 frames, but supplied checkpoint metadata says `seq_len=8,bg_mode=concat`: `[1,27,288,512]` plus a median background → `[1,8,288,512]` | `convert_tracknet_v3.py` rejects this checkpoint rather than silently dropping the background/frames. It is not a 3-frame browser candidate without retraining or a separate compatible checkpoint. |
| Official `AR4152/TrackNetV4` | Repository source `LICENSE` is MIT. `docs/RESULT.md` has `Download` links whose targets are `#`; no reproducible public weight URL was found in the repository | 3 RGB frames, `[1,9,288,512]` → 3 heatmaps; motion prompt/fusion adds conversion complexity | `convert_tracknet_v4.py` is ready for a supplied `.keras`/`.h5` checkpoint, but no official weight artifact could be obtained for an end-to-end browser run. TrackNetV4 accuracy and browser latency remain unproven here. |

The official V4 repository's reported Python FPS is not browser evidence and is
not substituted for this spike's measurements. Likewise, the source projects'
reported accuracy/FPS values are not re-evaluated here.

## Runtime contract

The implementation in `src/contract.mjs` is the proposed offscreen boundary:

1. A producer supplies exactly three `ImageData`-like `{data,width,height}`
   RGB/RGBA frames. The producer remains responsible for obtaining frames via
   `requestVideoFrameCallback`; this spike deliberately has no video element.
2. `preprocessFrames` resizes nearest-neighbour and packs normalized RGB into
   frame-major NCHW `[1,9,H,W]` (`frame0.R, frame0.G, frame0.B, ...`). This
   matches the exported 2-D TrackNet variants; a model using background
   concatenation needs a different explicit contract.
3. The offscreen document runs one local ONNX Runtime Web session. The model
   must expose one input and one `[1,T,H,W]` or `[T,H,W]` sigmoid heatmap output.
   The backend is selected explicitly (`webgpu`, `webgl`, or `wasm`) and no
   automatic cloud fallback exists.
4. `decodeHeatmaps` thresholds at 0.5, finds the largest 8-connected component,
   and emits centroid, component confidence, argmax and active-pixel count.
   Keep the raw heatmap diagnostic when confidence is low; a centroid is not a
   calibrated probability.
5. `TemporalWindowBuffer` tags every rolling window with media timestamps. A
   3-frame window cannot emit until two prior frames arrive. Selecting the
   latest output heatmap gives zero target-frame delay after that initial two
   frame fill; selecting the center gives one-frame media delay. Consumers must
   display result age and skip work rather than pause or seek playback.

## Measured evidence

Machine: Apple-silicon MacBook Air, macOS 26.6.2, Chrome 151, Chrome's
headless and headed modes, ONNX Runtime Web 1.29.0, 8 GiB reported device
memory. Commands used the local harness with warm-up and steady-state calls.
The full JSON samples are intentionally not committed because they contain
machine-specific timestamps and are reproducible with the commands above.

### Real 3-frame V3-compatible export, 512×288

Five calls were used for the short provider probes; the longer WASM probe used
one warm-up and two steady calls. The input was the deterministic synthetic
moving bright-pixel fixture, so these are runtime numbers, not accuracy:

| Chrome mode / EP | Warm-up | Steady-state | Result |
|---|---:|---:|---|
| Headed WebGPU | 1.236 s | 1.033–1.052 s (p50 1.043 s, n=2) | Session and inference succeed; heatmaps decode |
| Headless WebGPU | 1.538 / 1.027 s (n=2) | 1.010–1.033 s (p50 1.020 s, n=5) | Also succeeds, but does not represent a guaranteed hardware GPU |
| Headless WASM | 10.202 s | 10.092–10.184 s (p50 10.138 s, n=2) | Succeeds but is not live-capable |
| Headless WebGL | session created | — | Fails in inference: `Resize (packed) does not support mode: 'nearest'` |

The real ONNX output was `[1,3,288,512]`. In the headed WebGPU run the final
three heatmaps had decoded centroids `(127,101)`, `(228.53,131.13)`, and
`(331.89,159.58)`, with maxima `0.521`, `0.819`, and `0.787`; thresholded
component sizes were `1`, `15`, and `19`. This confirms output shape and
post-processing behavior on a known input, not shuttle localization quality.

### Small fixture provider check

The 408-byte fixture ran at both target resolutions. A representative headed
probe at 512×288 showed WebGPU steady p50 8.89 ms and WebGL steady p50 29.66
ms; WASM was about 1.10 ms in headless mode. At 640×360, the same probe showed
WebGPU 13.0 ms, WebGL 45.4 ms, and WASM 2.36 ms. These numbers measure a
one-convolution fixture and only establish that the provider plumbing and
shape-specific model loading work.

### Memory and failure symptoms

Portable GPU memory is not exposed by the browser API. The harness records JS
heap when `performance.memory` exists and labels GPU memory as unavailable.
In the real model probe, observed JS heap deltas varied with garbage
collection: approximately -13 MiB headed WebGPU, +42 MiB headless WASM, and
WebGL terminated before a useful steady-state sample. A future decision needs
an external OS/GPU profiler on target hardware; heap deltas are not VRAM
measurements.

## Recommendation and remaining proof

- **M0/MVP automatic path:** do not ship this TrackNet export as a live,
  per-frame offscreen tracker. Use the already-scoped manual labeling path and
  keep automatic tracking behind an explicit experimental/very-sparse mode.
- **If a browser model is required next:** keep the runtime contract and
  WebGPU-first provider, but benchmark a much smaller/distilled model or a
  lower sampling rate against the same 33.3 ms budget. Retest on supported
  headed Chrome devices, not only headless Chrome.
- **Fallback:** use local WASM only for explicit offline/batch analysis if a
  product owner accepts roughly ten seconds per 3-frame inference for this
  58 MiB export; it is not a transparent live fallback.
- **Unproven:** TrackNetV4 with real weights; accuracy on the product's YouTube
  footage; MV3 offscreen document lifetime/eviction under a long video; frame
  transfer cost from the content script; camera cuts; and end-to-end result
  age under real playback. None of those should be represented as solved by
  this spike.

## Sources and licenses

- [alenzenx/TrackNetV3](https://github.com/alenzenx/TrackNetV3), including its
  [MIT LICENSE](https://github.com/alenzenx/TrackNetV3/blob/main/LICENSE) and
  README checkpoint link.
- [qaz812345/TrackNetV3](https://github.com/qaz812345/TrackNetV3), including its
  [MIT LICENSE](https://github.com/qaz812345/TrackNetV3/blob/main/LICENSE),
  which explicitly mentions pretrained checkpoints.
- [official TrackNetV4 repository](https://github.com/AR4152/TrackNetV4), its
  [MIT LICENSE](https://github.com/AR4152/TrackNetV4/blob/main/LICENSE), and
  [RESULT.md](https://github.com/AR4152/TrackNetV4/blob/main/docs/RESULT.md).
- [ONNX Runtime Web WebGPU documentation](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).

The ONNX Runtime Web npm package is a runtime dependency installed by
`npm install`; model execution remains local. All external model sources and
weights are called out above; no unclear-license model is silently included.
