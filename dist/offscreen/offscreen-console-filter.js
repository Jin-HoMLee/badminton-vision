/* global globalThis */
'use strict';

/**
 * Bounded console filter for the offscreen analyzer document.
 *
 * LiteRT's vendored Emscripten bridge binds stdout to console.log and stderr
 * to console.error. The native WebGPU registration record is an INFO message,
 * but this LiteRT build emits it through the stderr callback; Chrome therefore
 * puts it on the extension Errors surface even though the runtime is healthy.
 * The stderr filter matches only that exact registration record. The older
 * stdout/info filters retain their bounded, known-benign diagnostic behavior;
 * warnings, errors, and initialization/fallback failures remain untouched.
 * This file is loaded before the LiteRT loader so the WASM glue captures the
 * wrapped methods when it binds its stdio sinks.
 */
(function installOffscreenConsoleFilter(root) {
  if (!root.console || typeof root.console.log !== 'function') return;
  var logPatterns = [
    /^info:\s+\[(?:environment|accelerator_registry|gpu_registry|cpu_registry|compiled_model)\.cc:/i,
    /created tensorflow lite xnnpack delegate/i
  ];
  // LiteRT emits this record through Emscripten's `err` callback. Keep this
  // deliberately stricter than logPatterns: do not hide other stderr INFO
  // records, warnings, errors, or diagnostics that happen to mention GPU.
  var errorPatterns = [
    /^info:\s+\[accelerator_registry\.cc:54\]\s+RegisterAccelerator:\s+.*\bname=GPU WebGPU\s*$/i
  ];
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
    root.BSOOffscreenConsoleFilter.patterns = logPatterns;
    root.BSOOffscreenConsoleFilter.errorPatterns = errorPatterns;
  }
  wrap('log', logPatterns);
  wrap('info', logPatterns);
  wrap('error', errorPatterns);
}(typeof globalThis === 'object' ? globalThis : self));
