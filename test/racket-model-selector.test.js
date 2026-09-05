const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
global.BSOProtocol = protocol;
const selector = require('../src/extension/offscreen/racket-model-selector.js');

function analyzerClass(id, options = {}) {
  return class StubRacketAnalyzer {
    constructor(opts) {
      this.opts = opts || {};
      this.identity = Object.freeze(Object.assign({
        id, version: 1, kind: 'test-racket-analyzer',
        detectionMethod: id === 'efficientdet-lite0-racket-v1' ? 'efficientdet-lite0-tennis-racket' : 'yolo-world-open-vocab-racket',
        productionModel: id === 'efficientdet-lite0-racket-v1',
        experimental: id !== 'efficientdet-lite0-racket-v1'
      }, options.identity || {}));
      this.disposed = false;
      this.initialized = false;
      options.constructed = (options.constructed || 0) + 1;
      this.instanceIndex = options.constructed;
    }
    async initialize() {
      this.initialized = true;
      return options.initialize || { available: true };
    }
    dispose() { this.disposed = true; }
    resetSession() { return { ok: true }; }
    endSession() { return { ok: true }; }
    async analyze() { return null; }
  };
}

function environment(overrides = {}) {
  const counters = { efficientdet: 0, yolo: 0 };
  return Object.assign({
    BSOLiteRuntimeReady: Promise.resolve({ loaded: true }),
    BSOEfficientDetRacketAdapter: {
      EfficientDetRacketDetector: analyzerClass('efficientdet-lite0-racket-v1', { constructed: 0 }),
      MODEL: Object.freeze({ id: 'efficientdet-lite0-racket-v1', modelUrl: './vendor/efficientdet-lite0/efficientdet_lite0.tflite' })
    },
    BSOYoloWorldRacketAdapter: {
      YoloWorldRacketAnalyzer: analyzerClass('yolo-world-racket-detector-v1', { constructed: 0 }),
      MODEL: Object.freeze({ id: 'yolo-world-racket-detector-v1', modelUrl: './vendor/yolo-world/yolo_world_s_open_vocab.onnx' })
    },
    location: { href: 'chrome-extension://test/offscreen/offscreen.html' },
    URL,
    fetch: async () => ({ ok: false, status: 404 })
  }, overrides);
}

test('the racket selector resolves each model to its own adapter namespace', () => {
  const env = environment();
  const efficientdet = selector.getRacketAnalyzerClass('efficientdet-lite0-racket-v1', env);
  const yolo = selector.getRacketAnalyzerClass('yolo-world-racket-detector-v1', env);
  assert.equal(typeof efficientdet, 'function');
  assert.equal(typeof yolo, 'function');
  assert.equal(new efficientdet({ environment: env }).identity.id, 'efficientdet-lite0-racket-v1');
  assert.equal(new yolo({ environment: env }).identity.id, 'yolo-world-racket-detector-v1');
  assert.equal(selector.getRacketAnalyzerClass('not-a-model', env), null);
});

test('only the production EfficientDet model is the default and only YOLO-World is experimental', () => {
  assert.equal(selector.DEFAULT_RACKET_MODEL, 'efficientdet-lite0-racket-v1');
  const efficientdet = selector.AVAILABLE_MODELS['efficientdet-lite0-racket-v1'];
  const yolo = selector.AVAILABLE_MODELS['yolo-world-racket-detector-v1'];
  assert.equal(efficientdet.isProduction, true);
  assert.equal(efficientdet.experimental, false);
  assert.equal(efficientdet.license, 'Apache-2.0');
  assert.equal(efficientdet.licenseStatus, 'cleared-for-redistribution');
  assert.equal(yolo.isProduction, false);
  assert.equal(yolo.experimental, true);
  assert.equal(yolo.license, 'AGPL-3.0');
  assert.equal(yolo.licenseStatus, 'agpl-3.0-experimental-source-disclosure');
  assert.match(yolo.description, /Experimental/);
  assert.equal(selector.isExperimental('efficientdet-lite0-racket-v1'), false);
  assert.equal(selector.isExperimental('yolo-world-racket-detector-v1'), true);
});

test('sync availability requires the runtime prerequisites, not only the adapter class', () => {
  const env = environment();
  const models = {};
  selector.getAvailableModels(env).forEach((model) => { models[model.id] = model; });
  assert.equal(models['efficientdet-lite0-racket-v1'].available, true);
  assert.equal(models['efficientdet-lite0-racket-v1'].reason, '');
  // No ONNX Runtime Web in the default document: YOLO-World is unavailable.
  assert.equal(models['yolo-world-racket-detector-v1'].available, false);
  assert.equal(models['yolo-world-racket-detector-v1'].reason, 'onnx-runtime-web-not-loaded');

  const withOrt = environment({ ort: {} });
  const withOrtModels = {};
  selector.getAvailableModels(withOrt).forEach((model) => { withOrtModels[model.id] = model; });
  assert.equal(withOrtModels['yolo-world-racket-detector-v1'].available, true);

  const noLiteRt = environment();
  delete noLiteRt.BSOLiteRuntimeReady;
  const noLiteModels = {};
  selector.getAvailableModels(noLiteRt).forEach((model) => { noLiteModels[model.id] = model; });
  assert.equal(noLiteModels['efficientdet-lite0-racket-v1'].available, false);
  assert.equal(noLiteModels['efficientdet-lite0-racket-v1'].reason, 'litert-runtime-unavailable');
});

