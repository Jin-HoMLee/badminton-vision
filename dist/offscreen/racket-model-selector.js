/* global globalThis, BSOProtocol, BSOEfficientDetRacketAdapter, BSOYoloWorldRacketAdapter */
(function installRacketModelSelector(root, factory) {
  const api = factory(root.BSOProtocol, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSoRacketModelSelector = api;
}(typeof globalThis === 'object' ? globalThis : self, function racketModelSelectorFactory(protocol, defaultEnvironment) {
  'use strict';

  /**
   * Available racket detection models, mirroring the pose-model selector. The
   * production model is the vendored Apache-2.0 MediaPipe EfficientDet-Lite0
   * tennis-racket detector (the shipped default, real-model-tested, see
   * vendor/efficientdet-lite0/MODEL-NOTICE.md). YOLO-World is an EXPERIMENTAL
   * open-vocabulary alternative produced from the AGPL-3.0 Ultralytics
   * yolov8s-world asset by scripts/prepare-yolo-world.mjs: it is never the
   * default, it is research-measured at roughly 2-6 s/frame in the MV3
   * offscreen document (archive-grade, not for live play), and selecting it in
   * a public build carries AGPL-3.0 source-disclosure terms for anyone who
   * redistributes the prepared artifact (license records in
   * vendor/yolo-world/). The experimental entry is never silently dropped:
   * when its runtime or artifact is not bundled it stays listed and reports an
   * explicit unavailable reason.
   */
  const AVAILABLE_MODELS = Object.freeze({
    'efficientdet-lite0-racket-v1': {
      id: 'efficientdet-lite0-racket-v1',
      label: 'EfficientDet-Lite0 (Production)',
      description: 'Real tennis-racket boxes from the bundled Apache-2.0 MediaPipe EfficientDet-Lite0 artifact. Fast and live-usable.',
      adapterKey: 'EfficientDetRacketAdapter',
      analyzerNames: ['EfficientDetRacketDetector'],
      license: 'Apache-2.0',
      licenseStatus: 'cleared-for-redistribution',
      runtimeKind: 'litert',
      isProduction: true,
      experimental: false
    },
    'yolo-world-racket-detector-v1': {
      id: 'yolo-world-racket-detector-v1',
      label: 'YOLO-World Open-Vocabulary (Experimental)',
      description: 'Zero-shot open-vocabulary racket detection. Experimental: AGPL-3.0 (Ultralytics asset), research-measured at ~2-6 s/frame - archive-grade, not for live play.',
      adapterKey: 'YoloWorldRacketAdapter',
      analyzerNames: ['YoloWorldRacketAnalyzer'],
      license: 'AGPL-3.0',
      licenseStatus: 'agpl-3.0-experimental-source-disclosure',
      runtimeKind: 'onnxruntimeweb',
      isProduction: false,
      experimental: true,
      measuredPerFrame: '2-6 s/frame (archive-grade, not for live play)'
    }
  });

  const DEFAULT_RACKET_MODEL = 'efficientdet-lite0-racket-v1';

  /**
   * Each adapter installs one analyzer namespace under a distinct global key.
   * The keys are unique per adapter module so the LiteRT EfficientDet adapter
   * and the ONNX Runtime Web YOLO-World adapter cannot shadow each other in
   * the same offscreen document.
   */
  const ADAPTER_GLOBALS = Object.freeze({
    EfficientDetRacketAdapter: { globalKey: 'BSOEfficientDetRacketAdapter', analyzerNames: ['EfficientDetRacketDetector'] },
    YoloWorldRacketAdapter: { globalKey: 'BSOYoloWorldRacketAdapter', analyzerNames: ['YoloWorldRacketAnalyzer'] }
  });

  function environmentFor(environment) {
    return environment || defaultEnvironment || globalThis;
  }

  function modelConfig(modelId) {
    return AVAILABLE_MODELS[modelId] || null;
  }

  function isExperimental(modelId) {
    const config = modelConfig(modelId);
    return Boolean(config && config.experimental);
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

  function getRacketAnalyzerClass(modelId, environment = defaultEnvironment) {
    const binding = adapterBinding(modelId, environment);
    return binding ? binding.AnalyzerClass : null;
  }

  function liteRuntimeLoaded(environment) {
    const env = environmentFor(environment);
    return Boolean(env.BSOLiteRuntimeReady);
  }

  function onnxRuntimeLoaded(environment) {
    const env = environmentFor(environment);
    return Boolean(env.ort || env.BSOOnnxRuntimeReady);
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
      throw new TypeError('racket model artifact URL resolved outside the extension package');
    }
    return resolved.toString();
  }

  async function probeArtifact(url, environment) {
    const env = environmentFor(environment);
    const fetchFn = env.fetch || defaultEnvironment.fetch;
    if (typeof fetchFn !== 'function') return { ok: false, reason: 'racket-model-artifact-probe-unavailable' };
    let resolved;
    try {
      resolved = resolveLocalArtifactUrl(url, env);
    } catch (_) {
      return { ok: false, reason: 'racket-model-artifact-url-invalid' };
    }
    try {
      const response = await fetchFn(resolved, { method: 'GET', cache: 'force-cache' });
      if (response && (response.ok === true || response.status === 200 || response.status === 0)) {
        return { ok: true, reason: '' };
      }
      return { ok: false, reason: 'racket-model-artifacts-not-bundled' };
    } catch (_) {
      return { ok: false, reason: 'racket-model-artifacts-not-bundled' };
    }
  }

  /**
   * Probe whether a racket model can actually run in this document: its
   * analyzer namespace must be loaded, its runtime (LiteRT loader or ONNX
   * Runtime Web) must be present, and for locally-vendored artifacts the
   * model file must be reachable. The YOLO-World runtime may arrive lazily
   * from a prepared vendor module; the adapter exposes the same resolution
   * used at activation so the probe cannot mark usable a model activation
   * would refuse, and vice versa.
   */
  async function probeRacketModelAvailability(modelId, environment = defaultEnvironment) {
    const binding = adapterBinding(modelId, environment);
    if (!binding) {
      return { modelId, available: false, reason: 'racket-analyzer-not-loaded' };
    }
    const env = environmentFor(environment);
    const config = binding.config;
    if (config.runtimeKind === 'onnxruntimeweb') {
      // ONNX Runtime Web may be present as a global, as a ready promise, or
      // as a lazily importable vendored module; the adapter resolves all
      // three the same way at activation.
      let runtimeAvailable = false;
      if (onnxRuntimeLoaded(env)) {
        runtimeAvailable = true;
      } else if (env[binding.globalKey] && typeof env[binding.globalKey].resolveOnnxRuntime === 'function') {
        const resolved = await env[binding.globalKey].resolveOnnxRuntime(env);
        runtimeAvailable = Boolean(resolved && resolved.ort);
      }
      if (!runtimeAvailable) {
        return { modelId, available: false, reason: 'onnx-runtime-web-not-loaded' };
      }
      const artifactUrl = localArtifactUrl(modelId, env);
      if (!artifactUrl) return { modelId, available: false, reason: 'racket-model-artifact-url-unavailable' };
      const artifact = await probeArtifact(artifactUrl, env);
      return { modelId, available: artifact.ok, reason: artifact.ok ? '' : artifact.reason };
    }
    // LiteRT: the loader and the cleared tflite artifact ship together in the
    // offscreen package; full readiness is verified by initialize().
    if (!liteRuntimeLoaded(env)) {
      return { modelId, available: false, reason: 'litert-runtime-unavailable' };
    }
    return { modelId, available: true, reason: '' };
  }

  /**
   * Get available models with their status. A model is usable only when its
   * adapter is loaded and its runtime prerequisites are present; artifact
   * presence is verified by the async probeRacketModelAvailability().
   */
  function getAvailableModels(environment = defaultEnvironment) {
    const models = [];
    for (const [modelId, config] of Object.entries(AVAILABLE_MODELS)) {
      const analyzerClass = getRacketAnalyzerClass(modelId, environment);
      const env = environmentFor(environment);
      const runtime = config.runtimeKind === 'onnxruntimeweb'
        ? onnxRuntimeLoaded(env)
        : liteRuntimeLoaded(env);
      models.push({
        ...config,
        available: Boolean(analyzerClass) && Boolean(runtime),
        reason: !analyzerClass ? 'racket-analyzer-not-loaded' : runtime ? '' : (config.runtimeKind === 'onnxruntimeweb' ? 'onnx-runtime-web-not-loaded' : 'litert-runtime-unavailable')
      });
    }
    return models;
  }

  function createRacketAnalyzer(modelId, options = {}) {
    const binding = adapterBinding(modelId, options.environment);
    if (!binding) {
      throw new Error(`Racket analyzer for model ${modelId} is not loaded`);
    }
    const AnalyzerClass = binding.AnalyzerClass;
    return new AnalyzerClass(options);
  }

  /**
   * RacketModelSwitcher owns the active racket analyzer instance.
   * prepareModel() prepares and initializes the target model before it
   * commits, so a model whose runtime or local artifact is missing never
   * displaces the detector currently serving frames. Only the current model
   * is instantiated: selecting nothing constructs exactly the production
   * EfficientDet detector, and the experimental YOLO-World path is never
   * created, parsed, or started unless the user chooses it.
   */
  class RacketModelSwitcher {
    constructor({
      initialModelId = DEFAULT_RACKET_MODEL,
      environment = defaultEnvironment,
      onModelChange = () => {},
      onStatus = () => {}
    } = {}) {
      this.environment = environmentFor(environment);
      this.onModelChange = typeof onModelChange === 'function' ? onModelChange : () => {};
      this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
      this.currentAnalyzer = null;
      this.modelId = initialModelId;
      try {
        if (!AVAILABLE_MODELS[initialModelId]) throw new Error(`Unknown racket model: ${initialModelId}`);
        // Construct only the current analyzer. The experimental model is
        // never instantiated here; prepareModel() creates it on demand.
        this.currentAnalyzer = this._createAnalyzer(initialModelId);
        this.identity = this.currentAnalyzer?.identity || {
          id: initialModelId,
          kind: 'racket-model-switcher',
          version: 1
        };
        this.modelId = initialModelId;
      } catch (error) {
        this.currentAnalyzer = null;
        this.modelId = DEFAULT_RACKET_MODEL;
        this.identity = {
          id: 'racket-model-unavailable',
          kind: 'racket-model-switcher',
          version: 1,
          reason: error instanceof Error ? error.message : String(error)
        };
      }
    }

    _createAnalyzer(modelId) {
      return createRacketAnalyzer(modelId, {
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
        kind: 'racket-model-switcher',
        version: 1
      };
      this.onModelChange({ modelId, ok: true });
      this.onStatus({ type: 'model-switched', modelId });
    }

    /**
     * Prepare a target model without touching the active detector: the target
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
        const AnalyzerClass = getRacketAnalyzerClass(modelId, this.environment);
        if (!AnalyzerClass) {
          const reason = `Model ${modelId} is not loaded in this environment`;
          this.onModelChange({ modelId, ok: false, reason });
          return { ok: false, modelId, reason, prepared: null, alreadyActive: false };
        }
        prepared = this._createAnalyzer(modelId);
        const initialized = await prepared.initialize();
        if (!initialized || initialized.available !== true) {
          const reason = (initialized && initialized.reason) || 'racket-model-initialization-failed';
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
     * Commit a prepared analyzer as the active detector. Synchronous: callers
     * must ensure no frame is running on the previous analyzer (the offscreen
     * scheduler waits for idle sessions before committing).
     */
    commitModel(modelId, prepared) {
      if (!prepared || typeof prepared.analyze !== 'function') {
        const reason = 'racket-model-not-prepared';
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
     * Switch to a different racket detection model. The target analyzer is
     * created and initialized first; the active detector is disposed only
     * after the target reports itself available. A failed initialization
     * leaves the active model untouched. Use prepareModel() + commitModel()
     * when frames may be running concurrently so the dispose can wait for
     * idle sessions.
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

    resetSession(sessionId, reason) {
      if (this.currentAnalyzer && typeof this.currentAnalyzer.resetSession === 'function') {
        return this.currentAnalyzer.resetSession(sessionId, reason);
      }
      return { sessionId, reason };
    }

    dispose() {
      if (this.currentAnalyzer && typeof this.currentAnalyzer.dispose === 'function') {
        this.currentAnalyzer.dispose();
      }
      this.currentAnalyzer = null;
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
      return probeRacketModelAvailability(modelId, this.environment);
    }
  }

  return Object.freeze({
    AVAILABLE_MODELS,
    DEFAULT_RACKET_MODEL,
    ADAPTER_GLOBALS,
    RacketModelSwitcher,
    getRacketAnalyzerClass,
    createRacketAnalyzer,
    getAvailableModels,
    probeRacketModelAvailability,
    isExperimental
  });
}));
