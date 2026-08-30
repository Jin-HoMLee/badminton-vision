import {
  decodeHeatmaps,
  percentile,
  preprocessFrames,
  TemporalWindowBuffer,
} from './contract.mjs';

const ort = globalThis.ort;
const $ = (id) => document.getElementById(id);

function makeSyntheticFrame(width, height, frameIndex) {
  const data = new Uint8Array(width * height * 4);
  data.fill(18);
  const x = Math.round(width * (0.25 + frameIndex * 0.2));
  const y = Math.round(height * (0.35 + frameIndex * 0.1));
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const offset = (py * width + px) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
      }
    }
  }
  return { data, width, height };
}

function backendSupport() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return {
    webgpu: typeof navigator.gpu !== 'undefined',
    webgl: Boolean(gl),
    wasm: true,
    userAgent: navigator.userAgent,
    deviceMemoryGb: navigator.deviceMemory ?? null,
  };
}

async function createSession(modelUrl, backend) {
  if (!ort) throw new Error('onnxruntime-web did not load');
  // Keep the WASM binary local to this package. No inference request leaves
  // the extension/offscreen document.
  ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  const executionProviders = [backend];
  return ort.InferenceSession.create(modelUrl, {
    executionProviders,
    graphOptimizationLevel: 'all',
    enableMemPattern: true,
  });
}

function heapSnapshot() {
  const memory = performance.memory;
  if (!memory) return null;
  return {
    usedJsHeapBytes: memory.usedJSHeapSize,
    totalJsHeapBytes: memory.totalJSHeapSize,
    limitJsHeapBytes: memory.jsHeapSizeLimit,
  };
}

async function timePreprocessing(frames, resolution, count = 5) {
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const start = performance.now();
    preprocessFrames(frames, resolution);
    values.push(performance.now() - start);
  }
  return { count, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), samplesMs: values };
}

function outputMetadata(output) {
  return { dims: Array.from(output.dims), type: output.type, length: output.data.length };
}

function summarizeOutput(output) {
  const decoded = decodeHeatmaps(output.data, output.dims, { threshold: 0.5 });
  return decoded.map(({ frame, width, height, detected, confidence, x, y, peakX, peakY, max, activePixels }) => ({
    frame, width, height, detected, confidence, x, y, peakX, peakY, max, activePixels,
  }));
}

