/**
 * Web Worker for parallel ML inference (pose, shuttle, tracking).
 * Prevents main thread blocking during model inference.
 *
 * Message format:
 * - init: { type: 'init', id, payload: { pose: { modelPath }, shuttle: { modelPath }, tracknet: { modelPath } } }
 * - infer: { type: 'infer', id, payload: { frame, frameData, width, height, mediaTime, requestId, sessionId } }
 * - release: { type: 'release', id }
 */

// Import dependencies inline since workers run in an isolated context. Keep
// these relative to the worker so the same artifact works from source and the
// packaged extension; no remote script can enter the worker.
const workerBase = new URL('./', globalThis.location?.href || 'file:///bso/ml-pipeline/workers/');
const localDependency = (path) => new URL(path, workerBase).toString();
importScripts(
  localDependency('../onnx-runtime.js'),
  localDependency('../adapters/blazepose-adapter.js'),
  localDependency('../adapters/yolov8-shuttle-adapter.js'),
  localDependency('../adapters/tracknet-processor.js'),
  localDependency('../../common/player-tracking.js')
);

let onnxManager = null;
let poseAnalyzer = null;
let shuttleDetector = null;
let tracknetProcessor = null;

/**
 * Initialize analyzers on worker startup.
 */
async function initializeAnalyzers(config = {}) {
  try {
    // ONNX Runtime Web is intentionally supplied as a local package asset.
    // Loading it here keeps the worker deterministic when the asset is absent.
    if (!globalThis.ort && config.runtimeScript) {
      const runtimeUrl = String(config.runtimeScript);
      if (/^(?:https?:)?\/\//i.test(runtimeUrl)) throw new Error('Remote ONNX runtime scripts are disabled');
      importScripts(localDependency(runtimeUrl));
    }

    // Initialize ONNX Runtime using globalThis after importScripts
    const OnnxRuntimeModule = globalThis.BSOOnnxRuntime;
    if (!OnnxRuntimeModule || !OnnxRuntimeModule.OnnxRuntimeManager) {
      return {
        success: false,
        error: 'ONNX Runtime module not loaded'
      };
    }

    onnxManager = new OnnxRuntimeModule.OnnxRuntimeManager();
    const runtimeStatus = await onnxManager.initialize();

    if (!runtimeStatus.available) {
      return {
        success: false,
        error: 'ONNX Runtime initialization failed: ' + runtimeStatus.reason,
        runtime: runtimeStatus
      };
    }

    // Initialize pose analyzer
    if (config.pose) {
      const BlazePoseModule = globalThis.BSOBlazePoseAdapter;
      if (BlazePoseModule && BlazePoseModule.BlazePoseAnalyzer) {
        poseAnalyzer = new BlazePoseModule.BlazePoseAnalyzer({
          modelPath: config.pose.modelPath,
          onnxManager,
          environment: globalThis
        });

        const poseStatus = await poseAnalyzer.initialize();
        if (!poseStatus.available) {
          console.warn('Pose analyzer initialization failed:', poseStatus.reason);
          poseAnalyzer = null;
        }
      }
    }

    // Initialize shuttle detector
    if (config.shuttle) {
      const YOLOv8Module = globalThis.BSOYOLOv8ShuttleAdapter;
      if (YOLOv8Module && YOLOv8Module.YOLOv8ShuttleDetector) {
        shuttleDetector = new YOLOv8Module.YOLOv8ShuttleDetector({
          modelPath: config.shuttle.modelPath,
          onnxManager,
          confidenceThreshold: config.shuttle.confidenceThreshold || 0.4,
          environment: globalThis
        });

        const shuttleStatus = await shuttleDetector.initialize();
        if (!shuttleStatus.available) {
          console.warn('Shuttle detector initialization failed:', shuttleStatus.reason);
          shuttleDetector = null;
        }
      }
    }

    // Initialize TrackNet (post-processing only)
    if (config.tracknet) {
      const TrackNetModule = globalThis.BSOTrackNetProcessor;
      if (TrackNetModule && TrackNetModule.TrackNetV3Processor) {
        tracknetProcessor = new TrackNetModule.TrackNetV3Processor({
          modelPath: config.tracknet.modelPath,
          onnxManager,
          mode: 'post-processing',
          environment: globalThis
        });

        const tracknetStatus = await tracknetProcessor.initialize();
        if (!tracknetStatus.available) {
          console.warn('TrackNet processor initialization failed:', tracknetStatus.reason);
          tracknetProcessor = null;
        }
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
    console.error('Analyzer initialization error:', error);
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

        const result = await runInference(frame, {
          sessionId: payload.sessionId,
          requestId: payload.requestId,
          mediaTime: payload.mediaTime,
          doPose: payload.doPose !== false,
          doShuttle: payload.doShuttle !== false
        });

        response = {
          type: 'infer-response',
          id,
          success: !result.error,
          result
        };
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
