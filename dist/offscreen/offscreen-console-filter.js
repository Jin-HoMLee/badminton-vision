/* global globalThis */
'use strict';

/**
 * Bounded console filter for the offscreen analyzer document.
 *
 * The vendored LiteRT WASM layer prints accelerator registration and
 * environment INFO lines through the emscripten stdout bridge on every load
 * (plus the wasm stdio stack frames the extension errors page shows for
 * them). Those lines are benign native diagnostics, not inference failures,
 * and they are already classified by the capability/result envelope. This
 * filter drops only the known INFO registration patterns from console.log /
 * console.info; warnings and errors stay untouched so a real model/backend
 * failure remains visible. It is loaded before the LiteRT loader so the WASM
 * glue captures the filtered methods when it binds its stdout sink.
 */
(function installOffscreenConsoleFilter(root) {
  if (!root.console || typeof root.console.log !== 'function') return;
  var patterns = [
    /^info:\s+\[(?:environment|accelerator_registry|gpu_registry|cpu_registry|compiled_model)\.cc:/i,
    /created tensorflow lite xnnpack delegate/i
  ];
  function filtered(args, fallback) {
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
  function wrap(methodName) {
    var original = root.console[methodName].bind(root.console);
    root.console[methodName] = function filteredLog() {
      if (filtered(arguments)) return;
      return original.apply(root.console, arguments);
    };
    // Keep a reference so the offscreen can restore/replace if needed and so
    // tests can verify the installed filter without touching the real console.
    root.BSOOffscreenConsoleFilter = root.BSOOffscreenConsoleFilter || {};
    root.BSOOffscreenConsoleFilter[methodName] = original;
    root.BSOOffscreenConsoleFilter.patterns = patterns;
  }
  wrap('log');
  if (typeof root.console.info === 'function') wrap('info');
}(typeof globalThis === 'object' ? globalThis : self));
