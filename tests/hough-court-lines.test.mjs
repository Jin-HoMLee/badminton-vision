import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The merged tests used to inline a copy of the adapter's internals, which
// meant the shipped module could rot without any test noticing. Import the
// real module instead.
const require = createRequire(import.meta.url);
const adapter = require('../src/extension/offscreen/hough-court-lines-adapter.js');

/** Build an RGBA frame with a court-like scene: noisy purple floor in the
 * lower part, darker surrounds above, crisp white lines (boundaries, service
 * line, centre line, receding side lines). */
function syntheticCourtFrame(width = 640, height = 360) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = (i / width) | 0;
    const floor = y > height * 0.4;
    // Smooth two-axis noise so texture stays low-frequency (no artificial
    // horizontal/vertical banding for the Hough transform to lock onto).
    let r = floor ? 150 + 6 * Math.sin(x / 23) + 5 * Math.sin(y / 17) : 70 + 8 * Math.sin(x / 31) + 7 * Math.sin(y / 13);
    let g = floor ? 98 + 5 * Math.sin(x / 19) + 4 * Math.sin(y / 11) : 62 + 6 * Math.sin(x / 29) + 5 * Math.sin(y / 7);
    let b = floor ? 172 + 6 * Math.sin(x / 29) + 6 * Math.sin(y / 23) : 84 + 8 * Math.sin(x / 13) + 6 * Math.sin(y / 17);
    data[i * 4] = Math.max(0, Math.min(255, Math.round(r)));
    data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g)));
    data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b)));
    data[i * 4 + 3] = 255;
  }
  const paint = (x1, y1, x2, y2, thickness = 3) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x1 + ((x2 - x1) * s) / steps);
      const y = Math.round(y1 + ((y2 - y1) * s) / steps);
      for (let dx = -thickness; dx <= thickness; dx++) {
        for (let dy = -thickness; dy <= thickness; dy++) {
          if (dx * dx + dy * dy > thickness * thickness) continue;
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const i = (py * width + px) * 4;
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
        }
      }
    }
  };
  // Broadcast half-court layout: near boundary, service line, far boundary,
  // receding side lines, centre line.
  paint(width * 0.04, height * 0.93, width * 0.96, height * 0.93);
  paint(width * 0.10, height * 0.78, width * 0.90, height * 0.78);
  paint(width * 0.24, height * 0.40, width * 0.76, height * 0.40);
  paint(width * 0.20, height * 0.93, width * 0.30, height * 0.40);
  paint(width * 0.80, height * 0.93, width * 0.70, height * 0.40);
  paint(width * 0.48, height * 0.93, width * 0.53, height * 0.40);
  return { data, width, height };
}

test('module exports the documented pipeline surface', () => {
  for (const name of [
    'detectCourtLines', 'toGrayscale', 'histogramEqualize',
    'gaussianBlur', 'sobelEdgeDetection', 'nonMaxSuppression', 'cannyEdgeDetection',
    'houghLineTransform', 'mergeParallelPeaks', 'clipLinesToSupport',
    'supportedSegments', 'filterShortSegments'
  ]) {
    assert.equal(typeof adapter[name], 'function', `export ${name}`);
  }
  assert.equal(typeof adapter.DEFAULT_CONFIG, 'object');
  assert.equal(adapter.DEFAULT_CONFIG.cannyLow, null);
  assert.equal(adapter.DEFAULT_CONFIG.cannyHigh, null);
  assert.ok(adapter.DEFAULT_CONFIG.maxLines > 0);
});

test('grayscale conversion applies luminance weights', () => {
  const width = 10;
  const height = 10;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 100;
    rgba[i * 4 + 1] = 150;
    rgba[i * 4 + 2] = 50;
    rgba[i * 4 + 3] = 255;
  }
  const gray = adapter.toGrayscale({ width, height, data: rgba, channels: 4 });
  const expected = Math.round(0.299 * 100 + 0.587 * 150 + 0.114 * 50);
  assert.equal(gray.data[0], expected);
  assert.equal(gray.data.length, width * height);
});

