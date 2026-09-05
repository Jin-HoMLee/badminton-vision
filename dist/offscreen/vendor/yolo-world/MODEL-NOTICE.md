# YOLO-World (open vocabulary) racket detection model notice — EXPERIMENTAL

Badminton Vision does **not** ship the YOLO-World model in its default package.
`yolo_world_s_open_vocab.onnx` is an EXPERIMENTAL, opt-in detector artifact that
a user prepares locally with `scripts/prepare-yolo-world.mjs` before the
experimental picker entry (`YOLO-World Open-Vocabulary (Experimental)` in the
Racket Detection Model selector) can run. The production default remains the
Apache-2.0 EfficientDet-Lite0 tennis-racket detector
(`vendor/efficientdet-lite0/MODEL-NOTICE.md`); YOLO-World is never the default.

## Provenance

- Model family: YOLO-World (open-vocabulary object detection), Ultralytics
  implementation: <https://docs.ultralytics.com/models/yolo-world>
- Source weights asset: `yolov8s-world.pt` from the Ultralytics assets
  releases, <https://github.com/ultralytics/assets/releases> (AGPL-3.0).
- Prepared artifact name: `yolo_world_s_open_vocab.onnx` (ONNX export at
  640x640 from the asset above). `scripts/prepare-yolo-world.mjs` downloads the
  asset, exports it, writes the artifact into this directory, and records the
  exact source URL and SHA-256 in the console output it prints.
- License: **AGPL-3.0**; see `LICENSE` in this directory. Ultralytics
  distributes the YOLO-World weights under AGPL-3.0, which requires anyone who
  redistributes the prepared artifact (or a work that links it) to offer the
  complete corresponding source under the same license. The captain accepted
  that source-disclosure implication **for an experimental picker entry in the
  public repository only**; the entry is labeled accordingly in the popup and
  never selected by default.

This directory always carries these license records so a locally prepared
artifact has its notice beside it. The `.onnx` itself and the ONNX Runtime Web
assets (`vendor/onnx/`) are created by the prepare script and are not tracked by
git, so the committed default package contains neither.

## Runtime and decode contract

The experimental adapter (`offscreen/yolo-world-racket-adapter.js`) runs the
artifact with ONNX Runtime Web (loaded lazily only when the model is activated;
`vendor/onnx/ort.min.mjs` + wasm assets prepared by the same script):

- Input: float32 `[1, 640, 640, 3]` RGB pixels normalized to `[0, 1]` after
  resizing the bounded capture frame onto the square model grid (input key
  `images`).
- Output: YOLO-style prediction tensor (`output0`), decoded with the model's
  prediction stride and NMS into normalized racket candidate boxes.
- Text prompts (zero-shot vocabulary): `badminton racket`, `racket`,
  `player's racket`, `racquet`.
- Measured behavior: research-measured at roughly 2-6 s/frame in the MV3
  offscreen document - archive-grade, not for live play. The popup entry and
  this notice both say so.

## Experimental licensing summary

- Production racket default: EfficientDet-Lite0, Apache-2.0, vendored and
  committed (`vendor/efficientdet-lite0/`).
- Experimental racket entry: YOLO-World, AGPL-3.0, artifact prepared locally,
  never part of the committed default package.
