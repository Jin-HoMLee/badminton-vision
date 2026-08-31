/* global globalThis */
(function installFixtureModel(root) {
  'use strict';

  // This is a tiny committed runtime fixture, not a trained computer-vision
  // model. It makes the offscreen round trip prove that a local analyzer read
  // the captured sample without implying production shuttle/player CV.
  root.BSOFixtureModel = Object.freeze({
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
}(typeof globalThis === 'object' ? globalThis : self));
