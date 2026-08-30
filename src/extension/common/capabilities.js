/* global globalThis, BSOProtocol */
(function installCapabilities(root, factory) {
  const api = factory(root.BSOProtocol);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOCapabilities = api;
}(typeof globalThis === 'object' ? globalThis : self, function capabilitiesFactory(protocol) {
  'use strict';

  function detectCapture(video, environment = globalThis) {
    const hasFrameCallback = Boolean(video && typeof video.requestVideoFrameCallback === 'function');
    const hasBitmap = typeof environment.createImageBitmap === 'function';
    if (hasFrameCallback && hasBitmap) return { mode: 'request-video-frame-callback', available: true, fallback: null };
    if (hasBitmap) return { mode: 'timer-fallback', available: true, fallback: 'requestVideoFrameCallback-unavailable' };
    return { mode: 'unavailable', available: false, fallback: 'createImageBitmap-unavailable' };
  }

  function detectRuntime(chromeApi = globalThis.chrome, video, environment = globalThis) {
    const capture = detectCapture(video, environment);
    const offscreen = Boolean(chromeApi && chromeApi.offscreen && typeof chromeApi.offscreen.createDocument === 'function');
    const fallbacks = [];
    if (capture.fallback) fallbacks.push(capture.fallback);
    if (!offscreen) fallbacks.push('offscreen-document-unavailable');
    return protocol.createCapabilityReport({
      sessionId: 'capability-probe',
      capture: capture.mode,
      transferableFrames: typeof environment.ImageBitmap === 'function' || typeof environment.VideoFrame === 'function',
      offscreen,
      inference: false,
      analyzer: 'none',
      fallbacks,
      reason: capture.available ? '' : 'Capture cannot produce frame samples in this browser'
    });
  }

  return Object.freeze({ detectCapture, detectRuntime });
}));
