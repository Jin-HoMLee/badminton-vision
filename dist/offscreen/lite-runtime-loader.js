/* global globalThis, document */
'use strict';

// LiteRT.js is intentionally loaded from the extension package. This small
// bootstrap is a classic script so the offscreen analyzer can wait for the
// ESM runtime without putting an import or a CDN URL in the MV3 HTML.
(function loadLocalLiteRt(root) {
  const current = typeof document === 'object' ? document.currentScript : null;
  const base = current && current.src ? new URL('.', current.src) : new URL('./', root.location?.href || 'file:///bso/offscreen/');
  const coreUrl = new URL('./vendor/litert/core.js', base).toString();
  const wasmPath = new URL('./vendor/litert/', base).toString();
  root.BSOLiteRuntimeReady = import(coreUrl).then(async (core) => {
    await core.loadLiteRt(wasmPath);
    // Module namespace objects are immutable; return a small plain facade so
    // analyzers can tell that the singleton runtime has already been loaded.
    return { ...core, loaded: true };
  });
}(typeof globalThis === 'object' ? globalThis : self));
