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
      modelConfig = {},
      onStatus = () => {},
      onMetrics = () => {}
    } = {}) {
      this.environment = environment;
      this.useWebWorkers = useWebWorkers;
      this.numWorkers = Math.max(1, Math.min(numWorkers, 4));
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
      this.nextRequestId = 0;

      this.mainThreadAnalyzers = null;
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
      if (this.initializationState === 'initializing' || this.initializationState === 'ready') {
        return { success: this.initializationState === 'ready' };
      }

      this.initializationState = 'initializing';
      this.onStatus({ type: 'pipeline-initializing' });

      try {
        if (this.useWebWorkers && this.environment.Worker) {
          await this._initializeWorkers();
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
    }

    /**
     * Initialize Web Workers for inference.
     */
    async _initializeWorkers() {
      const workerScript = this.modelConfig.workerPath || '/src/ml-pipeline/workers/inference-worker.js';

      for (let i = 0; i < this.numWorkers; i++) {
        try {
          const worker = new this.environment.Worker(workerScript);
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

          await initPromise;

          this.workers.push({
            instance: worker,
            ready: workerReady,
            busy: false,
            inferenceCount: 0
          });

          this.workerQueue.push(i);
        } catch (error) {
          console.warn(`Failed to initialize worker ${i}:`, error);
        }
      }

      if (this.workers.length === 0) {
        throw new Error('Failed to initialize any Web Workers');
      }

      // Set up message handlers
      for (let i = 0; i < this.workers.length; i++) {
        this.workers[i].instance.addEventListener('message', (event) => {
          this._handleWorkerMessage(i, event);
        });
      }
    }

    /**
     * Initialize analyzers on main thread (fallback).
     */
    async _initializeMainThread() {
      this.mainThreadAnalyzers = {};

      const onnxManager = new OnnxRuntime.OnnxRuntimeManager();
      const runtimeStatus = await onnxManager.initialize();

      if (!runtimeStatus.available) {
        throw new Error('ONNX Runtime initialization failed: ' + runtimeStatus.reason);
      }

      // Initialize pose analyzer
      if (BlazePoseAdapter) {
        this.mainThreadAnalyzers.pose = new BlazePoseAdapter.BlazePoseAnalyzer({
          modelPath: this.modelConfig.pose.modelPath,
          onnxManager
        });

        await this.mainThreadAnalyzers.pose.initialize();
      }

      // Initialize shuttle detector
      if (YOLOv8ShuttleAdapter) {
        this.mainThreadAnalyzers.shuttle = new YOLOv8ShuttleAdapter.YOLOv8ShuttleDetector({
          modelPath: this.modelConfig.shuttle.modelPath,
          onnxManager,
          confidenceThreshold: this.modelConfig.shuttle.confidenceThreshold
        });

        await this.mainThreadAnalyzers.shuttle.initialize();
      }

      // Initialize TrackNet (post-processing)
      if (TrackNetProcessor) {
        this.mainThreadAnalyzers.tracknet = new TrackNetProcessor.TrackNetV3Processor({
          modelPath: this.modelConfig.tracknet.modelPath,
          onnxManager,
          mode: 'post-processing'
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
        if (request) {
          if (success) {
            request.resolve(result);
          } else {
            request.reject(new Error(error || 'Inference failed'));
          }
          this.pendingRequests.delete(id);
        }

        // Return worker to queue
        this.workers[workerIdx].busy = false;
        this.workers[workerIdx].inferenceCount++;
        this.workerQueue.push(workerIdx);
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

      const startTime = performance.now();
      const requestId = this.nextRequestId++;

      try {
        let result;

        if (this.workers.length > 0 && this.workerQueue.length > 0) {
          // Use Web Worker
          result = await this._runInferenceOnWorker(frameData, options, requestId);
        } else if (this.mainThreadAnalyzers) {
          // Fallback to main thread
          result = await this._runInferenceOnMainThread(frameData, options, requestId);
        } else {
          throw new Error('No inference backend available');
        }

        const elapsedTime = performance.now() - startTime;
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

    /**
     * Run inference on a Web Worker.
     */
    async _runInferenceOnWorker(frameData, options, requestId) {
      const workerIdx = this.workerQueue.shift();
      if (workerIdx === undefined) {
        throw new Error('No available workers');
      }

      const worker = this.workers[workerIdx];
      worker.busy = true;

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          this.workerQueue.push(workerIdx);
          worker.busy = false;
          reject(new Error('Worker inference timeout'));
        }, 30000); // 30 second timeout

        this.pendingRequests.set(requestId, {
          resolve: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });

        worker.instance.postMessage({
          type: 'infer',
          id: requestId,
          payload: {
            frame: frameData,
            frameData: frameData.data,
            width: frameData.width,
            height: frameData.height,
            mediaTime: options.mediaTime,
            requestId: options.requestId,
            sessionId: options.sessionId,
            doPose: options.doPose !== false,
            doShuttle: options.doShuttle !== false
          }
        });
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
        metrics: { ...this.performanceMetrics }
      };
    }

    /**
     * Release all resources.
     */
    async release() {
      // Release workers
      for (const worker of this.workers) {
        worker.instance.postMessage({ type: 'release' });
        worker.instance.terminate();
      }
      this.workers = [];
      this.workerQueue = [];

      // Release main thread analyzers
      if (this.mainThreadAnalyzers) {
        for (const analyzer of Object.values(this.mainThreadAnalyzers)) {
          analyzer.release?.();
        }
        this.mainThreadAnalyzers = null;
      }

      this.initializationState = 'released';
    }
  }

  return Object.freeze({ InferencePipeline });
}));
