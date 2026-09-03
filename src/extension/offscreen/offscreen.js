/* global chrome, BSOProtocol, BSOFixtureAnalyzer, BSOMoveNetAdapter, BSOLiteOpenPoseAdapter, BSOBlazePoseTfjsAdapter, BSoPoseModelSelector, BSOShuttleTrackingAdapter, BSOOnnxInferenceAdapter */
'use strict';

const ANALYZER_FALLBACK = 'fixture-probe-v1';
let analyzerStatusSessionId = null;

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
 * The fixture remains available only to explicit Node plumbing diagnostics.
 * The public browser package selects the cleared local pose + shuttle
 * composition; no UI or capture code knows which analyzer is active. Stable
 * Chrome's serializable RGBA path is accepted by either analyzer.
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
        rally: { state: 'unknown', confidence: null, reason: 'rally-segmentation-not-available' },
        rallyEnd: { state: 'unknown', confidence: null, reason: 'rally-end-evidence-not-available' },
        winner: { state: 'unknown', confidence: null, reason: 'winner-evidence-not-available' },
        outcome: 'unclassified',
        shotFamily: 'unclassified',
        classificationConfidence: 0,
        geometryConfidence: 0,
        note: 'Compatibility seam only; no production CV model is bundled.'
      }
    });
  }
}

const ProductionAnalyzer = globalThis.BSOLiteOpenPoseAdapter &&
  globalThis.BSOLiteOpenPoseAdapter.LiteOpenPoseAnalyzer;
const MoveNetAnalyzer = globalThis.BSOMoveNetAdapter && globalThis.tf &&
  globalThis.BSOMoveNetAdapter.MoveNetMultiPoseLightningAnalyzer;
const FixtureAnalyzer = globalThis.BSOFixtureAnalyzer && globalThis.BSOFixtureAnalyzer.FixtureProbeAnalyzer;
const ShuttleAdapter = globalThis.BSOShuttleTrackingAdapter &&
  (globalThis.BSOShuttleTrackingAdapter.LocalShuttleTrajectoryAdapter ||
    globalThis.BSOShuttleTrackingAdapter.ShuttleTrajectoryAdapter);
const OnnxInferenceAnalyzer = globalThis.BSOOnnxInferenceAdapter &&
  globalThis.BSOOnnxInferenceAdapter.OnnxInferenceAnalyzer;
const onnxInferenceConfig = globalThis.BSO_ONNX_INFERENCE_CONFIG;
const onnxInferenceEnabled = Boolean(OnnxInferenceAnalyzer && onnxInferenceConfig &&
  (globalThis.BSO_ONNX_INFERENCE_ENABLED === true || onnxInferenceConfig.enabled === true));

function unknownEvidence(reason) {
  return { state: 'unknown', confidence: null, reason };
}