test('histogram equalization spreads a narrow range', () => {
  const width = 64;
  const height = 64;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = 40 + (i % 25);
  const equalized = adapter.histogramEqualize({ width, height, data: gray });
  let min = 255;
  let max = 0;
  for (const v of equalized.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  assert.ok(max - min >= 100, `range spread, got ${min}..${max}`);
});

test('gaussian blur smooths a checkerboard', () => {
  const width = 32;
  const height = 32;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = ((x + y) % 2) * 255;
  }
  const blurred = adapter.gaussianBlur({ width, height, data: gray }, 1.0);
  const center = blurred.data[(width * (height >> 1)) + (width >> 1)];
  assert.ok(center > 50 && center < 200, `blurred center midtone, got ${center}`);
});

test('regression: adaptive canny finds edges on a real-style soft-contrast frame', () => {
  // Broadcast frames (blurred, moderate contrast) previously produced ZERO
  // canny edges because the fixed 50/150 thresholds sat above the achievable
  // NMS magnitude range (~0..60). The adaptive default must find them.
  const width = 320;
  const height = 180;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const band = y > height * 0.6 ? 150 + 10 * Math.sin(x / 9) : 60;
      const line = Math.abs(y - height * 0.6) < 4 ? 235 : band;
      data[i] = line + (x % 7);
      data[i + 1] = line + 5 - (x % 11);
      data[i + 2] = line - 10;
      data[i + 3] = 255;
    }
  }
  const gray = adapter.toGrayscale({ width, height, data, channels: 4 });
  const edges = adapter.cannyEdgeDetection(gray, null, null);
  let count = 0;
  for (const v of edges.edges) if (v) count++;
  assert.ok(count > 50, `adaptive canny found ${count} edge pixels`);
});

test('explicit canny thresholds still work as literal values', () => {
  const frame = syntheticCourtFrame(320, 180);
  const gray = adapter.toGrayscale({ ...frame, channels: 4 });
  const edges = adapter.cannyEdgeDetection(gray, 10, 30);
  let count = 0;
  for (const v of edges.edges) if (v) count++;
  assert.ok(count > 100, `literal-threshold canny found ${count} edge pixels`);
});

test('hough transform accumulates votes for straight lines', () => {
  const width = 100;
  const height = 100;
  const edges = new Uint8Array(width * height);
  for (let x = 10; x < 90; x++) edges[50 * width + x] = 255;
  const result = adapter.houghLineTransform({ width, height, edges }, 1, 1, 5);
  assert.ok(result.lines.length > 0);
  const best = result.lines.slice().sort((a, b) => b.votes - a.votes)[0];
  assert.ok(Math.abs(best.thetaDeg - 90) <= 1, `horizontal line peaks near 90, got ${best.thetaDeg}`);
  assert.ok(best.votes >= 30);
});

test('merge parallel peaks collapses 0/179 degree duplicates and keeps distinct parallels', () => {
  const peaks = [
    { rho: 200, thetaDeg: 0, votes: 120 },     // vertical line x=200
    { rho: -200, thetaDeg: 179, votes: 110 },  // same line, alternate parameterization
    { rho: 300, thetaDeg: 1, votes: 90 },      // distinct vertical x=300
    { rho: 400, thetaDeg: 90, votes: 80 },     // horizontal y=400
    { rho: 397, thetaDeg: 90, votes: 70 }      // second ridge of the same thick horizontal
  ];
  const merged = adapter.mergeParallelPeaks(peaks, 6, 24);
  assert.equal(merged.length, 3, `merged to ${merged.length} peaks`);
  const verticals = merged.filter((p) => p.thetaDeg <= 6 || p.thetaDeg >= 174);
  const horizontals = merged.filter((p) => Math.abs(p.thetaDeg - 90) <= 6);
  assert.equal(verticals.length, 2, 'two distinct vertical lines survive');
  assert.equal(horizontals.length, 1, 'one horizontal survives');
});

