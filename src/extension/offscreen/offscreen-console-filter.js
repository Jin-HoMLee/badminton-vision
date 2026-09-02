/* global globalThis */
'use strict';

/**
 * Bounded console filter for the offscreen analyzer document.
 *
 * LiteRT's vendored Emscripten bridge binds stdout to console.log and stderr
 * to console.error. The native WebGPU registration record is an INFO message,
 * but this LiteRT build emits it through the stderr callback; Chrome therefore
 * puts it on the extension Errors surface even though the runtime is healthy.
 * The stderr filter matches only that exact registration record plus the
 * separately known benign INFO records from the same LiteRT native components.
 * Warnings, errors, and initialization/fallback failures remain untouched.
 * This file is loaded before the LiteRT loader so the WASM glue captures the
 * wrapped methods when it binds its stdio sinks.
 */
(function installOffscreenConsoleFilter(root) {
  if (!root.console || typeof root.console.log !== 'function') return;
  var benignInfoPatterns = [
    /^info:\s+\[(?:environment|accelerator_registry|gpu_registry|cpu_registry|compiled_model)\.cc:/i,
    /created tensorflow lite xnnpack delegate/i
  ];
  // LiteRT emits these native INFO records through Emscripten's `err`
  // callback in this package. Match the observed records, not every message
  // from a component: an unrelated stderr INFO, warning, or error must still
  // reach chrome://extensions.
  var stderrInfoPatterns = [
    /^info:\s+\[environment\.cc:36\]\s+Creating LiteRT environment with options\s*$/i,
    /^info:\s+\[accelerator_registry\.cc:54\]\s+RegisterAccelerator:\s+ptr=0x[0-9a-f]+,\s+name=CpuAccelerator\s*$/i,
    /^info:\s+\[gpu_registry\.cc:87\]\s+Statically linked GPU accelerator registered\.\s*$/i,
    /^info:\s+\[cpu_registry\.cc:75\]\s+XNNPACK CPU accelerator registered\.\s*$/i,
    /^info:\s+\[compiled_model\.cc:812\]\s+Flatbuffer model initialized directly from incoming litert model\.\s*$/i,
    /^info:\s+created tensorflow lite xnnpack delegate for cpu\.\s*$/i
  ];
  // PR37's exact WebGPU registration filter is intentionally retained as its
  // own pattern. It must not become a blanket console.error suppression.
  var webGpuRegistrationPattern = /^info:\s+\[accelerator_registry\.cc:54\]\s+RegisterAccelerator:\s+ptr=0x[0-9a-f]+,\s+name=GPU WebGPU\s*$/i;
  var errorPatterns = [webGpuRegistrationPattern].concat(stderrInfoPatterns);
  function filtered(args, patterns) {
    var text = '';
    for (var index = 0; index < args.length; index += 1) {
      if (index > 0) text += ' ';
      var value = args[index];
      text += typeof value === 'string' ? value : String(value);
    }
    for (var p = 0; p < patterns.length; p += 1) {
      if (patterns[p].test(text)) return true;
    }
    return false;
  }
  function wrap(methodName, patterns) {
    if (typeof root.console[methodName] !== 'function') return;
    var original = root.console[methodName].bind(root.console);
    root.console[methodName] = function filteredLog() {
      if (filtered(arguments, patterns)) return;
      return original.apply(root.console, arguments);
    };
    // Keep a reference so the offscreen can restore/replace if needed and so
    // tests can verify the installed filter without touching the real console.
    root.BSOOffscreenConsoleFilter = root.BSOOffscreenConsoleFilter || {};
    root.BSOOffscreenConsoleFilter[methodName] = original;
    root.BSOOffscreenConsoleFilter.patterns = benignInfoPatterns;
    root.BSOOffscreenConsoleFilter.errorPatterns = errorPatterns;
  }
  wrap('log', benignInfoPatterns);
  wrap('info', benignInfoPatterns);
  wrap('error', errorPatterns);
}(typeof globalThis === 'object' ? globalThis : self));
