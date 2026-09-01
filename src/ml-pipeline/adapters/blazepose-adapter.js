/* global globalThis, BSOOnnxRuntime, BSOPlayerTracking */
/**
 * MediaPipe BlazePose ONNX adapter for multi-person pose detection.
 * Detects 17 COCO-format keypoints per person (blazepose-lite ONNX export).
 *
 * Input: 256x256 RGB frame (normalized 0-1)
 * Output: up to 4 poses with 17 keypoints each, confidence scores
 */
(function installBlazePoseAdapter(root, factory) {
  const api = factory(
    root.BSOOnnxRuntime,
    root.BSOPlayerTracking,
    root
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOBlazePoseAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function blazePoseAdapterFactory(
  OnnxRuntime,
  PlayerTracking,
  defaultEnvironment
) {
  'use strict';

  // COCO 17-point keypoint names (MediaPipe BlazePose)
  const KEYPOINT_NAMES = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
  ];

  class BlazePoseAnalyzer {
    constructor({ environment = defaultEnvironment, modelPath, onnxManager } = {}) {
      this.environment = environment;
      this.modelPath = modelPath || 'models/blazepose-lite-256.onnx';
      this.onnxManager = onnxManager || (OnnxRuntime ? new OnnxRuntime.OnnxRuntimeManager({ environment }) : null);
      this.session = null;
      this.sessionReady = null;
      this.sessionId = `pose-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.playerTracker = PlayerTracking && PlayerTracking.SessionPlayerTracker
        ? new PlayerTracking.SessionPlayerTracker({ sessionId: this.sessionId, maxTracks: 4 })
        : null;

      this.identity = {
        id: 'blazepose-lite-256-v1',
        version: 1,
        kind: 'blazepose-onnx-multipose',
        productionModel: true
      };

      this.backend = null;
      this.fallbacks = [];
      this.onStatus = () => {};
      this.lastError = null;
    }

    /**
     * Initialize the model and ONNX runtime.
     */
    async initialize() {
      if (this.sessionReady) return this.sessionReady;

      this.sessionReady = (async () => {
        try {
          // Initialize ONNX Runtime
          if (!this.onnxManager.initialized) {
            const runtimeStatus = await this.onnxManager.initialize();
            this.backend = runtimeStatus.backend;
            this.fallbacks = runtimeStatus.fallbacks;

            if (!runtimeStatus.available) {
              this.onStatus?.({ type: 'initialization-failed', reason: runtimeStatus.reason });
              return { available: false, reason: runtimeStatus.reason };
            }
          }

          // Load BlazePose model
          this.session = await this.onnxManager.createSession('blazepose-lite', this.modelPath, {
            graphOptimizationLevel: 'all',
            executionProviders: this.backend === 'webgpu'
              ? ['webgpu', 'wasm']
              : this.backend === 'webgl'
              ? ['webgl', 'wasm']
              : ['wasm']
          });

          this.onStatus?.({
            type: 'pose-ready',
            backend: this.backend,
            fallbacks: this.fallbacks
          });

          return {
            available: true,
            backend: this.backend,
            fallbacks: this.fallbacks
          };
        } catch (error) {
          this.lastError = error;
          this.onStatus?.({ type: 'initialization-failed', reason: error.message });
          return { available: false, reason: error.message };
        }
      })();

      return this.sessionReady;
    }

    /**
     * Preprocess frame to normalized RGB format required by BlazePose.
     */
    _preprocessFrame(frameData, width, height) {
      const inputSize = 256;
      const aspectRatio = width / height;
      let destWidth = inputSize;
      let destHeight = inputSize;
      let offsetX = 0;
      let offsetY = 0;

      // Maintain aspect ratio with padding
      if (aspectRatio > 1) {
        destHeight = Math.floor(inputSize / aspectRatio);
        offsetY = (inputSize - destHeight) / 2;
      } else {
        destWidth = Math.floor(inputSize * aspectRatio);
        offsetX = (inputSize - destWidth) / 2;
      }

      // Create normalized RGB tensor [1, 3, 256, 256]
      const tensor = new Float32Array(1 * 3 * inputSize * inputSize);
      const stride = inputSize * inputSize;

      // Fill with aspect-ratio padding (black = 0,0,0)
      for (let i = 0; i < 3 * stride; i++) {
        tensor[i] = 0;
      }

      // Bilinear resample frame into padded area
      for (let y = 0; y < destHeight; y++) {
        for (let x = 0; x < destWidth; x++) {
          const srcX = (x / destWidth) * width;
          const srcY = (y / destHeight) * height;

          const srcXi = Math.floor(srcX);
          const srcYi = Math.floor(srcY);
          const fx = srcX - srcXi;
          const fy = srcY - srcYi;

          // Get 4-neighbor pixels
          const p00 = this._getPixel(frameData, srcXi, srcYi, width, height);
          const p10 = this._getPixel(frameData, srcXi + 1, srcYi, width, height);
          const p01 = this._getPixel(frameData, srcXi, srcYi + 1, width, height);
          const p11 = this._getPixel(frameData, srcXi + 1, srcYi + 1, width, height);

          // Bilinear interpolation
          const r = p00.r * (1 - fx) * (1 - fy) +
                    p10.r * fx * (1 - fy) +
                    p01.r * (1 - fx) * fy +
                    p11.r * fx * fy;
          const g = p00.g * (1 - fx) * (1 - fy) +
                    p10.g * fx * (1 - fy) +
                    p01.g * (1 - fx) * fy +
                    p11.g * fx * fy;
          const b = p00.b * (1 - fx) * (1 - fy) +
                    p10.b * fx * (1 - fy) +
                    p01.b * (1 - fx) * fy +
                    p11.b * fx * fy;

          const dstIdx = (offsetY + y) * inputSize + (offsetX + x);
          tensor[dstIdx] = r / 255;
          tensor[dstIdx + stride] = g / 255;
          tensor[dstIdx + 2 * stride] = b / 255;
        }
      }

      return tensor;
    }

    _getPixel(frameData, x, y, width, height) {
      x = Math.max(0, Math.min(width - 1, Math.floor(x)));
      y = Math.max(0, Math.min(height - 1, Math.floor(y)));
      const offset = (y * width + x) * 3; // Assume RGB

      return {
        r: frameData[offset] || 0,
        g: frameData[offset + 1] || 0,
        b: frameData[offset + 2] || 0
      };
    }

    /**
     * Decode BlazePose model output to normalized keypoint format.
     */
    _decodeOutput(outputTensor, inputDims) {
      const data = outputTensor.data;
      const poses = [];

      // BlazePose outputs [1, num_poses, 17, 3] or similar
      // Each keypoint: [x, y, confidence]
      // Coordinates are normalized 0-1
      const numPoses = Math.min(4, Math.floor(data.length / (17 * 3)));

      for (let poseIdx = 0; poseIdx < numPoses; poseIdx++) {
        const keypoints = [];
        let validKeypoints = 0;

        for (let kpIdx = 0; kpIdx < 17; kpIdx++) {
          const baseIdx = (poseIdx * 17 + kpIdx) * 3;
          const x = data[baseIdx];
          const y = data[baseIdx + 1];
          const confidence = data[baseIdx + 2];

          if (confidence > 0.1) {
            keypoints.push({
              name: KEYPOINT_NAMES[kpIdx],
              x: Math.max(0, Math.min(1, x)),
              y: Math.max(0, Math.min(1, y)),
              confidence: Math.max(0, Math.min(1, confidence))
            });
            validKeypoints++;
          } else {
            keypoints.push({
              name: KEYPOINT_NAMES[kpIdx],
              x,
              y,
              confidence: null
            });
          }
        }

        if (validKeypoints >= 4) { // Minimum keypoints for a valid pose
          poses.push({ keypoints, confidence: this._calculatePoseConfidence(keypoints) });
        }
      }

      return poses;
    }

    _calculatePoseConfidence(keypoints) {
      const confidences = keypoints
        .map(kp => kp.confidence)
        .filter(c => c !== null && c !== undefined);

      if (confidences.length === 0) return 0;
      return confidences.reduce((a, b) => a + b) / confidences.length;
    }

    /**
     * Run pose detection on a frame.
     */
    async analyze(sample) {
      try {
        const init = await this.initialize();
        if (!init.available) {
          throw new Error('Model not initialized: ' + init.reason);
        }

        // Read frame pixels
        const pixels = await this._readFramePixels(sample.frame);
        if (!pixels) {
          throw new Error('Failed to read frame pixels');
        }

        // Preprocess
        const inputTensor = this._preprocessFrame(pixels.data, pixels.width, pixels.height);

        // Create ONNX tensor
        const inputs = {
          images: this.onnxManager.createTensor(inputTensor, [1, 3, 256, 256], 'float32')
        };

        // Run inference
        const outputs = await this.onnxManager.runInference(this.session, inputs);

        // Extract pose tensor
        const poseOutput = outputs.output || outputs.poses || Object.values(outputs)[0];
        if (!poseOutput) {
          throw new Error('No valid output from BlazePose model');
        }

        // Decode output
        const poses = this._decodeOutput(poseOutput, sample.frame);

        // Track players if player tracker available
        let tracking = { state: 'unknown', players: [], observations: [] };
        if (this.playerTracker) {
          const observations = poses.map((pose, idx) => {
            const bbox = this._calculateBBox(pose.keypoints);
            return {
              keypoints: pose.keypoints,
              confidence: pose.confidence,
              bbox
            };
          });

          tracking = this.playerTracker.processFrame({
            observations: observations.map(obs => ({
              bbox: obs.bbox,
              keypoints: obs.keypoints,
              confidence: obs.confidence
            })),
            mediaTime: sample.mediaTime,
            requestId: sample.requestId
          });
        }

        return {
          state: poses.length > 0 ? 'tracked' : 'unknown',
          poses,
          tracking,
          confidence: poses.length > 0 ? Math.max(...poses.map(p => p.confidence)) : null
        };
      } catch (error) {
        this.lastError = error;
        console.error('BlazePose analysis error:', error);
        throw error;
      }
    }

    _calculateBBox(keypoints) {
      const validKps = keypoints.filter(kp => kp.confidence !== null && kp.confidence > 0.1);
      if (validKps.length === 0) return null;

      const xs = validKps.map(kp => kp.x);
      const ys = validKps.map(kp => kp.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const width = maxX - minX;
      const height = maxY - minY;

      return {
        x: minX,
        y: minY,
        width,
        height
      };
    }

    async _readFramePixels(frame) {
      if (!frame) return null;

      // Handle RGBA data format
      if (frame.data && frame.width && frame.height) {
        const pixelCount = frame.width * frame.height;
        const channels = frame.data.length / pixelCount;

        if (channels >= 3) {
          // Convert RGBA to RGB
          const rgbData = new Uint8Array(pixelCount * 3);
          for (let i = 0; i < pixelCount; i++) {
            rgbData[i * 3] = frame.data[i * channels];
            rgbData[i * 3 + 1] = frame.data[i * channels + 1];
            rgbData[i * 3 + 2] = frame.data[i * channels + 2];
          }
          return { data: rgbData, width: frame.width, height: frame.height };
        }
      }

      // Handle ImageBitmap or OffscreenCanvas
      if (frame.width && frame.height) {
        const Canvas = this.environment?.OffscreenCanvas || this.environment?.document?.createElement('canvas');
        if (!Canvas) return null;

        let canvas = Canvas instanceof Function ? new Canvas(frame.width, frame.height) : Canvas;
        if (!canvas) return null;

        const ctx = canvas.getContext?.('2d');
        if (!ctx) return null;

        ctx.drawImage(frame, 0, 0, frame.width, frame.height);
        const imageData = ctx.getImageData(0, 0, frame.width, frame.height);

        // Convert RGBA to RGB
        const rgbData = new Uint8Array(frame.width * frame.height * 3);
        for (let i = 0; i < imageData.data.length; i += 4) {
          const idx = (i / 4) * 3;
          rgbData[idx] = imageData.data[i];
          rgbData[idx + 1] = imageData.data[i + 1];
          rgbData[idx + 2] = imageData.data[i + 2];
        }

        return { data: rgbData, width: frame.width, height: frame.height };
      }

      return null;
    }

    release() {
      this.session?.release?.();
      this.onnxManager?.releaseAll();
    }
  }

  return Object.freeze({ BlazePoseAnalyzer });
}));
