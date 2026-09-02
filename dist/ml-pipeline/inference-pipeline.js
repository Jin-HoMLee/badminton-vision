/* global globalThis, BSOOnnxRuntime, BSOBlazePoseAdapter, BSOYOLOv8ShuttleAdapter, BSOTrackNetProcessor */
/**
 * ML Inference Pipeline Controller
 *
 * Coordinates:
 * - Multiple Web Workers for parallel inference
 * - Fallback to main-thread execution
 * - Result synchronization and caching
 * - Performance profiling
 */
(function installInferencePipeline(root, factory) {
  const api = factory(
    root.BSOOnnxRuntime,
    root.BSOBlazePoseAdapter,
    root.BSOYOLOv8ShuttleAdapter,
    root.BSOTrackNetProcessor,
    root
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOInferencePipeline = api;
}(typeof globalThis === 'object' ? globalThis : self, function inferencePipelineFactory(
  OnnxRuntime,
  BlazePoseAdapter,
  YOLOv8ShuttleAdapter,
  TrackNetProcessor,
  defaultEnvironment
) {
  'use strict';

  class InferencePipeline {
    constructor({
      environment = defaultEnvironment,
      useWebWorkers = true,
      numWorkers = 2,
      maxQueuedRequests = Math.max(1, Number(numWorkers) * 2),
      modelConfig = {},
      onStatus = () => {},
      onMetrics = () => {}
    } = {}) {
      this.environment = environment;
      this.useWebWorkers = useWebWorkers;
      const requestedWorkers = Number.isFinite(Number(numWorkers)) ? Math.floor(Number(numWorkers)) : 2;
      this.numWorkers = Math.max(1, Math.min(requestedWorkers, 4));
      this.maxQueuedRequests = Math.max(1, Number(maxQueuedRequests) || this.numWorkers * 2);
      this.modelConfig = {
        pose: {
          modelPath: 'models/blazepose-lite-256.onnx',
          ...modelConfig.pose
        },
        shuttle: {
          modelPath: 'models/yolov8n-badminton-shuttle.onnx',
          confidenceThreshold: 0.4,
          ...modelConfig.shuttle
        },
        tracknet: {
          modelPath: 'models/tracknetv3-3frame.onnx',
          ...modelConfig.tracknet
        }
      };

      this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
      this.onMetrics = typeof onMetrics === 'function' ? onMetrics : () => {};

      this.workers = [];
      this.workerQueue = [];
      this.pendingRequests = new Map();
      this.workerWaiters = [];
      this.nextRequestId = 0;
      this.initializationPromise = null;

      this.mainThreadAnalyzers = null;
      this.mainThreadOnnxManager = null;
      this.runtimeBackend = null;
      this.runtimeFallbacks = [];
      this.initializationState = 'uninitialized';
      this.performanceMetrics = {
        totalInferences: 0,
        totalTime: 0,
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        backendStats: {}
      };
    }

    /**
     * Initialize the pipeline with models and workers.
     */
    async initialize() {
      if (this.initializationState === 'ready') return { success: true };
      if (this.initializationState === 'initializing' && this.initializationPromise) return this.initializationPromise;

      this.initializationState = 'initializing';
      this.onStatus({ type: 'pipeline-initializing' });
      this.initializationPromise = (async () => {
        try {
          if (this.useWebWorkers && this.environment.Worker) {
            try {
              await this._initializeWorkers();
            } catch (workerError) {
              // A worker is preferred, but a browser with a restricted worker
              // policy can still use the same local ONNX analyzers on the main
              // thread. This is an explicit fallback, never a cloud path.
              this.onStatus({ type: 'worker-fallback', reason: workerError.message });
              await this._initializeMainThread();
            }
          } else {
            await this._initializeMainThread();
          }

          this.initializationState = 'ready';
          this.onStatus({ type: 'pipeline-ready', workers: this.workers.length });
          return { success: true };
        } catch (error) {
          this.initializationState = 'failed';
          this.onStatus({ type: 'pipeline-initialization-failed', error: error.message });
          return { success: false, error: error.message };
        }
      })();
      const result = await this.initializationPromise;
      if (this.initializationState !== 'initializing') this.initializationPromise = null;
      return result;
    }

    /**
     * Initialize Web Workers for inference.
     */
    async _initializeWorkers() {
      const workerScript = this.modelConfig.workerPath || '/ml-pipeline/workers/inference-worker.js';

      for (let i = 0; i < this.numWorkers; i++) {
        let worker = null;
        try {
          worker = new this.environment.Worker(workerScript);
          let workerReady = false;

          // Initialize worker
          const initPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Worker initialization timeout'));
            }, 10000);

            const messageHandler = (event) => {
              if (event.data.type === 'init-response') {
                clearTimeout(timeout);
                worker.removeEventListener('message', messageHandler);
                workerReady = event.data.success;
                if (event.data.success) {
                  resolve(event.data);
                } else {
                  reject(new Error(event.data.error || 'Unknown worker init error'));
                }
              }
            };

            worker.addEventListener('message', messageHandler);
            worker.postMessage({
              type: 'init',
              payload: this.modelConfig
            });
          });

          const initData = await initPromise;
          if (initData && initData.runtime) {
            this.runtimeBackend = initData.runtime.backend || this.runtimeBackend;
            this.runtimeFallbacks = initData.runtime.fallbacks || this.runtimeFallbacks;
          }

          this.workers.push({
            instance: worker,
            ready: workerReady,
            busy: false,
            inferenceCount: 0
          });

          // The worker array contains only successful workers, so its index
          // is not necessarily the original initialization-loop index.
          this.workerQueue.push(this.workers.length - 1);
        } catch (error) {
          console.warn(`Failed to initialize worker ${i}:`, error);
          // Terminate the failed worker to clean up resources
          if (worker && typeof worker.terminate === 'function') {
            worker.terminate();
          }
        }
      }

      if (this.workers.length === 0) {
        throw new Error('Failed to initialize any Web Workers');
      }

      // Set up message handlers with proper closure to capture worker index
      for (let i = 0; i < this.workers.length; i++) {
        const workerIdx = i;
        this.workers[i].instance.addEventListener('message', (event) => {
          this._handleWorkerMessage(workerIdx, event);
        });
      }
    }

    /**
     * Initialize analyzers on main thread (fallback).
     */
    async _initializeMainThread() {
      this.mainThreadAnalyzers = {};

      const onnxManager = new OnnxRuntime.OnnxRuntimeManager({ environment: this.environment });
      this.mainThreadOnnxManager = onnxManager;
      const runtimeStatus = await onnxManager.initialize();

      if (!runtimeStatus.available) {
        throw new Error('ONNX Runtime initialization failed: ' + runtimeStatus.reason);
      }

      this.runtimeBackend = runtimeStatus.backend || null;
      this.runtimeFallbacks = runtimeStatus.fallbacks || [];

      // Initialize pose analyzer
      if (BlazePoseAdapter) {
        this.mainThreadAnalyzers.pose = new BlazePoseAdapter.BlazePoseAnalyzer({
          modelPath: this.modelConfig.pose.modelPath,
          onnxManager,
          environment: this.environment
        });

        await this.mainThreadAnalyzers.pose.initialize();
      }

      // Initialize shuttle detector
      if (YOLOv8ShuttleAdapter) {
        this.mainThreadAnalyzers.shuttle = new YOLOv8ShuttleAdapter.YOLOv8ShuttleDetector({
          modelPath: this.modelConfig.shuttle.modelPath,
          onnxManager,
          confidenceThreshold: this.modelConfig.shuttle.confidenceThreshold,
          environment: this.environment
        });

        await this.mainThreadAnalyzers.shuttle.initialize();
      }

      // Initialize TrackNet (post-processing)
      if (TrackNetProcessor) {
        this.mainThreadAnalyzers.tracknet = new TrackNetProcessor.TrackNetV3Processor({
          modelPath: this.modelConfig.tracknet.modelPath,
          onnxManager,
          mode: 'post-processing',
          environment: this.environment
        });

        await this.mainThreadAnalyzers.tracknet.initialize();
      }
    }

    /**
     * Handle incoming messages from workers.
     */
    _handleWorkerMessage(workerIdx, event) {
      const { type, id, success, error, result, runtime, analyzers } = event.data;

      if (type === 'infer-response') {
        const request = this.pendingRequests.get(id);
        if (!request) return; // timed out or released; do not requeue twice
        const worker = this.workers[workerIdx];
        if (worker) worker.inferenceCount += 1;
        if (success) request.resolve(result);
        else request.reject(new Error(error || 'Inference failed'));
      }
    }

    /**
     * Run inference on a frame.
     * Sends to Web Worker if available, falls back to main thread.
     */
    async runInference(frameData, options = {}) {
      if (this.initializationState !== 'ready') {
        throw new Error('Pipeline not initialized');
      }

      const now = typeof this.environment.performance?.now === 'function'
        ? this.environment.performance.now.bind(this.environment.performance)
        : typeof performance !== 'undefined' ? performance.now.bind(performance) : Date.now;
      const startTime = now();
      const requestId = this.nextRequestId++;

      try {
        let result;

        if (this.workers.length > 0) {
          // Use Web Worker. If every worker is busy, the bounded worker queue
          // waits for the next completion instead of blocking the main thread
          // or dropping a direct API caller unexpectedly.
          result = await this._runInferenceOnWorker(frameData, options, requestId);
        } else if (this.mainThreadAnalyzers) {
          // Fallback to main thread
          result = await this._runInferenceOnMainThread(frameData, options, requestId);
        } else {
          throw new Error('No inference backend available');
        }

        const elapsedTime = now() - startTime;
        this._updateMetrics(elapsedTime);

        return {
          ...result,
          inferenceTime: elapsedTime,
          requestId
        };
      } catch (error) {
        console.error('Inference error:', error);
        throw error;
      }
    }

    _releaseWorker(workerIdx) {
      const worker = this.workers[workerIdx];
      if (!worker) return;
      worker.busy = false;
      if (this.workerWaiters.length) {
        const waiter = this.workerWaiters.shift();
        worker.busy = true;
        waiter.resolve(workerIdx);
      } else {
        this.workerQueue.push(workerIdx);
      }
    }

    _acquireWorker() {
      const workerIdx = this.workerQueue.shift();
      if (workerIdx !== undefined) {
        this.workers[workerIdx].busy = true;
        return Promise.resolve(workerIdx);
      }
      if (this.pendingRequests.size + this.workerWaiters.length >= this.maxQueuedRequests) {
        return Promise.reject(new Error('Inference queue is full'));
      }
      return new Promise((resolve, reject) => this.workerWaiters.push({ resolve, reject }));
    }

    /**
     * Run inference on a Web Worker.
     */
    async _runInferenceOnWorker(frameData, options, requestId) {
      const workerIdx = await this._acquireWorker();
      const worker = this.workers[workerIdx];
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          this._releaseWorker(workerIdx);
          callback(value);
        };
        const timeout = setTimeout(() => {
          settle(reject, new Error('Worker inference timeout'));
        }, 30000); // 30 second timeout

        this.pendingRequests.set(requestId, {
          resolve: (result) => settle(resolve, result),
          reject: (error) => settle(reject, error)
        });

        try {
          worker.instance.postMessage({
            type: 'infer',
            id: requestId,
            payload: {
              frame: frameData,
              frameData: frameData.data,
              width: frameData.width,
              height: frameData.height,
              mediaTime: options.mediaTime,
              requestId: options.requestId || requestId,
              sessionId: options.sessionId,
              doPose: options.doPose !== false,
              doShuttle: options.doShuttle !== false
            }
          });
        } catch (error) {
          settle(reject, error);
        }
      });
    }

    /**
     * Run inference on main thread (fallback).
     */
    async _runInferenceOnMainThread(frameData, options, requestId) {
      const sample = {
        frame: frameData,
        sessionId: options.sessionId || 'main-thread-session',
        requestId: options.requestId || requestId,
        mediaTime: options.mediaTime || 0
      };

      const result = {
        requestId,
        mediaTime: options.mediaTime,
        pose: null,
        shuttle: null
      };

      // Run pose detection
      if (this.mainThreadAnalyzers.pose && options.doPose !== false) {
        try {
          result.pose = await this.mainThreadAnalyzers.pose.analyze(sample);
        } catch (e) {
          result.pose = { error: e.message, state: 'unknown' };
        }
      }

      // Run shuttle detection
      if (this.mainThreadAnalyzers.shuttle && options.doShuttle !== false) {
        try {
          result.shuttle = await this.mainThreadAnalyzers.shuttle.analyze(sample);
        } catch (e) {
          result.shuttle = { error: e.message, state: 'unknown' };
        }
      }

      return result;
    }

    /**
     * Add frame to TrackNet processor for temporal smoothing.
     */
    addTrackNetFrame(heatmap, timestamp, process = false) {
      if (!this.mainThreadAnalyzers?.tracknet) {
        console.warn('TrackNet processor not available');
        return null;
      }

      this.mainThreadAnalyzers.tracknet.addFrame(heatmap, timestamp);

      if (process) {
        return this.mainThreadAnalyzers.tracknet.process();
      }

      return null;
    }

    /**
     * Extract trajectory point from heatmap.
     */
    extractTrajectoryPoint(heatmap, threshold = 0.5) {
      if (!this.mainThreadAnalyzers?.tracknet) {
        return null;
      }

      return this.mainThreadAnalyzers.tracknet.extractTrajectoryPoint(heatmap, threshold);
    }

    /**
     * Update performance metrics.
     */
    _updateMetrics(elapsedTime) {
      this.performanceMetrics.totalInferences++;
      this.performanceMetrics.totalTime += elapsedTime;
      this.performanceMetrics.avgTime = this.performanceMetrics.totalTime / this.performanceMetrics.totalInferences;
      this.performanceMetrics.minTime = Math.min(this.performanceMetrics.minTime, elapsedTime);
      this.performanceMetrics.maxTime = Math.max(this.performanceMetrics.maxTime, elapsedTime);

      // Report metrics every 30 inferences
      if (this.performanceMetrics.totalInferences % 30 === 0) {
        this.onMetrics({ ...this.performanceMetrics });
      }
    }

    /**
     * Get current pipeline status.
     */
    getStatus() {
      return {
        initialized: this.initializationState === 'ready',
        state: this.initializationState,
        workers: this.workers.length,
        pendingRequests: this.pendingRequests.size,
        backend: this.runtimeBackend,
        fallbacks: [...this.runtimeFallbacks],
        metrics: { ...this.performanceMetrics }
      };
    }

    /**
     * Release all resources.
     */
    async release() {
      // Settle in-flight and queued requests before clearing workers. Reject
      // queued acquisitions first so a completion cannot hand a worker to a
      // continuation after release has started.
      for (const waiter of this.workerWaiters.splice(0)) waiter.reject(new Error('Pipeline released'));
      for (const request of [...this.pendingRequests.values()]) {
        try {
          request.reject(new Error('Pipeline released'));
        } catch (e) {
          console.warn('Failed to reject pending inference request:', e);
        }
      }
      this.pendingRequests.clear();

      // Release workers
      for (const worker of this.workers) {
        try { worker.instance.postMessage({ type: 'release' }); } catch (_) { /* worker may already be gone */ }
        try { worker.instance.terminate?.(); } catch (_) { /* release is best effort */ }
      }
      this.workers = [];
      this.workerQueue = [];

      // Release main thread analyzers
      if (this.mainThreadAnalyzers) {
        for (const analyzer of Object.values(this.mainThreadAnalyzers)) {
          try {
            analyzer.release?.();
          } catch (e) {
            console.warn('Failed to release analyzer:', e);
          }
        }
        this.mainThreadAnalyzers = null;
      }

      // The pipeline owns the shared runtime manager it created
      if (this.mainThreadOnnxManager) {
        try {
          this.mainThreadOnnxManager.releaseAll?.();
        } catch (e) {
          console.warn('Failed to release ONNX runtime sessions:', e);
        }
        this.mainThreadOnnxManager = null;
      }

      this.runtimeBackend = null;
      this.runtimeFallbacks = [];
      this.initializationState = 'released';
    }
  }

  return Object.freeze({ InferencePipeline });
}));
