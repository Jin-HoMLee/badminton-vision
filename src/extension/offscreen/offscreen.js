/* global chrome, BSOProtocol, BSOFixtureAnalyzer */
'use strict';

const ANALYZER_FALLBACK = 'fixture-probe-v1';

function unknownTracking(sample, reason) {
  if (globalThis.BSOPlayerTracking && typeof globalThis.BSOPlayerTracking.unknownTrackingResult === 'function') {
    return globalThis.BSOPlayerTracking.unknownTrackingResult({
      sessionId: sample.sessionId,
      requestId: sample.requestId,
      mediaTime: sample.mediaTime,
      detector: { id: 'mock-compatibility-seam', version: 1, kind: 'compatibility-seam' },
      source: { id: 'captured-frame', version: 1, kind: 'mv3-offscreen-frame' },
      reason
    });
  }
  return {
    schema: 'bso.player-tracking.result.v1',
    version: 1,
    sessionId: sample.sessionId,
    requestId: sample.requestId,
    mediaTime: sample.mediaTime,
    state: 'unknown',
    players: [],
    observations: [],
    duplicateObservations: [],
    invalidObservations: [],
    association: { method: 'gated-motion-box-keypoint-v1', maxTracks: 4, identityRisk: 'none' },
    accepted: true,
    reason
  };
}

/**
 * The default analyzer is a committed, deterministic runtime fixture. It
 * proves that a captured frame can cross the MV3 boundary and be read locally
 * (ImageBitmap on an explicitly structured-clone-capable channel or bounded
 * RGBA data on stable Chrome); it is deliberately not a production
 * player/shuttle CV model.
 */
class MockAnalyzer {
  async analyze(sample) {
    return BSOProtocol.createAnalyzerResult({
      sessionId: sample.sessionId,
      requestId: sample.requestId,
      mediaTime: sample.mediaTime,
      analyzer: 'mock-compatibility-seam',
      analyzerIdentity: {
        id: 'mock-compatibility-seam',
        version: 1,
        kind: 'compatibility-seam',
        runtimeIntegrationTest: true,
        productionModel: false
      },
      inferenceAvailable: false,
      result: {
        kind: 'runtime-integration-probe',
        runtimeIntegrationTest: true,
        productionModel: false,
        state: 'partial',
        // The compatibility seam identifies no player or shuttle.
        players: [],
        tracking: unknownTracking(sample, 'compatibility-seam-no-detections'),
        shuttle: { state: 'unknown', confidence: null },
        strokeEvents: [],
        shotFamily: 'unclassified',
        classificationConfidence: 0,
        geometryConfidence: 0,
        note: 'Compatibility seam only; no production CV model is bundled.'
      }
    });
  }
}

const DefaultAnalyzer = globalThis.BSOFixtureAnalyzer && globalThis.BSOFixtureAnalyzer.FixtureProbeAnalyzer;
let activeAnalyzer = DefaultAnalyzer ? new DefaultAnalyzer() : new MockAnalyzer();
const sessions = new Map();
const sessionQueues = new Map();

function analyzerIdentity() {
  const identity = activeAnalyzer && activeAnalyzer.identity;
  if (identity) return identity;
  return {
    id: activeAnalyzer?.constructor?.name || ANALYZER_FALLBACK,
    version: 1,
    kind: 'local-analyzer',
    runtimeIntegrationTest: false,
    productionModel: false
  };
}

function analyzerId() {
  return analyzerIdentity().id || ANALYZER_FALLBACK;
}

function setAnalyzer(nextAnalyzer) {
  if (!nextAnalyzer || typeof nextAnalyzer.analyze !== 'function') {
    throw new TypeError('Analyzer must expose analyze(frameSample)');
  }
  activeAnalyzer = nextAnalyzer;
}

function capabilityState(input = {}, { inference = input.capture !== 'unavailable' } = {}) {
  return {
    capture: input.capture || 'unknown',
    transferableFrames: Boolean(input.transferableFrames),
    offscreen: true,
    inference: Boolean(inference),
    analyzer: analyzerId(),
    transport: 'mv3-runtime-messaging',
    frameTransport: input.frameTransport || 'unknown'
  };
}

// This narrow seam is intentionally the only place an inference backend needs
// to plug in. Capture and UI code never imports a model implementation.
globalThis.BSOOffscreenAnalyzer = Object.freeze({
  MockAnalyzer,
  FixtureProbeAnalyzer: DefaultAnalyzer,
  setAnalyzer,
  getActiveAnalyzer: () => activeAnalyzer
});

