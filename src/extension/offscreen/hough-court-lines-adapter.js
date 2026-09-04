/* Hough Line Transform for court line detection.
 *
 * Classical computer vision (no ML): grayscale -> histogram equalization ->
 * Gaussian blur -> Sobel/Canny edges -> Hough voting -> peak merging ->
 * support-clipped line segments.
 *
 * Real-footage correctness notes (validated against broadcast badminton
 * video, 2026-09):
 * - Canny thresholds are adaptive by default: cannyLow/cannyHigh of null
 *   derive high from the 94th percentile of NMS magnitudes and low = 0.45x
 *   high. A fixed 50/150 pair sits above the achievable magnitude range
 *   (blur + /8 Sobel scaling caps realistic edges near 60), so no strong
 *   seed ever existed and hysteresis emitted nothing on real frames.
 * - Hysteresis flood fill is iterative (explicit stack), never recursive.
 * - Hough peaks merge on BOTH angle and distance-from-frame-centre; each
 *   peak is matched in its own (theta, rho) parameterization first and,
 *   when that matches no group, against the folded twin (180 - theta,
 *   -rho), so the two accumulator parameterizations of one near-vertical
 *   line collapse into one segment while genuinely distinct parallel
 *   court lines survive.
 * - Segments are clipped to their actual edge-pixel support instead of being
 *   extended to the image borders, so guidance hugs visible line markings.
 */
