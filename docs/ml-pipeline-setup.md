# ML Pipeline Setup and Deployment Guide

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Prepare Models

#### BlazePose Lite Model

Provide a cleared, locally packaged ONNX export (the repository does not
fetch or redistribute an unlicensed checkpoint):

- Input: `images` [1, 3, 256, 256] float32
- Output: keypoints [1, 17, 4] float32

#### YOLOv8-Nano Badminton Model

Provide a cleared local ONNX export for the shuttlecock class. Training data,
weights, and model downloads are intentionally outside this repository:

- Input: [1, 3, 640, 640] float32
- Output: detections (1 class: shuttlecock)

#### TrackNetV3 Model (Optional)

Post-processing only (not for live):

- Input: [1, 9, 288, 512] float32 (3 frames)
- Output: [1, 3, 288, 512] float32 (smoothed heatmaps)
- Measured browser latency and backend limitations: see the
  [`TrackNet browser spike`](../spikes/tracknet-browser/README.md#result-in-one-sentence)

### 3. Build and Load the Extension

Follow the canonical build and Chrome loading instructions in
[`README.md` section 11](../README.md#11-public-extension-build-and-uiruntime-integration).

## Testing

```bash
node --test tests/ml-pipeline.test.mjs
npm run runtime-smoke
npm run check
```

The first command is the focused module check. The remaining commands cover
the canonical runtime boundary and the complete project, respectively.

## Performance Tuning

- WebGPU: Enable in Chrome flags
- Worker pool: Adjust `numWorkers` (1-4) based on device
- Model quantization: INT8 for 2-3x speedup on low-end devices

See [`docs/ml-pipeline.md`](ml-pipeline.md) for the architecture and component
contracts.