test('regression: segments hug their support instead of spanning frame borders', async () => {
  // A short horizontal white mark in the middle of the frame must produce a
  // segment near the mark, not a full-width line extended to both borders.
  const frame = syntheticCourtFrame(400, 300);
  const result = await adapter.detectCourtLines(frame, { votingThreshold: 30, maxLines: 20 });
  assert.ok(result.lines.length >= 3, `detected ${result.lines.length} lines`);
  // Expect a near-horizontal segment whose x-span is inside the frame (the
  // synthetic centre + side lines do not reach x=0/x=1).
  const horizontals = result.lines.filter((l) => Math.abs(l.angle - 90) <= 8);
  assert.ok(horizontals.length >= 2, `horizontal family present (${horizontals.length})`);
  const bounded = horizontals.some((l) => l.x1 > 0.02 && l.x2 < 0.98);
  assert.ok(bounded, 'at least one horizontal segment is clipped to its support');
});

test('regression: a level edge row emits one segment, not a folded smear twin', () => {
  // Peaks the row leaves at theta just above 90 used to be folded to
  // (180 - theta, -rho), which put them ~2y px away in rho from the true
  // (90, +y) peak; they survived merging and were emitted as a second,
  // overlapping near-horizontal ghost segment. The fold is only a valid
  // duplicate collapse near the 0/180 wrap, so an unfolded smear must
  // merge back into the true peak.
  const width = 640;
  const height = 360;
  const edges = new Uint8Array(width * height);
  for (let x = 40; x < 600; x++) edges[180 * width + x] = 255;
  const hough = adapter.houghLineTransform({ width, height, edges }, 1, 1, 45);
  assert.ok(hough.lines.length >= 1, 'row votes into peaks');
  const top = hough.lines.slice().sort((a, b) => b.votes - a.votes).slice(0, 120);
  const merged = adapter.mergeParallelPeaks(top, 6, 24);
  assert.equal(merged.length, 1, `smear family merged into one peak, got ${merged.length}`);
  const clipped = adapter.clipLinesToSupport(merged, { width, height, edges }, 2, 28);
  const segments = adapter.supportedSegments(clipped, width, height, 28);
  assert.equal(segments.length, 1, `one segment per stroke, got ${segments.length}`);
  assert.ok(Math.abs(segments[0].angle - 90) <= 1, `segment near level, got ${segments[0].angle}`);
  assert.ok(segments[0].length >= 500, `segment spans the row, got ${Math.round(segments[0].length)}px`);
});

test('regression: accumulator spans full -maxRho..+maxRho so off-centre vertical lines vote', () => {
  // The accumulator used to index rho against maxRho/2, so pixels whose
  // rho exceeded half the image diagonal (vertical lines beyond x ~ 0.57w
  // in a 16:9 frame, e.g. right-side court lines) never cast a vote and
  // the line was never detected.
  const width = 640;
  const height = 360;
  const edges = new Uint8Array(width * height);
  for (let y = 20; y < 340; y++) edges[y * width + 560] = 255;
  const hough = adapter.houghLineTransform({ width, height, edges }, 1, 1, 45);
  assert.ok(hough.lines.length >= 1, `column at x=560 votes, got ${hough.lines.length} peaks`);
  const top = hough.lines.slice().sort((a, b) => b.votes - a.votes).slice(0, 120);
  const merged = adapter.mergeParallelPeaks(top, 6, 24);
  const clipped = adapter.clipLinesToSupport(merged, { width, height, edges }, 2, 28);
  const segments = adapter.supportedSegments(clipped, width, height, 28);
  assert.equal(segments.length, 1, `one segment, got ${segments.length}`);
  assert.ok(Math.abs(segments[0].angle) <= 1 || Math.abs(segments[0].angle - 180) <= 1,
    `segment near vertical, got ${segments[0].angle}`);
  assert.ok(segments[0].length >= 250, `segment spans the column, got ${Math.round(segments[0].length)}px`);
});

