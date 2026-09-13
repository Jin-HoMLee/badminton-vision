# Racket detector A/B verdict: EfficientDet-Lite0 vs YOLO-World (experimental)

**Session:** MVP acceptance session, 2026-09-13. Same clip (the captain's match,
<https://www.youtube.com/watch?v=99riPBazzfk&t=1057s>, BWF World Championships
2026 Women's Singles Final), same paused frames, same conditions for both
detectors.

## Verdict

**Keep EfficientDet-Lite0 as the default.** Do not promote YOLO-World. On this
match, EfficientDet detects both players' rackets accurately in ~110-135ms;
YOLO-World, even after two real integration bugs were found and fixed during
this session so it could run at all, detected **zero** rackets on the same
frames and took ~7x longer per frame. Its AGPL-3.0 license and heavy local-only
prep also make it unsuitable as anything but an opt-in research/archive
comparison entry, exactly as the project's existing design already treats it.

## Method

1. Loaded the unpacked extension in a dedicated headed Chrome instance and
   enabled inference on the captain's match.
2. Paused on two full-court rally frames with both players' rackets clearly
   visible (frame 1: score 13-12, frame 2: score 17-17), captured each frame's
   real pixels via canvas, and ran both detectors' `analyze()` directly in the
   offscreen document on the identical pixel buffer - same input, same
   conditions, no confound from re-encoding or re-capturing between runs.
3. Also timed pure per-call inference latency for YOLO-World on synthetic
   1280x720 frames (3 runs) to cross-check against the paused-frame timings
   and the project's own documented "research-measured ~2-6 s/frame" figure.
4. Re-ran the same real-frame comparison with the network fully disconnected
   (see the acceptance record's offline test) to confirm neither detector's
   local artifact depends on network reachability once loaded.

## Setup cost

YOLO-World is not part of the default package by design (see
`docs/yolo-world-experimental.md`). Preparing it locally for this comparison
required:

```
pip3 install ultralytics onnx onnxruntime   # pulled in torch, opencv-python, etc.
npm install --no-save onnxruntime-web
node scripts/prepare-yolo-world.mjs --variant small
```

This downloaded a 338 MB Ultralytics checkpoint and exported it to a 47.8 MB
ONNX artifact baked with the racket vocabulary
(`badminton racket, racket, player's racket, racquet`). EfficientDet-Lite0
needs none of this - it ships in the default package today.

### Two real bugs found and fixed while preparing this comparison

Both are small, scoped fixes committed as part of this session (with
regression tests) and both were required just to get YOLO-World running at
all - the experimental entry was **completely non-functional**, not merely
slow, before these fixes:

1. **`src/extension/offscreen/racket-model-selector.js`** -
   `probeRacketModelAvailability` read `binding.globalKey` on the object
   `adapterBinding()` returns, but that object nests the adapter-globals
   binding one level deeper (`binding.binding.globalKey`); the outer object
   has no `globalKey` property. `env[binding.globalKey]` was therefore always
   `env[undefined]`, so the picker permanently reported
   `onnx-runtime-web-not-loaded`, even with a fully prepared local artifact.
   The current probe checks the packaged ONNX runtime module and model asset
   without executing the runtime during listing; activation alone resolves
   `resolveOnnxRuntime()`. Regression coverage verifies that listing performs
   no runtime resolution.
2. **`scripts/prepare-yolo-world.mjs`** - `copyOrtAssets()`'s file allowlist
   predates a newer `onnxruntime-web` release that split its WASM backend
   entry point into a separate `ort-wasm-simd-threaded.jsep.mjs` companion
   module. Without it, ONNX Runtime Web's `wasm` backend fails at runtime with
   `Failed to fetch dynamically imported module: .../ort-wasm-simd-threaded.jsep.mjs`,
   and the `webgl` fallback isn't bundled either, so **both** backends failed
   and the analyzer could never initialize even after the picker bug above was
   fixed. Added the missing `.jsep.mjs`/`.jsep.wasm` files to the copy list.

## Results

| | EfficientDet-Lite0 (Production) | YOLO-World (Experimental) |
| --- | --- | --- |
| Frame 1 (score 13-12) | **tracked**, 2 detections, conf 0.56 / 0.54, **113ms** | unknown, 0 detections, **848ms** |
| Frame 2 (score 17-17) | **tracked**, 4 detections (2 high-confidence ~0.54, 2 lower), **112ms** | unknown, 0 detections, **847ms** |
| Re-run fully offline (frame 1) | **tracked**, 2 detections, **136ms** | not re-run (result already 0/0 online; offline cannot improve it) |
| Synthetic 1280x720 frame, 3 runs | n/a | 852 / 858 / 876 ms (consistent, no detections expected - noise input) |
| Threshold sensitivity | n/a | re-tested at `confidenceThreshold: 0.01`; still 0 candidate detections, so this is not a threshold-calibration artifact |

EfficientDet's boxes land precisely on each player's racket head in the
correctly-tracked case; one of its two boxes per frame lands on a court-side
object near the left camera position rather than the near player's racket
(a real but minor false-positive pattern, consistent with it being a general
COCO "tennis racket" class detector rather than a badminton-specific one -
see the acceptance record's per-class spot-check for the annotated frames).
YOLO-World, despite being loaded, initialized, and confirmed reachable
(model file and ONNX Runtime both fetch and resolve successfully), produced
no candidate detections above even a near-zero confidence threshold on either
frame. The most likely cause is the fixed 640x640 square input resize against
this video's 854x480/1280x720 wide aspect ratio (no letterboxing in the
current adapter), compounding the vocabulary's own generalization gap on
small, motion-blurred broadcast rackets; a deeper investigation of YOLO-World's
accuracy is out of scope for this session, since the MVP verdict does not turn
on it - the speed and licensing factors alone are decisive.

## Licensing

EfficientDet-Lite0 is Apache-2.0, cleared for redistribution, and already
shipped. YOLO-World is an AGPL-3.0 Ultralytics asset; distributing a prepared
copy carries AGPL-3.0 source-disclosure obligations. This is a real, ongoing
governance cost with no offsetting accuracy or speed benefit observed in this
session.

## Recommendation

- Keep **EfficientDet-Lite0 as the shipped default** - no change.
- Keep YOLO-World as the **opt-in experimental entry only**, exactly as
  designed: not the default, not committed, not loaded unless a captain or
  developer explicitly prepares it and selects it. The two integration bugs
  above are now fixed so a future investigator can actually reach a live run
  instead of a silently-broken picker entry, but nothing in this session's
  results supports promoting it further.
