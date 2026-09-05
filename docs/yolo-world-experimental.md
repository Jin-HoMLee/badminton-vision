# YOLO-World experimental racket model - compare-on-your-own-footage guide

The popup's **Racket Detection Model** selector mirrors the **Pose Detection
Model** selector: EfficientDet-Lite0 is the bundled production default and
YOLO-World is an **experimental** entry for comparing open-vocabulary racket
detection on your own footage. This page is the captain-facing workflow;
implementation and licensing details live in
[`docs/runtime.md`](runtime.md) (§ Racket model selector) and
`src/extension/offscreen/vendor/yolo-world/MODEL-NOTICE.md`.

## What you get

| | EfficientDet-Lite0 (Production) | YOLO-World (Experimental) |
| --- | --- | --- |
| Role | Shipped default; selected when nothing is changed | Opt-in picker entry |
| Artifact | Vendored Apache-2.0 tflite (committed, in the default package) | AGPL-3.0 Ultralytics asset, prepared locally, never in the default package |
| Speed | Real-time (live play) | Research-measured ~2-6 s/frame (archive-grade, **not** for live play) |
| Detection | COCO class-42 "tennis racket" boxes | YOLO-World zero-shot racket vocabulary (`badminton racket`, `racket`, ...) baked into the export at prepare time |
| Licensing | Apache-2.0, cleared for redistribution | AGPL-3.0 source disclosure applies to anyone who redistributes the prepared artifact |

## Why it is labeled experimental

The captain's decision (D1 = A, 2026-09-05) accepted YOLO-World only as an
experimental comparison entry in the public repository:

- it is never the default and never part of the committed default package;
- selecting it in a public build carries AGPL-3.0 source-disclosure terms
  (recorded next to the model in `vendor/yolo-world/`);
- it is research-measured at ~2-6 s/frame in the MV3 offscreen document -
  archive-grade output suitable for frame-by-frame review, not live play.

## Preparing the experimental model locally

YOLO-World needs two local assets that are **not** in the repository:
the prepared ONNX artifact and the ONNX Runtime Web files.

```bash
pip3 install ultralytics onnx onnxruntime        # python side
npm install --no-save onnxruntime-web            # ort dist used by the copy step
node scripts/prepare-yolo-world.mjs --variant small
npm run build                                    # packages the prepared assets when present
```

`scripts/prepare-yolo-world.mjs`:

1. downloads the AGPL-3.0 `yolov8s-worldv2.pt` Ultralytics asset (the v2
   asset; the original `yolov8s-world.pt` cannot export to ONNX in current
   Ultralytics) and bakes the racket vocabulary into the graph with
   `model.set_classes([...])` before exporting it to ONNX at 640x640;
2. writes `src/extension/offscreen/vendor/yolo-world/yolo_world_s_open_vocab.onnx`
   and prints its SHA-256;
3. copies the onnxruntime-web ESM/wasm files into
   `src/extension/offscreen/vendor/onnx/`.

The baking step matters: because `set_classes` runs before `model.export`, the
rackets' text embeddings are constants in the ONNX graph. The artifact is then
a fixed racket-vocabulary detector with exactly one input (`images`, NCHW
`[1, 3, 640, 640]`) and one output (`output0`, per-anchor rows of 4 box
coordinates + one class score per baked vocabulary entry - no objectness
column, no runtime text input). The offscreen adapter validates those input/
output shapes against the real session and tensor metadata on every run, so a
plain (unbaked, e.g. 80-class) export is refused with an explicit reason
instead of misreading generic classes as rackets.

`npm run build` copies those assets into `dist/` only when they exist, so the
default package stays exactly as before.

## Using the entry

1. Load `dist/` in Chrome (`chrome://extensions`, developer mode).
2. Open the popup on a YouTube watch page and expand **Racket Detection
   Model**.
3. Choose **YOLO-World Open-Vocabulary (Experimental)**.

Before the assets above exist the option stays listed but disabled, with the
specific reason (missing ONNX Runtime Web and/or missing prepared artifact) in
its tooltip - the same availability semantics the pose picker uses. When the
model cannot activate, the selector reverts to the previous (default
EfficientDet) model and the popup explains the cause; a stored YOLO-World
preference only re-activates when the assets are present, and otherwise
converges back to the production default. When present but not selected, the
experimental entry never constructs, starts, or slows the EfficientDet
default path.

## Comparing both detectors on your footage

- Keep EfficientDet selected and play through a rally at normal speed, then
  rewind and select YOLO-World for the same passage: overlay racket boxes come
  from the active model only, and the evidence panel shows one model at a time.
- Because YOLO-World runs at ~2-6 s/frame, pause or scrub to the frames you
  want to compare rather than playing live.
- Detection evidence stays local: nothing is uploaded, and results keep the
  same overlay/feed/export surfaces as the production path.

Detected boxes are reported in the same normalized coordinates as the
production detector (full source frame, 0..1), so the two models' boxes can be
compared directly on the same frames.
