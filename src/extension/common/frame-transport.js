/* global globalThis */
(function installFrameTransport(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOFrameTransport = api;
}(typeof globalThis === 'object' ? globalThis : self, function frameTransportFactory() {
  'use strict';

  const SERIALIZABLE_FORMAT = 'rgba-array-v1';
  const BITMAP_FORMAT = 'image-bitmap';
  // The production pose model reads a 256x256 input. Capping the serialized
  // frame at a 256px long edge (256x144 for 16:9) keeps the model input
  // usable while bounding message size; the pixel bound below is only a
  // safety net for extreme aspect ratios.
  const DEFAULT_MAX_LONG_EDGE = 256;
  const DEFAULT_MAX_PIXELS = 65536;

  function positiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  function manifestFor(chromeApi) {
    if (!chromeApi?.runtime || typeof chromeApi.runtime.getManifest !== 'function') return null;
    try { return chromeApi.runtime.getManifest(); } catch (_) { return null; }
  }

  /**
   * Structured-clone messaging is an optional channel capability, not a
   * stable-channel manifest assumption. The public manifest deliberately
   * omits message_serialization because Chrome stable reports it as a Canary-
   * only manifest key. A future channel may opt in explicitly and retain the
   * ImageBitmap path without changing capture or analyzer contracts.
   */
  function supportsStructuredClone(chromeApi) {
    return manifestFor(chromeApi)?.message_serialization === 'structured_clone';
  }

  function selectTransport(chromeApi) {
    return supportsStructuredClone(chromeApi) ? BITMAP_FORMAT : SERIALIZABLE_FORMAT;
  }

  function targetDimensions(width, height, { maxPixels = DEFAULT_MAX_PIXELS, maxLongEdge = DEFAULT_MAX_LONG_EDGE } = {}) {
    if (!positiveInteger(width) || !positiveInteger(height)) throw new TypeError('frame dimensions must be positive integers');
    const limit = positiveInteger(maxPixels) ? maxPixels : DEFAULT_MAX_PIXELS;
    const edge = positiveInteger(maxLongEdge) ? maxLongEdge : DEFAULT_MAX_LONG_EDGE;
    const scale = Math.min(1, Math.sqrt(limit / (width * height)), edge / Math.max(width, height));
    let targetWidth = Math.max(1, Math.round(width * scale));
    let targetHeight = Math.max(1, Math.round(height * scale));
    while (targetWidth * targetHeight > limit) {
      if (targetWidth >= targetHeight && targetWidth > 1) targetWidth -= 1;
      else if (targetHeight > 1) targetHeight -= 1;
      else break;
    }
    while (Math.max(targetWidth, targetHeight) > edge) {
      if (targetWidth >= targetHeight && targetWidth > 1) targetWidth -= 1;
      else if (targetHeight > 1) targetHeight -= 1;
      else break;
    }
    return { width: targetWidth, height: targetHeight };
  }

  function createCanvas(width, height, environment) {
    const source = environment || globalThis;
    const Canvas = source && source.OffscreenCanvas;
    if (typeof Canvas === 'function') return new Canvas(width, height);
    if (source?.document && typeof source.document.createElement === 'function') {
      const canvas = source.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    return null;
  }

  /**
   * Convert the captured bitmap to a bounded plain object for Chrome stable's
   * default JSON extension messaging. This keeps ImageBitmap as the capture
   * primitive, but never sends an object that stable JSON serialization would
   * silently turn into `{}`. The fixture analyzer only needs sampled pixels,
   * so the fallback is intentionally capped rather than sending a full-size
   * video frame through the service worker. The bound is a 256px long edge,
   * which is the production pose model's input width.
   */
  async function toSerializableFrame(frame, {
    environment = globalThis,
    maxPixels = DEFAULT_MAX_PIXELS,
    maxLongEdge = DEFAULT_MAX_LONG_EDGE
  } = {}) {
    if (!frame || !positiveInteger(frame.width) || !positiveInteger(frame.height)) {
      throw new TypeError('captured frame dimensions are unavailable');
    }
    const dimensions = targetDimensions(frame.width, frame.height, { maxPixels, maxLongEdge });
    const canvas = createCanvas(dimensions.width, dimensions.height, environment);
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('frame serialization canvas unavailable');
    }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof context.drawImage !== 'function' || typeof context.getImageData !== 'function') {
      throw new Error('frame serialization pixel read unavailable');
    }
    context.drawImage(frame, 0, 0, dimensions.width, dimensions.height);
    const image = context.getImageData(0, 0, dimensions.width, dimensions.height);
    if (!image || !image.data || image.data.length !== dimensions.width * dimensions.height * 4) {
      throw new Error('frame serialization returned invalid RGBA data');
    }
    return {
      frame: {
        width: dimensions.width,
        height: dimensions.height,
        data: Array.from(image.data)
      },
      frameFormat: SERIALIZABLE_FORMAT,
      transferables: [],
      releaseSource: true,
      sourceDimensions: { width: frame.width, height: frame.height }
    };
  }

  async function prepareFrame(frame, {
    mode = SERIALIZABLE_FORMAT,
    environment = globalThis,
    maxPixels = DEFAULT_MAX_PIXELS,
    maxLongEdge = DEFAULT_MAX_LONG_EDGE
  } = {}) {
    if (mode === BITMAP_FORMAT) {
      return {
        frame,
        frameFormat: BITMAP_FORMAT,
        transferables: [frame],
        releaseSource: false,
        sourceDimensions: { width: frame?.width || 0, height: frame?.height || 0 }
      };
    }
    return toSerializableFrame(frame, { environment, maxPixels, maxLongEdge });
  }

  return Object.freeze({
    SERIALIZABLE_FORMAT,
    BITMAP_FORMAT,
    DEFAULT_MAX_LONG_EDGE,
    DEFAULT_MAX_PIXELS,
    supportsStructuredClone,
    selectTransport,
    targetDimensions,
    toSerializableFrame,
    prepareFrame
  });
}));