test('regression: fold-threshold straddle emits one segment, not a folded twin', () => {
  // A stroke whose head quantizes onto bins 173/174 (direction ~6-7 deg off
  // vertical) used to be split by the fold threshold at 180 -
  // angleGroupTolerance: the 173-family stayed native while the 174-family
  // folded to (6, -rho), so both groups survived support clipping and were
  // emitted as two overlapping full-length segments. Matching each peak
  // against the folded twin only when its native key matches no group must
  // collapse the straddle back into one segment.
  const width = 640;
  const height = 360;
  const stroke = (x0, phiDeg, len) => {
    const edges = new Uint8Array(width * height);
    const rad = (phiDeg * Math.PI) / 180;
    for (let s = 0; s < len; s++) {
      const x = Math.round(x0 + s * Math.cos(rad));
      const y = Math.round(30 + s * Math.sin(rad));
      if (x >= 0 && x < width && y >= 0 && y < height) edges[y * width + x] = 255;
    }
    return edges;
  };
  for (const [x0, phi, len] of [[320, 83.5, 345], [320, 83.5, 120], [560, 83.5, 345], [320, 84, 300]]) {
    const edges = stroke(x0, phi, len);
    const hough = adapter.houghLineTransform({ width, height, edges }, 1, 1, 45);
    const top = hough.lines.slice().sort((a, b) => b.votes - a.votes).slice(0, 120);
    const merged = adapter.mergeParallelPeaks(top, 6, 24);
    assert.equal(merged.length, 1, `x0=${x0} dir ${phi}deg len ${len}: merged to ${merged.length} peaks`);
    const clipped = adapter.clipLinesToSupport(merged, { width, height, edges }, 2, 28);
    const segments = adapter.supportedSegments(clipped, width, height, 28);
    assert.equal(segments.length, 1, `x0=${x0} dir ${phi}deg len ${len}: emitted ${segments.length} segments`);
  }
});

test('regression: every single-stroke orientation emits exactly one segment', () => {
  // After the round-1 fold threshold was removed in favour of per-peak
  // native-first / folded-twin matching, no orientation of a lone stroke
  // may split into two groups (overlapping duplicate guidance strokes).
  const width = 640;
  const height = 360;
  for (let phiDeg = 1; phiDeg <= 179; phiDeg += 2) {
    const edges = new Uint8Array(width * height);
    const rad = (phiDeg * Math.PI) / 180;
    for (let s = 0; s < 220; s++) {
      const x = Math.round(320 + s * Math.cos(rad));
      const y = Math.round(60 + s * Math.sin(rad));
      if (x >= 0 && x < width && y >= 0 && y < height) edges[y * width + x] = 255;
    }
    const hough = adapter.houghLineTransform({ width, height, edges }, 1, 1, 45);
    const top = hough.lines.slice().sort((a, b) => b.votes - a.votes).slice(0, 120);
    const merged = adapter.mergeParallelPeaks(top, 6, 24);
    assert.equal(merged.length, 1, `dir ${phiDeg}deg merged to ${merged.length} peaks`);
    const clipped = adapter.clipLinesToSupport(merged, { width, height, edges }, 2, 28);
    const segments = adapter.supportedSegments(clipped, width, height, 28);
    assert.equal(segments.length, 1, `dir ${phiDeg}deg emitted ${segments.length} segments`);
  }
});

test('regression: a thick painted band emits one segment, not smear tails', () => {
  // A painted line >= ~3px wide leaves several adjacent edge rows, which
  // pushes its off-angle smear bins past the 45-vote threshold; their
  // origin-anchored rho drifts >24px from the head at the band's far end,
  // so they used to survive merging and support clipping as 87/93deg tail
  // segments. Measuring the merge distance from the frame centre keeps the
  // smears inside the window.
  const width = 640;
  const height = 360;
  const frameDims = { width, height };
  for (const thickness of [3, 5, 8, 12]) {
    const edges = new Uint8Array(width * height);
    for (let y = 180; y < 180 + thickness; y++) {
      for (let x = 30; x < 610; x++) edges[y * width + x] = 255;
    }
    const hough = adapter.houghLineTransform({ width, height, edges }, 1, 1, 45);
    const top = hough.lines.slice().sort((a, b) => b.votes - a.votes).slice(0, 120);
    const merged = adapter.mergeParallelPeaks(top, 6, 24, frameDims);
    assert.equal(merged.length, 1, `t=${thickness}px band merged to ${merged.length} peaks`);
    const clipped = adapter.clipLinesToSupport(merged, { width, height, edges }, 2, 28);
    const segments = adapter.supportedSegments(clipped, width, height, 28);
    assert.equal(segments.length, 1, `t=${thickness}px band emitted ${segments.length} segments`);
    assert.ok(Math.abs(segments[0].angle - 90) <= 1, `t=${thickness}px band near level, got ${segments[0].angle}`);
  }
});

