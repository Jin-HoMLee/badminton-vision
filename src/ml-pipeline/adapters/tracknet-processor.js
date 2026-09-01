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

    /**
     * Add a frame to the rolling buffer.
     * Expects heatmap input [H, W] or [1, H, W]
     */
    addFrame(heatmap, timestamp) {
      // Ensure heatmap is 2D [H, W]
      let frameData = heatmap;
      let height, width;

      if (heatmap.dims && heatmap.dims.length === 3 && heatmap.dims[0] === 1) {
        height = heatmap.dims[1];
        width = heatmap.dims[2];
      } else if (heatmap.dims && heatmap.dims.length === 2) {
        height = heatmap.dims[0];
        width = heatmap.dims[1];
      } else if (Array.isArray(heatmap)) {
        height = Math.sqrt(heatmap.length);
        width = height;
      } else {
        throw new Error('Invalid heatmap format');
      }

      this.frameBuffer.push(frameData);
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
      if (frames.length !== 3) {
        throw new Error('Expected exactly 3 frames');
      }

      let height, width;
      const normalizedFrames = frames.map(f => {
        if (f.data) return f.data; // ONNX tensor
        return f; // Raw array
      });

      // Determine dimensions from first frame
      if (frames[0].dims) {
        if (frames[0].dims.length === 3) {
          height = frames[0].dims[1];
          width = frames[0].dims[2];
        } else {
          height = frames[0].dims[0];
          width = frames[0].dims[1];
        }
      } else {
        const size = normalizedFrames[0].length;
        height = width = Math.sqrt(size);
      }

      // Stack into [1, 9, H, W]
      const stacked = new Float32Array(1 * 9 * height * width);
      for (let frameIdx = 0; frameIdx < 3; frameIdx++) {
        const frameData = normalizedFrames[frameIdx];
        const channelStride = height * width;
        for (let c = 0; c < 3; c++) {
          for (let i = 0; i < channelStride; i++) {
            stacked[frameIdx * 3 * channelStride + c * channelStride + i] = frameData[i];
          }
        }
      }

      return {
        data: stacked,
        dims: [1, 9, height, width]
      };
    }

    /**
     * Extract middle frame from output tensor [1, 3, H, W].
     */
    _extractMiddleFrame(outputTensor, inputDims) {
      const data = outputTensor.data || outputTensor;
      const height = inputDims[2];
      const width = inputDims[3];
      const frameSize = height * width;

      // Extract middle frame (frame 1 out of 3)
      const startIdx = 1 * frameSize;
      const endIdx = startIdx + frameSize;

      return new Float32Array(data.slice(startIdx, endIdx));
    }

    /**
     * Post-process heatmap to extract trajectory point.
     * Returns normalized coordinate [x, y] and confidence.
     */
    extractTrajectoryPoint(heatmap, threshold = 0.5) {
      if (!heatmap) return null;

      const data = Array.isArray(heatmap) ? heatmap : Array.from(heatmap);
      const size = Math.sqrt(data.length);
      if (!Number.isInteger(size)) return null;

      const height = width = size;

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

        // Check 4-connected neighbors
        const neighbors = [
          idx - width, // up
          idx + width, // down
          idx - 1,     // left
          idx + 1      // right
        ];

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
      this.session?.release?.();
      this.onnxManager?.releaseAll();
    }
  }

  return Object.freeze({ TrackNetV3Processor });
}));
