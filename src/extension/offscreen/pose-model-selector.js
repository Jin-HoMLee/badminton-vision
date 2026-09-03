/* global globalThis, BSOProtocol, BSOLiteOpenPoseAdapter, BSOMoveNetAdapter, BSOBlazePoseAdapter */
(function installPoseModelSelector(root, factory) {
  const api = factory(root.BSOProtocol, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSoPoseModelSelector = api;
}(typeof globalThis === 'object' ? globalThis : self, function poseModelSelectorFactory(protocol, defaultEnvironment) {
  'use strict';

  /**
   * Available pose models. The production model is LiteOpenPose (cleared for redistribution).
   * MoveNet and BlazePose are additional high-accuracy options.
   */
  const AVAILABLE_MODELS = Object.freeze({
    'lightweight-openpose-lite-256-v1': {
      id: 'lightweight-openpose-lite-256-v1',
      label: 'Lightweight OpenPose (Production)',
      description: 'Fast, lightweight. Best for real-time analysis.',
      adapterKey: 'LiteOpenPoseAdapter',
      analyzerClass: 'LiteOpenPoseAnalyzer',
      licenseStatus: 'cleared-for-redistribution',
      isProduction: true
    },
    'movenet-multipose-lightning-v1': {
      id: 'movenet-multipose-lightning-v1',
      label: 'MoveNet MultiPose Lightning',
      description: 'Multi-person pose detection. Good accuracy and speed.',
      adapterKey: 'MoveNetAdapter',
      analyzerClass: 'MoveNetMultiPoseLightningAnalyzer',
      licenseStatus: 'not-cleared-for-redistribution',
      isProduction: false
    },
    'blazepose-tfjs-heavy-v1': {
      id: 'blazepose-tfjs-heavy-v1',
      label: 'BlazePose Heavy',
      description: 'High-accuracy single person pose. Best for detailed footwork.',
      adapterKey: 'BlazePoseAdapter',
      analyzerClass: 'BlazePoseAnalyzer',
      licenseStatus: 'cleared-for-redistribution',
      isProduction: false
    }
  });

  const DEFAULT_MODEL = 'lightweight-openpose-lite-256-v1';

  /**
   * Get the pose analyzer class for a given model ID.
   * Returns a constructor that can be instantiated with { environment, ... }
   */
  function getPoseAnalyzerClass(modelId, environment = defaultEnvironment) {
    const modelConfig = AVAILABLE_MODELS[modelId];
    if (!modelConfig) {
      return null;
    }

    // Map adapter keys to the actual analyzer classes in globalThis
    const adapterMap = {
      'LiteOpenPoseAdapter': () => {
        const adapter = environment?.BSOLiteOpenPoseAdapter || globalThis.BSOLiteOpenPoseAdapter;
        return adapter?.LiteOpenPoseAnalyzer;
      },
      'MoveNetAdapter': () => {
        const adapter = environment?.BSOMoveNetAdapter || globalThis.BSOMoveNetAdapter;
        return adapter?.MoveNetMultiPoseLightningAnalyzer || adapter?.MoveNetAnalyzer;
      },
      'BlazePoseAdapter': () => {
        const adapter = environment?.BSOBlazePoseAdapter || globalThis.BSOBlazePoseAdapter;
        return adapter?.BlazePoseAnalyzer || adapter?.BlazePose;
      }
    };

    const getAnalyzer = adapterMap[modelConfig.adapterKey];
    return getAnalyzer ? getAnalyzer() : null;
  }

  /**
   * Get available models with their status.
   * A model is usable if its adapter is loaded.
   */
  function getAvailableModels(environment = defaultEnvironment) {
    const models = [];
    for (const [modelId, config] of Object.entries(AVAILABLE_MODELS)) {
      const analyzerClass = getPoseAnalyzerClass(modelId, environment);
      models.push({
        ...config,
        available: Boolean(analyzerClass)
      });
    }
    return models;
  }

  /**
   * Create a pose analyzer instance for the given model.
   * If the model is not available, returns null.
   */
  function createPoseAnalyzer(modelId, options = {}) {
    const modelConfig = AVAILABLE_MODELS[modelId];
    if (!modelConfig) {
      throw new Error(`Unknown pose model: ${modelId}`);
    }

    const environment = options.environment || defaultEnvironment;
    const AnalyzerClass = getPoseAnalyzerClass(modelId, environment);
    if (!AnalyzerClass) {
      throw new Error(`Pose analyzer for model ${modelId} is not loaded`);
    }

    return new AnalyzerClass(options);
  }

  /**
   * Validate that exactly 2 players are detected and assign stable IDs.
   * Returns { isValid: boolean, players: [{ trackId, keypoints, ... }], reason?: string }
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
   * PoseModelSwitcher manages switching between different pose detection models.
   * It wraps any pose analyzer and provides consistent player-filtering behavior.
   */
  class PoseModelSwitcher {
    constructor({
      initialModelId = DEFAULT_MODEL,
      environment = defaultEnvironment,
      onModelChange = () => {},
      onStatus = () => {}
    } = {}) {
      this.modelId = initialModelId;
      this.environment = environment;
      this.onModelChange = typeof onModelChange === 'function' ? onModelChange : () => {};
      this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
      this.currentAnalyzer = null;
      this.lastPlayerPositions = new Map();

      try {
        this.currentAnalyzer = this._createAnalyzer(this.modelId);
        this.identity = this.currentAnalyzer?.identity || {
          id: this.modelId,
          kind: 'pose-model-switcher',
          version: 1
        };
      } catch (error) {
        this.currentAnalyzer = null;
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

    /**
     * Switch to a different pose detection model.
     * Disposes the old model and creates a new one.
     */
    switchModel(modelId) {
      if (modelId === this.modelId && this.currentAnalyzer) {
        return { ok: true, modelId, message: 'Model already active' };
      }

      if (!AVAILABLE_MODELS[modelId]) {
        return { ok: false, reason: `Unknown model: ${modelId}` };
      }

      try {
        const AnalyzerClass = getPoseAnalyzerClass(modelId, this.environment);
        if (!AnalyzerClass) {
          return { ok: false, reason: `Model ${modelId} is not loaded in this environment` };
        }

        // Dispose the old analyzer
        if (this.currentAnalyzer && typeof this.currentAnalyzer.dispose === 'function') {
          this.currentAnalyzer.dispose();
        }

        // Create and activate the new analyzer
        this.currentAnalyzer = this._createAnalyzer(modelId);
        this.modelId = modelId;
        this.identity = this.currentAnalyzer?.identity || {
          id: this.modelId,
          kind: 'pose-model-switcher',
          version: 1
        };
        this.lastPlayerPositions.clear();

        this.onModelChange({ modelId, ok: true });
        this.onStatus({ type: 'model-switched', modelId });

        return { ok: true, modelId, message: `Switched to ${AVAILABLE_MODELS[modelId]?.label || modelId}` };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.onModelChange({ modelId, ok: false, reason });
        return { ok: false, reason };
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
  }

  return Object.freeze({
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    PoseModelSwitcher,
    getPoseAnalyzerClass,
    createPoseAnalyzer,
    getAvailableModels,
    validateAndAssignPlayerIds
  });
}));
