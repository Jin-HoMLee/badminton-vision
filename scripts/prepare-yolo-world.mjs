#!/usr/bin/env node
/**
 * YOLO-World EXPERIMENTAL model preparation script.
 *
 * Prepares the local assets the experimental "YOLO-World Open-Vocabulary
 * (Experimental)" racket-model picker entry needs to run. It is NEVER needed
 * for the shipped default (EfficientDet-Lite0); nothing in the default build
 * loads or runs YOLO-World.
 *
 * What it does:
 *   1. Downloads the AGPL-3.0 Ultralytics YOLO-World v2 asset
 *      (`yolov8s-worldv2.pt`; the original `yolov8s-world.pt` cannot export
 *      to ONNX in current Ultralytics) and exports it to ONNX at 640x640.
 *   2. Bakes the racket vocabulary into the graph first (`model.set_classes(...)`
 *      before `model.export(...)`), so the ONNX exposes exactly one NCHW
 *      `images` input and one `output0` tensor of per-anchor rows: 4 box
 *      coordinates + one class score per baked vocabulary entry (no
 *      objectness column, no runtime text input).
 *   3. Writes the artifact to src/extension/offscreen/vendor/yolo-world/
 *      as `yolo_world_s_open_vocab.onnx` and prints its SHA-256 so the
 *      MODEL-NOTICE provenance can be recorded.
 *   4. Optionally copies the onnxruntime-web dist assets (ort ESM + wasm)
 *      into src/extension/offscreen/vendor/onnx/ so the offscreen document
 *      can load ONNX Runtime Web lazily from the extension package.
 *
 * Usage:
 *   node scripts/prepare-yolo-world.mjs [--variant small|medium|large]
 *
 * Licensing: YOLO-World weights from Ultralytics are AGPL-3.0. Preparing and
 * redistributing the artifact (for example committing it or shipping it in a
 * package) obliges you to offer the complete corresponding source under
 * AGPL-3.0. The experimental picker entry exists in the public repository
 * under exactly that disclosure; the artifact itself is not committed, so the
 * default package never contains it. See
 * src/extension/offscreen/vendor/yolo-world/MODEL-NOTICE.md.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'src/extension/offscreen/vendor/yolo-world');
const ONNX_VENDOR_DIR = path.join(PROJECT_ROOT, 'src/extension/offscreen/vendor/onnx');

const args = process.argv.slice(2);
let variant = 'small';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--variant' && args[i + 1]) {
    variant = String(args[i + 1]).toLowerCase();
    i += 1;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node scripts/prepare-yolo-world.mjs [--variant small|medium|large]');
    process.exit(0);
  }
}

const VARIANTS = {
  small: { model: 'yolov8s-worldv2.pt', artifact: 'yolo_world_s_open_vocab.onnx', note: 'experimental picker default (2-6 s/frame measured in the offscreen document)' },
  medium: { model: 'yolov8m-worldv2.pt', artifact: 'yolo_world_m_open_vocab.onnx', note: 'heavier; not wired to a picker entry' },
  large: { model: 'yolov8l-worldv2.pt', artifact: 'yolo_world_l_open_vocab.onnx', note: 'heavier; not wired to a picker entry' }
};

// The racket vocabulary baked into the artifact by model.set_classes(...)
// below. Keep in sync with DEFAULTS.prompts in
// src/extension/offscreen/yolo-world-racket-adapter.js: each entry becomes
// one output class channel, and the adapter validates the exported channel
// count against this list, so a drift is loud, not silent.
const RACKET_CLASSES = ['badminton racket', 'racket', "player's racket", 'racquet'];

// Output layout of the exported graph (validated by the adapter at runtime):
// input `images` NCHW float32 [1, 3, 640, 640]; output `output0` with dims
// [1, 4 + len(RACKET_CLASSES), 8400], channel-major (4 box coordinates in
// input-grid pixels followed by sigmoid class scores, no objectness column).

const variantInfo = VARIANTS[variant];
if (!variantInfo) {
  console.error(`Unknown variant "${variant}".`);
  console.error('Available: ' + Object.keys(VARIANTS).join(', '));
  process.exit(1);
}

function run(command, commandArgs, description) {
  return new Promise((resolve, reject) => {
    console.log(`\u23f3 ${description || command}...`);
    const child = spawn(command, commandArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${description || command} failed with exit code ${code}`));
      else resolve();
    });
  });
}

function sha256Of(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function copyOrtAssets() {
  // onnxruntime-web is an npm package; copy its dist ESM + wasm so the
  // offscreen document can lazily import ort from the extension package.
  const candidates = [
    path.join(PROJECT_ROOT, 'node_modules/onnxruntime-web/dist'),
    path.join(PROJECT_ROOT, 'node_modules/onnxruntime-web/lib')
  ];
  let ortDist = candidates.find((dir) => fs.existsSync(path.join(dir, 'ort.min.mjs')));
  if (!ortDist) {
    console.log('\u26a0\ufe0f  onnxruntime-web dist not found under node_modules/onnxruntime-web.');
    console.log('   Install it with:  npm install --no-save onnxruntime-web@<pinned version>');
    console.log('   and re-run this script to copy the ort ESM/wasm assets into vendor/onnx/.');
    return false;
  }
  fs.mkdirSync(ONNX_VENDOR_DIR, { recursive: true });
  const wanted = ['ort.min.mjs', 'ort.wasm.min.mjs', 'ort.webgpu.min.mjs', 'ort.min.js'];
  let copied = 0;
  for (const file of wanted) {
    const source = path.join(ortDist, file);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(ONNX_VENDOR_DIR, file));
    copied += 1;
  }
  const wasmCandidates = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd.wasm', 'ort-wasm.wasm'];
  for (const file of wasmCandidates) {
    const source = path.join(ortDist, file);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(ONNX_VENDOR_DIR, file));
    copied += 1;
  }
  console.log(`\u2713 Copied ${copied} onnxruntime-web assets into vendor/onnx/`);
  return copied > 0;
}

async function main() {
  console.log('\n\U0001F6A9 YOLO-World EXPERIMENTAL model preparation (not needed for the default build)\n');
  console.log(`Variant: ${variantInfo.model} (${variantInfo.note})`);
  console.log('License: AGPL-3.0 (Ultralytics asset). See vendor/yolo-world/MODEL-NOTICE.md.');

  // Python + ultralytics environment check happens inside the export step.
  await run('python3', ['-c', 'import sys; print("python3", sys.version.split()[0])'], 'Checking Python');
  await run('python3', ['-c', 'from ultralytics import YOLO; print("ultralytics OK")'], 'Checking ultralytics (pip install ultralytics onnx onnxruntime if missing)');

  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  const exportScript = `
import sys
from ultralytics import YOLO
RACKET_CLASSES = ${JSON.stringify(RACKET_CLASSES)}
try:
    model = YOLO('${variantInfo.model}')
    model.set_classes(RACKET_CLASSES)
    exported = model.export(format='onnx', imgsz=640, half=False, dynamic=False, opset=12, verbose=False)
    print('EXPORTED:' + str(exported))
    print('BAKED_CLASSES:' + ','.join(RACKET_CLASSES))
except Exception as error:
    print(f'Export failed: {error}', file=sys.stderr)
    sys.exit(1)
`;
  await run('python3', ['-c', exportScript], 'Downloading and exporting YOLO-World to ONNX (racket vocabulary baked via set_classes)');

  const exportedSource = path.join(PROJECT_ROOT, `${variantInfo.model.replace('.pt', '.onnx')}`);
  const sourceFile = fs.existsSync(exportedSource) ? exportedSource : path.join(process.cwd(), `${variantInfo.model.replace('.pt', '.onnx')}`);
  const targetFile = path.join(VENDOR_DIR, variantInfo.artifact);
  if (!fs.existsSync(sourceFile)) {
    console.error(`Expected ONNX export at ${sourceFile} but it was not found.`);
    process.exit(1);
  }
  fs.copyFileSync(sourceFile, targetFile);
  console.log(`\u2713 Artifact written to ${targetFile}`);
  console.log(`SHA-256: ${sha256Of(targetFile)}`);
  console.log(`Baked racket vocabulary: ${RACKET_CLASSES.join(', ')}`);
  console.log('\nRecord that SHA-256 in src/extension/offscreen/vendor/yolo-world/MODEL-NOTICE.md if you prepare a distributable copy.');

  await copyOrtAssets();

  console.log('\nDone. To use the experimental entry:');
  console.log('  1. npm run build   (copies vendor/yolo-world/*.onnx and vendor/onnx/ into dist when present)');
  console.log('  2. Load dist/ in Chrome (chrome://extensions) and open the popup');
  console.log('  3. Racket Detection Model -> YOLO-World Open-Vocabulary (Experimental)');
  console.log('\nThe experimental model is research-measured at ~2-6 s/frame (archive-grade, not for live play).');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
