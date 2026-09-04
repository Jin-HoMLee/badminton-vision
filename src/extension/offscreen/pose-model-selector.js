/* global globalThis, BSOProtocol, BSOLiteOpenPoseAdapter, BSOMoveNetAdapter, BSOBlazePoseTfjsAdapter */
(function installPoseModelSelector(root, factory) {
  const api = factory(root.BSOProtocol, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSoPoseModelSelector = api;
}(typeof globalThis === 'object' ? globalThis : self, function poseModelSelectorFactory(protocol, defaultEnvironment) {
  'use strict';

  /**
   * Available pose models. The production model is LiteOpenPose (cleared for
   * redistribution and bundled). MoveNet and BlazePose are additional options
   * whose TensorFlow.js graph checkpoints are not bundled (see the artifact
   * release gates in docs/runtime.md); their adapters report the models as
   * unavailable until cleared, licensed artifacts are vendored locally.
   */
  const AVAILABLE_MODELS = Object.freeze({
    'lightweight-openpose-lite-256-v1': {
      id: 'lightweight-openpose-lite-256-v1',
      label: 'Lightweight OpenPose (Production)',
      description: 'Fast, lightweight. Best for real-time analysis.',
      adapterKey: 'LiteOpenPoseAdapter',
      analyzerClass: 'LiteOpenPoseAnalyzer',
      licenseStatus: 'cleared-for-redistribution',
      runtimeKind: 'litert',
      isProduction: true
    },
    'movenet-multipose-lightning-v1': {
      id: 'movenet-multipose-lightning-v1',
      label: 'MoveNet MultiPose Lightning',
      description: 'Multi-person pose detection. Good accuracy and speed.',
      adapterKey: 'MoveNetAdapter',
      analyzerClass: 'MoveNetMultiPoseLightningAnalyzer',
      licenseStatus: 'not-cleared-for-redistribution',
      runtimeKind: 'tensorflowjs',
      isProduction: false
    },
    'blazepose-tfjs-heavy-v1': {
      id: 'blazepose-tfjs-heavy-v1',
      label: 'BlazePose Heavy',
      description: 'High-accuracy single person pose. Best for detailed footwork.',
      adapterKey: 'BlazePoseTfjsAdapter',
      analyzerClass: 'BlazePoseAnalyzer',
      licenseStatus: 'cleared-for-redistribution',
      runtimeKind: 'tensorflowjs',
      isProduction: false
    }
  });

  const DEFAULT_MODEL = 'lightweight-openpose-lite-256-v1';

  /**
   * Each adapter installs one analyzer namespace under a distinct global key.
   * The keys are deliberately unique per adapter module so the TF.js adapters
   * loaded by the offscreen document cannot shadow (or be shadowed by) the
   * ml-pipeline ONNX adapters in the same document.
   */
  const ADAPTER_GLOBALS = Object.freeze({
    LiteOpenPoseAdapter: { globalKey: 'BSOLiteOpenPoseAdapter', analyzerNames: ['LiteOpenPoseAnalyzer', 'LiteRTAnalyzer'] },
    MoveNetAdapter: { globalKey: 'BSOMoveNetAdapter', analyzerNames: ['MoveNetMultiPoseLightningAnalyzer', 'MoveNetAnalyzer'] },
    BlazePoseTfjsAdapter: { globalKey: 'BSOBlazePoseTfjsAdapter', analyzerNames: ['BlazePoseAnalyzer', 'BlazePose'] }
  });

  function environmentFor(environment) {
    return environment || defaultEnvironment || globalThis;
  }

  function modelConfig(modelId) {
    return AVAILABLE_MODELS[modelId] || null;
  }

  /**
   * Resolve the analyzer namespace and constructor for a model id.
   * Returns null when the model id is unknown or its adapter is not loaded.
   */
  function adapterBinding(modelId, environment = defaultEnvironment) {
    const config = modelConfig(modelId);
    if (!config) return null;
    const binding = ADAPTER_GLOBALS[config.adapterKey];
    if (!binding) return null;
    const env = environmentFor(environment);
    const adapter = env[binding.globalKey];
    if (!adapter) return null;
    for (const name of binding.analyzerNames) {
      if (typeof adapter[name] === 'function') {
        return { config, adapter, AnalyzerClass: adapter[name], binding };
      }
    }
    return null;
  }

  /**
   * Get the pose analyzer class for a given model ID.
   * Returns a constructor that can be instantiated with { environment, ... }
   */
  function getPoseAnalyzerClass(modelId, environment = defaultEnvironment) {
    const binding = adapterBinding(modelId, environment);
    return binding ? binding.AnalyzerClass : null;
  }

  function liteRuntimeLoaded(environment) {
    const env = environmentFor(environment);
    return Boolean(env.BSOLiteRuntimeReady);
  }

  function tensorFlowJsLoaded(environment) {
    const env = environmentFor(environment);
    return Boolean(env.tf);
  }

  function runtimeAvailableFor(config, environment) {
    if (config.runtimeKind === 'litert') {
      return liteRuntimeLoaded(environment)
        ? { available: true, reason: '' }
        : { available: false, reason: 'litert-runtime-unavailable' };
    }
    return tensorFlowJsLoaded(environment)
      ? { available: true, reason: '' }
      : { available: false, reason: 'tensorflowjs-not-loaded' };
  }

  function localArtifactUrl(modelId, environment = defaultEnvironment) {
    const binding = adapterBinding(modelId, environment);
    if (!binding || !binding.adapter.MODEL || typeof binding.adapter.MODEL.modelUrl !== 'string') return null;
    return binding.adapter.MODEL.modelUrl;
  }

  function resolveLocalArtifactUrl(url, environment = defaultEnvironment) {
    const env = environmentFor(environment);
    const href = env.location?.href;
    if (!href || typeof URL !== 'function') return String(url);
    const resolved = new URL(url, href);
    if (resolved.protocol !== 'chrome-extension:' && resolved.protocol !== 'file:' &&
        resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      throw new TypeError('pose model artifact URL resolved outside the extension package');
    }
    return resolved.toString();
  }

  /**
   * Probe whether a model can actually run in this document: its analyzer
   * namespace must be loaded, its runtime (LiteRT loader or TensorFlow.js)
   * must be present, and for graph-model checkpoints the local model.json
   * artifact must be reachable. This is the honest availability signal for
   * UI lists: adapter-class presence alone never marks a model usable.
   */
  async function probePoseModelAvailability(modelId, environment = defaultEnvironment) {
    const binding = adapterBinding(modelId, environment);
    if (!binding) {
      return { modelId, available: false, reason: 'pose-analyzer-not-loaded' };
    }
    const env = environmentFor(environment);
    const runtime = runtimeAvailableFor(binding.config, env);
    if (!runtime.available) return { modelId, available: false, reason: runtime.reason };
    if (binding.config.runtimeKind === 'litert') {
      // The LiteRT loader and the cleared tflite artifact ship together in the
      // offscreen package; full readiness is verified by initialize().
      return { modelId, available: true, reason: '' };
    }
    const artifactUrl = localArtifactUrl(modelId, env);
    if (!artifactUrl) return { modelId, available: false, reason: 'pose-model-artifact-url-unavailable' };
    const fetchFn = env.fetch || defaultEnvironment.fetch;
    if (typeof fetchFn !== 'function') return { modelId, available: false, reason: 'pose-model-artifact-probe-unavailable' };
    let resolved;
    try {
      resolved = resolveLocalArtifactUrl(artifactUrl, env);
    } catch (_) {
      return { modelId, available: false, reason: 'pose-model-artifact-url-invalid' };
    }
    // For remote URLs (TensorFlow Hub), skip fetch test and assume available if runtime is ready
    if (/^https?:/i.test(artifactUrl)) {
      return { modelId, available: true, reason: '' };
    }
    try {
      const response = await fetchFn(resolved, { method: 'GET', cache: 'force-cache' });
      if (response && (response.ok === true || response.status === 200 || response.status === 0)) {
        return { modelId, available: true, reason: '' };
      }
      return { modelId, available: false, reason: 'pose-model-artifacts-not-bundled' };
    } catch (_) {
      return { modelId, available: false, reason: 'pose-model-artifacts-not-bundled' };
    }
  }

  /**
   * Get available models with their status. A model is usable only when its
   * adapter is loaded and its runtime prerequisites are present; artifact
   * presence is verified by the async probePoseModelAvailability().
   */
  function getAvailableModels(environment = defaultEnvironment) {
    const models = [];
    for (const [modelId, config] of Object.entries(AVAILABLE_MODELS)) {
      const analyzerClass = getPoseAnalyzerClass(modelId, environment);
      const runtime = runtimeAvailableFor(config, environment);
      models.push({
        ...config,
        available: Boolean(analyzerClass) && runtime.available,
        reason: !analyzerClass ? 'pose-analyzer-not-loaded' : runtime.reason
      });
    }
    return models;
  }

  /**
   * Create a pose analyzer instance for the given model.
   * If the model is not available, throws.
   */
  function createPoseAnalyzer(modelId, options = {}) {
    const binding = adapterBinding(modelId, options.environment);
    if (!binding) {
      throw new Error(`Pose analyzer for model ${modelId} is not loaded`);
    }
    const AnalyzerClass = binding.AnalyzerClass;
    return new AnalyzerClass(options);
  }

  /**
   * Validate that exactly 2 players are detected and assign stable IDs.
   * Returns { isValid, players: [{ trackId, keypoints, ... }], reason? }
   */
  function validateAndAssignPlayerIds(observations, lastPlayerPositions = new Map()) {
    if (!Array.isArray(observations)) {
      return { isValid: false, players: [], reason: 'observations-not-array' };
    }

    // Filter for high-confidence poses only (exclude partial/unknown)
    const validPoses = observations.filter((obs) => {
      return obs && obs.state === 'tracked' && obs.keypoints && Array.isArray(obs.keypoints);
    });

    // For singles badminton, we need exactly 2 players
    if (validPoses.length !== 2) {
      return {
        isValid: false,
        players: validPoses,
        reason: validPoses.length === 0 ? 'no-poses-detected' :
                validPoses.length === 1 ? 'only-one-player-detected' :
                validPoses.length > 2 ? `too-many-players-detected-${validPoses.length}` :
                'unexpected-observation-count'
      };
    }

    // Assign player IDs based on position (top = player 1, bottom = player 2)
    // or based on continuity with previous positions
    const players = [];
    const poses = validPoses.map((pose, index) => {
      const bbox = pose.bbox || {};
      const centerY = (bbox.y || 0) + (bbox.height || 0) / 2;
      return { pose, index, centerY };
    }).sort((a, b) => a.centerY - b.centerY);

    // Player 1 is at the top of the frame, Player 2 is at the bottom
    for (let i = 0; i < poses.length; i += 1) {
      const poseData = poses[i];
      const trackId = i === 0 ? 1 : 2; // Player IDs are 1 and 2
      players.push({
        trackId,
        index: poseData.index,
        observationId: poseData.pose.observationId,
        keypoints: poseData.pose.keypoints,
        bbox: poseData.pose.bbox,
        confidence: poseData.pose.confidence,
        state: poseData.pose.state,
        detector: poseData.pose.detector
      });
    }

    return { isValid: true, players, reason: null };
  }

  /**
   * PoseModelSwitcher owns the active pose analyzer instance. activateModel()
   * prepares and initializes the target model before it commits, so a model
   * whose runtime or local artifact is missing never displaces the analyzer
   * that is currently serving frames.
   */
  class PoseModelSwitcher {
    constructor({
      initialModelId = DEFAULT_MODEL,
      environment = defaultEnvironment,
      onModelChange = () => {},
      onStatus = () => {}
    } = {}) {
      this.environment = environmentFor(environment);
      this.onModelChange = typeof onModelChange === 'function' ? onModelChange : () => {};
      this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
      this.currentAnalyzer = null;
      this.modelId = initialModelId;
      this.lastPlayerPositions = new Map();

      try {
        if (!AVAILABLE_MODELS[initialModelId]) throw new Error(`Unknown pose model: ${initialModelId}`);
        this.currentAnalyzer = this._createAnalyzer(initialModelId);
        this.identity = this.currentAnalyzer?.identity || {
          id: initialModelId,
          kind: 'pose-model-switcher',
          version: 1
        };
      } catch (error) {
        this.currentAnalyzer = null;
        this.modelId = DEFAULT_MODEL;
        this.identity = {
          id: 'pose-model-unavailable',
          kind: 'pose-model-switcher',
          version: 1,
          reason: error instanceof Error ? error.message : String(error)
        };
      }
    }

    _createAnalyzer(modelId) {
      return createPoseAnalyzer(modelId, {
        environment: this.environment,
        onStatus: (value) => this.onStatus({ model: modelId, ...value })
      });
    }

    _activate(next, modelId) {
      const previous = this.currentAnalyzer;
      if (previous && typeof previous.dispose === 'function') previous.dispose();
      this.currentAnalyzer = next;
      this.modelId = modelId;
      this.identity = this.currentAnalyzer?.identity || {
        id: this.modelId,
        kind: 'pose-model-switcher',
        version: 1
      };
      this.lastPlayerPositions.clear();
      this.onModelChange({ modelId, ok: true });
      this.onStatus({ type: 'model-switched', modelId });
    }

    /**
     * Prepare a target model without touching the active analyzer: the target
     * is created and initialized while the current model keeps serving
     * frames. Returns { ok, prepared } where `prepared` is the initialized
     * analyzer ready for commitModel(). Callers that never commit must
     * dispose the prepared analyzer themselves.
     */
    async prepareModel(modelId) {
      if (!AVAILABLE_MODELS[modelId]) {
        const reason = `Unknown model: ${modelId}`;
        this.onModelChange({ modelId, ok: false, reason });
        return { ok: false, modelId, reason, prepared: null, alreadyActive: false };
      }
      if (modelId === this.modelId && this.currentAnalyzer) {
        return { ok: true, modelId, prepared: null, alreadyActive: true, message: 'Model already active' };
      }
      let prepared = null;
      try {
        const AnalyzerClass = getPoseAnalyzerClass(modelId, this.environment);
        if (!AnalyzerClass) {
          const reason = `Model ${modelId} is not loaded in this environment`;
          this.onModelChange({ modelId, ok: false, reason });
          return { ok: false, modelId, reason, prepared: null, alreadyActive: false };
        }
        prepared = this._createAnalyzer(modelId);
        const initialized = await prepared.initialize();
        if (!initialized || initialized.available !== true) {
          const reason = (initialized && initialized.reason) || 'pose-model-initialization-failed';
          if (prepared && typeof prepared.dispose === 'function') prepared.dispose();
          this.onModelChange({ modelId, ok: false, reason });
          return {
            ok: false,
            modelId,
            reason,
            fallbacks: initialized && Array.isArray(initialized.fallbacks) ? initialized.fallbacks.slice() : [],
            prepared: null,
            alreadyActive: false
          };
        }
        return { ok: true, modelId, prepared, alreadyActive: false };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (prepared && typeof prepared.dispose === 'function') prepared.dispose();
        this.onModelChange({ modelId, ok: false, reason });
        return { ok: false, modelId, reason, prepared: null, alreadyActive: false };
      }
    }

    /**
     * Commit a prepared analyzer as the active model. Synchronous: callers
     * must ensure no frame is running on the previous analyzer (the offscreen
     * scheduler waits for idle sessions before committing).
     */
    commitModel(modelId, prepared) {
      if (!prepared || typeof prepared.analyze !== 'function') {
        const reason = 'pose-model-not-prepared';
        this.onModelChange({ modelId, ok: false, reason });
        return { ok: false, modelId, reason, changed: false };
      }
      this._activate(prepared, modelId);
      return {
        ok: true,
        modelId,
        message: `Switched to ${AVAILABLE_MODELS[modelId]?.label || modelId}`,
        changed: true
      };
    }

    /**
     * Switch to a different pose detection model. The target analyzer is
     * created and initialized first; the currently active analyzer is
     * disposed only after the target reports itself available. A failed
     * initialization leaves the active model untouched. Use prepareModel() +
     * commitModel() when frames may be running concurrently so the dispose
     * can wait for idle sessions.
     */
    async activateModel(modelId) {
      const preparedResult = await this.prepareModel(modelId);
      if (preparedResult.alreadyActive) {
        return { ok: true, modelId, message: 'Model already active', changed: false };
      }
      if (!preparedResult.ok || !preparedResult.prepared) {
        return { ok: false, modelId, reason: preparedResult.reason, fallbacks: preparedResult.fallbacks, changed: false };
      }
      return this.commitModel(modelId, preparedResult.prepared);
    }

    /**
     * Synchronous compatibility alias kept for callers that manage analyzer
     * initialization themselves; it swaps in the target immediately.
     */
    switchModel(modelId) {
      if (modelId === this.modelId && this.currentAnalyzer) {
        return { ok: true, modelId, message: 'Model already active' };
      }
      if (!AVAILABLE_MODELS[modelId]) {
        return { ok: false, modelId, reason: `Unknown model: ${modelId}` };
      }
      try {
        const next = this._createAnalyzer(modelId);
        this._activate(next, modelId);
        return { ok: true, modelId, message: `Switched to ${AVAILABLE_MODELS[modelId]?.label || modelId}` };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.onModelChange({ modelId, ok: false, reason });
        return { ok: false, modelId, reason };
      }
    }

    /**
     * Analyze a frame with the current pose model and filter for exactly 2 players.
     */
    async analyze(sample) {
      if (!this.currentAnalyzer) {
        return {
          schema: 'bso.player-tracking.result.v1',
          version: 1,
          sessionId: sample?.sessionId || 'unknown-session',
          requestId: sample?.requestId || 'unknown-request',
          mediaTime: sample?.mediaTime || 0,
          state: 'unknown',
          players: [],
          observations: [],
          reason: 'no-pose-analyzer-available'
        };
      }

      try {
        const result = await this.currentAnalyzer.analyze(sample);

        // If the analyzer returned null (stale result, backpressure, etc.), return null
        if (result === null) {
          return null;
        }

        // Extract observations from the result
        // The result structure depends on the analyzer type
        const observations = this._extractObservations(result);

        // Validate and assign player IDs
        const validation = validateAndAssignPlayerIds(observations, this.lastPlayerPositions);

        // Return the result with validated players
        if (!validation.isValid) {
          this.onStatus({
            type: 'player-validation-failed',
            reason: validation.reason,
            observationCount: observations.length
          });
        }

        return {
          ...result,
          result: {
            ...(result.result || {}),
            players: validation.players,
            validationState: validation.isValid ? 'valid' : 'invalid',
            validationReason: validation.reason
          }
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.onStatus({ type: 'analysis-error', reason, modelId: this.modelId });
        return {
          schema: 'bso.player-tracking.result.v1',
          version: 1,
          sessionId: sample?.sessionId || 'unknown-session',
          requestId: sample?.requestId || 'unknown-request',
          mediaTime: sample?.mediaTime || 0,
          state: 'unknown',
          players: [],
          observations: [],
          reason
        };
      }
    }

    _extractObservations(result) {
      // Different analyzers structure results differently
      // LiteOpenPoseAdapter returns observations directly in tracking
      // MoveNetAnalyzer returns observations through the tracker
      // We need to handle both cases

      if (result?.result?.tracking?.observations) {
        return result.result.tracking.observations;
      }
      if (result?.tracking?.observations) {
        return result.tracking.observations;
      }
      if (Array.isArray(result?.result?.observations)) {
        return result.result.observations;
      }
      return [];
    }

    resetSession(sessionId, reason) {
      if (this.currentAnalyzer && typeof this.currentAnalyzer.resetSession === 'function') {
        return this.currentAnalyzer.resetSession(sessionId, reason);
      }
      this.lastPlayerPositions.delete(sessionId);
      return { sessionId, reason };
    }

    dispose() {
      if (this.currentAnalyzer && typeof this.currentAnalyzer.dispose === 'function') {
        this.currentAnalyzer.dispose();
      }
      this.currentAnalyzer = null;
      this.lastPlayerPositions.clear();
    }

    getCurrentModel() {
      return {
        id: this.modelId,
        config: AVAILABLE_MODELS[this.modelId] || null,
        analyzer: this.currentAnalyzer,
        identity: this.identity
      };
    }

    getAvailableModels() {
      return getAvailableModels(this.environment);
    }

    async probeModelAvailability(modelId) {
      return probePoseModelAvailability(modelId, this.environment);
    }
  }

  return Object.freeze({
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    ADAPTER_GLOBALS,
    PoseModelSwitcher,
    getPoseAnalyzerClass,
    createPoseAnalyzer,
    getAvailableModels,
    probePoseModelAvailability,
    validateAndAssignPlayerIds
  });
}));