(function installHoughCourtLinesAdapter(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOHoughCourtLinesAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function houghCourtLinesAdapterFactory(defaultEnvironment) {
  'use strict';

  /**
   * Defaults. cannyLow/cannyHigh may be explicit numbers (literal thresholds
   * on the 0..255 NMS magnitude scale) or null for the per-frame adaptive
   * defaults described above. minSupportSpan and minLineLength are
   * normalized to the image diagonal.
   */
  const DEFAULT_CONFIG = {
    cannyLow: null,
    cannyHigh: null,
    rhoResolution: 1,           // pixels per rho bin
    thetaResolution: 1,         // degrees per theta bin
    votingThreshold: 45,        // minimum accumulator votes to accept a peak
    minLineLength: 0.05,        // normalized to image diagonal
    minSupportSpan: 0.05,       // normalized to image diagonal
    angleGroupTolerance: 6,     // degrees
    distanceGroupTolerance: 24, // pixels (rho distance)
    maxLines: 12                // output cap, strongest first
  };

  function validDimensions(pixels) {
    return pixels && Number.isInteger(pixels.width) && pixels.width > 0 &&
      Number.isInteger(pixels.height) && pixels.height > 0 && pixels.data;
  }

  /** RGBA -> luminance grayscale. */
  function toGrayscale(pixels) {
    const { width, height, data, channels } = pixels;
    const gray = new Uint8Array(width * height);
    const totalPixels = width * height;
    for (let i = 0; i < totalPixels; i++) {
      const offset = i * channels;
      gray[i] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]);
    }
    return { width, height, data: gray };
  }

  /** Full-frame histogram equalization. */
  function histogramEqualize(grayImage) {
    const { width, height, data } = grayImage;
    const histogram = new Uint32Array(256);
    for (let i = 0; i < data.length; i++) histogram[data[i]]++;
    const cdf = new Uint32Array(256);
    cdf[0] = histogram[0];
    for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + histogram[i];
    const totalPixels = width * height;
    const lut = new Uint8Array(256);
    const cdfMin = cdf[0];
    const cdfRange = (cdf[255] - cdfMin) || 1;
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.round(((cdf[i] - cdfMin) / cdfRange) * 255);
    }
    const equalized = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) equalized[i] = lut[data[i]];
    return { width, height, data: equalized };
  }

  /** Separable Gaussian blur. */
  function gaussianBlur(grayImage, sigma = 1.4) {
    const { width, height, data } = grayImage;
    const kernelSize = Math.max(3, Math.round(2 * Math.ceil(3 * sigma) + 1));
    const halfSize = Math.floor(kernelSize / 2);
    const kernel = new Float32Array(kernelSize);
    let ksum = 0;
    for (let i = 0; i < kernelSize; i++) {
      const x = i - halfSize;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      ksum += kernel[i];
    }
    for (let i = 0; i < kernelSize; i++) kernel[i] /= ksum;

    const temp = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weight = 0;
        for (let i = -halfSize; i <= halfSize; i++) {
          const nx = Math.min(Math.max(x + i, 0), width - 1);
          const k = kernel[i + halfSize];
          sum += data[y * width + nx] * k;
          weight += k;
        }
        temp[y * width + x] = Math.round(sum / weight);
      }
    }
    const blurred = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weight = 0;
        for (let i = -halfSize; i <= halfSize; i++) {
          const ny = Math.min(Math.max(y + i, 0), height - 1);
          const k = kernel[i + halfSize];
          sum += temp[ny * width + x] * k;
          weight += k;
        }
        blurred[y * width + x] = Math.round(sum / weight);
      }
    }
    return { width, height, data: blurred };
  }

  /** Sobel magnitude (0..255, scaled by /8) and gradient direction. */
  function sobelEdgeDetection(grayImage) {
    const { width, height, data } = grayImage;
    const magnitude = new Uint8Array(width * height);
    const direction = new Float32Array(width * height);
    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const pixel = data[(y + ky - 1) * width + (x + kx - 1)];
            gx += sobelX[ky][kx] * pixel;
            gy += sobelY[ky][kx] * pixel;
          }
        }
        magnitude[y * width + x] = Math.min(255, Math.round(Math.hypot(gx, gy) / 8));
        direction[y * width + x] = Math.atan2(gy, gx) * (180 / Math.PI);
      }
    }
    return { width, height, magnitude, direction };
  }

  /** Non-maximum suppression of gradient ridges. */
  function nonMaxSuppression(magnitudeMap, direction) {
    const { width, height, magnitude } = magnitudeMap;
    const suppressed = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const angle = direction[idx];
        const mag = magnitude[idx];
        let q = 0, r = 0;
        if ((angle >= -22.5 && angle < 22.5) || angle < -157.5 || angle >= 157.5) {
          q = magnitude[y * width + (x + 1)];
          r = magnitude[y * width + (x - 1)];
        } else if ((angle >= 22.5 && angle < 67.5) || (angle < -112.5 && angle >= -157.5)) {
          q = magnitude[(y + 1) * width + (x - 1)];
          r = magnitude[(y - 1) * width + (x + 1)];
        } else if ((angle >= 67.5 && angle < 112.5) || (angle < -67.5 && angle >= -112.5)) {
          q = magnitude[(y + 1) * width + x];
          r = magnitude[(y - 1) * width + x];
        } else {
          q = magnitude[(y + 1) * width + (x + 1)];
          r = magnitude[(y - 1) * width + (x - 1)];
        }
        if (mag >= q && mag >= r) suppressed[idx] = mag;
      }
    }
    return suppressed;
  }

  /** Adaptive thresholds from the NMS magnitude distribution of this frame. */
  function adaptiveThresholds(suppressed) {
    const values = [];
    for (let i = 0; i < suppressed.length; i++) {
      if (suppressed[i] > 0) values.push(suppressed[i]);
    }
    values.sort((a, b) => a - b);
    if (!values.length) return { low: 1, high: 255 };
    const at = (p) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
    const high = Math.max(3, at(0.97));
    const low = Math.max(2, Math.round(high * 0.5));
    return { low, high };
  }

  /** Canny edges; null thresholds select per-frame adaptive values. */
  function cannyEdgeDetection(grayImage, lowThreshold = null, highThreshold = null) {
    const blurred = gaussianBlur(grayImage, 1.4);
    const sobel = sobelEdgeDetection(blurred);
    const suppressed = nonMaxSuppression(sobel, sobel.direction);
    const { width, height } = blurred;

    let low, high;
    if (Number.isFinite(highThreshold) && Number.isFinite(lowThreshold)) {
      low = lowThreshold;
      high = highThreshold;
    } else {
      const adaptive = adaptiveThresholds(suppressed);
      low = adaptive.low;
      high = adaptive.high;
    }
    if (high < low) { const t = high; high = low; low = t; }

    const edges = new Uint8Array(width * height);
    const STRONG = 255;
    const stack = [];

    for (let i = 0; i < suppressed.length; i++) {
      if (suppressed[i] >= high) {
        edges[i] = STRONG;
        stack.push(i);
      }
    }
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (edges[nIdx]) continue;
          if (suppressed[nIdx] >= low) {
            edges[nIdx] = STRONG;
            stack.push(nIdx);
          }
        }
      }
    }
    return { width, height, edges };
  }

  /** Accumulate (rho, theta) votes over edge pixels; return peaks >= threshold. */
  function houghLineTransform(edgeImage, rhoRes = 1, thetaRes = 1, votingThreshold = 45) {
    const { width, height, edges } = edgeImage;
    // rho = x*cos + y*sin ranges over [-maxRho, +maxRho] for lines that
    // pass through the image, so the accumulator spans that full range;
    // halving it would blind every line whose supporting pixels sit more
    // than half a diagonal from the origin (e.g. right-side court lines).
    const maxRho = Math.hypot(width, height);
    const rhoSize = Math.ceil((2 * maxRho) / rhoRes);
    const thetaSize = Math.ceil(180 / thetaRes);
    const accumulator = new Uint32Array(rhoSize * thetaSize);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y * width + x] > 128) {
          for (let thetaDeg = 0; thetaDeg < 180; thetaDeg += thetaRes) {
            const theta = thetaDeg * (Math.PI / 180);
            const rho = x * Math.cos(theta) + y * Math.sin(theta);
            const rhoIdx = Math.round((rho + maxRho) / rhoRes);
            const thetaIdx = Math.round(thetaDeg / thetaRes);
            if (rhoIdx >= 0 && rhoIdx < rhoSize && thetaIdx >= 0 && thetaIdx < thetaSize) {
              accumulator[thetaIdx * rhoSize + rhoIdx]++;
            }
          }
        }
      }
    }
    const lines = [];
    for (let thetaIdx = 0; thetaIdx < thetaSize; thetaIdx++) {
      for (let rhoIdx = 0; rhoIdx < rhoSize; rhoIdx++) {
        const votes = accumulator[thetaIdx * rhoSize + rhoIdx];
        if (votes >= votingThreshold) {
          const theta = (thetaIdx * thetaRes) * (Math.PI / 180);
          lines.push({ rho: rhoIdx * rhoRes - maxRho, theta, votes, thetaDeg: thetaIdx * thetaRes });
        }
      }
    }
    return { width, height, maxRho, lines };
  }

  /**
   * Merge near-duplicate peaks. A near-vertical line votes twice — once
   * near theta 0 with rho ~ +c and again near theta 179 with rho ~ -c —
   * while the smeared votes any line leaves on neighbouring theta bins can
   * straddle either side of any fixed fold threshold, so no blanket angle
   * fold is applied. Each peak is compared against a group reference in
   * its own (theta, rho) parameterization first and, when that matches no
   * group, against the folded twin (180 - theta, -rho): wrap-seam
   * duplicates collapse through the folded comparison while the smears of
   * a single stroke merge back into their true peak through the native
   * one. The folded comparison only applies to pairs that straddle the
   * 0/180 seam (one side within angleGroupTol of 0, the other within
   * angleGroupTol of 180), so level lines mirror-symmetric about the
   * frame centre stay distinct. Distance is measured as the signed offset
   * from the frame centre along the line normal (or from the corner
   * origin when no frameSize is given): rho itself grows with distance
   * from the origin, so an origin-anchored window splits the off-angle
   * smears of long lines off their head. Peaks within angleGroupTol
   * degrees AND distanceGroupTol pixels belong to one physical line; the
   * strongest survives.
   */
  function mergeParallelPeaks(lines, angleGroupTol, distanceGroupTol, frameSize) {
    const cx = frameSize ? frameSize.width / 2 : 0;
    const cy = frameSize ? frameSize.height / 2 : 0;
    const items = lines.map((line) => ({
      line,
      offset: frameSize
        ? cx * Math.cos(line.theta) + cy * Math.sin(line.theta) - line.rho
        : -line.rho
    }));
    const sorted = items.slice().sort((a, b) => b.line.votes - a.line.votes);
    const groups = [];
    for (const item of sorted) {
      let placed = false;
      for (const group of groups) {
        const ref = group[0];
        if (Math.abs(item.line.thetaDeg - ref.line.thetaDeg) <= angleGroupTol &&
            Math.abs(item.offset - ref.offset) <= distanceGroupTol) {
          group.push(item);
          placed = true;
          break;
        }
        const straddlesSeam =
          (item.line.thetaDeg <= angleGroupTol && ref.line.thetaDeg >= 180 - angleGroupTol) ||
          (item.line.thetaDeg >= 180 - angleGroupTol && ref.line.thetaDeg <= angleGroupTol);
        if (straddlesSeam &&
            Math.abs(item.offset + ref.offset) <= distanceGroupTol) {
          group.push(item);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([item]);
    }
    return groups.map((g) => g[0].line).sort((a, b) => b.votes - a.votes);
  }

  /**
   * Clip each accepted line to the span of edge pixels that support it
   * (edge pixels within maxDist pixels of the line, projected along its
   * direction). Only lines whose support span and pixel count both reach
   * minSpan survive.
   */
  function clipLinesToSupport(lines, edgeImage, maxDist = 2, minSpan = 28) {
    const { width, height, edges } = edgeImage;
    const out = [];
    for (const line of lines) {
      const { rho, theta } = line;
      const cos_theta = Math.cos(theta);
      const sin_theta = Math.sin(theta);
      let minS = Infinity;
      let maxS = -Infinity;
      let count = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (edges[y * width + x] > 128) {
            const dist = Math.abs(x * cos_theta + y * sin_theta - rho);
            if (dist <= maxDist) {
              const s = x * -sin_theta + y * cos_theta;
              if (s < minS) minS = s;
              if (s > maxS) maxS = s;
              count++;
            }
          }
        }
      }
      if (count >= minSpan && maxS - minS >= minSpan) {
        out.push({ line, minS, maxS });
      }
    }
    return out;
  }

  /** Convert support-clipped lines to (image-bounded) endpoint segments. */
  function supportedSegments(clipped, width, height, minSpan = 28) {
    const segments = [];
    for (const item of clipped) {
      const { line, minS, maxS } = item;
      const { rho, theta, votes, thetaDeg } = line;
      const cos_theta = Math.cos(theta);
      const sin_theta = Math.sin(theta);
      // Point on the line at projection s:
      //   x = rho*cos - s*sin ; y = rho*sin + s*cos
      const p1 = { x: cos_theta * rho - sin_theta * minS, y: sin_theta * rho + cos_theta * minS };
      const p2 = { x: cos_theta * rho - sin_theta * maxS, y: sin_theta * rho + cos_theta * maxS };

      // Trim the segment to the image rectangle.
      let lo = 0, hi = 1;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      let invalid = false;
      const clipAxis = (orig, dir, bound) => {
        if (Math.abs(dir) < 1e-9) {
          if (orig < 0 || orig > bound) invalid = true;
          return;
        }
        const t0 = (0 - orig) / dir;
        const t1 = (bound - orig) / dir;
        if (t0 > t1) { lo = Math.max(lo, t1); hi = Math.min(hi, t0); }
        else { lo = Math.max(lo, t0); hi = Math.min(hi, t1); }
      };
      clipAxis(p1.x, dx, width - 1);
      clipAxis(p1.y, dy, height - 1);
      if (invalid || hi < lo) continue;
      const q1 = { x: p1.x + lo * dx, y: p1.y + lo * dy };
      const q2 = { x: p1.x + hi * dx, y: p1.y + hi * dy };
      const length = Math.hypot(q2.x - q1.x, q2.y - q1.y);
      if (length < Math.max(12, minSpan * 0.5)) continue;
      segments.push({
        x1: q1.x, y1: q1.y, x2: q2.x, y2: q2.y,
        length, angle: thetaDeg, votes, rho, support: maxS - minS
      });
    }
    return segments;
  }

  function filterShortSegments(segments, minLength, diagonal) {
    const minPixels = Math.max(12, minLength * diagonal);
    return segments.filter((s) => s.length >= minPixels);
  }

  async function detectCourtLines(frame, config = DEFAULT_CONFIG) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    let pixels;
    if (frame && frame.data && frame.width && frame.height) {
      const expectedLength = frame.width * frame.height * 4;
      if (frame.data.length === expectedLength) {
        pixels = {
          width: frame.width,
          height: frame.height,
          data: frame.data instanceof Uint8ClampedArray ? frame.data : new Uint8ClampedArray(frame.data),
          channels: 4
        };
      }
    }
    if (!pixels) {
      const Canvas = defaultEnvironment && defaultEnvironment.OffscreenCanvas;
      let canvas = Canvas ? new Canvas(frame.width, frame.height) : null;
      if (!canvas && defaultEnvironment && defaultEnvironment.document && defaultEnvironment.document.createElement) {
        canvas = defaultEnvironment.document.createElement('canvas');
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      if (!canvas || typeof canvas.getContext !== 'function') return { lines: [] };
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context || typeof context.drawImage !== 'function' || typeof context.getImageData !== 'function') {
        return { lines: [] };
      }
      if (typeof frame.drawImage === 'function' || frame instanceof HTMLCanvasElement ||
          (defaultEnvironment && defaultEnvironment.ImageBitmap && frame instanceof defaultEnvironment.ImageBitmap)) {
        context.drawImage(frame, 0, 0, frame.width, frame.height);
        const image = context.getImageData(0, 0, frame.width, frame.height);
        pixels = { width: frame.width, height: frame.height, data: image.data, channels: 4 };
      } else {
        return { lines: [] };
      }
    }
    if (!validDimensions(pixels)) return { lines: [] };

    try {
      const gray = toGrayscale(pixels);
      const equalized = histogramEqualize(gray);
      const edges = cannyEdgeDetection(equalized, cfg.cannyLow, cfg.cannyHigh);
      const hough = houghLineTransform(edges, cfg.rhoResolution, cfg.thetaResolution, cfg.votingThreshold);
      // Merge cost grows with peak count, and dense edge maps can saturate
      // most accumulator bins with low-vote peaks. Court lines are the
      // strongest peaks, so merging the top peaks only is both cheap and
      // keeps the real lines.
      const topPeaks = hough.lines.slice().sort((a, b) => b.votes - a.votes).slice(0, 120);
      const merged = mergeParallelPeaks(topPeaks, cfg.angleGroupTolerance, cfg.distanceGroupTolerance, pixels);
      const diagonal = Math.hypot(pixels.width, pixels.height);
      const minSpan = Math.max(28, Math.round(cfg.minSupportSpan * diagonal));
      const clipped = clipLinesToSupport(merged.slice(0, 40), edges, 2, minSpan);
      const segments = supportedSegments(clipped, pixels.width, pixels.height, minSpan);
      const kept = filterShortSegments(segments, cfg.minLineLength, diagonal)
        .sort((a, b) => b.votes - a.votes)
        .slice(0, Math.max(1, Number(cfg.maxLines) || 12));

      return {
        lines: kept.map((s) => ({
          x1: s.x1 / frame.width,
          y1: s.y1 / frame.height,
          x2: s.x2 / frame.width,
          y2: s.y2 / frame.height,
          angle: s.angle,
          votes: s.votes
        })),
        config: cfg
      };
    } catch (error) {
      console.error('Hough line detection error:', error);
      return { lines: [] };
    }
  }

  return Object.freeze({
    detectCourtLines,
    DEFAULT_CONFIG,
    toGrayscale,
    histogramEqualize,
    gaussianBlur,
    sobelEdgeDetection,
    nonMaxSuppression,
    cannyEdgeDetection,
    adaptiveThresholds,
    houghLineTransform,
    mergeParallelPeaks,
    clipLinesToSupport,
    supportedSegments,
    filterShortSegments
  });
}));
