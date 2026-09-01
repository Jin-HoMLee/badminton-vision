/* global globalThis, BSOOnnxRuntime, BSOBlazePoseAdapter, BSOYOLOv8ShuttleAdapter, BSOTrackNetProcessor */
/**
 * Web Worker for parallel ML inference (pose, shuttle, tracking).
 * Prevents main thread blocking during model inference.
 *
 * Message format:
 * - init: { type: 'init', payload: { models: { pose, shuttle, tracknet } } }
 * - infer: { type: 'infer', payload: { frame, width, height, mediaTime, requestId } }
 * - release: { type: 'release' }
 */

let onnxManager = null;
let poseAnalyzer = null;
let shuttleDetector = null;
let tracknetProcessor = null;

/**
 * Initialize analyzers on worker startup.
 */
async function initializeAnalyzers(config) {
  try {
    // Initialize ONNX Runtime
    onnxManager = new globalThis.BSOOnnxRuntime.OnnxRuntimeManager();
    const runtimeStatus = await onnxManager.initialize();

    if (!runtimeStatus.available) {
      return {
        success: false,
        error: 'ONNX Runtime initialization failed: ' + runtimeStatus.reason
      };
    }

    // Initialize pose analyzer
    if (config.pose) {
      poseAnalyzer = new globalThis.BSOBlazePoseAdapter.BlazePoseAnalyzer({
        modelPath: config.pose.modelPath,
        onnxManager
      });

      const poseStatus = await poseAnalyzer.initialize();
      if (!poseStatus.available) {
        console.warn('Pose analyzer initialization failed:', poseStatus.reason);
      }
    }

    // Initialize shuttle detector
    if (config.shuttle) {
      shuttleDetector = new globalThis.BSOYOLOv8ShuttleAdapter.YOLOv8ShuttleDetector({
        modelPath: config.shuttle.modelPath,
        onnxManager,
        confidenceThreshold: config.shuttle.confidenceThreshold || 0.4
      });

      const shuttleStatus = await shuttleDetector.initialize();
      if (!shuttleStatus.available) {
        console.warn('Shuttle detector initialization failed:', shuttleStatus.reason);
      }
    }

    // Initialize TrackNet (post-processing only)
    if (config.tracknet) {
      tracknetProcessor = new globalThis.BSOTrackNetProcessor.TrackNetV3Processor({
        modelPath: config.tracknet.modelPath,
        onnxManager,
        mode: 'post-processing'
      });

      const tracknetStatus = await tracknetProcessor.initialize();
      if (!tracknetStatus.available) {
        console.warn('TrackNet processor initialization failed:', tracknetStatus.reason);
      }
    }

    return {
      success: true,
      runtime: runtimeStatus,
      analyzers: {
        pose: poseAnalyzer ? 'initialized' : 'skipped',
        shuttle: shuttleDetector ? 'initialized' : 'skipped',
        tracknet: tracknetProcessor ? 'initialized' : 'skipped'
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Run inference on a frame.
 */
async function runInference(frameData, config) {
  const results = {
    requestId: config.requestId,
    mediaTime: config.mediaTime,
    timestamp: Date.now(),
    pose: null,
    shuttle: null,
    error: null
  };

  try {
    // Prepare frame sample
    const sample = {
      frame: frameData,
      sessionId: config.sessionId || 'worker-session',
      requestId: config.requestId,
      mediaTime: config.mediaTime
    };

    // Run pose detection
    if (poseAnalyzer && config.doPose !== false) {
      try {
        results.pose = await poseAnalyzer.analyze(sample);
      } catch (e) {
        results.pose = { error: e.message, state: 'unknown' };
      }
    }

    // Run shuttle detection
    if (shuttleDetector && config.doShuttle !== false) {
      try {
        results.shuttle = await shuttleDetector.analyze(sample);
      } catch (e) {
        results.shuttle = { error: e.message, state: 'unknown' };
      }
    }

    return results;
  } catch (error) {
    results.error = error.message;
    return results;
  }
}

/**
 * Handle messages from main thread.
 */
globalThis.onmessage = async (event) => {
  const { type, id, payload } = event.data;

  try {
    let response = { type, id, success: false };

    switch (type) {
      case 'init': {
        response = await initializeAnalyzers(payload);
        response.type = 'init-response';
        response.id = id;
        break;
      }

      case 'infer': {
        // Reconstruct frame from ArrayBuffer
        const frame = payload.frame || {
          data: payload.frameData,
          width: payload.width,
          height: payload.height
        };

        response = await runInference(frame, {
          sessionId: payload.sessionId,
          requestId: payload.requestId,
          mediaTime: payload.mediaTime,
          doPose: payload.doPose !== false,
          doShuttle: payload.doShuttle !== false
        });

        response.type = 'infer-response';
        response.id = id;
        response.success = !response.error;
        break;
      }

      case 'tracknet-frame': {
        // Add frame to TrackNet processor
        if (tracknetProcessor) {
          const heatmap = payload.heatmap || {
            data: payload.heatmapData,
            dims: payload.dims
          };

          tracknetProcessor.addFrame(heatmap, payload.timestamp);

          if (payload.process) {
            const result = await tracknetProcessor.process();
            response = {
              type: 'tracknet-response',
              id,
              success: true,
              result
            };
          } else {
            response = {
              type: 'tracknet-response',
              id,
              success: true,
              result: null
            };
          }
        }
        break;
      }

      case 'tracknet-extract': {
        // Extract trajectory point from heatmap
        if (tracknetProcessor) {
          const point = tracknetProcessor.extractTrajectoryPoint(
            payload.heatmap,
            payload.threshold || 0.5
          );

          response = {
            type: 'tracknet-extract-response',
            id,
            success: true,
            result: point
          };
        }
        break;
      }

      case 'release': {
        if (poseAnalyzer) poseAnalyzer.release?.();
        if (shuttleDetector) shuttleDetector.release?.();
        if (tracknetProcessor) tracknetProcessor.release?.();
        if (onnxManager) onnxManager.releaseAll?.();

        poseAnalyzer = null;
        shuttleDetector = null;
        tracknetProcessor = null;
        onnxManager = null;

        response = {
          type: 'release-response',
          id,
          success: true
        };
        break;
      }

      case 'status': {
        response = {
          type: 'status-response',
          id,
          success: true,
          status: {
            onnx: onnxManager?.getStatus?.() || null,
            pose: poseAnalyzer ? 'initialized' : 'not-initialized',
            shuttle: shuttleDetector ? 'initialized' : 'not-initialized',
            tracknet: tracknetProcessor ? 'initialized' : 'not-initialized'
          }
        };
        break;
      }

      default:
        response.error = `Unknown message type: ${type}`;
    }

    globalThis.postMessage(response);
  } catch (error) {
    globalThis.postMessage({
      type: `${event.data.type}-error`,
      id: event.data.id,
      success: false,
      error: error.message
    });
  }
};