function racketEvidence(players) {
  const hands = [];
  for (const player of Array.isArray(players) ? players : []) {
    const keypoints = Array.isArray(player.keypoints) ? player.keypoints : [];
    for (const side of ['left', 'right']) {
      const wrist = keypoints.find((point) => point.name === `${side}_wrist` && point.confidence != null);
      const elbow = keypoints.find((point) => point.name === `${side}_elbow` && point.confidence != null);
      if (!wrist) continue;
      const wristConfidence = Number(wrist.confidence) || 0;
      const elbowConfidence = elbow ? Number(elbow.confidence) || 0 : wristConfidence;
      hands.push({
        trackId: player.trackId || null,
        side,
        wrist: { x: wrist.x, y: wrist.y },
        elbow: elbow ? { x: elbow.x, y: elbow.y } : null,
        confidence: Math.min(wristConfidence, elbowConfidence),
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
 * The public analyzer is a composition, not a fallback chain. Pose remains
 * the production capability and the local shuttle adapter contributes only
 * its accepted bounded candidate/trajectory. A pose/backend failure therefore
 * produces an honest unknown pose result with the same production identity;
 * it never switches to the fixture probe.
 */
class LocalPoseShuttleAnalyzer {
  constructor({ environment = globalThis, poseAnalyzer, shuttleAnalyzer, onStatus = () => {} } = {}) {
    const resolvedPose = poseAnalyzer || (ProductionAnalyzer ? new ProductionAnalyzer({ environment }) : null);
    if (!resolvedPose || typeof resolvedPose.analyze !== 'function') throw new TypeError('A production pose analyzer is required');
    this.shuttleAnalyzer = shuttleAnalyzer || (ShuttleAdapter ? new ShuttleAdapter({ environment }) : null);
    if (!this.shuttleAnalyzer || typeof this.shuttleAnalyzer.analyze !== 'function') throw new TypeError('A local shuttle analyzer is required');
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    // Forward backend and reset transitions without allowing status observers
    // to affect inference. The adapters retain their own resource ownership.
    if (Object.hasOwn(this.shuttleAnalyzer, 'onStatus')) this.shuttleAnalyzer.onStatus = (value) => this.status({ component: 'shuttle', ...value });
    this.lastMediaBySession = new Map();
    this.setPoseAnalyzer(resolvedPose);
  }

  /**
   * Swap the pose component of the composition (used when the user switches
   * pose models mid-session). The caller owns the previous analyzer's
   * lifecycle: the pose model switcher disposes it when the switch commits.
   */
  setPoseAnalyzer(nextPoseAnalyzer) {
    if (!nextPoseAnalyzer || typeof nextPoseAnalyzer.analyze !== 'function') throw new TypeError('A production pose analyzer is required');
    this.poseAnalyzer = nextPoseAnalyzer;
    if (Object.hasOwn(this.poseAnalyzer, 'onStatus')) this.poseAnalyzer.onStatus = (value) => this.status({ component: 'pose', ...value });
    this.identity = Object.freeze({
      ...(this.poseAnalyzer.identity || { id: 'lightweight-openpose-lite-256-v1', version: 1, kind: 'local-litert-tflite-multipose' }),
      composition: 'pose-plus-shuttle-v1',
      components: {
        pose: this.poseAnalyzer.identity || null,
        shuttle: this.shuttleAnalyzer.identity || null
      }
    });
    this.initialization = null;
    this.initializationState = null;
    this.capabilityDetails = {
      backend: this.poseAnalyzer.backend || null,
      fallbacks: Array.isArray(this.poseAnalyzer.backendReport?.fallbacks) ? this.poseAnalyzer.backendReport.fallbacks.slice() : [],
      shuttle: this.shuttleAnalyzer.identity?.id || 'local-shuttle-frame-difference-v1'
    };
    return this;
  }

  status(value) {
    try { this.onStatus(value); } catch (_) { /* status observers cannot break inference */ }
  }

  async initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      try {
        const initialized = typeof this.poseAnalyzer.initialize === 'function'
          ? await this.poseAnalyzer.initialize()
          : { available: true };
        const available = initialized?.available !== false;
        this.initializationState = { ...(initialized || {}), available };
        this.capabilityDetails = {
          backend: initialized?.backend || this.poseAnalyzer.backend || null,
          fallbacks: Array.from(new Set(initialized?.fallbacks || [])),
          shuttle: this.shuttleAnalyzer.identity?.id || 'local-shuttle-frame-difference-v1'
        };
        this.status({
          type: available ? 'composition-ready' : 'composition-pose-unavailable',
          pose: available,
          shuttle: this.capabilityDetails.shuttle,
          backend: this.capabilityDetails.backend,
          fallbacks: this.capabilityDetails.fallbacks,
          reason: initialized?.reason || ''
        });
        return {
          ...(initialized || {}), available, poseAvailable: available, shuttleAvailable: true,
          backend: this.capabilityDetails.backend, fallbacks: this.capabilityDetails.fallbacks
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.initializationState = { available: false, reason, fallbacks: ['local-pose-initialization-failed'] };
        this.capabilityDetails = { backend: null, fallbacks: this.initializationState.fallbacks, shuttle: this.shuttleAnalyzer.identity?.id || 'local-shuttle-frame-difference-v1' };
        this.status({ type: 'composition-pose-unavailable', pose: false, shuttle: this.capabilityDetails.shuttle, reason, fallbacks: this.capabilityDetails.fallbacks });
        return { available: false, poseAvailable: false, shuttleAvailable: true, reason, fallbacks: this.capabilityDetails.fallbacks };
      }
    })();
    return this.initialization;
  }

  resetSession(sessionId, reason = 'session-reset') {
    const id = sessionId == null ? null : String(sessionId);
    if (id !== null && typeof this.poseAnalyzer.resetSession === 'function') this.poseAnalyzer.resetSession(id, reason);
    if (id !== null && typeof this.shuttleAnalyzer.resetSession === 'function') this.shuttleAnalyzer.resetSession(id, reason);
    if (id !== null) this.lastMediaBySession.delete(id);
    return { sessionId: id, reason };
  }

  endSession(sessionId, reason = 'session-end') {
    const id = sessionId == null ? null : String(sessionId);
    if (id !== null && typeof this.poseAnalyzer.endSession === 'function') this.poseAnalyzer.endSession(id, reason);
    else if (id !== null && typeof this.poseAnalyzer.resetSession === 'function') this.poseAnalyzer.resetSession(id, reason);
    if (id !== null && typeof this.shuttleAnalyzer.endSession === 'function') this.shuttleAnalyzer.endSession(id, reason);
    else if (id !== null && typeof this.shuttleAnalyzer.resetSession === 'function') this.shuttleAnalyzer.resetSession(id, reason);
    if (id !== null) this.lastMediaBySession.delete(id);
    return { sessionId: id, reason };
  }

  unknownShuttle(reason) {
    return { state: 'unknown', confidence: null, candidate: null, candidates: [], trajectory: [], accepted: false, reason, evidence: {} };
  }

  async analyze(sample) {
    const sessionId = String(sample?.sessionId || 'unknown-session');
    const mediaTime = sample?.mediaTime;
    if (!Number.isFinite(mediaTime) || mediaTime < 0) return this.poseAnalyzer.analyze(sample);
    const previous = this.lastMediaBySession.get(sessionId);
    if (Number.isFinite(previous) && mediaTime < previous) this.resetSession(sessionId, 'media-time-reset');
    if (Number.isFinite(previous) && mediaTime === previous) return null;
    if (sample?.cameraCut) this.resetSession(sessionId, 'camera-cut');

    // Shuttle runs first so an automatically detected global cut resets pose
    // association before this frame can establish a new player identity.
    let shuttleEnvelope = null;
    try {
      shuttleEnvelope = await this.shuttleAnalyzer.analyze(sample);
    } catch (error) {
      this.status({ component: 'shuttle', type: 'shuttle-failure', reason: error instanceof Error ? error.message : String(error) });
    }
    const shuttle = shuttleEnvelope?.result?.shuttle || this.unknownShuttle('shuttle-result-unavailable');
    const cut = sample?.cameraCut === true || shuttle.reason === 'camera-cut';
    const poseSample = cut && !sample?.cameraCut ? { ...sample, cameraCut: true } : sample;
    let poseEnvelope;
    try {
      poseEnvelope = await this.poseAnalyzer.analyze(poseSample);
    } catch (error) {
      this.status({ component: 'pose', type: 'pose-failure', reason: error instanceof Error ? error.message : String(error) });
      poseEnvelope = null;
    }
    if (!poseEnvelope) return null;
    this.lastMediaBySession.set(sessionId, mediaTime);

    const poseResult = poseEnvelope.result || {};
    const tracking = poseResult.tracking || null;
    const players = Array.isArray(poseResult.players) ? poseResult.players : tracking?.players || [];
    const poseAvailable = Boolean(poseEnvelope.inferenceAvailable);
    const poseKind = typeof poseResult.kind === 'string' && poseResult.kind ? poseResult.kind : null;
    const analysis = {
      kind: poseKind && poseKind !== 'lightweight-openpose' ? `${poseKind}-pose-shuttle` : 'lightweight-openpose-pose-shuttle',
      composition: 'pose-plus-shuttle-v1',
      runtimeIntegrationTest: false,
      productionModel: poseAvailable && poseEnvelope.analyzerIdentity?.productionModel === true,
      state: tracking?.state || poseResult.state || 'unknown',
      poseState: tracking?.state || 'unknown',
      shuttleState: shuttle.state || 'unknown',
      cameraCut: cut,
      players,
      tracking,
      shuttle,
      racket: poseResult.racket || racketEvidence(players),
      temporal: {
        state: Array.isArray(shuttle.trajectory) && shuttle.trajectory.length ? 'partial' : 'unknown',
        trajectory: Array.isArray(shuttle.trajectory) ? shuttle.trajectory : [],
        reason: 'tracknet-post-processing-not-run-in-live-cycle'
      },
      // The current adapters do not classify hits or segment rallies. Keep
      // these fields explicit so downstream UI/export can edit them instead
      // of mistaking a candidate or pose box for a badminton event.
      strokeEvents: Array.isArray(poseResult.strokeEvents) ? poseResult.strokeEvents : [],
      shotFamily: poseResult.shotFamily || 'unclassified',
      classificationConfidence: Number.isFinite(poseResult.classificationConfidence) ? poseResult.classificationConfidence : 0,
      geometryConfidence: Number.isFinite(poseResult.geometryConfidence) ? poseResult.geometryConfidence : 0,
      rally: unknownEvidence('rally-segmentation-not-available'),
      rallyEnd: unknownEvidence('rally-end-evidence-not-available'),
      winner: unknownEvidence('winner-evidence-not-available'),
      outcome: 'unclassified',
      detector: this.identity,
      reason: poseResult.reason || (poseAvailable ? '' : 'local-pose-inference-unavailable'),
      evidence: {
        pose: { available: poseAvailable, analyzer: poseEnvelope.analyzer || this.identity.id },
        shuttle: shuttleEnvelope?.analyzerIdentity || this.shuttleAnalyzer.identity || null
      }
    };
    return BSOProtocol.createAnalyzerResult({
      sessionId,
      requestId: String(sample.requestId),
      mediaTime,
      status: poseEnvelope.status === 'fallback' || !poseAvailable ? 'fallback' : 'ok',
      analyzer: this.identity.id,
      analyzerIdentity: this.identity,
      inferenceAvailable: poseAvailable,
      result: analysis
    });
  }

  dispose() {
    if (typeof this.poseAnalyzer.dispose === 'function') this.poseAnalyzer.dispose();
    if (typeof this.shuttleAnalyzer.dispose === 'function') this.shuttleAnalyzer.dispose();
    this.lastMediaBySession.clear();
  }
}

// The pose model switcher owns the active pose analyzer when the production
// composition (cleared LiteRT pose + local shuttle) is selected. It lets the
// popup swap the pose model mid-session; the deterministic fixture and the
// explicit ONNX pipeline are separate selections and never route through it.
const poseModelSwitcher = Boolean(globalThis.BSoPoseModelSelector) && Boolean(ProductionAnalyzer) && Boolean(ShuttleAdapter) && !onnxInferenceEnabled
  ? (() => {
    try {
      return new globalThis.BSoPoseModelSelector.PoseModelSwitcher({
        initialModelId: globalThis.BSoPoseModelSelector.DEFAULT_MODEL,
        environment: globalThis,
        onModelChange: (result) => {
          // The preference is committed only when the model actually
          // activated; a failed switch never rewrites the stored choice.
          if (result && result.ok && typeof result.modelId === 'string') {
            persistPoseModelPreference(result.modelId);
          }
        },
        onStatus: (status) => {
          if (globalThis.BSOOffscreenLogger && typeof globalThis.BSOOffscreenLogger.debug === 'function') {
            globalThis.BSOOffscreenLogger.debug('pose-model-selector', status);
          }
        }
      });
    } catch (error) {
      if (globalThis.BSOOffscreenLogger && typeof globalThis.BSOOffscreenLogger.error === 'function') {
        globalThis.BSOOffscreenLogger.error('pose-model-selector-init', error instanceof Error ? error.message : String(error));
      }
      return null;
    }
  })()
  : null;

// The cleared local LiteRT analyzer is the only production selection. The
// deterministic fixture is selected only when the explicit diagnostics flag
// is present; it is never silently substituted after a model or backend
// failure, which keeps capability identity honest.
const diagnosticFixture = globalThis.BSO_DIAGNOSTIC_FIXTURE === true;
let activeAnalyzer = poseModelSwitcher && poseModelSwitcher.getCurrentModel().analyzer
  ? new LocalPoseShuttleAnalyzer({ environment: globalThis, poseAnalyzer: poseModelSwitcher.getCurrentModel().analyzer, onStatus: analyzerStatus })
  : onnxInferenceEnabled
    ? new OnnxInferenceAnalyzer({ environment: globalThis, inferenceConfig: onnxInferenceConfig, onStatus: analyzerStatus })
    : ProductionAnalyzer && ShuttleAdapter
      ? new LocalPoseShuttleAnalyzer({ environment: globalThis, onStatus: analyzerStatus })
      : ProductionAnalyzer
        ? new ProductionAnalyzer({ environment: globalThis })
        : diagnosticFixture && FixtureAnalyzer ? new FixtureAnalyzer() : new MockAnalyzer();

const sessions = new Map();
const sessionQueues = new Map();
const frameStates = new Map();

function analyzerStatus(value) {
  const session = analyzerStatusSessionId && sessions.get(analyzerStatusSessionId);
  // Per-frame shuttle observations are evidence on the result envelope, not
  // runtime capability transitions. Forwarding them as global status would
  // make a healthy pose backend appear to restart every sampled frame.
  if (!session || !value || value.component === 'shuttle') return;
  const isFailure = value.type === 'model-failure' || value.type === 'composition-pose-unavailable' ||
    value.type === 'inference-failure' || value.type === 'pose-failure';
  const isReady = value.type === 'model-ready' || value.type === 'composition-ready';
  const phase = isFailure ? 'fallback' : isReady ? 'ready' : 'starting';
  const details = activeAnalyzer.capabilityDetails || {};
  void send(BSOProtocol.createRuntimeStatus({
    sessionId: session.sessionId,
    phase,
    message: isFailure ? 'Local production inference unavailable; playback is unaffected.' :
      isReady ? 'Local pose and shuttle analyzers are ready.' :
        value.backend ? `Local backend ${value.backend} is being prepared.` : 'Local analyzer is initializing.',
    capabilities: capabilityState(session.capabilities, {
      inference: isReady && activeAnalyzer.initializationState?.available !== false,
      analyzer: isReady && activeAnalyzer.identity?.id ? activeAnalyzer.identity.id : isFailure ? 'none' : analyzerId(),
      backend: value.backend || details.backend || null,
      fallbacks: value.fallbacks || details.fallbacks || [],
      shuttle: details.shuttle || null
    }),
    reason: value.reason || (value.backend ? `backend-${value.backend}` : value.type || '')
  }));
}

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

function capabilityState(input = {}, {
  inference = input.capture !== 'unavailable',
  analyzer = analyzerId(),
  offscreen = true,
  backend = input.backend || null,
  fallbacks = input.fallbacks || [],
  shuttle = input.shuttle || null
} = {}) {
  return {
    capture: input.capture || 'unknown',
    transferableFrames: Boolean(input.transferableFrames),
    offscreen: Boolean(offscreen),
    inference: Boolean(inference),
    analyzer,
    backend,
    fallbacks: Array.isArray(fallbacks) ? fallbacks.slice() : [],
    shuttle,
    transport: 'mv3-runtime-messaging',
    frameTransport: input.frameTransport || 'unknown'
  };
}

// This narrow seam is intentionally the only place an inference backend needs
// to plug in. Capture and UI code never imports a model implementation.
globalThis.BSOOffscreenAnalyzer = Object.freeze({
  MockAnalyzer,
  FixtureProbeAnalyzer: FixtureAnalyzer,
  MoveNetMultiPoseLightningAnalyzer: MoveNetAnalyzer,
  LiteOpenPoseAnalyzer: ProductionAnalyzer,
  OnnxInferenceAnalyzer,
  LocalPoseShuttleAnalyzer,
  ShuttleTrajectoryAdapter: ShuttleAdapter,
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
  const details = activeAnalyzer.capabilityDetails || {};
  const inference = Boolean(result.inferenceAvailable);
  // Keep the attempted production analyzer in the result for provenance, but
  // report analyzer=none in capabilities when its model did not initialize.
  const state = capabilityState(inputCapabilities, {
    inference,
    analyzer: inference ? (result.analyzer || analyzerId()) : 'none',
    backend: details.backend || null,
    fallbacks: details.fallbacks || [],
    shuttle: details.shuttle || null
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
      starting: true,
      pending: null,
      watermark: -Infinity,
      generation: 0,
      waiters: []
    });
    const input = message.capabilities || {};
    analyzerStatusSessionId = message.sessionId;
    // The offscreen document can outlive sessions (Chrome closes and the
    // service worker recreates it), so the stored pose-model preference is
    // re-applied at every session start. An unavailable preference falls back
    // to the production default and the stored key converges to what runs.
    if (poseModelSwitcher && activeAnalyzer instanceof LocalPoseShuttleAnalyzer) {
      try {
        const storedModel = await readStoredPoseModelPreference();
        if (storedModel && storedModel !== poseModelSwitcher.getCurrentModel().id) {
          const committed = await commitPoseModelSwitch(storedModel);
          if (!committed.ok) persistPoseModelPreference(poseModelSwitcher.getCurrentModel().id);
        }
      } catch (_) {
        persistPoseModelPreference(poseModelSwitcher.getCurrentModel().id);
      }
    }
    let initialized;
    try {
      initialized = typeof activeAnalyzer.initialize === 'function'
        ? await activeAnalyzer.initialize()
        : { available: true, fallbacks: ['runtime-integration-probe-not-production-cv'], reason: 'runtime-integration-probe' };
    } catch (error) {
      initialized = {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
        fallbacks: ['local-analyzer-initialization-failed']
      };
    } finally {
      if (analyzerStatusSessionId === message.sessionId) analyzerStatusSessionId = null;
    }
    activeAnalyzer.initializationState = initialized || { available: false, reason: 'analyzer-initialization-returned-no-state' };
    const inference = input.capture !== 'unavailable' && initialized.available !== false;
    const fallbacks = (initialized.fallbacks || []).slice();
    if (activeAnalyzer.identity?.runtimeIntegrationTest) fallbacks.push('runtime-integration-probe-not-production-cv');
    if (input.capture === 'unavailable') fallbacks.push('capture-unavailable');
    const reason = inference
      ? (activeAnalyzer.identity?.runtimeIntegrationTest
        ? 'A deterministic local fixture is active; production CV is not bundled.'
        : activeAnalyzer.identity?.productionModel
          ? 'Cleared local Lightweight OpenPose inference is active.'
          : 'Local analyzer is active.')
      : initialized.reason || (input.capture === 'unavailable'
        ? 'Frame capture is unavailable; production inference did not run.'
        : 'Local production inference is unavailable; playback is unaffected.');
    await send(BSOProtocol.createCapabilityReport({
      sessionId: message.sessionId,
      capture: input.capture || 'unknown',
      transferableFrames: Boolean(input.transferableFrames),
      offscreen: true,
      inference,
      analyzer: inference ? analyzerId() : 'none',
      frameTransport: input.frameTransport || 'unknown',
      backend: initialized.backend || activeAnalyzer.capabilityDetails?.backend || null,
      components: activeAnalyzer.identity?.components || null,
      fallbacks: Array.from(new Set(fallbacks.concat(activeAnalyzer.capabilityDetails?.fallbacks || []))),
      reason
    }));
    await send(BSOProtocol.createRuntimeStatus({
      sessionId: message.sessionId,
      phase: inference ? 'ready' : 'fallback',
      message: inference ? (activeAnalyzer.identity?.runtimeIntegrationTest
        ? 'Local runtime integration probe ready; not production CV.'
        : activeAnalyzer.identity?.productionModel
          ? 'Local Lightweight OpenPose pose + shuttle analyzers ready.'
          : 'Local analyzer ready.') : 'Local inference unavailable; playback is unaffected.',
      capabilities: capabilityState(input, {
        inference,
        analyzer: inference ? analyzerId() : 'none',
        backend: initialized.backend || activeAnalyzer.capabilityDetails?.backend || null,
        fallbacks: Array.from(new Set(fallbacks.concat(activeAnalyzer.capabilityDetails?.fallbacks || []))),
        shuttle: activeAnalyzer.capabilityDetails?.shuttle || null
      }),
      reason
    }));
    releaseSessionStart(message.sessionId);
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
    capabilities: capabilityState(session.capabilities, {
      inference: phase !== 'fallback' && activeAnalyzer.initializationState?.available !== false,
      analyzer: phase === 'fallback' || activeAnalyzer.initializationState?.available === false ? 'none' : analyzerId(),
      backend: activeAnalyzer.capabilityDetails?.backend || null,
      fallbacks: activeAnalyzer.capabilityDetails?.fallbacks || [],
      shuttle: activeAnalyzer.capabilityDetails?.shuttle || null
    }),
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
    void processFrame(sessionId, next, state.generation).catch(async (error) => {
      const session = sessions.get(sessionId);
      if (session) await reportFrameStatus(session, 'fallback', 'Local analyzer failed; playback is unaffected.', error instanceof Error ? error.message : String(error));
    });
    return;
  }
  state.busy = false;
  const waiters = state.waiters.splice(0);
  waiters.forEach((resolve) => resolve());
}

function releaseSessionStart(sessionId) {
  const state = frameStates.get(sessionId);
  if (!state) return;
  state.starting = false;
  if (!state.pending) {
    const waiters = state.waiters.splice(0);
    waiters.forEach((resolve) => resolve());
    return;
  }
  const pending = state.pending;
  state.pending = null;
  state.busy = true;
  void processFrame(sessionId, pending, state.generation).catch(async (error) => {
    const session = sessions.get(sessionId);
    if (session) await reportFrameStatus(session, 'fallback', 'Local analyzer failed; playback is unaffected.', error instanceof Error ? error.message : String(error));
  });
}

async function processFrame(sessionId, message, generation = frameStates.get(sessionId)?.generation || 0) {
  const session = sessions.get(sessionId);
  const state = frameStates.get(sessionId);
  if (!session || !state) {
    closeFrame(message);
    if (state) finishFrame(sessionId);
    return;
  }
  try {
    const result = await activeAnalyzer.analyze(message);
    // A backward media-time jump/camera cut may arrive while inference is
    // running. Discard that old result and reset once more after inference so
    // late model completion cannot repopulate the new timeline's tracks.
    if (state.generation !== generation) {
      if (typeof activeAnalyzer.resetSession === 'function') activeAnalyzer.resetSession(sessionId, 'timeline-generation-changed');
      return;
    }
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
  // A backwards media-time jump or explicit camera cut starts a new local
  // timeline. Drop any pending old-timeline frame before applying the stale
  // gate, and use a generation so an active inference cannot leak across it.
  const timelineReset = message.cameraCut === true || (state.watermark !== -Infinity && message.mediaTime < state.watermark);
  if (timelineReset) {
    if (state.pending) closeFrame(state.pending);
    state.pending = null;
    state.watermark = -Infinity;
    state.generation += 1;
    if (typeof activeAnalyzer.resetSession === 'function') activeAnalyzer.resetSession(message.sessionId, message.cameraCut === true ? 'camera-cut' : 'media-time-reset');
  }
  // A pending newer frame is already the session watermark; an older arrival
  // cannot replace it after the reset check above.
  if (state.busy && state.pending && message.mediaTime <= state.pending.mediaTime) {
    closeFrame(message);
    void reportFrameStatus(session, 'ready', 'Stale frame sample discarded.', 'stale-frame-dropped');
    return;
  }
  if (message.mediaTime === state.watermark) {
    closeFrame(message);
    void reportFrameStatus(session, 'ready', 'Stale frame sample discarded.', 'stale-frame-dropped');
    return;
  }
  state.watermark = message.mediaTime;
  if (state.starting) {
    if (state.pending) closeFrame(state.pending);
    state.pending = message;
    return;
  }
  if (state.busy) {
    if (state.pending) closeFrame(state.pending);
    state.pending = message;
    void reportFrameStatus(session, 'ready', 'Local analyzer busy; keeping only the newest frame.', 'backpressure');
    return;
  }
  state.busy = true;
  void processFrame(message.sessionId, message, state.generation).catch(async (error) => {
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
    if (typeof activeAnalyzer.endSession === 'function') activeAnalyzer.endSession(message.sessionId, 'session-end');
    else if (typeof activeAnalyzer.resetSession === 'function') activeAnalyzer.resetSession(message.sessionId, 'session-end');
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

function persistPoseModelPreference(modelId) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local ||
      typeof chrome.storage.local.set !== 'function') return;
  try {
    chrome.storage.local.set({ bvSelectedPoseModel: String(modelId) });
  } catch (_) { /* preference persistence must never break inference */ }
}

function readStoredPoseModelPreference() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local ||
        typeof chrome.storage.local.get !== 'function') {
      resolve(null);
      return;
    }
    try {
      chrome.storage.local.get('bvSelectedPoseModel', (result) => {
        const stored = result && typeof result.bvSelectedPoseModel === 'string' ? result.bvSelectedPoseModel : null;
        resolve(stored || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function isPoseSwitchingComposition() {
  return Boolean(poseModelSwitcher) && activeAnalyzer instanceof LocalPoseShuttleAnalyzer &&
    typeof activeAnalyzer.setPoseAnalyzer === 'function';
}

async function waitForFrameIdle() {
  const sessionIds = Array.from(frameStates.keys());
  for (const sessionId of sessionIds) {
    await waitForFrames(sessionId);
  }
}

function announcePoseModelChange(modelId) {
  const identity = activeAnalyzer.identity || {};
  const details = activeAnalyzer.capabilityDetails || {};
  const ready = activeAnalyzer.initializationState?.available !== false;
  for (const [sessionId] of sessions) {
    const session = sessions.get(sessionId);
    if (!session) continue;
    void send(BSOProtocol.createRuntimeStatus({
      sessionId,
      phase: ready ? 'ready' : 'fallback',
      message: ready ? `Local pose model is now ${identity.model || modelId}.` : 'The selected pose model could not start; playback is unaffected.',
      capabilities: capabilityState(session.capabilities, {
        inference: ready,
        analyzer: ready ? identity.id || modelId : 'none',
        backend: details.backend || null,
        fallbacks: details.fallbacks || [],
        shuttle: details.shuttle || null
      }),
      reason: 'pose-model-switched'
    }));
  }
}

/**
 * Activate a pose model on the live composition. The target model is probed
 * and initialized before the active analyzer is touched, so an unavailable
 * model (missing TensorFlow.js, missing local artifact, backend failure)
 * leaves the current model serving frames and reports ok:false.
 */
async function commitPoseModelSwitch(modelId) {
  if (!poseModelSwitcher) {
    return { ok: false, reason: 'pose-model-selector-unavailable' };
  }
  if (!isPoseSwitchingComposition()) {
    return { ok: false, reason: 'pose-model-switching-unavailable-in-current-mode' };
  }
  if (poseModelSwitcher.getCurrentModel().id === modelId) {
    return { ok: true, modelId, message: 'Model already active', changed: false };
  }
  const probe = await poseModelSwitcher.probeModelAvailability(modelId);
  if (!probe.available) {
    return { ok: false, modelId, reason: probe.reason, changed: false };
  }
  // Prepare and initialize the target while the current analyzer keeps
  // serving frames; then wait for idle sessions so the synchronous commit
  // never disposes an analyzer that is still running a frame.
  const prepared = await poseModelSwitcher.prepareModel(modelId);
  if (!prepared.ok) {
    return { ok: false, modelId, reason: prepared.reason, changed: false };
  }
  if (prepared.alreadyActive) {
    return { ok: true, modelId, message: 'Model already active', changed: false };
  }
  await waitForFrameIdle();
  const committed = poseModelSwitcher.commitModel(modelId, prepared.prepared);
  if (committed.ok && activeAnalyzer instanceof LocalPoseShuttleAnalyzer) {
    activeAnalyzer.setPoseAnalyzer(poseModelSwitcher.getCurrentModel().analyzer);
    announcePoseModelChange(modelId);
  } else if (!committed.ok && prepared.prepared && typeof prepared.prepared.dispose === 'function') {
    prepared.prepared.dispose();
  }
  return committed;
}

function handleModelSwitch(message) {
  const modelId = typeof message?.modelId === 'string' ? message.modelId.trim() : '';
  if (!modelId) {
    return Promise.resolve({ ok: false, reason: 'no-model-id-specified' });
  }
  return commitPoseModelSwitch(modelId);
}

async function handleGetAvailableModels(message) {
  if (!poseModelSwitcher || !globalThis.BSoPoseModelSelector) {
    return { ok: false, models: [], reason: 'pose-model-selector-unavailable' };
  }
  const selector = globalThis.BSoPoseModelSelector;
  const models = [];
  for (const modelId of Object.keys(selector.AVAILABLE_MODELS || {})) {
    const probe = await poseModelSwitcher.probeModelAvailability(modelId);
    models.push({
      id: modelId,
      label: selector.AVAILABLE_MODELS[modelId].label,
      available: probe.available,
      reason: probe.available ? '' : probe.reason,
      current: poseModelSwitcher.getCurrentModel().id === modelId
    });
  }
  return { ok: true, models, currentModel: poseModelSwitcher.getCurrentModel().id };
}

/**
 * Handle Hough line detection for court calibration guidance.
 * Detects court lines in a frame and returns their coordinates.
 */
async function handleHoughDetection(message) {
  if (!globalThis.BSOHoughCourtLinesAdapter) {
    return { ok: false, lines: [], reason: 'hough-adapter-unavailable' };
  }

  try {
    const { frameData, width, height } = message;
    if (!frameData || !width || !height) {
      return { ok: false, lines: [], reason: 'invalid-frame-data' };
    }

    // Convert frameData back to ImageData if needed
    let frame;
    if (frameData instanceof ImageData) {
      frame = frameData;
    } else if (frameData.data && frameData.width && frameData.height) {
      frame = frameData;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      // If frameData is a bitmap or raw data, create a canvas and draw it
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return { ok: false, lines: [], reason: 'canvas-context-unavailable' };
      }
      // Assume frameData is a bitmap
      ctx.drawImage(frameData, 0, 0);
      frame = ctx.getImageData(0, 0, width, height);
    } else {
      return { ok: false, lines: [], reason: 'unsupported-frame-format' };
    }

    const result = await globalThis.BSOHoughCourtLinesAdapter.detectCourtLines(frame);
    return {
      ok: true,
      lines: result.lines || [],
      config: result.config
    };
  } catch (error) {
    console.error('Hough detection error:', error);
    return {
      ok: false,
      lines: [],
      reason: error instanceof Error ? error.message : 'hough-detection-failed'
    };
  }
}

function handle(message) {
  if (message.type === BSOProtocol.TYPES.SESSION_START) return handleSessionStart(message);
  if (message.type === BSOProtocol.TYPES.SESSION_END) return handleSessionEnd(message);
  if (message.type === BSOProtocol.TYPES.FRAME_SAMPLE) return handleFrame(message);
  // Handle custom model switching messages (non-protocol messages)
  if (message.action === 'switchPoseModel') return handleModelSwitch(message);
  if (message.action === 'getAvailablePoseModels') return handleGetAvailableModels(message);
  return Promise.resolve();
}

if (typeof chrome !== 'object' || !chrome.runtime || !chrome.runtime.onMessage ||
    typeof chrome.runtime.onMessage.addListener !== 'function') {
  // The analyzer module can also be opened as a local diagnostics page; an
  // MV3 offscreen context is required for message handling.
} else {
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle Hough line detection for calibration
  if (message && message.action === 'detectHoughLines') {
    Promise.resolve(handleHoughDetection(message)).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ ok: false, lines: [], reason: error instanceof Error ? error.message : String(error) });
    });
    return true; // Keep the channel open for async response
  }
  // Handle custom model switching messages (before protocol check)
  if (message && message.action === 'switchPoseModel') {
    Promise.resolve(handleModelSwitch(message)).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    });
    return true; // Keep the channel open for async response
  }
  if (message && message.action === 'getAvailablePoseModels') {
    Promise.resolve(handleGetAvailableModels(message)).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ ok: false, models: [], reason: error instanceof Error ? error.message : String(error) });
    });
    return true; // Keep the channel open for async response
  }

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
