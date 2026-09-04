const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/extension/common/protocol.js');
global.BSOProtocol = protocol;
const selector = require('../src/extension/offscreen/pose-model-selector.js');

function identityFor(id, overrides = {}) {
  return Object.assign({ id, version: 1, kind: 'test-analyzer', productionModel: false }, overrides);
}

function analyzerClass(id, options = {}) {
  return class StubAnalyzer {
    constructor(opts) {
      this.opts = opts || {};
      this.identity = identityFor(id, options.identity || {});
      this.disposed = false;
      this.initialized = null;
    }
    async initialize() {
      this.initialized = true;
      return options.initialize || { available: true };
    }
    dispose() { this.disposed = true; }
    async analyze() { return null; }
  };
}

function environment(overrides = {}) {
  return Object.assign({
    BSOLiteOpenPoseAdapter: { LiteOpenPoseAnalyzer: analyzerClass('lightweight-openpose-lite-256-v1'), MODEL: { modelUrl: './vendor/lite-openpose/pose_256.tflite' } },
    BSOMoveNetAdapter: { MoveNetMultiPoseLightningAnalyzer: analyzerClass('movenet-multipose-lightning-v1'), MODEL: { modelUrl: './vendor/movenet-multipose-lightning/model.json' } },
    BSOBlazePoseTfjsAdapter: { BlazePoseAnalyzer: analyzerClass('blazepose-tfjs-heavy-v1'), MODEL: { modelUrl: './vendor/blazepose-tfjs/model.json' } },
    BSOBlazePoseAdapter: { BlazePoseAnalyzer: analyzerClass('blazepose-onnx-multipose'), MODEL: { modelUrl: 'models/blazepose-lite-256.onnx' } },
    BSOLiteRuntimeReady: Promise.resolve({ loaded: true }),
    tf: {},
    location: { href: 'chrome-extension://test/offscreen/offscreen.html' },
    URL,
    fetch: async () => ({ ok: false, status: 404 })
  }, overrides);
}

test('selector resolves each model to its own adapter namespace', () => {
  const env = environment();
  const lite = selector.getPoseAnalyzerClass('lightweight-openpose-lite-256-v1', env);
  const movenet = selector.getPoseAnalyzerClass('movenet-multipose-lightning-v1', env);
  const blaze = selector.getPoseAnalyzerClass('blazepose-tfjs-heavy-v1', env);
  assert.equal(lite.name, 'StubAnalyzer');
  assert.equal(new lite({ environment: env }).identity.id, 'lightweight-openpose-lite-256-v1');
  assert.equal(new movenet({ environment: env }).identity.id, 'movenet-multipose-lightning-v1');
  assert.equal(new blaze({ environment: env }).identity.id, 'blazepose-tfjs-heavy-v1');
});

test('the ml-pipeline ONNX BlazePose namespace does not resolve the TF.js model entry', () => {
  const env = environment();
  delete env.BSOBlazePoseTfjsAdapter;
  assert.equal(selector.getPoseAnalyzerClass('blazepose-tfjs-heavy-v1', env), null);
  // The LiteRT default and MoveNet entries stay resolved by their own keys.
  assert.notEqual(selector.getPoseAnalyzerClass('lightweight-openpose-lite-256-v1', env), null);
});