function send(message) {
  if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return Promise.resolve(false);
  return Promise.resolve(chrome.runtime.sendMessage(message)).then(() => true).catch(() => false);
}

function enqueue(sessionId, task) {
  const previous = sessionQueues.get(sessionId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  sessionQueues.set(sessionId, next);
  return next;
}

function resultWithState(result, inputCapabilities) {
  const state = capabilityState(inputCapabilities, { inference: result.inferenceAvailable });
  return {
    ...result,
    analyzer: result.analyzer || analyzerId(),
    analyzerIdentity: result.analyzerIdentity || analyzerIdentity(),
    capabilities: state,
    capabilityState: state
  };
}

async function handleSessionStart(message) {
  return enqueue(message.sessionId, async () => {
    sessions.set(message.sessionId, { capabilities: message.capabilities || {} });
    const input = message.capabilities || {};
    await send(BSOProtocol.createCapabilityReport({
      sessionId: message.sessionId,
      capture: input.capture || 'unknown',
      transferableFrames: Boolean(input.transferableFrames),
      offscreen: true,
      inference: input.capture !== 'unavailable',
      analyzer: analyzerId(),
      frameTransport: input.frameTransport || 'unknown',
      fallbacks: ['runtime-integration-probe-not-production-cv'].concat(input.capture === 'unavailable' ? ['capture-unavailable'] : []),
      reason: 'A deterministic local fixture is active; production CV is not bundled.'
    }));
    await send(BSOProtocol.createRuntimeStatus({
      sessionId: message.sessionId,
      phase: 'ready',
      message: 'Local runtime integration probe ready; not production CV.',
      capabilities: capabilityState(input),
      reason: 'runtime-integration-probe'
    }));
  });
}

async function handleFrame(message) {
  return enqueue(message.sessionId, async () => {
    const session = sessions.get(message.sessionId);
    if (!session) return;
    if (!BSOProtocol.isFrameSample(message)) {
      await send(BSOProtocol.createRuntimeStatus({
        sessionId: message.sessionId,
        phase: 'fallback',
        message: 'Frame sample did not satisfy the runtime contract.',
        capabilities: capabilityState(session.capabilities, { inference: false }),
        reason: 'message-contract-rejected'
      }));
      return;
    }
    try {
      const result = await activeAnalyzer.analyze(message);
      await send(resultWithState(result, session.capabilities));
    } finally {
      // ImageBitmap.close releases the snapshot even when an analyzer throws.
      if (message.frame && typeof message.frame.close === 'function') message.frame.close();
    }
  });
}

async function handleSessionEnd(message) {
  return enqueue(message.sessionId, async () => {
    const session = sessions.get(message.sessionId);
    sessions.delete(message.sessionId);
    // The queue makes the end marker wait behind all frame analyses, so a
    // result cannot be lost merely because navigation arrived quickly.
    await send(message);
    if (session) {
      await send(BSOProtocol.createRuntimeStatus({
        sessionId: message.sessionId,
        phase: 'ended',
        message: 'Local runtime session ended.',
        capabilities: capabilityState(session.capabilities),
        reason: 'session-end-ack'
      }));
    }
    sessionQueues.delete(message.sessionId);
  });
}

function handle(message) {
  if (message.type === BSOProtocol.TYPES.SESSION_START) return handleSessionStart(message);
  if (message.type === BSOProtocol.TYPES.SESSION_END) return handleSessionEnd(message);
  if (message.type === BSOProtocol.TYPES.FRAME_SAMPLE) return handleFrame(message);
  return Promise.resolve();
}

if (typeof chrome !== 'object' || !chrome.runtime || !chrome.runtime.onMessage ||
    typeof chrome.runtime.onMessage.addListener !== 'function') {
  // The analyzer module can also be opened as a local diagnostics page; an
  // MV3 offscreen context is required for message handling.
} else {
chrome.runtime.onMessage.addListener((message) => {
  if (!BSOProtocol.isRuntimeMessage(message)) return false;
  void handle(message).catch(async (error) => {
    const session = sessions.get(message.sessionId);
    if (message.sessionId && session) {
      await send(BSOProtocol.createRuntimeStatus({
        sessionId: message.sessionId,
        phase: 'fallback',
        message: 'Local analyzer failed; playback is unaffected.',
        capabilities: capabilityState(session.capabilities, { inference: false }),
        reason: error instanceof Error ? error.message : String(error)
      }));
    }
  });
  return false;
});
}
