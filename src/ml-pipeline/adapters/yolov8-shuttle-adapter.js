/* global globalThis, BSOOnnxRuntime */
/**
 * YOLOv8-Nano ONNX adapter for shuttlecock detection.
 * Fine-tuned on badminton dataset via Roboflow.
 *
 * Input: 640x640 RGB frame (normalized 0-1 or 0-255)
 * Output: bounding boxes + confidence scores for shuttlecock class
 */
(function installYolov8ShuttleAdapter(root, factory) {
  const api = factory(root.BSOOnnxRuntime, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOYOLOv8ShuttleAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function yolov8ShuttleAdapterFactory(
  OnnxRuntime,
  defaultEnvironment
) {
  'use strict';

  class YOLOv8ShuttleDetector {
    constructor({ environment = defaultEnvironment, modelPath, onnxManager, confidenceThreshold = 0.4 } = {}) {
      this.environment = environment;
      this.modelPath = modelPath || 'models/yolov8n-badminton-shuttle.onnx';
      this.onnxManager = onnxManager || (OnnxRuntime ? new OnnxRuntime.OnnxRuntimeManager({ environment }) : null);
      this.session = null;
      this.sessionReady = null;
      this.confidenceThreshold = confidenceThreshold;

      this.identity = {
        id: 'yolov8n-badminton-shuttle-v1',
        version: 1,
        kind: 'yolov8-onnx-shuttlecock-detector',
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

          // Load YOLOv8 model
          this.session = await this.onnxManager.createSession('yolov8n-shuttle', this.modelPath, {
            graphOptimizationLevel: 'all',
            executionProviders: this.backend === 'webgpu'
              ? ['webgpu', 'wasm']
              : this.backend === 'webgl'
              ? ['webgl', 'wasm']
              : ['wasm']
          });

          this.onStatus?.({
            type: 'shuttle-detector-ready',
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
     * Preprocess frame to YOLOv8 format (640x640 RGB).
     */
    _preprocessFrame(frameData, width, height) {
      const inputSize = 640;
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

      // Create normalized RGB tensor [1, 3, 640, 640]
      const tensor = new Float32Array(1 * 3 * inputSize * inputSize);
      const stride = inputSize * inputSize;

      // Fill with aspect-ratio padding (gray = 0.5)
      for (let i = 0; i < 3 * stride; i++) {
        tensor[i] = 0.5;
      }

      // Bilinear resample frame into padded area
      const channels = Math.floor(frameData.length / (width * height));
      for (let y = 0; y < destHeight; y++) {
        for (let x = 0; x < destWidth; x++) {
          const srcX = (x / destWidth) * width;
          const srcY = (y / destHeight) * height;

          const srcXi = Math.floor(srcX);
          const srcYi = Math.floor(srcY);
          const fx = srcX - srcXi;
          const fy = srcY - srcYi;

          // Get 4-neighbor pixels
          const p00 = this._getPixel(frameData, srcXi, srcYi, width, height, channels);
          const p10 = this._getPixel(frameData, srcXi + 1, srcYi, width, height, channels);
          const p01 = this._getPixel(frameData, srcXi, srcYi + 1, width, height, channels);
          const p11 = this._getPixel(frameData, srcXi + 1, srcYi + 1, width, height, channels);

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

      return { tensor, offsetX, offsetY, destWidth, destHeight, inputSize };
    }

    _getPixel(frameData, x, y, width, height, channels) {
      x = Math.max(0, Math.min(width - 1, Math.floor(x)));
      y = Math.max(0, Math.min(height - 1, Math.floor(y)));
      const offset = (y * width + x) * channels;

      return {
        r: frameData[offset] || 0,
        g: frameData[offset + 1] || 0,
        b: frameData[offset + 2] || 0
      };
    }

    /**
     * Decode YOLOv8 output to detections.
     * YOLOv8 ONNX output: [1, 84, 8400] or [1, 25200] depending on export format
     * For badminton, we expect one class (shuttlecock) at index 80 in the 84-element vector
     * (80 classes in COCO + 4 bbox coords)
     */
    _decodeOutput(outputTensor, inputDims, offsetX, offsetY, destWidth, destHeight, inputSize) {
      const data = outputTensor.data;
      const detections = [];

      // Handle different output formats
      let predictions = [];
      if (outputTensor.dims?.length === 3) {
        // [1, num_detections, 85] format (x, y, w, h, objectness, class1...class80)
        const numDetections = outputTensor.dims[1];
        for (let i = 0; i < numDetections; i++) {
          const baseIdx = i * 85;
          const x = data[baseIdx];
          const y = data[baseIdx + 1];
          const w = data[baseIdx + 2];
          const h = data[baseIdx + 3];
          const objectness = data[baseIdx + 4];

          // Find class with highest confidence (assuming shuttlecock detection)
          let maxClassConf = 0;
          for (let c = 0; c < 80; c++) {
            maxClassConf = Math.max(maxClassConf, data[baseIdx + 5 + c]);
          }

          const confidence = objectness * maxClassConf;
          if (confidence > this.confidenceThreshold) {
            predictions.push({
              x, y, w, h,
              confidence,
              class: 0 // Shuttlecock class (we fine-tune to have one class)
            });
          }
        }
      } else if (outputTensor.dims?.length === 2) {
        // Flattened format [1, num_features]
        const elementsPerDetection = 85;
        const numDetections = Math.floor(data.length / elementsPerDetection);

        for (let i = 0; i < numDetections && i < 8400; i++) {
          const baseIdx = i * elementsPerDetection;
          const x = data[baseIdx];
          const y = data[baseIdx + 1];
          const w = data[baseIdx + 2];
          const h = data[baseIdx + 3];
          const objectness = data[baseIdx + 4];

          let maxClassConf = 0;
          for (let c = 0; c < 80; c++) {
            maxClassConf = Math.max(maxClassConf, data[baseIdx + 5 + c]);
          }

          const confidence = objectness * maxClassConf;
          if (confidence > this.confidenceThreshold) {
            predictions.push({
              x, y, w, h,
              confidence,
              class: 0
            });
          }
        }
      }

      // Apply NMS to remove overlapping detections
      predictions = this._nms(predictions, 0.45);

      // Convert to normalized coordinates
      for (const pred of predictions) {
        // Denormalize from input space
        const denormX = pred.x * inputSize;
        const denormY = pred.y * inputSize;
        const denormW = pred.w * inputSize;
        const denormH = pred.h * inputSize;

        // Account for padding
        const imgX = (denormX - offsetX) / destWidth;
        const imgY = (denormY - offsetY) / destHeight;
        const imgW = denormW / destWidth;
        const imgH = denormH / destHeight;

        // Clamp to 0-1 range
        if (imgX >= -imgW && imgX <= 1 && imgY >= -imgH && imgY <= 1) {
          detections.push({
            bbox: {
              x: Math.max(0, Math.min(1, imgX - imgW / 2)),
              y: Math.max(0, Math.min(1, imgY - imgH / 2)),
              width: Math.max(0, Math.min(1, imgX + imgW / 2)) - Math.max(0, Math.min(1, imgX - imgW / 2)),
              height: Math.max(0, Math.min(1, imgY + imgH / 2)) - Math.max(0, Math.min(1, imgY - imgH / 2))
            },
            confidence: pred.confidence,
            class: 'shuttlecock'
          });
        }
      }

      return detections;
    }

    /**
     * Non-maximum suppression to remove overlapping detections.
     */
    _nms(predictions, iouThreshold = 0.45) {
      if (predictions.length === 0) return [];

      // Sort by confidence descending
      predictions.sort((a, b) => b.confidence - a.confidence);

      const kept = [];
      for (let i = 0; i < predictions.length; i++) {
        let keep = true;
        for (const kept_box of kept) {
          const iou = this._calculateIoU(predictions[i], kept_box);
          if (iou > iouThreshold) {
            keep = false;
            break;
          }
        }
        if (keep) kept.push(predictions[i]);
      }

      return kept;
    }

    _calculateIoU(box1, box2) {
      const x1Min = box1.x - box1.w / 2;
      const y1Min = box1.y - box1.h / 2;
      const x1Max = box1.x + box1.w / 2;
      const y1Max = box1.y + box1.h / 2;

      const x2Min = box2.x - box2.w / 2;
      const y2Min = box2.y - box2.h / 2;
      const x2Max = box2.x + box2.w / 2;
      const y2Max = box2.y + box2.h / 2;

      const intersection = Math.max(0, Math.min(x1Max, x2Max) - Math.max(x1Min, x2Min)) *
                          Math.max(0, Math.min(y1Max, y2Max) - Math.max(y1Min, y2Min));
      const area1 = (x1Max - x1Min) * (y1Max - y1Min);
      const area2 = (x2Max - x2Min) * (y2Max - y2Min);
      const union = area1 + area2 - intersection;

      return union === 0 ? 0 : intersection / union;
    }

    /**
     * Detect shuttlecock in a frame.
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
        const preprocessed = this._preprocessFrame(pixels.data, pixels.width, pixels.height);

        // Create ONNX tensor
        const inputs = {
          images: this.onnxManager.createTensor(preprocessed.tensor, [1, 3, 640, 640], 'float32')
        };

        // Run inference
        const outputs = await this.onnxManager.runInference(this.session, inputs);

        // Extract output tensor
        const detectionOutput = outputs.output || Object.values(outputs)[0];
        if (!detectionOutput) {
          throw new Error('No valid output from YOLOv8 model');
        }

        // Decode output
        const detections = this._decodeOutput(
          detectionOutput,
          [640, 640],
          preprocessed.offsetX,
          preprocessed.offsetY,
          preprocessed.destWidth,
          preprocessed.destHeight,
          preprocessed.inputSize
        );

        return {
          state: detections.length > 0 ? 'tracked' : 'unknown',
          detections,
          confidence: detections.length > 0 ? Math.max(...detections.map(d => d.confidence)) : null
        };
      } catch (error) {
        this.lastError = error;
        console.error('YOLOv8 shuttle detection error:', error);
        throw error;
      }
    }

    async _readFramePixels(frame) {
      if (!frame) return null;

      // Handle RGBA data format
      if (frame.data && frame.width && frame.height) {
        const pixelCount = frame.width * frame.height;
        const channels = frame.data.length / pixelCount;

        if (channels >= 3) {
          // Keep as-is for bilinear sampling
          return { data: frame.data, width: frame.width, height: frame.height };
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

        return { data: imageData.data, width: frame.width, height: frame.height };
      }

      return null;
    }

    release() {
      this.session?.release?.();
      this.onnxManager?.releaseAll();
    }
  }

  return Object.freeze({ YOLOv8ShuttleDetector });
}));
