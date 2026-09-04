/* Hough Line Transform for court line detection. */
(function installHoughCourtLinesAdapter(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BSOHoughCourtLinesAdapter = api;
}(typeof globalThis === 'object' ? globalThis : self, function houghCourtLinesAdapterFactory(defaultEnvironment) {
  'use strict';

  /**
   * Hough Line Transform for automatic court line detection.
   *
   * Algorithm:
   * 1. Grayscale conversion
   * 2. Histogram equalization (lighting variation)
   * 3. Gaussian blur (noise reduction)
   * 4. Canny edge detection
   * 5. Hough line transform (voting)
   * 6. Post-processing: filter by length, group parallel lines
   *
   * Performance: ~5-15ms per frame on typical hardware
   */

  const DEFAULT_CONFIG = {
    // Canny edge detection thresholds
    cannyLow: 50,
    cannyHigh: 150,

    // Hough transform parameters
    rhoResolution: 1,           // pixels per bin
    thetaResolution: 1,         // degrees per bin
    votingThreshold: 50,        // minimum votes to accept a line

    // Line filtering
    minLineLength: 0.1,         // normalized [0, 1] of image diagonal
    angleGroupTolerance: 5,     // degrees
    distanceGroupTolerance: 20  // pixels
  };

  function validDimensions(pixels) {
    return pixels && Number.isInteger(pixels.width) && pixels.width > 0 &&
      Number.isInteger(pixels.height) && pixels.height > 0 && pixels.data;
  }

  /**
   * Convert RGBA to grayscale using luminance formula.
   */
  function toGrayscale(pixels) {
    const { width, height, data, channels } = pixels;
    const gray = new Uint8Array(width * height);
    const totalPixels = width * height;

    for (let i = 0; i < totalPixels; i++) {
      const offset = i * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      // Luminance formula: 0.299R + 0.587G + 0.114B
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return { width, height, data: gray };
  }

  /**
   * Histogram equalization for better contrast.
   */
  function histogramEqualize(grayImage) {
    const { width, height, data } = grayImage;
    const histogram = new Uint32Array(256);

    // Build histogram
    for (let i = 0; i < data.length; i++) {
      histogram[data[i]]++;
    }

    // Cumulative histogram
    const cdf = new Uint32Array(256);
    cdf[0] = histogram[0];
    for (let i = 1; i < 256; i++) {
      cdf[i] = cdf[i - 1] + histogram[i];
    }

    // Normalize and create lookup table
    const totalPixels = width * height;
    const lut = new Uint8Array(256);
    const cdfMin = cdf[0];
    const cdfMax = cdf[255];
    const cdfRange = cdfMax - cdfMin || 1;

    for (let i = 0; i < 256; i++) {
      lut[i] = Math.round(((cdf[i] - cdfMin) / cdfRange) * 255);
    }

    // Apply LUT
    const equalized = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      equalized[i] = lut[data[i]];
    }

    return { width, height, data: equalized };
  }

  /**
   * Gaussian blur using separable kernels.
   */
  function gaussianBlur(grayImage, sigma = 1.0) {
    const { width, height, data } = grayImage;
    const blurred = new Uint8Array(data.length);

    // Kernel size based on sigma
    const kernelSize = Math.max(3, Math.round(2 * Math.ceil(3 * sigma) + 1));
    const halfSize = Math.floor(kernelSize / 2);

    // Generate Gaussian kernel
    const kernel = new Float32Array(kernelSize);
    let sum = 0;
    for (let i = 0; i < kernelSize; i++) {
      const x = i - halfSize;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      sum += kernel[i];
    }
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] /= sum;
    }

    // Horizontal pass
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

    // Vertical pass
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

  /**
   * Sobel edge detection.
   * Returns both gradient magnitude and direction.
   */
  function sobelEdgeDetection(grayImage) {
    const { width, height, data } = grayImage;
    const magnitude = new Uint8Array(width * height);
    const direction = new Float32Array(width * height);

    // Sobel kernels
    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;

        // Apply Sobel kernels
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const pixel = data[(y + ky - 1) * width + (x + kx - 1)];
            gx += sobelX[ky][kx] * pixel;
            gy += sobelY[ky][kx] * pixel;
          }
        }

        // Magnitude
        const mag = Math.hypot(gx, gy);
        magnitude[y * width + x] = Math.min(255, Math.round(mag / 8));

        // Direction (in degrees, 0-180)
        direction[y * width + x] = Math.atan2(gy, gx) * (180 / Math.PI);
      }
    }

    return { width, height, magnitude, direction };
  }

  /**
   * Non-maximum suppression for edge thinning.
   */
  function nonMaxSuppression(edges, magnitude, direction) {
    const { width, height } = edges;
    const suppressed = new Uint8Array(width * height);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const angle = direction[idx];
        const mag = magnitude[idx];

        let q = 0, r = 0;

        // Determine neighbors based on gradient direction
        if ((angle >= -22.5 && angle < 22.5) || angle < -157.5 || angle >= 157.5) {
          // Horizontal
          q = magnitude[y * width + (x + 1)];
          r = magnitude[y * width + (x - 1)];
        } else if ((angle >= 22.5 && angle < 67.5) || (angle < -112.5 && angle >= -157.5)) {
          // Diagonal /
          q = magnitude[(y + 1) * width + (x - 1)];
          r = magnitude[(y - 1) * width + (x + 1)];
        } else if ((angle >= 67.5 && angle < 112.5) || (angle < -67.5 && angle >= -112.5)) {
          // Vertical
          q = magnitude[(y + 1) * width + x];
          r = magnitude[(y - 1) * width + x];
        } else {
          // Diagonal \
          q = magnitude[(y + 1) * width + (x + 1)];
          r = magnitude[(y - 1) * width + (x - 1)];
        }

        if (mag >= q && mag >= r) {
          suppressed[idx] = mag;
        }
      }
    }

    return suppressed;
  }

  /**
   * Canny edge detection with hysteresis.
   */
  function cannyEdgeDetection(grayImage, lowThreshold = 50, highThreshold = 150) {
    // Blur to reduce noise
    const blurred = gaussianBlur(grayImage, 1.4);

    // Sobel edge detection
    const edges = sobelEdgeDetection(blurred);

    // Non-maximum suppression
    const suppressed = nonMaxSuppression(blurred, edges.magnitude, edges.direction);

    // Double thresholding
    const { width, height } = blurred;
    const strong = new Uint8Array(width * height);
    const weak = new Uint8Array(width * height);
    const edges_out = new Uint8Array(width * height);

    const STRONG = 255;
    const WEAK = 100;

    for (let i = 0; i < suppressed.length; i++) {
      if (suppressed[i] >= highThreshold) {
        strong[i] = STRONG;
      } else if (suppressed[i] >= lowThreshold) {
        weak[i] = WEAK;
      }
    }

    // Edge tracking by hysteresis
    function trackEdges(y, x, visited) {
      if (y < 0 || y >= height || x < 0 || x >= width) return;
      const idx = y * width + x;
      if (visited[idx]) return;
      visited[idx] = true;

      if (weak[idx] === WEAK) {
        edges_out[idx] = STRONG;
        // Check 8 neighbors
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx !== 0 || dy !== 0) {
              trackEdges(y + dy, x + dx, visited);
            }
          }
        }
      }
    }

    const visited = new Uint8Array(width * height);
    for (let i = 0; i < strong.length; i++) {
      if (strong[i] === STRONG) {
        edges_out[i] = STRONG;
        const x = i % width;
        const y = Math.floor(i / width);
        visited[i] = true;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            trackEdges(y + dy, x + dx, visited);
          }
        }
      }
    }

    return { width, height, edges: edges_out };
  }

  /**
   * Hough Line Transform.
   * Converts edge pixels to (rho, theta) space and accumulates votes.
   */
  function houghLineTransform(edgeImage, rhoRes = 1, thetaRes = 1, votingThreshold = 50) {
    const { width, height, edges } = edgeImage;

    // Diagonal is the maximum rho distance
    const maxRho = Math.hypot(width, height);
    const rhoSize = Math.ceil(maxRho / rhoRes);
    const thetaSize = Math.ceil(180 / thetaRes);

    // Accumulator array
    const accumulator = new Uint32Array(rhoSize * thetaSize);

    // For each edge pixel, vote for all possible lines through it
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (edges[idx] > 128) {
          // This is an edge pixel
          for (let thetaDeg = 0; thetaDeg < 180; thetaDeg += thetaRes) {
            const theta = thetaDeg * (Math.PI / 180);
            const rho = x * Math.cos(theta) + y * Math.sin(theta);
            const rhoIdx = Math.round((rho + maxRho / 2) / rhoRes);
            const thetaIdx = Math.round(thetaDeg / thetaRes);

            if (rhoIdx >= 0 && rhoIdx < rhoSize && thetaIdx >= 0 && thetaIdx < thetaSize) {
              accumulator[thetaIdx * rhoSize + rhoIdx]++;
            }
          }
        }
      }
    }

    // Extract lines with sufficient votes
    const lines = [];
    for (let thetaIdx = 0; thetaIdx < thetaSize; thetaIdx++) {
      for (let rhoIdx = 0; rhoIdx < rhoSize; rhoIdx++) {
        const votes = accumulator[thetaIdx * rhoSize + rhoIdx];
        if (votes >= votingThreshold) {
          const theta = (thetaIdx * thetaRes) * (Math.PI / 180);
          const rho = rhoIdx * rhoRes - maxRho / 2;
          lines.push({ rho, theta, votes, thetaDeg: thetaIdx * thetaRes });
        }
      }
    }

    return { width, height, maxRho, lines };
  }

  /**
   * Convert Hough lines back to image space and compute endpoints.
   */
  function houghLinesToSegments(houghResult, edgeImage) {
    const { width, height, lines, maxRho } = houghResult;
    const { edges } = edgeImage;
    const segments = [];

    for (const line of lines) {
      const { rho, theta } = line;
      const cos_theta = Math.cos(theta);
      const sin_theta = Math.sin(theta);

      // Find endpoints by intersecting with image bounds
      let points = [];

      // Top edge (y = 0)
      if (Math.abs(sin_theta) > 0.01) {
        const x = (rho - 0 * sin_theta) / cos_theta;
        if (x >= 0 && x < width) points.push({ x, y: 0 });
      }

      // Bottom edge (y = height - 1)
      if (Math.abs(sin_theta) > 0.01) {
        const x = (rho - (height - 1) * sin_theta) / cos_theta;
        if (x >= 0 && x < width) points.push({ x, y: height - 1 });
      }

      // Left edge (x = 0)
      if (Math.abs(cos_theta) > 0.01) {
        const y = (rho - 0 * cos_theta) / sin_theta;
        if (y >= 0 && y < height) points.push({ x: 0, y });
      }

      // Right edge (x = width - 1)
      if (Math.abs(cos_theta) > 0.01) {
        const y = (rho - (width - 1) * cos_theta) / sin_theta;
        if (y >= 0 && y < height) points.push({ x: width - 1, y });
      }

      // Remove duplicates
      points = points.filter((p, i, arr) =>
        i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 1
      );

      if (points.length >= 2) {
        const p1 = points[0];
        const p2 = points[points.length - 1];
        const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);

        segments.push({
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          length,
          angle: line.thetaDeg,
          votes: line.votes
        });
      }
    }

    return segments;
  }

  /**
   * Filter lines by length and group parallel lines.
   */
  function filterAndGroupLines(segments, minLength, angleGroupTol, distanceGroupTol) {
    // Filter by minimum length
    const minPixels = minLength * Math.hypot(segments[0]?.x2 - segments[0]?.x1 || 1,
                                              segments[0]?.y2 - segments[0]?.y1 || 1);
    let filtered = segments.filter(s => s.length >= Math.max(50, minPixels));

    // Sort by votes descending
    filtered.sort((a, b) => b.votes - a.votes);

    // Group parallel lines
    const groups = [];
    for (const segment of filtered) {
      let found = false;
      for (const group of groups) {
        const angleDiff = Math.min(
          Math.abs(segment.angle - group[0].angle),
          180 - Math.abs(segment.angle - group[0].angle)
        );
        if (angleDiff <= angleGroupTol) {
          group.push(segment);
          found = true;
          break;
        }
      }
      if (!found) {
        groups.push([segment]);
      }
    }

    // Keep top line from each group
    return groups.map(g => g[0]);
  }

  /**
   * Detect court lines from a frame.
   */
  async function detectCourtLines(frame, config = DEFAULT_CONFIG) {
    // Check if frame is already ImageData or has pixel data directly
    // This avoids unnecessary canvas roundtrip and works with serialized frames
    let pixels;
    if (frame && frame.data && frame.width && frame.height) {
      // Frame is already ImageData or has .data array (from deserialization)
      // Check if data length matches expected size
      const expectedLength = frame.width * frame.height * 4;
      if (frame.data.length === expectedLength) {
        // Use frame directly - no canvas needed
        pixels = {
          width: frame.width,
          height: frame.height,
          data: frame.data instanceof Uint8ClampedArray ? frame.data : new Uint8ClampedArray(frame.data),
          channels: 4
        };
      }
    }

    // Fallback: use canvas for sources that need drawImage (ImageBitmap, VideoFrame, HTMLCanvasElement, etc.)
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

      // Only attempt drawImage if frame is a drawable type (not ImageData)
      if (typeof frame.drawImage === 'function' || frame instanceof HTMLCanvasElement ||
          (defaultEnvironment && defaultEnvironment.ImageBitmap && frame instanceof defaultEnvironment.ImageBitmap)) {
        context.drawImage(frame, 0, 0, frame.width, frame.height);
        const image = context.getImageData(0, 0, frame.width, frame.height);
        pixels = {
          width: frame.width,
          height: frame.height,
          data: image.data,
          channels: 4
        };
      } else {
        return { lines: [] };
      }
    }

    if (!validDimensions(pixels)) return { lines: [] };

    try {
      // Processing pipeline
      const gray = toGrayscale(pixels);
      const equalized = histogramEqualize(gray);
      const edges = cannyEdgeDetection(equalized, config.cannyLow, config.cannyHigh);
      const houghResult = houghLineTransform(edges, config.rhoResolution,
                                            config.thetaResolution, config.votingThreshold);
      const segments = houghLinesToSegments(houghResult, edges);
      const filtered = filterAndGroupLines(segments, config.minLineLength,
                                          config.angleGroupTolerance, config.distanceGroupTolerance);

      return {
        lines: filtered.map(s => ({
          x1: s.x1 / frame.width,     // Normalize to [0, 1]
          y1: s.y1 / frame.height,
          x2: s.x2 / frame.width,
          y2: s.y2 / frame.height,
          angle: s.angle,
          votes: s.votes
        })),
        config
      };
    } catch (error) {
      console.error('Hough line detection error:', error);
      return { lines: [] };
    }
  }

  return Object.freeze({
    detectCourtLines,
    DEFAULT_CONFIG,
    // Exported for testing
    toGrayscale,
    histogramEqualize,
    gaussianBlur,
    sobelEdgeDetection,
    nonMaxSuppression,
    cannyEdgeDetection,
    houghLineTransform,
    houghLinesToSegments,
    filterAndGroupLines
  });
}));
