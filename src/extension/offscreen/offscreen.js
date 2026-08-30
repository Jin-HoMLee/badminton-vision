/* global chrome, BSOProtocol */
'use strict';

/**
 * Analyzer seam. A future ONNX Runtime Web implementation can replace this
 * object without changing capture, messaging, or synchronization contracts.
 */
class MockAnalyzer {
  async analyze(sample) {
    return BSOProtocol.createAnalyzerResult({
      sessionId: sample.sessionId,
      requestId: sample.requestId,
      mediaTime: sample.mediaTime,
      analyzer: 'mock',
      inferenceAvailable: false,
      result: {
        kind: 'mock',
        shotFamily: 'unclassified',
        classificationConfidence: 0,
        geometryConfidence: 0,
        note: 'Inference seam active; no model is bundled in M0.'
      }
    });
  }
}

let activeAnalyzer = new MockAnalyzer();
const sessions = new Set();

function setAnalyzer(nextAnalyzer) {
  if (!nextAnalyzer || typeof nextAnalyzer.analyze !== 'function') {
    throw new TypeError('Analyzer must expose analyze(frameSample)');
  }
  activeAnalyzer = nextAnalyzer;
}

// This narrow seam is intentionally the only place an inference backend needs
// to plug in. Capture and UI code never imports a model implementation.
globalThis.BSOOffscreenAnalyzer = Object.freeze({ MockAnalyzer, setAnalyzer });

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function handle(message) {
  if (message.type === BSOProtocol.TYPES.SESSION_START) {
    sessions.add(message.sessionId);
    await send(BSOProtocol.createCapabilityReport({
      sessionId: message.sessionId,
      capture: message.capabilities?.capture || 'unknown',
      transferableFrames: Boolean(message.capabilities?.transferableFrames),
      offscreen: true,
      inference: false,
      analyzer: 'mock',
      fallbacks: ['mock-analyzer'],
      reason: 'ONNX Runtime Web is intentionally not bundled in M0.'
    }));
    await send(BSOProtocol.createRuntimeStatus({
      sessionId: message.sessionId,
      phase: 'ready',
      message: 'Mock analyzer ready; results remain explicitly unclassified.',
      capabilities: { offscreen: true, inference: false, analyzer: 'mock' }
    }));
    return;
  }
  if (message.type === BSOProtocol.TYPES.SESSION_END) {
    sessions.delete(message.sessionId);
    return;
  }
  if (message.type !== BSOProtocol.TYPES.FRAME_SAMPLE || !sessions.has(message.sessionId)) return;
  if (!BSOProtocol.isFrameSample(message)) {
    await send(BSOProtocol.createRuntimeStatus({
      sessionId: message.sessionId,
      phase: 'fallback',
      message: 'Frame sample did not satisfy the runtime contract.',
      capabilities: { offscreen: true, inference: false, analyzer: 'mock' },
      reason: 'message-contract-rejected'
    }));
    return;
  }
  const result = await activeAnalyzer.analyze(message);
  await send(result);
  if (message.frame && typeof message.frame.close === 'function') message.frame.close();
}

chrome.runtime.onMessage.addListener((message) => {
  if (!BSOProtocol.isRuntimeMessage(message)) return false;
  void handle(message).catch(async (error) => {
    if (message.sessionId) await send(BSOProtocol.createRuntimeStatus({
      sessionId: message.sessionId,
      phase: 'fallback',
      message: 'Mock analyzer failed; playback is unaffected.',
      capabilities: { offscreen: true, inference: false, analyzer: 'mock' },
      reason: error instanceof Error ? error.message : String(error)
    }));
  });
  return false;
});
