# Lightweight OpenPose model notice

Badminton Vision distributes `pose_256.tflite`, the LiteRT/TFLite format
conversion published by the `litert-community/lightweight-openpose` model
repository. The model card explicitly identifies the conversion and weights as
Apache-2.0, and identifies the source model as
[`Daniil-Osokin/lightweight-human-pose-estimation.pytorch`](https://github.com/Daniil-Osokin/lightweight-human-pose-estimation.pytorch),
which is also Apache-2.0.

- Model repository: <https://huggingface.co/litert-community/lightweight-openpose/tree/cf34efa237821900dcc0f205fc41a45368f22cd0>
- Source model: <https://github.com/Daniil-Osokin/lightweight-human-pose-estimation.pytorch>
- Model card: <https://huggingface.co/litert-community/lightweight-openpose#license--attribution>
- Artifact: `pose_256.tflite`
- SHA-256: `b5c200e7050f1e17884059bf3da72b14e842af555ad67a49f46a4a9b37aeb0cd`
- License: Apache-2.0; see `LICENSE` in this directory.

The conversion is the heatmap-only 18-keypoint model described by its model
card (`[1, 256, 256, 3]` RGB input and `[1, 32, 32, 19]` heatmap output). This
package decodes its local peaks and reports anonymous pose coordinates only;
it does not identify people. The model card's COCO 2017 training data is not
redistributed by this extension.
