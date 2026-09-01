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

## Components

### ONNX Runtime Manager (`onnx-runtime.js`)
- Handles WebGPU (primary), WebGL (fallback), WASM (CPU) backend selection
- Session caching and management
- Automatic fallback chain

### Adapters
- **BlazePose** (`blazepose-adapter.js`): 17-keypoint pose detection
- **YOLOv8-Nano** (`yolov8-shuttle-adapter.js`): Shuttlecock detection  
- **TrackNetV3** (`tracknet-processor.js`): Temporal smoothing (post-processing)

### Parallelization
- **Inference Pipeline** (`inference-pipeline.js`): Web Worker pool coordination
- **Worker Pool** (`workers/inference-worker.js`): 2-4 parallel inference workers
- **Main Thread Fallback** (`onnx-inference-adapter.js`): Fallback when workers busy

See `docs/ml-pipeline-setup.md` for setup and deployment guide.
