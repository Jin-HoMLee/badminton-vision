/* global globalThis, ort */
/**
 * ONNX Runtime Web initialization and backend management.
 * Handles WebGPU (primary), WebGL (fallback), and WASM (last resort).
 */
(function installOnnxRuntime(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOOnnxRuntime = api;
}(typeof globalThis === 'object' ? globalThis : self, function onnxRuntimeFactory(environment) {
  'use strict';

  class OnnxRuntimeManager {
    constructor({ environment = globalThis } = {}) {
      this.environment = environment;
      this.ort = environment.ort || null;
      this.initialized = false;
      this.activeBackend = null;
      this.fallbacks = [];
      this.sessions = new Map();
      this.status = 'uninitialized';
    }

    /**
     * Initialize ONNX Runtime with backend selection.
     * Tries WebGPU first, falls back to WebGL, then WASM.
     */
    async initialize() {
      if (this.initialized) {
        return { available: true, backend: this.activeBackend, fallbacks: this.fallbacks };
      }

      try {
        const ort = this.environment.ort;
        if (!ort) {
          this.status = 'ort-not-available';
          return { available: false, reason: 'ONNX Runtime not loaded' };
        }

        this.ort = ort;

        // Try WebGPU first
        if (this.environment.navigator && typeof navigator.gpu !== 'undefined') {
          try {
            await this._tryWebGPU();
            this.activeBackend = 'webgpu';
            this.initialized = true;
            this.status = 'ready-webgpu';
            return { available: true, backend: 'webgpu', fallbacks: ['webgl', 'wasm'] };
          } catch (e) {
            this.fallbacks.push('webgpu-unavailable');
          }
        }

        // Try WebGL
        try {
          await this._tryWebGL();
          this.activeBackend = 'webgl';
          this.initialized = true;
          this.status = 'ready-webgl';
          return { available: true, backend: 'webgl', fallbacks: ['wasm'] };
        } catch (e) {
          this.fallbacks.push('webgl-unavailable');
        }

        // WASM fallback
        try {
          await this._tryWasm();
          this.activeBackend = 'wasm';
          this.initialized = true;
          this.status = 'ready-wasm';
          return { available: true, backend: 'wasm', fallbacks: [] };
        } catch (e) {
          this.fallbacks.push('wasm-unavailable');
          this.status = 'all-backends-failed';
          return { available: false, reason: 'All ONNX backends failed to initialize', fallbacks: this.fallbacks };
        }
      } catch (error) {
        this.status = 'initialization-error';
        return { available: false, reason: error.message };
      }
    }

    async _tryWebGPU() {
      const ort = this.ort;
      if (!ort) throw new Error('ONNX Runtime not available');

      // Set WebGPU provider
      ort.env.wasm.wasmPaths = undefined; // Will use default paths
      try {
        await ort.InferenceSession.create('about:blank', {
          providers: [{ name: 'webgpu', options: { device: 'gpu-preferred' } }],
          executionProviders: ['webgpu']
        }).catch(() => {
          // Session creation may fail but we want to test provider registration
          throw new Error('WebGPU not available');
        });
      } catch (e) {
        // Attempt to check if WebGPU is available
        if (!globalThis.navigator?.gpu) {
          throw new Error('WebGPU API not available');
        }
      }
    }

    async _tryWebGL() {
      const ort = this.ort;
      if (!ort) throw new Error('ONNX Runtime not available');

      // Test WebGL provider
      try {
        const session = await ort.InferenceSession.create('about:blank', {
          providers: [{ name: 'webgl', options: {} }],
          executionProviders: ['webgl']
        }).catch(() => {
          throw new Error('WebGL not available');
        });
        session.release?.();
      } catch (e) {
        throw new Error('WebGL provider failed: ' + e.message);
      }
    }

    async _tryWasm() {
      const ort = this.ort;
      if (!ort) throw new Error('ONNX Runtime not available');

      // WASM is always the last fallback
      ort.env.wasm.wasmPaths = undefined;
      ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);
    }

    /**
     * Create or get a cached inference session.
     * Expects model as ONNX binary buffer or path.
     */
    async createSession(modelId, modelData, options = {}) {
      if (this.sessions.has(modelId)) {
        return this.sessions.get(modelId);
      }

      if (!this.initialized) {
        await this.initialize();
      }

      if (!this.initialized) {
        throw new Error('ONNX Runtime failed to initialize');
      }

      try {
        const sessionOptions = {
          executionProviders: this.activeBackend === 'webgpu'
            ? [{ name: 'webgpu', options: { device: 'gpu-preferred' } }, 'wasm']
            : this.activeBackend === 'webgl'
            ? [{ name: 'webgl', options: {} }, 'wasm']
            : ['wasm'],
          graphOptimizationLevel: 'all',
          ...options
        };

        let session;
        if (modelData instanceof ArrayBuffer) {
          session = await this.ort.InferenceSession.create(modelData, sessionOptions);
        } else if (typeof modelData === 'string') {
          session = await this.ort.InferenceSession.create(modelData, sessionOptions);
        } else {
          throw new TypeError('Model data must be ArrayBuffer or URL string');
        }

        this.sessions.set(modelId, session);
        return session;
      } catch (error) {
        throw new Error(`Failed to create ONNX session for ${modelId}: ${error.message}`);
      }
    }

    /**
     * Run inference on a session with input tensors.
     * Input format: { name: tensor }
     */
    async runInference(session, inputs) {
      if (!session) {
        throw new Error('No inference session provided');
      }

      try {
        const results = await session.run(inputs);
        return results;
      } catch (error) {
        throw new Error(`Inference failed: ${error.message}`);
      }
    }

    /**
     * Create ONNX tensor from raw data.
     */
    createTensor(data, dims, type = 'float32') {
      if (!this.ort) {
        throw new Error('ONNX Runtime not initialized');
      }

      return new this.ort.Tensor(type, data, dims);
    }

    /**
     * Release all cached sessions.
     */
    releaseAll() {
      for (const [modelId, session] of this.sessions.entries()) {
        try {
          session.release?.();
          this.sessions.delete(modelId);
        } catch (e) {
          console.warn(`Failed to release session ${modelId}:`, e);
        }
      }
    }

    /**
     * Get current runtime status.
     */
    getStatus() {
      return {
        initialized: this.initialized,
        backend: this.activeBackend,
        fallbacks: this.fallbacks,
        status: this.status,
        sessionCount: this.sessions.size
      };
    }
  }

  return Object.freeze({ OnnxRuntimeManager });
}));
