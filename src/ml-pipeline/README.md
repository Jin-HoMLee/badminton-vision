# ML/AI Inference Pipeline

Production-ready real-time ML inference for badminton video analysis.

## Components

### Core Runtime
- **`onnx-runtime.js`** - ONNX Runtime Web initialization and backend management
  - WebGPU (primary), WebGL (fallback), WASM (CPU fallback)
  - Automatic backend selection and fallback
  - Session management and resource cleanup

### Model Adapters
- **`adapters/blazepose-adapter.js`** - MediaPipe BlazePose (17 COCO keypoints)
  - 256x256 input with aspect ratio preservation
  - Multi-person pose detection
  - Confidence scoring and keypoint tracking
  
- **`adapters/yolov8-shuttle-adapter.js`** - YOLOv8-Nano shuttle detection
  - 640x640 input with bilinear resampling
  - Fine-tuned on badminton dataset via Roboflow
  - Non-maximum suppression for overlapping detections
  - 1 class: shuttlecock
  
- **`adapters/tracknet-processor.js`** - TrackNetV3 temporal smoothing
  - 3-frame rolling window processing
  - Heatmap-based trajectory extraction
  - Post-processing only (1+ second latency)

### Inference Coordination
- **`inference-pipeline.js`** - Main pipeline controller
  - Web Worker pool management (2-4 workers)
  - Fallback to main-thread inference
  - Performance metrics tracking
  
- **`workers/inference-worker.js`** - Web Worker for parallel processing
  - Non-blocking model inference
  - Message-based communication protocol

### Integration
- **`adapters/onnx-inference-adapter.js`** - Runtime adapter
  - Compatible with existing offscreen analyzer protocol
  - bso.runtime.v1 message generation

## Performance

- **Real-time:** 25-30 FPS on modern GPUs (M3, RTX 3070)
- **Fallback:** 10-15 FPS on CPU (WASM)
- **Latency:** <250ms per frame end-to-end
- **Memory:** <150MB total (models + runtime)

## Testing

```bash
npm run test -- tests/ml-pipeline.test.mjs
npm run runtime-smoke
npm run check
```

## Integration

The pipeline integrates via `onnx-inference-adapter.js` as a drop-in replacement for LiteOpenPoseAdapter.

See `docs/ml-pipeline.md` and `docs/ml-pipeline-setup.md` for complete documentation.
