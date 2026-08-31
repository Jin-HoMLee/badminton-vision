/* global globalThis, BSOProtocol, BSOFixtureModel */
(function installFixtureAnalyzer(root, factory) {
  const api = factory(root.BSOProtocol, root.BSOFixtureModel, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOFixtureAnalyzer = api;
}(typeof globalThis === 'object' ? globalThis : self, function fixtureAnalyzerFactory(protocol, model, defaultEnvironment) {
  'use strict';

  const fallbackModel = Object.freeze({
    schema: 'bso.runtime.fixture-model.v1',
    id: 'fixture-probe-v1',
    version: 1,
    kind: 'deterministic-pixel-probe',
    runtimeIntegrationTest: true,
    productionModel: false,
    algorithm: 'sampled-rgb-statistics-and-deterministic-checksum',
    maxSampledPixels: 4096,
    note: 'Local package fixture for runtime integration only; not a production CV model.'
  });
  const fixtureModel = model || fallbackModel;

  function validDimensions(frame) {
    return frame && Number.isInteger(frame.width) && frame.width > 0 &&
      Number.isInteger(frame.height) && frame.height > 0;
  }

  function directPixels(frame) {
    if (!validDimensions(frame) || !frame.data) return null;
    const pixelCount = frame.width * frame.height;
    const channels = frame.data.length / pixelCount;
    if (!Number.isInteger(channels) || channels < 3) return null;
    return { width: frame.width, height: frame.height, data: frame.data, channels };
  }

  /**
   * Read a captured ImageBitmap in the offscreen document. The direct-data
   * branch is intentionally useful for the deterministic Node integration
   * test; production capture supplies the ImageBitmap/canvas branch.
   */
  async function readFramePixels(frame, environment = defaultEnvironment) {
    const direct = directPixels(frame);
    if (direct) return direct;
    if (!validDimensions(frame)) return null;

    const Canvas = environment && environment.OffscreenCanvas;
    let canvas = Canvas ? new Canvas(frame.width, frame.height) : null;
    if (!canvas && environment && environment.document && environment.document.createElement) {
      canvas = environment.document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
    }
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof context.drawImage !== 'function' || typeof context.getImageData !== 'function') return null;
    context.drawImage(frame, 0, 0, frame.width, frame.height);
    const image = context.getImageData(0, 0, frame.width, frame.height);
    return directPixels(image);
  }

  function summarizeFrame(pixels, maxPixels = fixtureModel.maxSampledPixels) {
    if (!pixels) return null;
    const totalPixels = pixels.width * pixels.height;
    const stride = Math.max(1, Math.ceil(totalPixels / maxPixels));
    let sampledPixels = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let checksum = 2166136261;
    let peak = { value: -1, x: 0, y: 0 };
    for (let pixel = 0; pixel < totalPixels; pixel += stride) {
      const offset = pixel * pixels.channels;
      const r = Number(pixels.data[offset]) || 0;
      const g = Number(pixels.data[offset + 1]) || 0;
      const b = Number(pixels.data[offset + 2]) || 0;
      red += r;
      green += g;
      blue += b;
      checksum ^= r;
      checksum = Math.imul(checksum, 16777619);
      checksum ^= g;
      checksum = Math.imul(checksum, 16777619);
      checksum ^= b;
      checksum = Math.imul(checksum, 16777619);
      const signal = r + g + b;
      if (signal > peak.value) peak = { value: signal, x: pixel % pixels.width, y: Math.floor(pixel / pixels.width) };
      sampledPixels += 1;
    }
    const divisor = Math.max(1, sampledPixels * 255);
    return {
      width: pixels.width,
      height: pixels.height,
      sampledPixels,
      meanRgb: {
        red: Number((red / divisor).toFixed(6)),
        green: Number((green / divisor).toFixed(6)),
        blue: Number((blue / divisor).toFixed(6))
      },
      checksum: checksum >>> 0,
      peak: { x: peak.x, y: peak.y, signal: peak.value }
    };
  }

  class FixtureProbeAnalyzer {
    constructor({ environment = defaultEnvironment, fixture = fixtureModel } = {}) {
      this.environment = environment;
      this.fixture = fixture;
      this.identity = Object.freeze({
        id: fixture.id,
        version: fixture.version,
        kind: fixture.kind,
        runtimeIntegrationTest: true,
        productionModel: false
      });
    }

    async analyze(sample) {
      const pixels = await readFramePixels(sample.frame, this.environment);
      const probe = summarizeFrame(pixels, this.fixture.maxSampledPixels);
      const readable = Boolean(probe);
      return protocol.createAnalyzerResult({
        sessionId: sample.sessionId,
        requestId: sample.requestId,
        mediaTime: sample.mediaTime,
        status: readable ? 'ok' : 'fallback',
        analyzer: this.fixture.id,
        analyzerIdentity: this.identity,
        inferenceAvailable: readable,
        result: {
          kind: 'runtime-integration-probe',
          fixtureModel: this.fixture.schema,
          runtimeIntegrationTest: true,
          productionModel: false,
          shotFamily: 'unclassified',
          classificationConfidence: 0,
          geometryConfidence: 0,
          probe,
          note: readable
            ? 'Deterministic local fixture probe only; this is not production player or shuttle computer vision.'
            : 'Captured frame pixels were unavailable at the offscreen boundary; no CV claim is made.'
        }
      });
    }
  }

  return Object.freeze({ FixtureProbeAnalyzer, readFramePixels, summarizeFrame, fixtureModel });
}));
