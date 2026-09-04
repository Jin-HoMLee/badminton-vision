/* global globalThis, BSOProtocol */
/**
 * EfficientDet-Lite0 (COCO) racket detector adapter for the offscreen
 * analyzer. Runs the Apache-2.0 MediaPipe model-zoo EfficientDet-Lite0
 * artifact (float16) on the LiteRT.js runtime already vendored for
 * Lightweight OpenPose, decodes its raw [1, 19206, 90] class logits and
 * [1, 19206, 4] box deltas with the EfficientDet reference anchor geometry,
 * and emits bounding boxes for exactly one class: COCO "tennis racket"
 * (class index 42 of the artifact's embedded 90-entry label map). The strict
 * per-class filter is intentional: a high-confidence person, ball, or any
 * other COCO class is never relabeled as a racket.
 *
 * Provenance, artifact checksum, input/output contract, and fixture sources
 * are recorded in vendor/efficientdet-lite0/MODEL-NOTICE.md.
 */
(function installEfficientDetRacketAdapter(root, factory) {
  const api = factory(root.BSOProtocol, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOEfficientDetRacketAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function efficientDetRacketAdapterFactory(protocol, defaultEnvironment) {
  'use strict';

  // The checkpoint is the explicit Apache-2.0 MediaPipe model-zoo artifact
  // documented in vendor/efficientdet-lite0/MODEL-NOTICE.md. Only the COCO
  // "tennis racket" class is consumed; no other model is involved.
  const MODEL = Object.freeze({
    schema: 'bso.litert.model.v1',
    id: 'efficientdet-lite0-racket-v1',
    version: 1,
    kind: 'local-litert-tflite-racket-detector',
    modelUrl: './vendor/efficientdet-lite0/efficientdet_lite0.tflite',
    sourceUrl: 'https://ai.google.dev/edge/mediapipe/models/object_detection',
    sourceModelUrl: 'https://tfhub.dev/google/lite-model/efficientdet/lite0/detection/metadata/1',
    license: 'Apache-2.0',
    licenseStatus: 'cleared-for-redistribution',
    inputShape: [1, 320, 320, 3],
    anchorCount: 19206,
    classCount: 90,
    racketClassIndex: 42,
    racketClassName: 'tennis racket'
  });
  const BACKENDS = Object.freeze(['webgpu', 'webgl', 'wasm']);
  const DEFAULTS = Object.freeze({
    inputDimension: 320,
    // Bounded below/above the observed absent-class noise floor (~0.50-0.52
    // for class 42 on racket-free frames) and the weakest observed real
    // detections (>= ~0.55 on the vendored model); see MODEL-NOTICE.md and
    // test/efficientdet-racket-real-model.test.js for the measured margins.
    confidenceThreshold: 0.53,
    iouThreshold: 0.5,
    maxDetections: 4,
    anchorScale: 3.0,
    aspectRatios: Object.freeze([1.0, 2.0, 0.5])
  });
  const LEVEL_GRIDS = Object.freeze([40, 20, 10, 5, 3]); // levels 3..7 at 320px

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizedNumber(value) {
    return Number(value.toFixed(6));
  }

  function sigmoid(value) {
    return 1 / (1 + Math.exp(-Number(value)));
  }

  function dispose(value, seen = new Set()) {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => dispose(item, seen));
      if (typeof value.delete === 'function') value.delete();
      return;
    }
    if (typeof value.delete === 'function') value.delete();
    else if (typeof value.dispose === 'function') value.dispose();
  }

  function localUrl(url) {
    if (typeof url !== 'string' || !url.trim()) throw new TypeError('LiteRT model URL must be a non-empty string');
    const value = url.trim();
    if (/^(?:https?:)?\/\//i.test(value)) throw new TypeError('LiteRT model URL must resolve to the locally vendored artifact');
    return value;
  }

  function resolveLocalUrl(url, environment) {
    const value = localUrl(url);
    const href = environment?.location?.href;
    if (!href || typeof URL !== 'function') return value;
    const resolved = new URL(value, href);
    if (resolved.protocol !== 'chrome-extension:' && resolved.protocol !== 'file:') {
      throw new TypeError('LiteRT model URL resolved outside the extension package');
    }
    return resolved.toString();
  }

  function dimensions(frame) {
    const width = Number(frame?.width);
    const height = Number(frame?.height);
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new TypeError('LiteRT frame dimensions must be positive integers');
    }
    return { width, height };
  }

  function directPixels(frame) {
    const size = dimensions(frame);
    if (!frame?.data) return null;
    const channels = frame.data.length / (size.width * size.height);
    if (!Number.isInteger(channels) || channels < 3) return null;
    return { ...size, data: frame.data, channels };
  }

  async function readFramePixels(frame, environment = defaultEnvironment) {
    const direct = directPixels(frame);
    if (direct) return direct;
    const size = dimensions(frame);
    const Canvas = environment?.OffscreenCanvas;
    let canvas = typeof Canvas === 'function' ? new Canvas(size.width, size.height) : null;
    if (!canvas && environment?.document?.createElement) {
      canvas = environment.document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
    }
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof context.drawImage !== 'function' || typeof context.getImageData !== 'function') return null;
    context.drawImage(frame, 0, 0, size.width, size.height);
    const image = context.getImageData(0, 0, size.width, size.height);
    return directPixels(image);
  }

  function shapeOf(output) {
    if (!output) return null;
    if (Array.isArray(output.shape)) return output.shape;
    if (output.shape && typeof output.shape.length === 'number') return Array.from(output.shape);
    const dimensionsValue = output.type?.layout?.dimensions;
    if (typeof dimensionsValue === 'function') {
      const value = dimensionsValue();
      if (value && typeof value.length === 'number') return Array.from(value);
    }
    if (dimensionsValue && typeof dimensionsValue.length === 'number') return Array.from(dimensionsValue);
    return null;
  }

  async function outputData(output) {
    if (output && typeof output.toTypedArray === 'function') return output.toTypedArray();
    if (output && typeof output.data === 'function') return output.data();
    if (output && typeof output.dataSync === 'function') return output.dataSync();
    if (output && ArrayBuffer.isView(output)) return output;
    throw new TypeError('LiteRT output tensor cannot be read');
  }

  /**
   * Generate the 19,206 EfficientDet-Lite0 anchor boxes (level 3..7 grids at
   * 40/20/10/5/3 cells for a 320px input, anchor scale 3.0, three scale
   * octaves 2^(0/3..2/3), aspect ratios [1.0, 2.0, 0.5], y-major cell order,
   * level blocks ascending). Units are pixels on the 320px grid, in
   * [ymin, xmin, ymax, xmax] order. The generator reproduces the artifact's
   * embedded fixed-anchor table exactly (see MODEL-NOTICE.md), so decode does
   * not parse model metadata at runtime.
   */
  function generateAnchors(dimension = DEFAULTS.inputDimension, anchorScale = DEFAULTS.anchorScale, aspectRatios = DEFAULTS.aspectRatios, grids = LEVEL_GRIDS) {
    const size = Number(dimension);
    const scale = Number(anchorScale);
    if (!Number.isInteger(size) || size < 1 || !finite(scale)) throw new TypeError('anchor generation requires a positive integer grid dimension');
    const ratios = Array.from(aspectRatios || []).map(Number);
    if (!ratios.length || ratios.some((value) => !finite(value) || value <= 0)) throw new TypeError('anchor generation requires positive aspect ratios');
    const perLevel = [];
    let anchorCount = 0;
    for (const cells of grids) {
      if (!Number.isInteger(cells) || cells < 1) throw new TypeError('anchor grid sizes must be positive integers');
      const stride = size / cells;
      const perCell = [];
      for (let octave = 0; octave < 3; octave += 1) {
        for (const aspect of ratios) {
          const base = scale * stride * Math.pow(2, octave / 3);
          const aspectX = Math.sqrt(aspect);
          const aspectY = 1 / aspectX;
          perCell.push({ halfWidth: base * aspectX / 2, halfHeight: base * aspectY / 2 });
        }
      }
      const boxes = new Float64Array(cells * cells * perCell.length * 4);
      let offset = 0;
      for (let row = 0; row < cells; row += 1) {
        const centerY = (row + 0.5) * stride;
        for (let column = 0; column < cells; column += 1) {
          const centerX = (column + 0.5) * stride;
          for (const anchor of perCell) {
            boxes[offset] = centerY - anchor.halfHeight;
            boxes[offset + 1] = centerX - anchor.halfWidth;
            boxes[offset + 2] = centerY + anchor.halfHeight;
            boxes[offset + 3] = centerX + anchor.halfWidth;
            offset += 4;
          }
        }
      }
      perLevel.push(boxes);
      anchorCount += boxes.length / 4;
    }
    if (anchorCount !== MODEL.anchorCount) throw new Error(`EfficientDet anchor count mismatch: ${anchorCount}`);
    const flat = new Float64Array(anchorCount * 4);
    let flatOffset = 0;
    for (const level of perLevel) {
      flat.set(level, flatOffset);
      flatOffset += level.length;
    }
    return { count: anchorCount, perLevel, flat };
  }

  let anchorsCache = null;
  function anchorsFor(dimension) {
    if (!anchorsCache || anchorsCache.dimension !== dimension) {
      anchorsCache = { dimension, ...generateAnchors(dimension) };
    }
    return anchorsCache;
  }

  /**
   * Resize the bounded RGBA capture frame onto the 320px model grid with
   * bilinear sampling and normalize with the artifact's declared input
   * contract: RGB pixels scaled by (pixel - 127.5) / 127.5. Deterministic and
   * allocation-bounded (320*320*3 floats), mirroring the capture boundary that
   * already bounds frames to a 256px long edge.
   */
  function createInputPixels(pixels, dimension = DEFAULTS.inputDimension) {
    if (!pixels || !Number.isInteger(dimension) || dimension < 1) throw new TypeError('input pixels are unavailable');
    const sourceWidth = Number(pixels.width);
    const sourceHeight = Number(pixels.height);
    if (!Number.isInteger(sourceWidth) || sourceWidth < 1 || !Number.isInteger(sourceHeight) || sourceHeight < 1) {
      throw new TypeError('source pixels require positive integer dimensions');
    }
    const channels = Number(pixels.channels);
    if (!Number.isInteger(channels) || channels < 3) throw new TypeError('source pixels require at least 3 channels');
    const data = pixels.data;
    if (!data || data.length < sourceWidth * sourceHeight * channels) throw new TypeError('source pixel buffer is truncated');
    const output = new Float32Array(dimension * dimension * 3);
    for (let y = 0; y < dimension; y += 1) {
      const sourceY = Math.min(sourceHeight - 1, y * sourceHeight / dimension);
      const y0 = Math.floor(sourceY);
      const yWeight = sourceY - y0;
      const y1 = Math.min(sourceHeight - 1, y0 + 1);
      for (let x = 0; x < dimension; x += 1) {
        const sourceX = Math.min(sourceWidth - 1, x * sourceWidth / dimension);
        const x0 = Math.floor(sourceX);
        const xWeight = sourceX - x0;
        const x1 = Math.min(sourceWidth - 1, x0 + 1);
        const targetOffset = (y * dimension + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          const p00 = Number(data[(y0 * sourceWidth + x0) * channels + channel]) || 0;
          const p01 = Number(data[(y0 * sourceWidth + x1) * channels + channel]) || 0;
          const p10 = Number(data[(y1 * sourceWidth + x0) * channels + channel]) || 0;
          const p11 = Number(data[(y1 * sourceWidth + x1) * channels + channel]) || 0;
          const top = p00 * (1 - xWeight) + p01 * xWeight;
          const bottom = p10 * (1 - xWeight) + p11 * xWeight;
          const pixel = top * (1 - yWeight) + bottom * yWeight;
          output[targetOffset + channel] = (pixel - 127.5) / 127.5;
        }
      }
    }
    return output;
  }

  function intersectionOverUnion(a, b) {
    const intersectionWidth = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
    const intersectionHeight = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (intersectionWidth <= 0 || intersectionHeight <= 0) return 0;
    const intersection = intersectionWidth * intersectionHeight;
    const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
    const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
    return intersection / (areaA + areaB - intersection);
  }

  /**
   * Decode the raw EfficientDet outputs into racket detections. Scores are
   * the per-anchor logits over the artifact's 90-entry COCO label map
   * (row-major [anchor][class]); boxes are the per-anchor regression deltas
   * [ty, tx, th, tw]. Only anchors whose sigmoid score at the tennis-racket
   * class index clears the threshold are decoded (a strict class filter: the
   * argmax class of any other COCO object is never emitted as a racket).
   * Decoded boxes are normalized [ymin, xmin, ymax, xmax] on the model grid
   * and collapsed with per-class NMS. Deterministic; no runtime state.
   */
  function decodeEfficientDetOutput({ scores, boxes, dimension = DEFAULTS.inputDimension, confidenceThreshold = DEFAULTS.confidenceThreshold, iouThreshold = DEFAULTS.iouThreshold, maxDetections = DEFAULTS.maxDetections, classIndex = MODEL.racketClassIndex } = {}) {
    const size = Number(dimension);
    const threshold = Number(confidenceThreshold);
    const iou = Number(iouThreshold);
    const limit = Number(maxDetections);
    if (!Number.isInteger(size) || size < 1) throw new TypeError('decode requires a positive integer grid dimension');
    if (!finite(threshold) || threshold <= 0 || threshold >= 1) throw new TypeError('confidence threshold must be in (0, 1)');
    if (!finite(iou) || iou <= 0 || iou >= 1) throw new TypeError('NMS IoU threshold must be in (0, 1)');
    if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new TypeError('max detections must be a small positive integer');
    const classId = Number(classIndex);
    if (!Number.isInteger(classId) || classId < 0 || classId >= MODEL.classCount) throw new TypeError('class index must address the 90-entry label map');
    const anchors = anchorsFor(size);
    const expected = anchors.count * MODEL.classCount;
    const boxCount = anchors.count * 4;
    if (!scores || scores.length !== expected) throw new Error(`Unexpected EfficientDet class output length: ${scores?.length || 0}`);
    if (!boxes || boxes.length !== boxCount) throw new Error(`Unexpected EfficientDet box output length: ${boxes?.length || 0}`);

    const candidates = [];
    for (let anchorIndex = 0; anchorIndex < anchors.count; anchorIndex += 1) {
      const score = sigmoid(scores[anchorIndex * MODEL.classCount + classId]);
      if (!(score >= threshold)) continue;
      const flatOffset = anchorIndex * 4;
      const deltaY = Number(boxes[flatOffset]) || 0;
      const deltaX = Number(boxes[flatOffset + 1]) || 0;
      const deltaHeight = Number(boxes[flatOffset + 2]) || 0;
      const deltaWidth = Number(boxes[flatOffset + 3]) || 0;
      if (![deltaY, deltaX, deltaHeight, deltaWidth].every(finite)) continue;
      const anchorYMin = anchors.flat[flatOffset];
      const anchorXMin = anchors.flat[flatOffset + 1];
      const anchorYMax = anchors.flat[flatOffset + 2];
      const anchorXMax = anchors.flat[flatOffset + 3];
      const anchorHeight = anchorYMax - anchorYMin;
      const anchorWidth = anchorXMax - anchorXMin;
      const centerY = (anchorYMin + anchorYMax) / 2;
      const centerX = (anchorXMin + anchorXMax) / 2;
      const height = Math.exp(deltaHeight) * anchorHeight;
      const width = Math.exp(deltaWidth) * anchorWidth;
      const decodedCenterY = deltaY * anchorHeight + centerY;
      const decodedCenterX = deltaX * anchorWidth + centerX;
      candidates.push({
        y1: (decodedCenterY - height / 2) / size,
        x1: (decodedCenterX - width / 2) / size,
        y2: (decodedCenterY + height / 2) / size,
        x2: (decodedCenterX + width / 2) / size,
        confidence: score
      });
    }
    if (!candidates.length) return { detections: [] };
    candidates.sort((a, b) => b.confidence - a.confidence || a.y1 - b.y1 || a.x1 - b.x1);
    const kept = [];
    for (const candidate of candidates) {
      if (kept.length >= limit) break;
      if (kept.some((existing) => intersectionOverUnion(existing, candidate) > iou)) continue;
      kept.push(candidate);
    }
    return {
      detections: kept.map((box) => {
        const clamped = {
          x1: clamp(box.x1),
          y1: clamp(box.y1),
          x2: clamp(box.x2),
          y2: clamp(box.y2)
        };
        return {
          bbox: {
            x: normalizedNumber(clamped.x1),
            y: normalizedNumber(clamped.y1),
            width: normalizedNumber(Math.max(0, clamped.x2 - clamped.x1)),
            height: normalizedNumber(Math.max(0, clamped.y2 - clamped.y1))
          },
          confidence: normalizedNumber(box.confidence),
          class: MODEL.racketClassName,
          classIndex: MODEL.racketClassIndex,
          state: 'tracked'
        };
      }).filter((detection) => detection.bbox.width > 0 && detection.bbox.height > 0)
    };
  }

  async function webGpuDevice(environment) {
    const gpu = environment?.navigator?.gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') throw new Error('WebGPU unavailable');
    const adapter = await gpu.requestAdapter();
    if (!adapter || typeof adapter.requestDevice !== 'function') throw new Error('WebGPU adapter unavailable');
    return adapter.requestDevice();
  }

  function normalizeBackendResult(name, result) {
    if (result === true) return { name, ok: true, reason: '' };
    return { name, ok: Boolean(result?.ok), reason: result?.reason || (result?.ok ? '' : `${name} backend probe failed`), model: result?.model || null };
  }

  /** Compile the racket artifact on the first usable backend (WebGPU then
   * WASM; LiteRT.js WebGL is reported as unsupported rather than mislabeled),
   * mirroring the pose adapter's backend selection. */
  async function selectLiteRtBackend({ runtime, modelUrl, environment = defaultEnvironment, order = BACKENDS, backendProbe = null, onStatus = () => {} } = {}) {
    if (!runtime || typeof runtime.loadAndCompile !== 'function') return { backend: null, attempted: [], fallbacks: ['litert-runtime-unavailable'] };
    const candidates = Array.from(new Set((Array.isArray(order) ? order : BACKENDS).filter((name) => BACKENDS.includes(name))));
    const attempted = [];
    for (const name of candidates) {
      onStatus({ type: 'backend-probe', backend: name });
      let result;
      if (backendProbe) result = await backendProbe(name, runtime);
      else if (name === 'webgl') result = { ok: false, reason: 'litert-webgl-backend-unsupported' };
      else {
        try {
          if (name === 'webgpu') {
            const device = await webGpuDevice(environment);
            if (typeof runtime.setWebGpuDevice !== 'function') throw new Error('LiteRT WebGPU device binding unavailable');
            runtime.setWebGpuDevice(device);
          }
          const model = await runtime.loadAndCompile(modelUrl, { accelerator: name });
          if (name === 'webgpu' && model && model.isFullyAccelerated === false) {
            dispose(model);
            result = { ok: false, reason: 'webgpu-model-not-fully-accelerated' };
          } else result = { ok: true, model };
        } catch (error) {
          result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
        }
      }
      const normalized = normalizeBackendResult(name, result);
      attempted.push(normalized);
      if (normalized.ok) {
        const fallbacks = attempted.slice(0, -1).map((item) => `backend-${item.name}-unavailable`);
        onStatus({ type: 'backend-selected', backend: name, fallbacks });
        return { backend: name, model: normalized.model || result?.model || null, attempted, fallbacks };
      }
      onStatus({ type: 'backend-unavailable', backend: name, reason: normalized.reason });
    }
    return { backend: null, model: null, attempted, fallbacks: attempted.map((item) => `backend-${item.name}-unavailable`) };
  }

  function unknownEvidence(reason) {
    return {
      state: 'unknown',
      confidence: null,
      detections: [],
      detectionMethod: 'efficientdet-lite0-tennis-racket',
      reason
    };
  }

  class EfficientDetRacketDetector {
    constructor({
      runtime = null,
      runtimeReady = defaultEnvironment.BSOLiteRuntimeReady,
      environment = defaultEnvironment,
      modelUrl = MODEL.modelUrl,
      wasmPath = './vendor/litert/',
      backendOrder = BACKENDS,
      backendProbe = null,
      confidenceThreshold = DEFAULTS.confidenceThreshold,
      iouThreshold = DEFAULTS.iouThreshold,
      maxDetections = DEFAULTS.maxDetections,
      onStatus = () => {}
    } = {}) {
      this.runtime = runtime;
      this.runtimeReady = runtimeReady;
      this.environment = environment;
      this.modelUrl = localUrl(modelUrl);
      this.wasmPath = localUrl(wasmPath);
      this.backendOrder = backendOrder;
      this.backendProbe = backendProbe;
      this.confidenceThreshold = confidenceThreshold;
      this.iouThreshold = iouThreshold;
      this.maxDetections = maxDetections;
      this.onStatus = onStatus;
      this.model = null;
      this.backend = null;
      this.backendReport = null;
      this.initialization = null;
      this.failed = null;
      this.inFlight = false;
      this.inFlightMediaTime = null;
      this.identity = Object.freeze({
        id: MODEL.id,
        version: MODEL.version,
        kind: MODEL.kind,
        model: 'MediaPipe EfficientDet-Lite0 (COCO float16)',
        modelVersion: MODEL.version,
        localArtifact: MODEL.modelUrl,
        sourceUrl: MODEL.sourceUrl,
        sourceModelUrl: MODEL.sourceModelUrl,
        license: MODEL.license,
        licenseStatus: MODEL.licenseStatus,
        runtime: '@litertjs/core 2.5.3',
        runtimeLicense: 'Apache-2.0',
        runtimeIntegrationTest: false,
        productionModel: true,
        classFilter: { label: MODEL.racketClassName, classIndex: MODEL.racketClassIndex, classCount: MODEL.classCount }
      });
    }

    status(value) {
      try { this.onStatus(value); } catch (_) { /* status observers cannot break inference */ }
    }

    async initialize() {
      if (this.initialization) return this.initialization;
      this.initialization = (async () => {
        try {
          const runtime = this.runtime || (this.runtimeReady ? await this.runtimeReady : null);
          if (!runtime) throw new Error('litert-runtime-unavailable');
          this.runtime = runtime;
          const runtimeLoaded = runtime.loaded === true || runtime.loadAndCompile?.__bsoLoaded === true;
          if (typeof runtime.loadLiteRt === 'function' && !runtimeLoaded) {
            const wasmUrl = resolveLocalUrl(this.wasmPath, this.environment);
            await runtime.loadLiteRt(wasmUrl);
            if (runtime.loadAndCompile) runtime.loadAndCompile.__bsoLoaded = true;
          }
          const modelUrl = resolveLocalUrl(this.modelUrl, this.environment);
          this.backendReport = await selectLiteRtBackend({ runtime, modelUrl, environment: this.environment, order: this.backendOrder, backendProbe: this.backendProbe, onStatus: (value) => this.status(value) });
          if (!this.backendReport.backend || !this.backendReport.model) {
            throw new Error(this.backendReport.attempted.at(-1)?.reason || 'no-usable-inference-backend');
          }
          this.backend = this.backendReport.backend;
          this.model = this.backendReport.model;
          this.status({ type: 'model-ready', backend: this.backend, model: MODEL.id });
          return { available: true, backend: this.backend, fallbacks: this.backendReport.fallbacks };
        } catch (error) {
          this.failed = error instanceof Error ? error.message : String(error);
          dispose(this.model);
          this.model = null;
          this.status({ type: 'model-failure', reason: this.failed, fallbacks: this.backendReport?.fallbacks || ['local-model-artifact-unavailable'] });
          return { available: false, reason: this.failed, fallbacks: this.backendReport?.fallbacks || ['local-model-artifact-unavailable'] };
        }
      })();
      return this.initialization;
    }

    async infer(frame) {
      const pixels = await readFramePixels(frame, this.environment);
      if (!pixels) throw new Error('frame-pixels-unavailable');
      if (!this.runtime?.Tensor || typeof this.model?.run !== 'function') throw new Error('LiteRT tensor/model API is unavailable');
      const inputPixels = createInputPixels(pixels, DEFAULTS.inputDimension);
      const input = new this.runtime.Tensor(inputPixels, [1, DEFAULTS.inputDimension, DEFAULTS.inputDimension, 3]);
      let outputs = null;
      try {
        outputs = await this.model.run(input);
        // Output order is fixed by the artifact: index 0 holds the per-anchor
        // class logits [1, 19206, 90] and index 1 the box deltas [1, 19206, 4].
        const scoresOutput = Array.isArray(outputs) ? outputs[0] : outputs;
        const boxesOutput = Array.isArray(outputs) ? outputs[1] : null;
        if (!scoresOutput || !boxesOutput) throw new Error('Unexpected EfficientDet output count');
        const scoresShape = shapeOf(scoresOutput);
        const boxesShape = shapeOf(boxesOutput);
        if (!scoresShape || scoresShape.length !== 3 || scoresShape[1] !== MODEL.anchorCount || scoresShape[2] !== MODEL.classCount) {
          throw new Error(`Unexpected EfficientDet class output shape: [${(scoresShape || []).join(', ')}]`);
        }
        if (!boxesShape || boxesShape.length !== 3 || boxesShape[1] !== MODEL.anchorCount || boxesShape[2] !== 4) {
          throw new Error(`Unexpected EfficientDet box output shape: [${(boxesShape || []).join(', ')}]`);
        }
        const scoresHost = scoresOutput && typeof scoresOutput.moveTo === 'function' ? await scoresOutput.moveTo('wasm') : scoresOutput;
        const boxesHost = boxesOutput && typeof boxesOutput.moveTo === 'function' ? await boxesOutput.moveTo('wasm') : boxesOutput;
        try {
          return decodeEfficientDetOutput({
            scores: await outputData(scoresHost),
            boxes: await outputData(boxesHost),
            confidenceThreshold: this.confidenceThreshold,
            iouThreshold: this.iouThreshold,
            maxDetections: this.maxDetections
          });
        } finally {
          if (scoresHost !== scoresOutput) dispose(scoresHost);
          if (boxesHost !== boxesOutput) dispose(boxesHost);
        }
      } finally {
        const seen = new Set();
        dispose(outputs, seen);
        dispose(input, seen);
      }
    }

    /**
     * Analyze one accepted frame sample. Stateless per frame (no tracker):
     * each accepted frame contributes fresh racket evidence, and the result
     * is deterministic for identical frames.
     */
    async analyze(sample) {
      const sessionId = String(sample?.sessionId || 'unknown-session');
      const requestId = String(sample?.requestId || 'unknown-request');
      const mediaTime = sample?.mediaTime;
      if (!finite(mediaTime) || mediaTime < 0) return unknownEvidence('invalid-media-time');
      if (this.inFlight) {
        this.status({ type: 'inference-status', status: 'backpressure', requestId, mediaTime, inFlightMediaTime: this.inFlightMediaTime });
        return null;
      }
      this.inFlight = true;
      this.inFlightMediaTime = mediaTime;
      try {
        const initialized = await this.initialize();
        if (!initialized.available) return unknownEvidence(initialized.reason || 'model-unavailable');
        const decoded = await this.infer(sample.frame);
        const detections = Array.isArray(decoded.detections) ? decoded.detections : [];
        if (!detections.length) return unknownEvidence('no-tennis-racket-detection');
        return {
          state: 'tracked',
          confidence: normalizedNumber(Math.max(...detections.map((detection) => detection.confidence))),
          detections,
          detectionMethod: 'efficientdet-lite0-tennis-racket',
          reason: 'coco-tennis-racket-detections',
          segmentationAvailable: false,
          detector: this.identity,
          sessionId,
          requestId,
          mediaTime
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.failed = reason;
        this.status({ type: 'inference-failure', requestId, mediaTime, reason });
        return unknownEvidence(reason);
      } finally {
        this.inFlight = false;
        this.inFlightMediaTime = null;
      }
    }

    resetSession() {
      return { sessionId: null, reason: 'racket-detector-is-stateless' };
    }

    endSession() {
      return { sessionId: null, reason: 'racket-detector-is-stateless' };
    }

    dispose() {
      dispose(this.model);
      this.model = null;
    }
  }

  return Object.freeze({
    MODEL,
    BACKENDS,
    DEFAULTS,
    LEVEL_GRIDS,
    generateAnchors,
    createInputPixels,
    decodeEfficientDetOutput,
    sigmoid,
    readFramePixels,
    selectLiteRtBackend,
    EfficientDetRacketDetector
  });
}));
