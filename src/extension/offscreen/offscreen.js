/* global chrome, BSOProtocol, BSOFixtureAnalyzer, BSOMoveNetAdapter */
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
 * The fixture remains available to Node integration harnesses. The browser
 * package selects the local MoveNet adapter when its explicitly vendored
 * runtime is present; no UI or capture code knows which analyzer is active.
 * Stable Chrome's serializable RGBA path is accepted by either analyzer.
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

const ProductionAnalyzer = globalThis.BSOMoveNetAdapter && globalThis.tf &&
  globalThis.BSOMoveNetAdapter.MoveNetMultiPoseLightningAnalyzer;
const FixtureAnalyzer = globalThis.BSOFixtureAnalyzer && globalThis.BSOFixtureAnalyzer.FixtureProbeAnalyzer;
// The adapter is shipped as a seam, but its TensorFlow.js runtime and model
// are intentionally absent until the weight license is cleared. Node/runtime
// harnesses retain the deterministic fixture, so plumbing tests never claim CV
// detections.
let activeAnalyzer = ProductionAnalyzer
  ? new ProductionAnalyzer({ tf: globalThis.tf, environment: globalThis })
  : FixtureAnalyzer ? new FixtureAnalyzer() : new MockAnalyzer();
const sessions = new Map();
const sessionQueues = new Map();
const frameStates = new Map();

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

function capabilityState(input = {}, { inference = input.capture !== 'unavailable', analyzer = analyzerId(), offscreen = true } = {}) {
  return {
    capture: input.capture || 'unknown',
    transferableFrames: Boolean(input.transferableFrames),
    offscreen: Boolean(offscreen),
    inference: Boolean(inference),
    analyzer,
    transport: 'mv3-runtime-messaging',
    frameTransport: input.frameTransport || 'unknown'
  };
}

// This narrow seam is intentionally the only place an inference backend needs
// to plug in. Capture and UI code never imports a model implementation.
globalThis.BSOOffscreenAnalyzer = Object.freeze({
  MockAnalyzer,
  FixtureProbeAnalyzer: FixtureAnalyzer,
  MoveNetMultiPoseLightningAnalyzer: ProductionAnalyzer,
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
  if (!result) return null;
  const state = capabilityState(inputCapabilities, {
    inference: result.inferenceAvailable,
    analyzer: result.analyzer || analyzerId()
  });
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
    sessions.set(message.sessionId, { sessionId: message.sessionId, capabilities: message.capabilities || {} });
    frameStates.set(message.sessionId, {
      busy: false,
      pending: null,
      watermark: -Infinity,
      waiters: []
    });
    const input = message.capabilities || {};
    const initialized = typeof activeAnalyzer.initialize === 'function'
      ? await activeAnalyzer.initialize()
      : { available: true, fallbacks: ['runtime-integration-probe-not-production-cv'], reason: 'runtime-integration-probe' };
    const inference = input.capture !== 'unavailable' && initialized.available !== false;
    const fallbacks = (initialized.fallbacks || []).slice();
    if (activeAnalyzer.identity?.runtimeIntegrationTest) fallbacks.push('runtime-integration-probe-not-production-cv');
    if (input.capture === 'unavailable') fallbacks.push('capture-unavailable');
    const reason = initialized.reason || (activeAnalyzer.identity?.runtimeIntegrationTest
      ? 'A deterministic local fixture is active; production CV is not bundled.' : 'Local MoveNet inference is active.');
    await send(BSOProtocol.createCapabilityReport({
      sessionId: message.sessionId,
      capture: input.capture || 'unknown',
      transferableFrames: Boolean(input.transferableFrames),
      offscreen: true,
      inference,
      analyzer: analyzerId(),
      frameTransport: input.frameTransport || 'unknown',
      fallbacks: Array.from(new Set(fallbacks)),
      reason
    }));
    await send(BSOProtocol.createRuntimeStatus({
      sessionId: message.sessionId,
      phase: inference ? 'ready' : 'fallback',
      message: inference ? (activeAnalyzer.identity?.runtimeIntegrationTest
        ? 'Local runtime integration probe ready; not production CV.'
        : 'Local MoveNet MultiPose Lightning ready.') : 'Local inference unavailable; playback is unaffected.',
      capabilities: capabilityState(input, { inference }),
      reason
    }));
  });
}