test('sync availability requires the runtime prerequisites, not only the adapter class', () => {
  const env = environment();
  const all = selector.getAvailableModels(env);
  const byId = {};
  all.forEach((model) => { byId[model.id] = model; });
  assert.equal(byId['lightweight-openpose-lite-256-v1'].available, true);
  assert.equal(byId['movenet-multipose-lightning-v1'].available, true);
  // BlazePose is work in progress: it stays listed (and its adapter stays
  // loadable) but is never reported available, even with every prerequisite
  // present.
  assert.equal(byId['blazepose-tfjs-heavy-v1'].available, false);
  assert.equal(byId['blazepose-tfjs-heavy-v1'].reason, 'pose-model-work-in-progress');
  assert.equal(byId['blazepose-tfjs-heavy-v1'].workInProgress, true);

  const noTf = environment();
  delete noTf.tf;
  const withoutTf = {};
  selector.getAvailableModels(noTf).forEach((model) => { withoutTf[model.id] = model; });
  assert.equal(withoutTf['movenet-multipose-lightning-v1'].available, false);
  assert.equal(withoutTf['movenet-multipose-lightning-v1'].reason, 'tensorflowjs-not-loaded');
  assert.equal(withoutTf['blazepose-tfjs-heavy-v1'].available, false);
  assert.equal(withoutTf['blazepose-tfjs-heavy-v1'].reason, 'pose-model-work-in-progress');
  assert.equal(withoutTf['lightweight-openpose-lite-256-v1'].available, true);
});

test('the availability probe refuses the work-in-progress model before any runtime or artifact check', async () => {
  const env = environment();
  const probe = await selector.probePoseModelAvailability('blazepose-tfjs-heavy-v1', env);
  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'pose-model-work-in-progress');
  // Even without the TF.js runtime the refusal reason is the work-in-progress
  // gate, never a runtime or artifact diagnostic.
  const noTf = environment();
  delete noTf.tf;
  const noRuntimeProbe = await selector.probePoseModelAvailability('blazepose-tfjs-heavy-v1', noTf);
  assert.equal(noRuntimeProbe.available, false);
  assert.equal(noRuntimeProbe.reason, 'pose-model-work-in-progress');
});

test('artifact probe reports a graph model available only when its local model.json is reachable', async () => {
  const env = environment();
  const reachable = environment();
  reachable.fetch = async (url) => ({ ok: String(url).includes('movenet-multipose-lightning/model.json'), status: String(url).includes('movenet-multipose-lightning/model.json') ? 200 : 404 });
  const movenet = await selector.probePoseModelAvailability('movenet-multipose-lightning-v1', reachable);
  assert.equal(movenet.available, true);
  // A non-bundled artifact still refuses a non-WIP model.
  const notBundled = await selector.probePoseModelAvailability('movenet-multipose-lightning-v1', env);
  assert.equal(notBundled.available, false);
  assert.equal(notBundled.reason, 'pose-model-artifacts-not-bundled');
  const noRuntime = environment();
  delete noRuntime.tf;
  const noTf = await selector.probePoseModelAvailability('movenet-multipose-lightning-v1', noRuntime);
  assert.equal(noTf.available, false);
  assert.equal(noTf.reason, 'tensorflowjs-not-loaded');
});

test('switcher prepares and initializes a target before committing, disposing only the previous analyzer', async () => {
  const env = environment();
  const disposed = [];
  const tracked = [];
  const liteClass = env.BSOLiteOpenPoseAdapter.LiteOpenPoseAnalyzer;
  const originalDispose = liteClass.prototype.dispose;
  liteClass.prototype.dispose = function () { disposed.push(this.identity.id); this.disposed = true; };
  const switcher = new selector.PoseModelSwitcher({ environment: env, onModelChange: (result) => tracked.push(result) });
  assert.equal(switcher.getCurrentModel().id, 'lightweight-openpose-lite-256-v1');
  assert.ok(switcher.getCurrentModel().analyzer);

  const prepared = await switcher.prepareModel('movenet-multipose-lightning-v1');
  assert.equal(prepared.ok, true);
  assert.ok(prepared.prepared);
  assert.equal(prepared.prepared.initialized, true);
  // Preparing must not disturb the analyzer that is serving frames.
  assert.equal(switcher.getCurrentModel().id, 'lightweight-openpose-lite-256-v1');
  assert.deepEqual(disposed, []);

  const committed = switcher.commitModel('movenet-multipose-lightning-v1', prepared.prepared);
  assert.equal(committed.ok, true);
  assert.equal(switcher.getCurrentModel().id, 'movenet-multipose-lightning-v1');
  assert.deepEqual(disposed, ['lightweight-openpose-lite-256-v1']);
  assert.deepEqual(tracked.map((result) => [result.ok, result.modelId]), [[true, 'movenet-multipose-lightning-v1']]);
  liteClass.prototype.dispose = originalDispose;
});

