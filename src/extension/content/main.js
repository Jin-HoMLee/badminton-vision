/* global globalThis, BSORuntime */
(function startBadmintonRuntime(root) {
  'use strict';
  if (!root.BSORuntime || !root.document) return;
  const controller = new root.BSORuntime.RuntimeController({
    documentRef: root.document,
    windowRef: root,
    chromeApi: root.chrome
  });
  controller.start();
  // Expose a narrow diagnostic handle for browser tests and future UI work;
  // no product UI depends on this global.
  root.__BSO_RUNTIME__ = controller;
}(typeof globalThis === 'object' ? globalThis : self));