function closeFrame(message) {
  if (message?.frame && typeof message.frame.close === 'function') message.frame.close();
}

async function reportFrameStatus(session, phase, message, reason) {
  await send(BSOProtocol.createRuntimeStatus({
    sessionId: session.sessionId,
    phase,
    message,
    capabilities: capabilityState(session.capabilities, { inference: phase !== 'fallback' }),
    reason
  }));
}

function waitForFrames(sessionId) {
  const state = frameStates.get(sessionId);
  if (!state || !state.busy) return Promise.resolve();
  return new Promise((resolve) => state.waiters.push(resolve));
}

function finishFrame(sessionId) {
  const state = frameStates.get(sessionId);
  if (!state) return;
  if (state.pending) {
    const next = state.pending;
    state.pending = null;
    void processFrame(sessionId, next).catch(() => undefined);
    return;
  }
  state.busy = false;
  const waiters = state.waiters.splice(0);
  waiters.forEach((resolve) => resolve());
}

async function processFrame(sessionId, message) {
  const session = sessions.get(sessionId);
  const state = frameStates.get(sessionId);
  if (!session || !state) {
    closeFrame(message);
    if (state) finishFrame(sessionId);
    return;
  }
  try {
    const result = await activeAnalyzer.analyze(message);
    const envelope = resultWithState(result, session.capabilities);
    if (envelope) await send(envelope);
  } finally {
    // ImageBitmap.close releases the snapshot even when an analyzer throws.
    closeFrame(message);
    finishFrame(sessionId);
  }
}

/**
 * Keep at most one active and one latest pending frame per session. Capture
 * already bounds bitmap creation; this second gate prevents a slow local
 * backend from turning MV3 messages into an unbounded analysis queue.
 */
function handleFrame(message) {
  const session = sessions.get(message.sessionId);
  const state = frameStates.get(message.sessionId);
  if (!session || !state) {
    closeFrame(message);
    return;
  }
  if (!BSOProtocol.isFrameSample(message)) {
    closeFrame(message);
    void reportFrameStatus(session, 'fallback', 'Frame sample did not satisfy the runtime contract.', 'message-contract-rejected');
    return;
  }
  // A pending newer frame is already the session watermark; an older arrival
  // cannot be a timeline reset while that frame is waiting to run.
  if (state.busy && state.pending && message.mediaTime <= state.pending.mediaTime) {
    closeFrame(message);
    void reportFrameStatus(session, 'ready', 'Stale frame sample discarded.', 'stale-frame-dropped');
    return;
  }
  // A backwards media-time jump starts a new local timeline. The synchronizer
  // applies the same policy on the UI side; association state must not bridge
  // across the jump.
  if (state.watermark !== -Infinity && message.mediaTime < state.watermark) {
    state.watermark = -Infinity;
    if (typeof activeAnalyzer.resetSession === 'function') activeAnalyzer.resetSession(message.sessionId, 'media-time-reset');
  }
  if (message.mediaTime === state.watermark) {
    closeFrame(message);
    void reportFrameStatus(session, 'ready', 'Stale frame sample discarded.', 'stale-frame-dropped');
    return;
  }
  state.watermark = message.mediaTime;
  if (state.busy) {
    if (state.pending) closeFrame(state.pending);
    state.pending = message;
    void reportFrameStatus(session, 'ready', 'Local analyzer busy; keeping only the newest frame.', 'backpressure');
    return;
  }
  state.busy = true;
  void processFrame(message.sessionId, message).catch(async (error) => {
    await reportFrameStatus(session, 'fallback', 'Local analyzer failed; playback is unaffected.', error instanceof Error ? error.message : String(error));
  });
}

async function handleSessionEnd(message) {
  return enqueue(message.sessionId, async () => {
    const session = sessions.get(message.sessionId);
    // Wait for the active frame and its one coalesced successor before
    // acknowledging the end marker. Dropped pending frames are closed by the
    // frame scheduler, so navigation cannot leak ImageBitmaps.
    await waitForFrames(message.sessionId);
    sessions.delete(message.sessionId);
    frameStates.delete(message.sessionId);
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
  void Promise.resolve(handle(message)).catch(async (error) => {
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
