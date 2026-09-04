# EfficientDet-Lite0 (COCO) racket detection model notice

Badminton Vision distributes `efficientdet_lite0.tflite`, Google's
EfficientDet-Lite0 object detector from the MediaPipe model zoo (float16
variant). It is trained on the COCO 2017 dataset and detects the COCO object
classes; this extension uses only its **tennis racket** class (class index 42
in the artifact's embedded 90-entry label map) as racket evidence in the live
pose/shuttle composition.

- Model zoo page: <https://ai.google.dev/edge/mediapipe/models/object_detection>
  (EfficientDet-Lite0 entry; "Object Detector" models section)
- Artifact URL:
  `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`
- Artifact: `efficientdet_lite0.tflite` (7,254,339 bytes)
- SHA-256: `4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993`
- License: Apache-2.0; see `LICENSE` in this directory.

The same checkpoint family is also published on TensorFlow Hub as
<https://tfhub.dev/google/lite-model/efficientdet/lite0/detection/metadata/1>
(Apache-2.0). Google's model card for this model zoo entry describes the
EfficientDet-Lite architecture and its COCO 2017 training data; the COCO
training images are not redistributed by this extension.

## Runtime and decode contract

The model runs on the LiteRT.js WASM runtime that the extension already
vendors for Lightweight OpenPose (`vendor/litert/`), so no new runtime is
packaged. The offscreen adapter (`offscreen/efficientdet-racket-adapter.js`)
uses the artifact's embedded metadata contract:

- Input: float32 `[1, 320, 320, 3]` RGB pixels normalized `(pixel - 127.5) /
  127.5` (the metadata-declared mean/std of the artifact) after stretching the
  bounded capture frame onto the square model grid.
- Outputs: class logits `[1, 19206, 90]` (per-anchor sigmoid scores over the
  90-entry COCO label map embedded in the artifact as `labels.txt`) and box
  regression deltas `[1, 19206, 4]` ordered `[ty, tx, th, tw]` per anchor.
- Anchors: 19,206 anchors across levels 3-7 (grids 40, 20, 10, 5, 3) with
  3 scale octaves (`2^(octave/3)`) x aspect ratios `[1.0, 2.0, 0.5]` per cell
  and an anchor scale of 3.0. The adapter generates them from the EfficientDet
  reference geometry; the generator was validated to reproduce the artifact's
  embedded fixed-anchor table (`DETECTOR_METADATA` custom metadata) for all
  19,206 anchors, so decode does not parse that metadata at runtime.
- Decode: `w = exp(tw) * wa`, `h = exp(th) * ha`,
  `center = anchor + delta * anchor_size` (the `decode_box_outputs` math of the
  EfficientDet reference implementation, google/automl, Apache-2.0), followed
  by a strict class filter that keeps **only** class index 42
  ("tennis racket") and per-class NMS. The deterministic real-model fixtures
  (`test/efficientdet-racket-real-model.test.js`) verify this end-to-end on
  the vendored artifact.

## Test fixture provenance

`test/fixtures/racket-sample-256.bmp` is a 256x164 downscale of the racket
area of the photograph
["Tennis Racket and Balls"](https://commons.wikimedia.org/wiki/File:Tennis_Racket_and_Balls.jpg)
by Vladsinger (English Wikipedia), released under CC BY-SA 3.0
(<https://creativecommons.org/licenses/by-sa/3.0/>); the full-resolution image
is 1920x1440 and the crop covers the racket bounding box (x 131-1256, y
161-884). It is used only as a deterministic regression fixture for the
real-model input contract test and is not part of the packaged extension. The
negative-case fixture reuses `test/fixtures/pose-sample-256.bmp` (already
documented in `vendor/lite-openpose/MODEL-NOTICE.md`; it contains two people
and no racket).
