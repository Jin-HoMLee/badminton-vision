const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FILTER = path.join(ROOT, 'src/extension/offscreen/offscreen-console-filter.js');
const OFFSCREEN_HTML = path.join(ROOT, 'src/extension/offscreen/offscreen.html');
const WASM_BRIDGE = path.join(ROOT, 'src/extension/offscreen/vendor/litert/litert_wasm_internal.js');

function loadFilter() {
  const calls = [];
  const consoleMethods = {};
  for (const method of ['log', 'info', 'warn', 'error']) {
    consoleMethods[method] = (...args) => calls.push({ method, args });
  }
  const context = vm.createContext({ console: consoleMethods });
  vm.runInContext(fs.readFileSync(FILTER, 'utf8'), context, { filename: FILTER });
  return { context, calls };
}

test('offscreen filter suppresses only the LiteRT WebGPU registration on the stderr bridge', () => {
  const { context, calls } = loadFilter();
  const observed = 'INFO: [accelerator_registry.cc:54] RegisterAccelerator: ptr=0xc5fd8, name=GPU WebGPU';

  // Emscripten captures console.error before LiteRT's WASM module starts. This
  // is the path used by default_tty1_ops for the observed native diagnostic.
  context.console.error(observed);
  assert.deepEqual(calls, []);

  context.console.error('WARNING: [npu_registry.cc:34] NPU accelerator could not be loaded and registered');
  context.console.error('ERROR: LiteRT model initialization failed');
  context.console.error('INFO: [unrelated_backend.cc:36] A diagnostic from an unknown backend');
  context.console.error('INFO: [compiled_model.cc:812] Failed to invoke the compiled model');
  context.console.error('INFO: [accelerator_registry.cc:54] RegisterAccelerator: ptr=0xc5fd8, name=GPU Vulkan');
  context.console.error("NotFoundError: Failed to execute 'setPointerCapture' on 'HTMLDivElement'");
  context.console.warn('NPU accelerator could not be loaded and registered');
  context.console.warn('WebGPU device lost');
  assert.deepEqual(calls.map(({ method, args }) => [method, args[0]]), [
    ['error', 'WARNING: [npu_registry.cc:34] NPU accelerator could not be loaded and registered'],
    ['error', 'ERROR: LiteRT model initialization failed'],
    ['error', 'INFO: [unrelated_backend.cc:36] A diagnostic from an unknown backend'],
    ['error', 'INFO: [compiled_model.cc:812] Failed to invoke the compiled model'],
    ['error', 'INFO: [accelerator_registry.cc:54] RegisterAccelerator: ptr=0xc5fd8, name=GPU Vulkan'],
    ['error', "NotFoundError: Failed to execute 'setPointerCapture' on 'HTMLDivElement'"],
    ['warn', 'NPU accelerator could not be loaded and registered'],
    ['warn', 'WebGPU device lost']
  ]);
});

test('offscreen filter classifies known LiteRT INFO diagnostics on the stderr bridge', () => {
  const { context, calls } = loadFilter();
  const benignDiagnostics = [
    'INFO: [environment.cc:36] Creating LiteRT environment with options',
    'INFO: [accelerator_registry.cc:54] RegisterAccelerator: ptr=0xc61a0, name=CpuAccelerator',
    'INFO: [gpu_registry.cc:87] Statically linked GPU accelerator registered.',
    'INFO: [cpu_registry.cc:75] XNNPACK CPU accelerator registered.',
    'INFO: [compiled_model.cc:812] Flatbuffer model initialized directly from incoming litert model.',
    'INFO: Created TensorFlow Lite XNNPACK delegate for CPU.'
  ];

  benignDiagnostics.forEach((message) => context.console.error(message));

  assert.deepEqual(calls, []);
});

test('filter loads before LiteRT and the vendored bridge binds stderr to console.error', () => {
  const html = fs.readFileSync(OFFSCREEN_HTML, 'utf8');
  assert.ok(html.indexOf('offscreen-console-filter.js') < html.indexOf('../common/protocol.js'));
  const bridge = fs.readFileSync(WASM_BRIDGE, 'utf8');
  assert.match(bridge, /var err = console\.error\.bind\(console\);/);
  assert.match(bridge, /default_tty1_ops[\s\S]{0,800}err\(UTF8ArrayToString\(tty\.output\)\)/);
});
