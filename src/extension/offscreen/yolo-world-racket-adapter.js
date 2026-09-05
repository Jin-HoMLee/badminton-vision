/* global globalThis, BSOProtocol */
/**
 * YOLO-World open-vocabulary racket detector adapter (EXPERIMENTAL) for the
 * offscreen analyzer. This is the YOLO-World MVP revived from the
 * fm/badminton-racket-yolo-world work and made selectable next to the
 * production EfficientDet-Lite0 detector; it is NOT the shipped default.
 *
 * Licensing and provenance: the prepared ONNX artifact is produced from the
 * AGPL-3.0 Ultralytics `yolov8s-world.pt` asset by
 * `scripts/prepare-yolo-world.mjs` and is never distributed in the default
 * package; the vendor directory carries the license records
 * (`vendor/yolo-world/MODEL-NOTICE.md` and `vendor/yolo-world/LICENSE`).
 * Selecting this model in the public build carries AGPL-3.0 source-disclosure
 * terms for anyone who redistributes the prepared artifact, which is why the
 * entry is experimental and opt-in only. The captain accepted that trade for
 * an experimental comparison entry, never for the shipped default.
 *
 * Experimental behavior: research-measured at roughly 2-6 s per frame in the
 * MV3 offscreen document (archive-grade, not for live play). The adapter
 * emits racket evidence in the same envelope as the EfficientDet detector so
 * the composition and the overlay consume either model without branching.
 */