export async function runSpikeBenchmark({
  modelUrl = '/fixtures/tracknet_fixture.onnx',
  backend = 'wasm',
  width = 512,
  height = 288,
  warmup = 3,
  iterations = 20,
} = {}) {
  const support = backendSupport();
  const frames = [0, 1, 2].map((index) => makeSyntheticFrame(width, height, index));
  const inputData = preprocessFrames(frames, { width, height });
  const preprocessing = await timePreprocessing(frames, { width, height });
  const heapBefore = heapSnapshot();
  const startedAt = new Date().toISOString();
  let session;
  try {
    session = await createSession(modelUrl, backend);
  } catch (error) {
    return {
      schema: 'tracknet-browser-spike/v1', startedAt, modelUrl, backend, resolution: { width, height },
      support, preprocessing, status: 'failed', phase: 'session-create', error: String(error?.stack || error),
      note: 'The selected execution provider could not create an ONNX Runtime Web session in this environment.',
    };
  }

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = new ort.Tensor('float32', inputData, [1, 9, height, width]);
  const warmupMs = [];
  let lastOutput;
  try {
    for (let i = 0; i < warmup; i += 1) {
      const start = performance.now();
      const outputs = await session.run({ [inputName]: tensor });
      warmupMs.push(performance.now() - start);
      lastOutput = outputs[outputName];
    }
    const steadyMs = [];
    const decodedMs = [];
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      const outputs = await session.run({ [inputName]: tensor });
      const afterRun = performance.now();
      lastOutput = outputs[outputName];
      summarizeOutput(lastOutput);
      steadyMs.push(afterRun - start);
      decodedMs.push(performance.now() - afterRun);
    }
    const heapAfter = heapSnapshot();
    const temporal = new TemporalWindowBuffer(3);
    const timeline = [0, 1000 / 30, 2 * 1000 / 30, 3 * 1000 / 30].map((mediaTime, index) => temporal.push(index, mediaTime)).filter(Boolean);
    const finalOutput = lastOutput || (await session.run({ [inputName]: tensor }))[outputName];
    const result = {
      schema: 'tracknet-browser-spike/v1', startedAt, finishedAt: new Date().toISOString(), status: 'ok',
      modelUrl, backend, resolution: { width, height }, support,
      runtime: { ortVersion: ort.env.version ?? '1.29.0 (package-pinned)', inputName, outputName, inputDims: [1, 9, height, width], output: outputMetadata(finalOutput) },
      warmup: { count: warmup, samplesMs: warmupMs, firstMs: warmupMs[0] ?? null, p50Ms: percentile(warmupMs, 0.5), p95Ms: percentile(warmupMs, 0.95) },
      steadyState: { count: iterations, p50Ms: percentile(steadyMs, 0.5), p95Ms: percentile(steadyMs, 0.95), minMs: Math.min(...steadyMs), maxMs: Math.max(...steadyMs), samplesMs: steadyMs },
      preprocessing, postprocessing: { p50Ms: percentile(decodedMs, 0.5), p95Ms: percentile(decodedMs, 0.95), samplesMs: decodedMs, finalPeaks: summarizeOutput(finalOutput) },
      memory: { before: heapBefore, after: heapAfter, deltaUsedJsHeapBytes: heapBefore && heapAfter ? heapAfter.usedJsHeapBytes - heapBefore.usedJsHeapBytes : null, gpuMemory: 'not exposed by browser API' },
      temporal: {
        windowFrames: 3, outputFrames: 3, timelineSample: timeline,
        frameIntervalAt30FpsMs: 1000 / 30, firstResultFrameDelay: 2,
        latestFrameTargetDelay: 0, centerFrameTargetDelay: 1,
        steadyP95ProcessingMs: percentile(steadyMs, 0.95),
        steadyP50ThroughputFps: 1000 / percentile(steadyMs, 0.5),
        meets30FpsAtP95: percentile(steadyMs, 0.95) <= (1000 / 30),
        explanation: 'A rolling window can emit the latest of its three output heatmaps after two prior frames arrive. It must not block playback. Processing above the frame interval creates an unbounded live queue unless the consumer drops stale windows.',
      },
      limitations: ['Synthetic bright-pixel fixture only; this result is a runtime/contract measurement, not tracking accuracy.', 'ONNX Runtime Web does not expose portable GPU memory counters; failures and JS heap are recorded instead.'],
    };
    if (session.release) await session.release();
    return result;
  } catch (error) {
    if (session.release) await session.release();
    return {
      schema: 'tracknet-browser-spike/v1', startedAt, modelUrl, backend, resolution: { width, height }, support,
      status: 'failed', phase: 'inference', error: String(error?.stack || error),
      runtime: { inputName, outputName },
      note: 'Inference failed after session creation; inspect the error for an unsupported operator, shape, or provider memory failure.',
    };
  }
}

function renderStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').className = isError ? 'error' : 'muted';
}

$('controls').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('run').disabled = true;
  renderStatus('Running…');
  const [width, height] = $('resolution').value.split('x').map(Number);
  try {
    const result = await runSpikeBenchmark({
      modelUrl: $('model').value,
      backend: $('backend').value,
      width,
      height,
      warmup: Number($('warmup').value),
      iterations: Number($('iterations').value),
    });
    $('result').textContent = JSON.stringify(result, null, 2);
    renderStatus(result.status === 'ok' ? 'Complete.' : 'Failed (see result).', result.status !== 'ok');
  } catch (error) {
    $('result').textContent = String(error?.stack || error);
    renderStatus('Failed.', true);
  } finally {
    $('run').disabled = false;
  }
});

window.runSpikeBenchmark = runSpikeBenchmark;
window.tracknetSpike = { preprocessFrames, decodeHeatmaps, TemporalWindowBuffer };