test('a target that cannot initialize never displaces the active analyzer', async () => {
  const env = environment();
  env.BSOMoveNetAdapter.MoveNetMultiPoseLightningAnalyzer = analyzerClass('movenet-multipose-lightning-v1', {
    initialize: { available: false, reason: 'no-usable-inference-backend' }
  });
  const switcher = new selector.PoseModelSwitcher({ environment: env });
  const failed = await switcher.activateModel('movenet-multipose-lightning-v1');
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'no-usable-inference-backend');
  assert.equal(switcher.getCurrentModel().id, 'lightweight-openpose-lite-256-v1');
  assert.ok(switcher.getCurrentModel().analyzer);

  const unknown = await switcher.activateModel('not-a-model');
  assert.equal(unknown.ok, false);
  assert.equal(switcher.getCurrentModel().id, 'lightweight-openpose-lite-256-v1');
});

test('the work-in-progress BlazePose entry stays loadable but is refused by every activation path', async () => {
  const env = environment();
  // The adapter class stays resolvable and constructible so the model remains
  // testable while the switch-back wedge is open.
  const blazeClass = selector.getPoseAnalyzerClass('blazepose-tfjs-heavy-v1', env);
  assert.ok(blazeClass, 'BlazePose adapter class stays resolvable');
  assert.equal(new blazeClass({ environment: env }).identity.id, 'blazepose-tfjs-heavy-v1');

  const notices = [];
  const switcher = new selector.PoseModelSwitcher({ environment: env, onModelChange: (result) => notices.push(result) });

  const prepared = await switcher.prepareModel('blazepose-tfjs-heavy-v1');
  assert.equal(prepared.ok, false);
  assert.equal(prepared.reason, 'pose-model-work-in-progress');
  assert.equal(prepared.prepared, null);
  assert.equal(switcher.getCurrentModel().id, 'lightweight-openpose-lite-256-v1');

  const activated = await switcher.activateModel('blazepose-tfjs-heavy-v1');
  assert.equal(activated.ok, false);
  assert.equal(activated.reason, 'pose-model-work-in-progress');
  assert.equal(switcher.getCurrentModel().id, 'lightweight-openpose-lite-256-v1');

  const sync = switcher.switchModel('blazepose-tfjs-heavy-v1');
  assert.equal(sync.ok, false);
  assert.equal(sync.reason, 'pose-model-work-in-progress');
  assert.equal(switcher.getCurrentModel().id, 'lightweight-openpose-lite-256-v1');

  assert.deepEqual(notices.map((result) => [result.ok, result.modelId, result.reason]), [
    [false, 'blazepose-tfjs-heavy-v1', 'pose-model-work-in-progress'],
    [false, 'blazepose-tfjs-heavy-v1', 'pose-model-work-in-progress']
  ]);
});

test('a work-in-progress initial model boots the production default instead', () => {
  const env = environment();
  const switcher = new selector.PoseModelSwitcher({ environment: env, initialModelId: 'blazepose-tfjs-heavy-v1' });
  assert.equal(switcher.getCurrentModel().id, 'lightweight-openpose-lite-256-v1');
  assert.ok(switcher.getCurrentModel().analyzer);
  assert.equal(switcher.getCurrentModel().analyzer.identity.id, 'lightweight-openpose-lite-256-v1');
});

test('switching back to the already active model is a no-op success', async () => {
  const env = environment();
  const switcher = new selector.PoseModelSwitcher({ environment: env });
  const prepared = await switcher.prepareModel('lightweight-openpose-lite-256-v1');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.alreadyActive, true);
  assert.equal(prepared.prepared, null);
  const result = await switcher.activateModel('lightweight-openpose-lite-256-v1');
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
});