(function installYoloWorldRacketAdapter(root, factory) {
  const api = factory(root.BSOProtocol, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOYoloWorldRacketAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function yoloWorldRacketAdapterFactory(protocol, defaultEnvironment) {
  'use strict';

  // The prepared artifact is produced locally from the AGPL-3.0 Ultralytics
  // YOLO-World asset (yolov8s-world.pt) by scripts/prepare-yolo-world.mjs and
  // is not part of the shipped default package. See
  // vendor/yolo-world/MODEL-NOTICE.md for the exact provenance.
  const MODEL = Object.freeze({
    schema: 'bso.onnx.yolo-world.model.v1',
    id: 'yolo-world-racket-detector-v1',
    version: 1,
    kind: 'onnx-yolo-world-racket-detector',
    modelUrl: './vendor/yolo-world/yolo_world_s_open_vocab.onnx',
    sourceUrl: 'https://docs.ultralytics.com/models/yolo-world',
    sourceAssetUrl: 'https://github.com/ultralytics/assets/releases',
    license: 'AGPL-3.0',
    licenseStatus: 'agpl-3.0-experimental-source-disclosure',
    inputShape: [1, 640, 640, 3],
    outputPredictionCount: 8400,
    outputStride: 85, // 4 box coords + 1 objectness + 80 class scores
    modelVariant: 'small',
    inferenceEngine: 'onnx-runtime-web',
    experimental: true
  });

  const BACKENDS = Object.freeze(['wasm', 'webgl']);
  // ONNX Runtime Web assets are prepared locally (scripts/prepare-yolo-world.mjs
  // copies the onnxruntime-web dist files here). The module and its wasm are
  // loaded lazily only when the experimental model is activated, so the
  // production EfficientDet path never parses or starts them.
  const ORT_MODULE_URL = './vendor/onnx/ort.min.mjs';
  const ORT_WASM_PATH = './vendor/onnx/';

  const DEFAULTS = Object.freeze({
    confidenceThreshold: 0.5,
    iouThreshold: 0.45,
    maxDetections: 100,
    inputResolution: 640,
    prompts: Object.freeze(['badminton racket', 'racket', 'player\'s racket', 'racquet'])
  });

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

  function dispose(value) {
    if (value && typeof value.release === 'function') {
      try { value.release(); } catch (_) { /* release is best effort */ }
    } else if (value && typeof value.delete === 'function') {
      try { value.delete(); } catch (_) { /* delete is best effort */ }
    }
  }

  function localUrl(url) {
    if (typeof url !== 'string' || !url.trim()) throw new TypeError('ONNX model URL must be a non-empty string');
    const value = url.trim();
    if (/^(?:https?:)?\/\//i.test(value)) throw new TypeError('ONNX model URL must resolve to a locally vendored artifact');
    return value;
  }

  function resolveLocalUrl(url, environment) {
    const value = localUrl(url);
    const href = environment?.location?.href;
    if (!href || typeof URL !== 'function') return value;
    const resolved = new URL(value, href);
    if (resolved.protocol !== 'chrome-extension:' && resolved.protocol !== 'file:') {
      throw new TypeError('ONNX model URL resolved outside the extension package');
    }
    return resolved.toString();
  }

  function dimensions(frame) {
    const width = Number(frame?.width);
    const height = Number(frame?.height);
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new TypeError('frame dimensions must be positive integers');
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

  function racketDetection(bbox, confidence, trackingId = null) {
    return Object.freeze({
      bbox: {
        x: normalizedNumber(clamp(Number(bbox?.x) || 0)),
        y: normalizedNumber(clamp(Number(bbox?.y) || 0)),
        width: normalizedNumber(clamp(Number(bbox?.width) || 0)),
        height: normalizedNumber(clamp(Number(bbox?.height) || 0))
      },
      confidence: normalizedNumber(clamp(Number(confidence) || 0)),
      trackingId: trackingId || null,
      source: 'yolo-world-racket-detector',
      state: 'detected'
    });
  }

  /**
   * Intersection over Union between two normalized boxes {x, y, width, height}.
   * Deterministic; no runtime state.
   */
  function computeIoU(box1, box2) {
    if (!isObject(box1) || !isObject(box2)) return 0;
    const x1Min = Number(box1.x) || 0;
    const y1Min = Number(box1.y) || 0;
    const x1Max = x1Min + (Number(box1.width) || 0);
    const y1Max = y1Min + (Number(box1.height) || 0);
    const x2Min = Number(box2.x) || 0;
    const y2Min = Number(box2.y) || 0;
    const x2Max = x2Min + (Number(box2.width) || 0);
    const y2Max = y2Min + (Number(box2.height) || 0);
    const xiMin = Math.max(x1Min, x2Min);
    const yiMin = Math.max(y1Min, y2Min);
    const xiMax = Math.min(x1Max, x2Max);
    const yiMax = Math.min(y1Max, y2Max);
    if (xiMax < xiMin || yiMax < yiMin) return 0;
    const intersection = (xiMax - xiMin) * (yiMax - yiMin);
    const area1 = (x1Max - x1Min) * (y1Max - y1Min);
    const area2 = (x2Max - x2Min) * (y2Max - y2Min);
    const union = area1 + area2 - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Convert raw YOLO-style predictions ([x_center, y_center, width, height,
   * confidence, ...]) into normalized, NMS-filtered detections. Deterministic.
   */
  function processDetections(rawOutput, imageWidth, imageHeight, options = {}) {
    const confThresh = Number(options.confidenceThreshold) || DEFAULTS.confidenceThreshold;
    const iouThresh = Number(options.iouThreshold) || DEFAULTS.iouThreshold;
    const maxDets = Number(options.maxDetections) || DEFAULTS.maxDetections;
    if (!Array.isArray(rawOutput) || rawOutput.length === 0) return [];
    const width = Number(imageWidth) || 1;
    const height = Number(imageHeight) || 1;
    const candidates = [];
    for (const det of rawOutput) {
      if (!Array.isArray(det) || det.length < 5) continue;
      const confidence = Number(det[4]) || 0;
      if (confidence < confThresh) continue;
      const xCenter = Number(det[0]) || 0;
      const yCenter = Number(det[1]) || 0;
      const boxWidth = Number(det[2]) || 0;
      const boxHeight = Number(det[3]) || 0;
      candidates.push({
        bbox: {
          x: clamp((xCenter - boxWidth / 2) / width),
          y: clamp((yCenter - boxHeight / 2) / height),
          width: clamp(boxWidth / width),
          height: clamp(boxHeight / height)
        },
        confidence: clamp(confidence),
        original: { xc: det[0], yc: det[1], w: det[2], h: det[3], conf: det[4] }
      });
    }
    candidates.sort((a, b) => b.confidence - a.confidence || a.bbox.x - b.bbox.x || a.bbox.y - b.bbox.y);
    const kept = [];
    for (const det of candidates) {
      if (kept.length >= maxDets) break;
      if (kept.some((existing) => computeIoU(det.bbox, existing.bbox) > iouThresh)) continue;
      kept.push(det);
    }
    return kept;
  }

  /**
   * Resize the bounded RGBA capture frame onto the 640px model grid and
   * normalize RGB to [0, 1]. Deterministic and allocation-bounded.
   */
  function createYoloInputPixels(pixels, resolution = DEFAULTS.inputResolution) {
    if (!pixels || !Number.isInteger(resolution) || resolution < 1) throw new TypeError('input pixels are unavailable');
    const sourceWidth = Number(pixels.width);
    const sourceHeight = Number(pixels.height);
    if (!Number.isInteger(sourceWidth) || sourceWidth < 1 || !Number.isInteger(sourceHeight) || sourceHeight < 1) {
      throw new TypeError('source pixels require positive integer dimensions');
    }
    const channels = Number(pixels.channels);
    if (!Number.isInteger(channels) || channels < 3) throw new TypeError('source pixels require at least 3 channels');
    const data = pixels.data;
    if (!data || data.length < sourceWidth * sourceHeight * channels) throw new TypeError('source pixel buffer is truncated');
    const output = new Float32Array(resolution * resolution * 3);
    for (let y = 0; y < resolution; y += 1) {
      const sourceY = Math.min(sourceHeight - 1, y * sourceHeight / resolution);
      const y0 = Math.floor(sourceY);
      const yWeight = sourceY - y0;
      const y1 = Math.min(sourceHeight - 1, y0 + 1);
      for (let x = 0; x < resolution; x += 1) {
        const sourceX = Math.min(sourceWidth - 1, x * sourceWidth / resolution);
        const x0 = Math.floor(sourceX);
        const xWeight = sourceX - x0;
        const x1 = Math.min(sourceWidth - 1, x0 + 1);
        const targetOffset = (y * resolution + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          const p00 = Number(data[(y0 * sourceWidth + x0) * channels + channel]) || 0;
          const p01 = Number(data[(y0 * sourceWidth + x1) * channels + channel]) || 0;
          const p10 = Number(data[(y1 * sourceWidth + x0) * channels + channel]) || 0;
          const p11 = Number(data[(y1 * sourceWidth + x1) * channels + channel]) || 0;
          const top = p00 * (1 - xWeight) + p01 * xWeight;
          const bottom = p10 * (1 - xWeight) + p11 * xWeight;
          output[targetOffset + channel] = (top * (1 - yWeight) + bottom * yWeight) / 255.0;
        }
      }
    }
    return output;
  }

  // A completed run that found no racket still carries the detector marker
  // (the model ran and answered); the composition then treats it as an honest
  // unknown for that frame instead of falling back to the pose proxy.
  function unknownEvidence(reason) {
    return {
      state: 'unknown',
      confidence: null,
      detections: [],
      detectionMethod: 'yolo-world-open-vocab-racket',
      reason
    };
  }

  // A run that could not complete (no runtime, no artifact, backend failure)
  // carries no detector marker: the composition keeps the pose-derived proxy
  // for that frame, exactly as the EfficientDet detector behaves.
  function unavailableEvidence(reason) {
    return {
      state: 'unknown',
      confidence: null,
      detections: [],
      detectionMethod: null,
      reason
    };
  }

  function configureOnnxRuntime(ort, wasmPath, environment) {
    try {
      if (ort && ort.env && ort.env.wasm) {
        ort.env.wasm.wasmPaths = resolveLocalUrl(wasmPath, environment);
        ort.env.wasm.numThreads = 1;
      }
    } catch (_) { /* wasm path tuning is best effort */ }
  }

  /**
   * Resolve the ONNX Runtime Web facade for a document: an `ort` global, an
   * optional `BSOOnnxRuntimeReady` promise, then a lazily imported
   * locally-vendored ort ESM (vendor/onnx/ort.min.mjs, prepared by
   * scripts/prepare-yolo-world.mjs). The default package bundles neither, so
   * the experimental model reports an explicit unavailable reason instead of
   * failing silently. This is the same availability source the selector probe
   * uses, so a model the probe marks available can always activate.
   */
  async function resolveOnnxRuntime(environment = defaultEnvironment, moduleUrl = ORT_MODULE_URL, wasmPath = ORT_WASM_PATH) {
    const env = environment || defaultEnvironment;
    if (env && env.ort) {
      configureOnnxRuntime(env.ort, wasmPath, env);
      return { ort: env.ort };
    }
    if (env && env.BSOOnnxRuntimeReady) {
      try {
        const ready = typeof env.BSOOnnxRuntimeReady === 'function' ? await env.BSOOnnxRuntimeReady() : await env.BSOOnnxRuntimeReady;
        if (ready) {
          configureOnnxRuntime(ready, wasmPath, env);
          return { ort: ready };
        }
      } catch (_) { /* fall through to the vendored module */ }
    }
    try {
      const resolvedUrl = resolveLocalUrl(moduleUrl, env);
      const loaded = await import(resolvedUrl);
      const ort = loaded && (loaded.ort || loaded.default || loaded);
      if (!ort || (typeof ort.InferenceSession !== 'object' && typeof ort.InferenceSession !== 'function')) {
        throw new Error('loaded ort module has no InferenceSession');
      }
      configureOnnxRuntime(ort, wasmPath, env);
      return { ort };
    } catch (_) {
      return { ort: null, reason: 'yolo-world-runtime-not-bundled' };
    }
  }

  class YoloWorldRacketAnalyzer {
    constructor({
      runtime = null,
      runtimeReady = defaultEnvironment.BSOOnnxRuntimeReady,
      environment = defaultEnvironment,
      modelUrl = MODEL.modelUrl,
      ortModuleUrl = ORT_MODULE_URL,
      wasmPath = ORT_WASM_PATH,
      backendOrder = BACKENDS,
      loadModel = null,
      confidenceThreshold = DEFAULTS.confidenceThreshold,
      iouThreshold = DEFAULTS.iouThreshold,
      maxDetections = DEFAULTS.maxDetections,
      prompts = DEFAULTS.prompts,
      onStatus = () => {}
    } = {}) {
      this.runtime = runtime;
      this.runtimeReady = runtimeReady;
      this.environment = environment;
      this.modelUrl = localUrl(modelUrl);
      this.ortModuleUrl = localUrl(ortModuleUrl);
      this.wasmPath = localUrl(wasmPath);
      this.backendOrder = Array.from(new Set((Array.isArray(backendOrder) ? backendOrder : BACKENDS).filter((name) => BACKENDS.includes(name))));
      this.loadModel = typeof loadModel === 'function' ? loadModel : null;
      this.confidenceThreshold = confidenceThreshold;
      this.iouThreshold = iouThreshold;
      this.maxDetections = maxDetections;
      this.prompts = Array.isArray(prompts) ? prompts.slice() : DEFAULTS.prompts.slice();
      this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
      this.ort = null;
      this.session = null;
      this.backend = null;
      this.initialization = null;
      this.failed = null;
      this.inFlight = false;
      this.inFlightMediaTime = null;
      this.identity = Object.freeze({
        id: MODEL.id,
        version: MODEL.version,
        kind: MODEL.kind,
        detectionMethod: 'yolo-world-open-vocab-racket',
        model: 'Ultralytics YOLO-World (open vocabulary, small)',
        modelVariant: MODEL.modelVariant,
        localArtifact: MODEL.modelUrl,
        sourceUrl: MODEL.sourceUrl,
        sourceAssetUrl: MODEL.sourceAssetUrl,
        license: MODEL.license,
        licenseStatus: MODEL.licenseStatus,
        runtime: 'onnxruntime-web',
        prompts: this.prompts.slice(),
        productionModel: false,
        experimental: true,
        // Research-measured per-frame cost in the MV3 offscreen document:
        // archive-grade only, never for live play. Labeled in the popup entry.
        measuredPerFrame: '2-6 s/frame (archive-grade, not for live play)'
      });
    }

    status(value) {
      try { this.onStatus(value); } catch (_) { /* status observers cannot break inference */ }
    }

    /**
     * Resolve the ONNX Runtime Web facade. Preference order: an injected
     * runtime, an injected runtimeReady promise, the document global `ort`,
     * then a lazily imported locally-vendored ort ESM (loaded only when the
     * experimental model is activated). Absent runtimes resolve to null with
     * an explicit reason; the default package never bundles ort.
     */
    async _resolveOrt() {
      if (this.ort) return { ort: this.ort };
      if (this.runtime) {
        this.ort = this.runtime;
        return { ort: this.runtime };
      }
      if (this.runtimeReady != null) {
        try {
          const ready = typeof this.runtimeReady === 'function' ? await this.runtimeReady() : await this.runtimeReady;
          if (ready) {
            this.ort = ready;
            return { ort: ready };
          }
        } catch (_) { /* fall through to the remaining sources */ }
      }
      const resolved = await resolveOnnxRuntime(this.environment, this.ortModuleUrl, this.wasmPath);
      if (resolved.ort) this.ort = resolved.ort;
      return resolved;
    }

    _configureOrt(ort) {
      configureOnnxRuntime(ort, this.wasmPath, this.environment);
    }

    async _fetchModelData() {
      if (this.loadModel) {
        const data = await this.loadModel(this.modelUrl);
        if (data) return data;
      }
      const env = this.environment || defaultEnvironment;
      const fetchFn = env?.fetch || defaultEnvironment.fetch;
      if (typeof fetchFn !== 'function') return null;
      const resolved = resolveLocalUrl(this.modelUrl, env);
      const response = await fetchFn(resolved, { method: 'GET' });
      if (!response || (response.ok !== true && response.status !== 200 && response.status !== 0)) return null;
      if (typeof response.arrayBuffer === 'function') return response.arrayBuffer();
      const buffer = response.data;
      if (buffer && typeof buffer.byteLength === 'number') return buffer;
      return null;
    }

    async initialize() {
      if (this.initialization) return this.initialization;
      this.initialization = (async () => {
        try {
          const resolved = await this._resolveOrt();
          if (!resolved.ort) {
            const reason = resolved.reason || 'onnx-runtime-web-unavailable';
            this.failed = reason;
            this.status({ type: 'model-failure', reason, fallbacks: ['local-onnx-runtime-unavailable'] });
            return { available: false, reason, fallbacks: ['local-onnx-runtime-unavailable'] };
          }
          this._configureOrt(resolved.ort);
          const modelData = await this._fetchModelData();
          if (modelData === null) {
            const reason = 'yolo-world-artifact-not-bundled';
            this.failed = reason;
            this.status({ type: 'model-failure', reason, fallbacks: ['local-model-artifact-unavailable'] });
            return { available: false, reason, fallbacks: ['local-model-artifact-unavailable'] };
          }
          const attempted = [];
          let sessionCreated = false;
          for (const backend of this.backendOrder) {
            try {
              this.status({ type: 'backend-probe', backend });
              const sessionOptions = {
                executionProviders: [backend],
                graphOptimizationLevel: 'all'
              };
              const session = await resolved.ort.InferenceSession.create(modelData, sessionOptions);
              if (!session || typeof session.run !== 'function') throw new Error('onnx session has no run()');
              this.session = session;
              this.backend = backend;
              sessionCreated = true;
              this.status({ type: 'backend-selected', backend, fallbacks: this.backendOrder.slice(this.backendOrder.indexOf(backend) + 1) });
              break;
            } catch (error) {
              attempted.push({ backend, reason: error instanceof Error ? error.message : String(error) });
              this.status({ type: 'backend-unavailable', backend, reason: attempted[attempted.length - 1].reason });
            }
          }
          if (!sessionCreated) {
            const reason = attempted.at(-1)?.reason || 'no-usable-inference-backend';
            this.failed = reason;
            this.status({ type: 'model-failure', reason, fallbacks: ['onnx-backend-unavailable'] });
            return { available: false, reason, fallbacks: ['onnx-backend-unavailable'] };
          }
          this.status({ type: 'model-ready', backend: this.backend, model: MODEL.id });
          return { available: true, backend: this.backend, fallbacks: this.backendOrder.slice(this.backendOrder.indexOf(this.backend) + 1) };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.failed = reason;
          dispose(this.session);
          this.session = null;
          this.status({ type: 'model-failure', reason, fallbacks: ['local-model-artifact-unavailable'] });
          return { available: false, reason, fallbacks: ['local-model-artifact-unavailable'] };
        }
      })();
      return this.initialization;
    }

    /**
     * Parse the flat YOLO-style output buffer into per-prediction arrays.
     * Row-major [prediction][4 box coords + 1 objectness + 80 class scores].
     */
    parseYoloOutput(outputArray) {
      const numPredictions = MODEL.outputPredictionCount;
      const stride = MODEL.outputStride;
      const detections = [];
      for (let i = 0; i < numPredictions; i += 1) {
        const baseIdx = i * stride;
        const confidence = Number(outputArray[baseIdx + 4]);
        if (finite(confidence) && confidence > 0) {
          detections.push([
            Number(outputArray[baseIdx]) || 0,
            Number(outputArray[baseIdx + 1]) || 0,
            Number(outputArray[baseIdx + 2]) || 0,
            Number(outputArray[baseIdx + 3]) || 0,
            confidence
          ]);
        }
      }
      return detections;
    }

    async infer(frame) {
      const pixels = await readFramePixels(frame, this.environment);
      if (!pixels) throw new Error('frame-pixels-unavailable');
      if (!this.ort || !this.session || typeof this.session.run !== 'function' || typeof this.ort.Tensor !== 'function') {
        throw new Error('ONNX tensor/session API is unavailable');
      }
      const inputPixels = createYoloInputPixels(pixels);
      const input = new this.ort.Tensor('float32', inputPixels, [1, DEFAULTS.inputResolution, DEFAULTS.inputResolution, 3]);
      let results = null;
      try {
        results = await this.session.run({ images: input });
        const output = results && results.output0;
        if (!output || !output.data || typeof output.data.length !== 'number') {
          throw new Error('No output tensor from YOLO-World model');
        }
        const flat = output.data;
        const rawDetections = this.parseYoloOutput(typeof flat.slice === 'function' ? Array.from(flat) : flat);
        return processDetections(rawDetections, pixels.width, pixels.height, {
          confidenceThreshold: this.confidenceThreshold,
          iouThreshold: this.iouThreshold,
          maxDetections: this.maxDetections
        });
      } finally {
        if (results) {
          for (const tensor of Object.values(results)) dispose(tensor);
        }
        if (input && typeof input.dispose === 'function') dispose(input);
      }
    }

    /**
     * Analyze one accepted frame sample. Stateless per frame: each accepted
     * frame contributes fresh racket evidence and the result is deterministic
     * for identical frames. Experimental: research-measured at 2-6 s/frame.
     */
    async analyze(sample) {
      const sessionId = String(sample?.sessionId || 'unknown-session');
      const requestId = String(sample?.requestId || 'unknown-request');
      const mediaTime = sample?.mediaTime;
      if (!finite(mediaTime) || mediaTime < 0) return unavailableEvidence('invalid-media-time');
      if (this.inFlight) {
        this.status({ type: 'inference-status', status: 'backpressure', requestId, mediaTime, inFlightMediaTime: this.inFlightMediaTime });
        return null;
      }
      this.inFlight = true;
      this.inFlightMediaTime = mediaTime;
      try {
        const initialized = await this.initialize();
        if (!initialized.available) return unavailableEvidence(initialized.reason || 'model-unavailable');
        const detections = await this.infer(sample.frame);
        if (!Array.isArray(detections) || !detections.length) return unknownEvidence('no-yolo-world-racket-detection');
        return {
          state: 'tracked',
          confidence: normalizedNumber(Math.max(...detections.map((detection) => detection.confidence))),
          detections: detections.map((detection, index) => racketDetection(detection.bbox, detection.confidence, `yolo-racket-${index}`)),
          detectionMethod: 'yolo-world-open-vocab-racket',
          reason: 'open-vocabulary-racket-detections',
          segmentationAvailable: false,
          detector: this.identity,
          sessionId,
          requestId,
          mediaTime
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.failed = reason;
        // A run that threw did not complete, so this frame's evidence is not
        // authoritative. Drop the session and cached initialization so the
        // next frame retries from scratch instead of silently suppressing
        // evidence for the rest of the session.
        dispose(this.session);
        this.session = null;
        this.initialization = null;
        this.status({ type: 'inference-failure', sessionId, requestId, mediaTime, reason });
        return unavailableEvidence(reason);
      } finally {
        this.inFlight = false;
        this.inFlightMediaTime = null;
      }
    }

    resetSession() {
      return { sessionId: null, reason: 'yolo-world-racket-detector-is-stateless' };
    }

    endSession() {
      return { sessionId: null, reason: 'yolo-world-racket-detector-is-stateless' };
    }

    dispose() {
      dispose(this.session);
      this.session = null;
      this.initialization = null;
    }
  }

  return Object.freeze({
    MODEL,
    DEFAULTS,
    BACKENDS,
    ORT_MODULE_URL,
    ORT_WASM_PATH,
    computeIoU,
    processDetections,
    racketDetection,
    readFramePixels,
    createYoloInputPixels,
    resolveOnnxRuntime,
    configureOnnxRuntime,
    YoloWorldRacketAnalyzer
  });
}));