test('the availability probe reports the YOLO-World artifact only when bundled and runtime present', async () => {
  const env = environment({ ort: {}, fetch: async (url) => ({ ok: String(url).includes('yolo_world_s_open_vocab.onnx'), status: 200 }) });
  const probed = await selector.probeRacketModelAvailability('yolo-world-racket-detector-v1', env);
  assert.equal(probed.available, true);
  assert.equal(probed.reason, '');

  const noArtifact = environment({ ort: {}, fetch: async () => ({ ok: false, status: 404 }) });
  const missing = await selector.probeRacketModelAvailability('yolo-world-racket-detector-v1', noArtifact);
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'racket-model-artifacts-not-bundled');

  const noOrt = environment();
  const runtimeMissing = await selector.probeRacketModelAvailability('yolo-world-racket-detector-v1', noOrt);
  assert.equal(runtimeMissing.available, false);
  assert.equal(runtimeMissing.reason, 'onnx-runtime-web-not-loaded');
});

test('the EfficientDet probe short-circuits on the shipped LiteRT runtime', async () => {
  const env = environment({ fetch: async () => ({ ok: false, status: 404 }) });
  const probed = await selector.probeRacketModelAvailability('efficientdet-lite0-racket-v1', env);
  assert.equal(probed.available, true);
});

test('the switcher constructs only the default analyzer; the experimental model is created on demand', async () => {
  const constructed = { efficientdet: 0, yolo: 0 };
  const env = environment();
  env.BSOEfficientDetRacketAdapter.EfficientDetRacketDetector = analyzerClass('efficientdet-lite0-racket-v1', { constructed: 0 });
  env.BSOYoloWorldRacketAdapter.YoloWorldRacketAnalyzer = analyzerClass('yolo-world-racket-detector-v1', { constructed: 0 });
  const OriginalEfficientDet = env.BSOEfficientDetRacketAdapter.EfficientDetRacketDetector;
  const OriginalYolo = env.BSOYoloWorldRacketAdapter.YoloWorldRacketAnalyzer;
  env.BSOEfficientDetRacketAdapter.EfficientDetRacketDetector = class extends OriginalEfficientDet {
    constructor(opts) { constructed.efficientdet += 1; super(opts); }
  };
  env.BSOYoloWorldRacketAdapter.YoloWorldRacketAnalyzer = class extends OriginalYolo {
    constructor(opts) { constructed.yolo += 1; super(opts); }
  };

  const switcher = new selector.RacketModelSwitcher({ environment: env });
  assert.equal(switcher.getCurrentModel().id, 'efficientdet-lite0-racket-v1');
  assert.equal(constructed.efficientdet, 1);
  assert.equal(constructed.yolo, 0, 'the experimental model must not be instantiated by default');

  const prepared = await switcher.prepareModel('yolo-world-racket-detector-v1');
  assert.equal(prepared.ok, true);
  assert.equal(constructed.yolo, 1, 'the experimental model is created only on demand');
  const committed = switcher.commitModel('yolo-world-racket-detector-v1', prepared.prepared);
  assert.equal(committed.ok, true);
  assert.equal(switcher.getCurrentModel().id, 'yolo-world-racket-detector-v1');
  assert.equal(prepared.prepared.disposed, false);
  switcher.dispose();
});

test('a target that cannot initialize never displaces the active analyzer', async () => {
  const env = environment();
  env.BSOYoloWorldRacketAdapter.YoloWorldRacketAnalyzer = analyzerClass('yolo-world-racket-detector-v1', {
    constructed: 0,
    initialize: { available: false, reason: 'yolo-world-artifact-not-bundled' }
  });
  const switcher = new selector.RacketModelSwitcher({ environment: env });
  const prepared = await switcher.prepareModel('yolo-world-racket-detector-v1');
  assert.equal(prepared.ok, false);
  assert.equal(prepared.reason, 'yolo-world-artifact-not-bundled');
  assert.equal(switcher.getCurrentModel().id, 'efficientdet-lite0-racket-v1', 'the default stays active');
});

test('switching to the already active model is a no-op success', async () => {
  const switcher = new selector.RacketModelSwitcher({ environment: environment() });
  const prepared = await switcher.prepareModel('efficientdet-lite0-racket-v1');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.alreadyActive, true);
  const response = await switcher.activateModel('efficientdet-lite0-racket-v1');
  assert.equal(response.ok, true);
  assert.equal(response.changed, false);
});

test('unknown models are refused and the experimental model is never the initial fallback', async () => {
  const switcher = new selector.RacketModelSwitcher({ environment: environment() });
  const unknown = await switcher.prepareModel('nope-model');
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /Unknown model/);
  assert.equal(switcher.getCurrentModel().id, 'efficientdet-lite0-racket-v1');
  // Even an unknown initial id boots the production default.
  const fallback = new selector.RacketModelSwitcher({ environment: environment(), initialModelId: 'nope-model' });
  assert.equal(fallback.getCurrentModel().id, 'efficientdet-lite0-racket-v1');
});
