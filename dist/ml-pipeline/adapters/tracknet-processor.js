/* global globalThis, BSOOnnxRuntime */
/**
 * TrackNetV3 temporal smoothing post-processor for shuttle trajectory.
 *
 * Accepts 3-frame window of heatmaps and outputs smoothed shuttle trajectory.
 * Input: [1, 9, H, W] (3 frames x 3 channels)
 * Output: [1, 3, H, W] heatmap (3 smoothed frames)
 *
 * Note: Based on spike findings, this runs offline/post-processing only due to
 * 1+ second per frame latency on browsers. Used for batch processing and offline
 * analysis, not live streaming.
 */
(function installTrackNetProcessor(root, factory) {
  const api = factory(root.BSOOnnxRuntime, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOTrackNetProcessor = api;
}(typeof globalThis === 'object' ? globalThis : self, function trackNetProcessorFactory(
  OnnxRuntime,
  defaultEnvironment
) {
  'use strict';

  class TrackNetV3Processor {
    constructor({ environment = defaultEnvironment, modelPath, onnxManager, mode = 'post-processing' } = {}) {
      this.environment = environment;
      this.modelPath = modelPath || 'models/tracknetv3-3frame.onnx';
      this.onnxManager = onnxManager || (OnnxRuntime ? new OnnxRuntime.OnnxRuntimeManager({ environment }) : null);
      this.ownsOnnxManager = !onnxManager;
      this.session = null;
      this.sessionReady = null;
      this.mode = mode; // 'post-processing' (offline), not live

      this.identity = {
        id: 'tracknetv3-3frame-processor-v1',
        version: 1,
        kind: 'tracknet-onnx-temporal-post-processor',
        productionModel: false, // Not for live streaming
        mode: 'post-processing' // Offline temporal smoothing
      };

      this.backend = null;
      this.fallbacks = [];
      this.onStatus = () => {};
      this.lastError = null;

      // Rolling frame buffer (3-frame window)
      this.frameBuffer = [];
      this.timestampBuffer = [];
      this.maxBufferSize = 3;
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

          // Load TrackNetV3 model
          this.session = await this.onnxManager.createSession('tracknetv3-3frame', this.modelPath, {
            graphOptimizationLevel: 'all',
            executionProviders: this.backend === 'webgpu'
              ? ['webgpu', 'wasm']
              : this.backend === 'webgl'
              ? ['webgl', 'wasm']
              : ['wasm']
          });

          this.onStatus?.({
            type: 'tracknet-ready',
            backend: this.backend,
            fallbacks: this.fallbacks,
            mode: this.mode
          });

          return {
            available: true,
            backend: this.backend,
            fallbacks: this.fallbacks,
            mode: this.mode
          };
        } catch (error) {
          this.lastError = error;
          this.onStatus?.({ type: 'initialization-failed', reason: error.message });
          return { available: false, reason: error.message };
        }
      })();

      return this.sessionReady;
    }

    _normalizeHeatmapFrame(heatmap) {
      const dims = Array.isArray(heatmap?.dims) ? heatmap.dims : null;
      const data = heatmap?.data || heatmap;
      const isBuffer = Array.isArray(data) || ArrayBuffer.isView(data);
      if (!isBuffer) throw new Error('Invalid heatmap format');

      let height;
      let width;
      let offset = 0;
      if (dims) {
        if (dims.length === 2) {
          [height, width] = dims;
        } else if (dims.length === 3 && dims[0] === 1) {
          [, height, width] = dims;
        } else if (dims.length === 4 && dims[0] === 1 && dims[1] === 1) {
          [, , height, width] = dims;
        } else {
          throw new Error('Heatmap dimensions must be [H,W] or [1,H,W]');
        }
      } else {
        const size = Math.sqrt(data.length);
        if (!Number.isInteger(size)) throw new Error('Raw heatmaps must be square');
        height = size;
        width = size;
      }
      if (!Number.isInteger(height) || height < 1 || !Number.isInteger(width) || width < 1 ||
          data.length < height * width) {
        throw new Error('Invalid heatmap dimensions');
      }
      return { data, height, width, offset };
    }

    /**
     * Add a frame to the rolling buffer.
     * Expects a single-channel heatmap [H,W] or [1,H,W].
     */
    addFrame(heatmap, timestamp) {
      this._normalizeHeatmapFrame(heatmap);
      this.frameBuffer.push(heatmap);
      this.timestampBuffer.push(timestamp);

      // Maintain rolling window
      if (this.frameBuffer.length > this.maxBufferSize) {
        this.frameBuffer.shift();
        this.timestampBuffer.shift();
      }
    }

    /**
     * Process current buffer of frames through TrackNetV3.
     * Returns smoothed heatmap for the middle frame if buffer is full.
     */
    async process() {
      if (this.frameBuffer.length < this.maxBufferSize) {
        return null; // Not enough frames yet
      }

      try {
        const init = await this.initialize();
        if (!init.available) {
          throw new Error('Model not initialized: ' + init.reason);
        }

        // Stack 3 frames into [1, 9, H, W] tensor
        const stacked = this._stackFrames(this.frameBuffer);

        // Create ONNX tensor
        const inputs = {
          input: this.onnxManager.createTensor(stacked.data, stacked.dims, 'float32')
        };

        // Run inference
        const outputs = await this.onnxManager.runInference(this.session, inputs);

        // Extract smoothed heatmap
        const smoothedOutput = outputs.output || Object.values(outputs)[0];
        if (!smoothedOutput) {
          throw new Error('No valid output from TrackNetV3 model');
        }

        // Return the middle frame (index 1) from the 3-frame output
        const smoothed = this._extractMiddleFrame(smoothedOutput, stacked.dims);

        return {
          smoothedHeatmap: smoothed,
          timestamp: this.timestampBuffer[1], // Middle frame timestamp
          frameIndex: 1
        };
      } catch (error) {
        this.lastError = error;
        console.error('TrackNetV3 processing error:', error);
        throw error;
      }
    }

    /**
     * Clear the rolling buffer.
     */
    clear() {
      this.frameBuffer = [];
      this.timestampBuffer = [];
    }

    /**
     * Stack 3 frames into [1, 9, H, W] tensor.
     * Each frame is expected to be [H, W] or [1, H, W]
     */
    _stackFrames(frames) {
      if (frames.length !== 3) throw new Error('Expected exactly 3 frames');

      const normalizedFrames = frames.map((frame) => this._normalizeHeatmapFrame(frame));
      const { height, width } = normalizedFrames[0];
      if (normalizedFrames.some((frame) => frame.height !== height || frame.width !== width)) {
        throw new Error('TrackNet frames must have matching dimensions');
      }

      // TrackNet consumes three RGB-like heatmaps, one triplet per temporal
      // frame, hence nine channels. Repeating a scalar heatmap in its triplet
      // preserves the model's expected frame layout without inventing color.
      const channelStride = height * width;
      const stacked = new Float32Array(9 * channelStride);
      for (let frameIdx = 0; frameIdx < 3; frameIdx++) {
        const frameData = normalizedFrames[frameIdx].data;
        for (let c = 0; c < 3; c++) {
          const target = frameIdx * 3 * channelStride + c * channelStride;
          for (let i = 0; i < channelStride; i++) stacked[target + i] = Number(frameData[i]) || 0;
        }
      }

      return { data: stacked, dims: [1, 9, height, width] };
    }

    /**
     * Extract middle frame from output tensor [1, 3, H, W].
     */
    _extractMiddleFrame(outputTensor, inputDims) {
      const data = outputTensor.data || outputTensor;
      const outputDims = Array.isArray(outputTensor?.dims) ? outputTensor.dims : null;
      const height = outputDims?.length === 4 ? outputDims[2] : inputDims[2];
      const width = outputDims?.length === 4 ? outputDims[3] : inputDims[3];
      const channels = outputDims?.length === 4 ? outputDims[1] : outputDims?.length === 3 ? outputDims[0] : 3;
      const frameSize = height * width;
      const middle = Math.min(1, Math.max(0, channels - 1));
      const startIdx = middle * frameSize;
      return new Float32Array(Array.from(data).slice(startIdx, startIdx + frameSize));
    }

    /**
     * Post-process heatmap to extract trajectory point.
     * Returns normalized coordinate [x, y] and confidence.
     */
    extractTrajectoryPoint(heatmap, threshold = 0.5) {
      if (!heatmap) return null;

      let normalized;
      try {
        normalized = this._normalizeHeatmapFrame(heatmap);
      } catch (_) {
        return null;
      }
      const { data, height, width } = normalized;

      // Find largest connected component above threshold
      const visited = new Uint8Array(data.length);
      let maxComponent = null;
      let maxSize = 0;

      for (let i = 0; i < data.length; i++) {
        if (!visited[i] && data[i] > threshold) {
          const component = this._floodFill(data, visited, i, height, width, threshold);
          if (component.size > maxSize) {
            maxComponent = component;
            maxSize = component.size;
          }
        }
      }

      if (!maxComponent) return null;

      // Calculate centroid
      const centroidX = maxComponent.sumX / maxComponent.size / width;
      const centroidY = maxComponent.sumY / maxComponent.size / height;
      const avgConfidence = maxComponent.sumConf / maxComponent.size;

      return {
        x: Math.max(0, Math.min(1, centroidX)),
        y: Math.max(0, Math.min(1, centroidY)),
        confidence: avgConfidence,
        componentSize: maxComponent.size
      };
    }

    /**
     * Flood fill to find connected component.
     */
    _floodFill(data, visited, startIdx, height, width, threshold) {
      const component = {
        size: 0,
        sumX: 0,
        sumY: 0,
        sumConf: 0
      };

      const queue = [startIdx];
      visited[startIdx] = 1;

      while (queue.length > 0) {
        const idx = queue.shift();
        const y = Math.floor(idx / width);
        const x = idx % width;

        component.size++;
        component.sumX += x;
        component.sumY += y;
        component.sumConf += data[idx];

        // Check 4-connected neighbors, without wrapping across row edges
        const neighbors = [
          idx - width, // up
          idx + width  // down
        ];
        if (x > 0) neighbors.push(idx - 1);          // left
        if (x < width - 1) neighbors.push(idx + 1);  // right

        for (const nIdx of neighbors) {
          if (nIdx >= 0 && nIdx < data.length && !visited[nIdx] && data[nIdx] > threshold) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }

      return component;
    }

    release() {
      this.clear();
      // Only the owner of the runtime manager may dispose its shared session cache
      if (this.ownsOnnxManager) {
        this.onnxManager?.releaseAll();
      }
      this.session = null;
      this.sessionReady = null;
    }
  }

  return Object.freeze({ TrackNetV3Processor });
}));