test('regression: centre-anchored merging keeps distinct parallel bands apart', () => {
  // The centre-anchored distance must not fold two genuinely separated
  // painted bands into one group.
  const width = 640;
  const height = 360;
  const frameDims = { width, height };
  const edges = new Uint8Array(width * height);
  for (let y = 120; y < 124; y++) {
    for (let x = 30; x < 610; x++) edges[y * width + x] = 255;
  }
  for (let y = 160; y < 164; y++) {
    for (let x = 30; x < 610; x++) edges[y * width + x] = 255;
  }
  const hough = adapter.houghLineTransform({ width, height, edges }, 1, 1, 45);
  const top = hough.lines.slice().sort((a, b) => b.votes - a.votes).slice(0, 120);
  const merged = adapter.mergeParallelPeaks(top, 6, 24, frameDims);
  assert.equal(merged.length, 2, `two bands 40px apart merged to ${merged.length} peaks`);
  const clipped = adapter.clipLinesToSupport(merged, { width, height, edges }, 2, 28);
  const segments = adapter.supportedSegments(clipped, width, height, 28);
  assert.equal(segments.length, 2, `two bands emitted ${segments.length} segments`);
});

test('detectCourtLines finds the synthetic court end to end', async () => {
  const frame = syntheticCourtFrame(640, 360);
  const result = await adapter.detectCourtLines(frame);
  assert.ok(Array.isArray(result.lines));
  assert.equal(typeof result.config, 'object');
  assert.equal(result.config.votingThreshold, 45, 'merged defaults reported');
  assert.ok(result.lines.length >= 3, `found ${result.lines.length} lines`);
  const angles = result.lines.map((l) => l.angle);
  const hasHorizontal = angles.some((a) => Math.abs(a - 90) <= 6);
  // Court lines running away from a courtside camera tilt up to ~25 degrees
  // off image-vertical (Hough theta 0/180 families).
  const hasSteep = angles.some((a) => a <= 25 || a >= 155);
  assert.ok(hasHorizontal, `horizontal family present in ${angles.map(Math.round)}`);
  assert.ok(hasSteep, `steep family present in ${angles.map(Math.round)}`);
  for (const l of result.lines) {
    for (const v of [l.x1, l.y1, l.x2, l.y2]) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `normalized endpoint ${v}`);
    }
    assert.ok(Number.isInteger(l.votes) && l.votes > 0);
  }
});

test('detectCourtLines caps output at maxLines', async () => {
  const frame = syntheticCourtFrame(640, 360);
  const result = await adapter.detectCourtLines(frame, { maxLines: 4 });
  assert.ok(result.lines.length <= 4, `capped at 4, got ${result.lines.length}`);
});

test('detectCourtLines tolerates noise and empty frames without throwing', async () => {
  const noise = new Uint8ClampedArray(160 * 90 * 4);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
  const noisy = await adapter.detectCourtLines({ width: 160, height: 90, data: noise });
  assert.ok(Array.isArray(noisy.lines));

  const black = new Uint8ClampedArray(160 * 90 * 4);
  const empty = await adapter.detectCourtLines({ width: 160, height: 90, data: black });
  assert.deepEqual(empty.lines, []);
});

test('detectCourtLines is deterministic for the same frame', async () => {
  const frame = syntheticCourtFrame(320, 180);
  const a = await adapter.detectCourtLines(frame);
  const b = await adapter.detectCourtLines(frame);
  assert.deepEqual(a.lines, b.lines);
});
