/* global globalThis, BSOProtocol, BSOPlayerTracking, BSOInferencePipeline */
/**
 * ONNX-based inference adapter for integration with the offscreen analyzer.
 *
 * Provides the same interface as LiteOpenPoseAdapter, but uses:
 * - MediaPipe BlazePose + YOLOv8-Nano via ONNX Runtime Web
 * - Web Workers for parallel processing
 * - TrackNetV3 for post-processing
 */
(function installOnnxInferenceAdapter(root, factory) {
  const api = factory(
    root.BSOProtocol,
    root.BSOPlayerTracking,
    root.BSOInferencePipeline,
    root
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOOnnxInferenceAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function onnxInferenceAdapterFactory(
  Protocol,
  PlayerTracking,
  InferencePipeline,
  defaultEnvironment
) {
  'use strict';

  class OnnxInferenceAnalyzer {
    constructor({ environment = defaultEnvironment, inferenceConfig = {}, onStatus = () => {} } = {}) {
      this.environment = environment;
      const defaultModelConfig = {
        pose: { modelPath: 'models/blazepose-lite-256.onnx' },
        shuttle: { modelPath: 'models/yolov8n-badminton-shuttle.onnx', confidenceThreshold: 0.4 },
        tracknet: { modelPath: 'models/tracknetv3-3frame.onnx' }
      };
      const suppliedModelConfig = inferenceConfig.modelConfig || {};
      this.inferenceConfig = {
        useWebWorkers: true,
        numWorkers: 2,
        ...inferenceConfig,
        modelConfig: {
          ...defaultModelConfig,
          ...suppliedModelConfig,
          pose: { ...defaultModelConfig.pose, ...suppliedModelConfig.pose },
          shuttle: { ...defaultModelConfig.shuttle, ...suppliedModelConfig.shuttle },
          tracknet: { ...defaultModelConfig.tracknet, ...suppliedModelConfig.tracknet }
        }
      };

      this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
      this.pipeline = null;
      this.sessionId = `adapter-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.playerTracker = PlayerTracking?.SessionPlayerTracker
        ? new PlayerTracking.SessionPlayerTracker({ sessionId: this.sessionId, maxTracks: 4 })
        : null;

      this.identity = {
        id: 'onnx-blazepose-yolov8-v1',
        version: 1,
        kind: 'onnx-runtime-multipose-shuttle',
        productionModel: true,
        components: {
          pose: 'blazepose-lite-256-onnx',
          shuttle: 'yolov8n-badminton-shuttle-onnx',
          tracking: 'tracknetv3-onnx-post-processor'
        }
      };

      this.backend = null;
      this.fallbacks = [];
      this.initialization = null;
    }

    /**
     * Initialize the inference pipeline.
     */
    async initialize() {
      if (this.initialization) return this.initialization;

      this.initialization = (async () => {
        try {
          if (!InferencePipeline) {
            return { available: false, reason: 'InferencePipeline not available' };
          }

          this.pipeline = new InferencePipeline.InferencePipeline({
            environment: this.environment,
            ...this.inferenceConfig,
            onStatus: (status) => this.onStatus?.({ component: 'pipeline', ...status }),
            onMetrics: (metrics) => this.onStatus?.({ component: 'metrics', ...metrics })
          });

          const initResult = await this.pipeline.initialize();

          if (!initResult.success) {
            return { available: false, reason: initResult.error };
          }

          const status = this.pipeline.getStatus();
          this.backend = status.backend || 'multi-backend';
          this.fallbacks = status.fallbacks || [];

          this.onStatus?.({
            type: 'analyzer-ready',
            backend: this.backend,
            fallbacks: this.fallbacks
          });

          return {
            available: true,
            backend: this.backend,
            fallbacks: this.fallbacks
          };
        } catch (error) {
          this.onStatus?.({ type: 'initialization-failed', reason: error.message });
          return { available: false, reason: error.message };
        }
      })();

      return this.initialization;
    }

    /**
     * Analyze a frame: run pose and shuttle detection.
     */
    async analyze(sample = {}) {
      try {
        const init = await this.initialize();
        if (!init.available) {
          throw new Error('Analyzer not initialized: ' + init.reason);
        }
        const sessionId = String(sample.sessionId || this.sessionId);
        const requestId = String(sample.requestId || `${sessionId}:${Date.now()}`);
        const mediaTime = Number.isFinite(sample.mediaTime) && sample.mediaTime >= 0 ? sample.mediaTime : 0;

        // Prepare frame data
        const frameData = await this._readFramePixels(sample.frame);
        if (!frameData) {
          throw new Error('Failed to read frame pixels');
        }

        // Run inference
        const inferenceResult = await this.pipeline.runInference(frameData, {
          sessionId,
          requestId,
          mediaTime,
          doPose: true,
          doShuttle: true
        });

        // Process pose results through player tracker
        let tracking = { state: 'unknown', players: [] };
        if (this.playerTracker && inferenceResult.pose && inferenceResult.pose.poses) {
          // Reset tracker if sessionId changes
          if (this.sessionId !== sessionId) {
            this.sessionId = sessionId;
            this.playerTracker.reset('session-changed');
          }

          const observations = inferenceResult.pose.poses.map(pose => ({
            keypoints: pose.keypoints,
            confidence: pose.confidence,
            bbox: this._calculateBBox(pose.keypoints)
          }));

          const processedTracker = this.playerTracker.processFrame({
            observations,
            mediaTime,
            requestId
          });

          tracking = processedTracker || tracking;
        }

        // Compile result
        return Protocol.createAnalyzerResult({
          sessionId,
          requestId,
          mediaTime,
          status: 'ok',
          analyzer: this.identity.id,
          analyzerIdentity: this.identity,
          inferenceAvailable: true,
          result: {
            kind: 'onnx-inference-result',
            productionModel: true,
            state: this._determineState(inferenceResult),
            players: this._extractPlayers(tracking, inferenceResult),
            tracking,
            shuttle: this._extractShuttle(inferenceResult),
            racket: this._extractRacket(tracking, inferenceResult),
            temporal: {
              state: 'unknown',
              trajectory: [],
              reason: 'tracknet-post-processing-not-run-in-live-cycle'
            },
            strokeEvents: [],
            rally: { state: 'unknown', confidence: null, reason: 'rally-segmentation-not-available' },
            rallyEnd: { state: 'unknown', confidence: null, reason: 'rally-end-evidence-not-available' },
            winner: { state: 'unknown', confidence: null, reason: 'winner-evidence-not-available' },
            outcome: 'unclassified',
            shotFamily: 'unclassified',
            classificationConfidence: 0,
            geometryConfidence: this._calculateGeometryConfidence(inferenceResult),
            inferenceTime: inferenceResult.inferenceTime,
            note: `ONNX-based inference completed in ${inferenceResult.inferenceTime?.toFixed(1)}ms`
          }
        });
      } catch (error) {
        console.error('ONNX analysis error:', error);
        throw error;
      }
    }

    /**
     * Extract player information from tracking result.
     */
    _extractPlayers(tracking, inferenceResult) {
      const trackedPlayers = tracking && Array.isArray(tracking.players) ? tracking.players : [];
      if (trackedPlayers.length) {
        return trackedPlayers.map(player => ({
          trackId: player.trackId,
          state: player.state,
          confidence: player.confidence,
          bbox: player.bbox,
          keypoints: player.keypoints
        }));
      }
      // A tracker can be deliberately disabled in a worker seam. Preserve
      // pose evidence instead of turning a successful detector run into an
      // empty player list.
      return (inferenceResult.pose?.poses || []).map((pose, index) => ({
        trackId: `pose-${index}`,
        state: pose.state || (pose.confidence > 0.1 ? 'tracked' : 'partial'),
        confidence: pose.confidence ?? null,
        bbox: this._calculateBBox(pose.keypoints),
        keypoints: pose.keypoints
      }));
    }

    /**
     * Racket segmentation is intentionally deferred. Wrist/elbow vectors are
     * still useful, bounded local evidence for UI positioning and downstream
     * classifiers, so expose them with an explicit partial state.
     */
    _extractRacket(tracking, inferenceResult) {
      const players = this._extractPlayers(tracking, inferenceResult);
      const hands = [];
      for (const player of players) {
        const keypoints = player.keypoints || [];
        for (const side of ['left', 'right']) {
          const wrist = keypoints.find((point) => point.name === `${side}_wrist` && point.confidence != null);
          const elbow = keypoints.find((point) => point.name === `${side}_elbow` && point.confidence != null);
          if (!wrist) continue;
          const confidence = Math.min(Number(wrist.confidence) || 0, elbow ? Number(elbow.confidence) || 0 : Number(wrist.confidence) || 0);
          hands.push({
            trackId: player.trackId,
            side,
            wrist: { x: wrist.x, y: wrist.y },
            elbow: elbow ? { x: elbow.x, y: elbow.y } : null,
            confidence,
            segmentation: 'deferred'
          });
        }
      }
      return {
        state: hands.length ? 'partial' : 'unknown',
        confidence: hands.length ? Math.max(...hands.map((hand) => hand.confidence)) : null,
        hands,
        segmentationAvailable: false,
        reason: hands.length ? 'wrist-elbow-pose-proxy' : 'racket-evidence-unavailable'
      };
    }

    /**
     * Extract shuttle information.
     */
    _extractShuttle(inferenceResult) {
      if (inferenceResult.shuttle && inferenceResult.shuttle.state !== 'unknown') {
        const detections = inferenceResult.shuttle.detections || [];
        if (detections.length > 0) {
          const best = detections[0]; // Use highest confidence detection
          return {
            state: 'tracked',
            confidence: best.confidence,
            bbox: best.bbox,
            trajectory: null // Would be populated by TrackNetV3 post-processing
          };
        }
      }

      return { state: 'unknown', confidence: null };
    }

    /**
     * Determine overall analysis state.
     */
    _determineState(result) {
      if (result.error) return 'error';
      if ((result.pose && result.pose.state === 'tracked') ||
          (result.shuttle && result.shuttle.state === 'tracked')) {
        return 'tracked';
      }
      if ((result.pose && result.pose.state === 'partial') ||
          (result.shuttle && result.shuttle.state === 'partial')) {
        return 'partial';
      }
      return 'unknown';
    }

    /**
     * Calculate geometry confidence from inference results.
     */
    _calculateGeometryConfidence(result) {
      const confidences = [];

      if (result.pose && result.pose.confidence) {
        confidences.push(result.pose.confidence);
      }

      if (result.shuttle && result.shuttle.confidence) {
        confidences.push(result.shuttle.confidence);
      }

      if (confidences.length === 0) return 0;
      return confidences.reduce((a, b) => a + b) / confidences.length;
    }

    /**
     * Calculate bounding box from keypoints.
     */
    _calculateBBox(keypoints) {
      if (!keypoints || keypoints.length === 0) return null;

      const validKps = keypoints.filter(kp => kp.confidence !== null && kp.confidence > 0.1);
      if (validKps.length === 0) return null;

      const xs = validKps.map(kp => kp.x);
      const ys = validKps.map(kp => kp.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      };
    }

    /**
     * Read frame pixels from various formats.
     */
    /**
     * Create a canvas sized to the frame, in worker or DOM contexts.
     */
    _createCanvas(width, height) {
      const OffscreenCanvasCtor = this.environment?.OffscreenCanvas;
      if (typeof OffscreenCanvasCtor === 'function') {
        return new OffscreenCanvasCtor(width, height);
      }

      const canvas = this.environment?.document?.createElement?.('canvas');
      if (!canvas) return null;

      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    async _readFramePixels(frame) {
      if (!frame) return null;

      // Handle RGBA data format
      if (frame.data && frame.width && frame.height) {
        return { data: frame.data, width: frame.width, height: frame.height };
      }

      // Handle ImageBitmap or OffscreenCanvas
      if (frame.width && frame.height) {
        const canvas = this._createCanvas(frame.width, frame.height);
        if (!canvas) return null;

        const ctx = canvas.getContext?.('2d');
        if (!ctx) return null;

        ctx.drawImage(frame, 0, 0, frame.width, frame.height);
        const imageData = ctx.getImageData(0, 0, frame.width, frame.height);

        return {
          data: imageData.data,
          width: frame.width,
          height: frame.height
        };
      }

      return null;
    }

    /**
     * Release all resources.
     */
    async release() {
      if (this.pipeline) {
        await this.pipeline.release();
        this.pipeline = null;
      }
    }
  }

  return Object.freeze({ OnnxInferenceAnalyzer });
}));
