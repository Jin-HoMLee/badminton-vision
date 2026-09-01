# ML/AI Inference Pipeline Architecture

## Overview

The ML/AI inference pipeline provides production-ready real-time detection and analysis for badminton video:

- **Pose Detection:** MediaPipe BlazePose (17 COCO keypoints per person)
- **Shuttle Detection:** YOLOv8-Nano (fine-tuned on badminton dataset via Roboflow)
- **Temporal Smoothing:** TrackNetV3 post-processing (3-frame window)
- **Runtime:** ONNX Runtime Web with WebGPU (primary), WebGL/WASM fallback
- **Parallelization:** Web Workers for non-blocking inference
- **Racket Detection:** Wrist/elbow pose keypoints (full segmentation deferred to MVP+1)

## Performance Targets

- **Real-time Processing:** 25-30 FPS on modern GPUs (MacBook M3, RTX 3070)
- **Fallback Performance:** 10-15 FPS on CPU via WASM
- **Frame Latency:** <250ms per frame end-to-end
- **Memory Footprint:** <150MB total (models + runtime)

## Live Integration Architecture

The pipeline integrates with the offscreen analyzer via `OnnxInferenceAdapter` which replaces `LiteOpenPoseAdapter`. 

**Live Frame Processing Flow:**
1. Content script captures video frames via `requestVideoFrameCallback`
2. Frames sent to offscreen analyzer via message protocol (bso.runtime.v1)
3. Offscreen analyzer routes to `OnnxInferenceAdapter.analyze(sample)`
4. Adapter runs inference pipeline (BlazePose + YOLOv8) via Web Workers
5. Results processed through player tracker and returned to content
6. UI overlays draw pose/shuttle detections on video

This maintains the existing offscreen boundary and message contract, enabling drop-in replacement of the pose/shuttle detection backend.

## Components

### ONNX Runtime Manager (`onnx-runtime.js`)

- Handles WebGPU (primary), WebGL (fallback), WASM (CPU) backend selection
- Session caching and management
- Automatic fallback chain with capability validation

### Adapters
- **BlazePose** (`blazepose-adapter.js`): 17-keypoint pose detection (live)
- **YOLOv8-Nano** (`yolov8-shuttle-adapter.js`): Shuttlecock detection (live)
- **TrackNetV3** (`tracknet-processor.js`): Post-processing temporal smoothing
- **ONNX Inference Adapter** (`onnx-inference-adapter.js`): Runtime integration

### Parallelization

- **Inference Pipeline** (`inference-pipeline.js`): Web Worker pool coordination
- **Worker Pool** (`workers/inference-worker.js`): 2-4 parallel inference workers
- **Main Thread Fallback** (`onnx-inference-adapter.js`): Fallback when workers busy

## TrackNetV3 Design Note

TrackNetV3 is implemented as **post-processing only** due to browser latency constraints:
- Live inference: BlazePose + YOLOv8 achieve <250ms per frame (25-30 FPS)
- TrackNetV3 alone: 1+ second per frame latency in browser (see spike findings)
- Use case: Offline batch trajectory smoothing after detection, not live streaming
- Live streaming: Uses raw YOLOv8 detections; optional TrackNet polish for archived analysis

See [`docs/ml-pipeline-setup.md`](ml-pipeline-setup.md) for the setup and
deployment guide.
