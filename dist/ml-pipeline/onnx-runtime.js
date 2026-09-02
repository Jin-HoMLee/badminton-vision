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
    constructor({ environment = globalThis, backendOrder = ['webgpu', 'webgl', 'wasm'], backendProbe = null, loadModel = null } = {}) {
      this.environment = environment;
      this.ort = environment.ort || null;
      this.backendOrder = Array.from(new Set((Array.isArray(backendOrder) ? backendOrder : ['webgpu', 'webgl', 'wasm'])
        .filter((backend) => ['webgpu', 'webgl', 'wasm'].includes(backend))));
      this.backendProbe = typeof backendProbe === 'function' ? backendProbe : null;
      this.loadModel = typeof loadModel === 'function' ? loadModel : null;
      this.initialized = false;
      this.initializationPromise = null;
      this.activeBackend = null;
      this.fallbacks = [];
      this.sessions = new Map();
      this.status = 'uninitialized';
    }

    /**
     * Initialize ONNX Runtime with backend selection.
     * Tries WebGPU first, falls back to WebGL, then WASM. The optional probe
     * is an explicit deterministic seam for environments where a real GPU or
     * canvas cannot be created (for example a worker test harness).
     */
    async initialize() {
      if (this.initialized) {
        return { available: true, backend: this.activeBackend, fallbacks: [...this.fallbacks] };
      }
      if (this.initializationPromise) return this.initializationPromise;

      this.initializationPromise = (async () => {
        try {
          const ort = this.environment.ort;
          if (!ort) {
            this.status = 'ort-not-available';
            return { available: false, reason: 'ONNX Runtime not loaded', fallbacks: [] };
          }

          this.ort = ort;
          this.fallbacks = [];
          for (const backend of this.backendOrder) {
            // Preserve the useful distinction between an absent WebGPU API and
            // a WebGPU API which rejected adapter creation. This keeps status
            // reports actionable without claiming that an absent API was tried.
            if (backend === 'webgpu' && !this.environment.navigator?.gpu && !this.backendProbe) continue;
            try {
              const probeMethod = {
                webgpu: '_tryWebGPU',
                webgl: '_tryWebGL',
                wasm: '_tryWasm'
              }[backend];
              const result = this.backendProbe
                ? await this.backendProbe(backend, this)
                : await this[probeMethod]();
              if (result === false || result?.ok === false) {
                throw new Error(result?.reason || `${backend} backend unavailable`);
              }
              this.activeBackend = backend;
              this.initialized = true;
              this.status = `ready-${backend}`;
              const later = this.backendOrder.slice(this.backendOrder.indexOf(backend) + 1);
              return { available: true, backend, fallbacks: later };
            } catch (error) {
              this.fallbacks.push(`${backend}-unavailable`);
            }
          }

          this.status = 'all-backends-failed';
          return { available: false, reason: 'All ONNX backends failed to initialize', fallbacks: [...this.fallbacks] };
        } catch (error) {
          this.status = 'initialization-error';
          return { available: false, reason: error instanceof Error ? error.message : String(error), fallbacks: [...this.fallbacks] };
        }
      })();

      return this.initializationPromise;
    }

    async _tryWebGPU() {
      const ort = this.ort;
      if (!ort) throw new Error('ONNX Runtime not available');

      // Check if WebGPU API is available
      const gpu = this.environment.navigator?.gpu;
      if (!gpu) {
        throw new Error('WebGPU API not available');
      }

      // Attempt to initialize a WebGPU adapter (without creating session on about:blank)
      try {
        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) {
          throw new Error('No WebGPU adapter available');
        }
        // Successfully got adapter, WebGPU is available
      } catch (e) {
        throw new Error('WebGPU not available: ' + e.message);
      }
    }

    async _tryWebGL() {
      const ort = this.ort;
      if (!ort) throw new Error('ONNX Runtime not available');

      // Test WebGL provider by checking if canvas supports WebGL context
      try {
        const OffscreenCanvas = this.environment.OffscreenCanvas;
        const isOffscreenCanvas = OffscreenCanvas && typeof OffscreenCanvas === 'function';
        const documentRef = this.environment.document;
        const Canvas = isOffscreenCanvas ? OffscreenCanvas : (documentRef?.createElement ? () => documentRef.createElement('canvas') : null);
        if (!Canvas) {
          throw new Error('Canvas not available for WebGL test');
        }

        let canvas;
        if (isOffscreenCanvas) {
          // OffscreenCanvas is constructible
          canvas = new Canvas(1, 1);
        } else {
          // Document.createElement factory is not constructible
          canvas = Canvas();
        }

        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) {
          throw new Error('WebGL context not supported');
        }
        // Successfully got WebGL context
      } catch (e) {
        throw new Error('WebGL provider failed: ' + e.message);
      }
    }

    async _tryWasm() {
      const ort = this.ort;
      if (!ort) throw new Error('ONNX Runtime not available');

      // WASM is always available as fallback - just configure it
      try {
        ort.env.wasm.wasmPaths = undefined; // Use default paths
        const hardwareConcurrency = this.environment.navigator?.hardwareConcurrency;
        if (hardwareConcurrency) {
          ort.env.wasm.numThreads = Math.min(hardwareConcurrency, 4);
        }
      } catch (e) {
        throw new Error('WASM configuration failed: ' + e.message);
      }
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

        if (typeof modelData === 'string' && /^(?:https?:)?\/\//i.test(modelData)) {
          throw new TypeError('Model URL must be local; remote inference is disabled');
        }
        const resolvedModelData = this.loadModel
          ? await this.loadModel(modelId, modelData)
          : modelData;
        let session;
        const isArrayBuffer = resolvedModelData instanceof ArrayBuffer ||
          Object.prototype.toString.call(resolvedModelData) === '[object ArrayBuffer]';
        if (isArrayBuffer) {
          session = await this.ort.InferenceSession.create(resolvedModelData, sessionOptions);
        } else if (typeof resolvedModelData === 'string') {
          if (/^(?:https?:)?\/\//i.test(resolvedModelData)) {
            throw new TypeError('Model URL must be local; remote inference is disabled');
          }
          session = await this.ort.InferenceSession.create(resolvedModelData, sessionOptions);
        } else {
          throw new TypeError('Model data must be ArrayBuffer or local URL string');
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
