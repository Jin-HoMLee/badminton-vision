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

## Browser Integration

`OnnxInferenceAnalyzer` implements the same `analyze(sample)` boundary as the
existing offscreen analyzer. The build packages its runtime, adapters, and
worker under `dist/ml-pipeline/`; the offscreen document loads those local
scripts without adding a network dependency. The live flow is:

1. Content captures one current video frame at a `requestVideoFrameCallback`.
2. The MV3 protocol transports that frame to the offscreen document.
3. The configured local analyzer routes pose and shuttle inference to workers.
4. The result envelope returns model-neutral players, shuttle evidence, racket
   wrist/elbow proxy evidence, and explicit temporal/event unknown states.
5. UI synchronization displays only results at or before the current media time.

The ONNX path is opt-in because this repository does not contain uncleared
ONNX weights or an ONNX Runtime Web distribution. Set
`BSO_ONNX_INFERENCE_CONFIG` with local model paths and
`BSO_ONNX_INFERENCE_ENABLED = true` before the offscreen analyzer is loaded,
or use `BSOOffscreenAnalyzer.setAnalyzer()` in an extension-owned bootstrap.
`runtimeScript`, when supplied, must also be a local packaged script. With no
configuration the cleared LiteRT pose composition remains the production path;
missing ONNX assets report an honest unavailable state rather than selecting a
fixture or contacting a cloud service.

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
