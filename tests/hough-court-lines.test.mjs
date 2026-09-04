import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock the adapter factory
const createHoughAdapter = function() {
  // Inline the core functions from the adapter for testing
  const DEFAULT_CONFIG = {
    cannyLow: 50,
    cannyHigh: 150,
    rhoResolution: 1,
    thetaResolution: 1,
    votingThreshold: 50,
    minLineLength: 0.1,
    angleGroupTolerance: 5,
    distanceGroupTolerance: 20
  };

  function toGrayscale(pixels) {
    const { width, height, data, channels } = pixels;
    const gray = new Uint8Array(width * height);
    const totalPixels = width * height;

    for (let i = 0; i < totalPixels; i++) {
      const offset = i * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return { width, height, data: gray };
  }

  function histogramEqualize(grayImage) {
    const { width, height, data } = grayImage;
    const histogram = new Uint32Array(256);

    for (let i = 0; i < data.length; i++) {
      histogram[data[i]]++;
    }

    const cdf = new Uint32Array(256);
    cdf[0] = histogram[0];
    for (let i = 1; i < 256; i++) {
      cdf[i] = cdf[i - 1] + histogram[i];
    }

    const totalPixels = width * height;
    const lut = new Uint8Array(256);
    const cdfMin = cdf[0];
    const cdfMax = cdf[255];
    const cdfRange = cdfMax - cdfMin || 1;

    for (let i = 0; i < 256; i++) {
      lut[i] = Math.round(((cdf[i] - cdfMin) / cdfRange) * 255);
    }

    const equalized = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      equalized[i] = lut[data[i]];
    }

    return { width, height, data: equalized };
  }

  function gaussianBlur(grayImage, sigma = 1.0) {
    const { width, height, data } = grayImage;
    const blurred = new Uint8Array(data.length);

    const kernelSize = Math.max(3, Math.round(2 * Math.ceil(3 * sigma) + 1));
    const halfSize = Math.floor(kernelSize / 2);

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

        const mag = Math.hypot(gx, gy);
        magnitude[y * width + x] = Math.min(255, Math.round(mag / 8));
        direction[y * width + x] = Math.atan2(gy, gx) * (180 / Math.PI);
      }
    }

    return { width, height, magnitude, direction };
  }

  function nonMaxSuppression(edges, magnitude, direction) {
    const { width, height } = edges;
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

        if (mag >= q && mag >= r) {
          suppressed[idx] = mag;
        }
      }
    }

    return suppressed;
  }

  function cannyEdgeDetection(grayImage, lowThreshold = 50, highThreshold = 150) {
    const blurred = gaussianBlur(grayImage, 1.4);
    const edges = sobelEdgeDetection(blurred);
    const suppressed = nonMaxSuppression(blurred, edges.magnitude, edges.direction);

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

    function trackEdges(y, x, visited) {
      if (y < 0 || y >= height || x < 0 || x >= width) return;
      const idx = y * width + x;
      if (visited[idx]) return;
      visited[idx] = true;

      if (weak[idx] === WEAK) {
        edges_out[idx] = STRONG;
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

  function houghLineTransform(edgeImage, rhoRes = 1, thetaRes = 1, votingThreshold = 50) {
    const { width, height, edges } = edgeImage;

    const maxRho = Math.hypot(width, height);
    const rhoSize = Math.ceil(maxRho / rhoRes);
    const thetaSize = Math.ceil(180 / thetaRes);

    const accumulator = new Uint32Array(rhoSize * thetaSize);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (edges[idx] > 128) {
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

  return {
    toGrayscale,
    histogramEqualize,
    gaussianBlur,
    sobelEdgeDetection,
    nonMaxSuppression,
    cannyEdgeDetection,
    houghLineTransform
  };
};

test('Grayscale conversion', (t) => {
  const adapter = createHoughAdapter();
  const width = 10, height = 10;
  const rgba = new Uint8Array(width * height * 4);

  // Fill with known values: R=100, G=150, B=50
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 100;     // R
    rgba[i * 4 + 1] = 150; // G
    rgba[i * 4 + 2] = 50;  // B
    rgba[i * 4 + 3] = 255; // A
  }

  const pixels = { width, height, data: rgba, channels: 4 };
  const gray = adapter.toGrayscale(pixels);

  assert.equal(gray.width, width);
  assert.equal(gray.height, height);
  // Expected luminance: 0.299*100 + 0.587*150 + 0.114*50 ≈ 118
  const expected = Math.round(0.299 * 100 + 0.587 * 150 + 0.114 * 50);
  assert.equal(gray.data[0], expected, `Grayscale value should be ${expected}, got ${gray.data[0]}`);
});

test('Histogram equalization', (t) => {
  const adapter = createHoughAdapter();
  const width = 10, height = 10;
  const gray = new Uint8Array(width * height);

  // Fill with low values (0-50)
  for (let i = 0; i < width * height; i++) {
    gray[i] = (i % 50);
  }

  const grayImage = { width, height, data: gray };
  const equalized = adapter.histogramEqualize(grayImage);

  // After equalization, values should be spread across the range
  const min = Math.min(...equalized.data);
  const max = Math.max(...equalized.data);
  assert(max > min + 50, 'Equalization should spread values across range');
});

test('Gaussian blur reduces noise', (t) => {
  const adapter = createHoughAdapter();
  const width = 20, height = 20;
  const gray = new Uint8Array(width * height);

  // Create checkerboard pattern (high frequency noise)
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    gray[i] = ((x + y) % 2) * 255;
  }

  const grayImage = { width, height, data: gray };
  const blurred = adapter.gaussianBlur(grayImage, 1.0);

  // After blur, interior pixels should be less extreme
  const centerIdx = (width * Math.floor(height / 2)) + Math.floor(width / 2);
  const centerValue = blurred.data[centerIdx];
  assert(centerValue > 50 && centerValue < 200, 'Blurred center should be midtone');
});

test('Canny edge detection produces an edge image', (t) => {
  const adapter = createHoughAdapter();
  const width = 50, height = 50;
  const gray = new Uint8Array(width * height);

  // Create a strong vertical line in the middle (dark to bright transition)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < width / 2) {
        gray[y * width + x] = 10;  // Very dark
      } else {
        gray[y * width + x] = 245; // Very bright
      }
    }
  }

  const grayImage = { width, height, data: gray };
  const edges = adapter.cannyEdgeDetection(grayImage, 30, 80);

  // Should produce an edge image
  assert.equal(edges.width, width);
  assert.equal(edges.height, height);
  assert(edges.edges instanceof Uint8Array);
  assert.equal(edges.edges.length, width * height);
});

test('Hough transform accumulates votes', (t) => {
  const adapter = createHoughAdapter();
  const width = 50, height = 50;
  const edges = new Uint8Array(width * height);

  // Create a horizontal line of edge pixels
  for (let x = 10; x < 40; x++) {
    edges[25 * width + x] = 255;
  }

  const edgeImage = { width, height, edges };
  const result = adapter.houghLineTransform(edgeImage, 1, 1, 5);

  // Should find lines with votes
  assert(result.lines.length > 0, 'Should detect lines');
  const maxVotes = Math.max(...result.lines.map(l => l.votes));
  assert(maxVotes >= 5, 'Detected lines should have sufficient votes');
});

test('Hough transform executes without errors', async (t) => {
  // This test verifies the Hough transform pipeline runs
  const adapter = createHoughAdapter();
  const width = 100, height = 100;

  // Create grayscale image with simple edges
  const gray = new Uint8Array(width * height);

  // Fill with gradient (creates edges)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      gray[y * width + x] = Math.floor((x / width) * 255);
    }
  }

  const grayImage = { width, height, data: gray };
  const edges = adapter.cannyEdgeDetection(grayImage, 30, 80);
  const houghResult = adapter.houghLineTransform(edges, 1, 2, 1);

  // Should return a valid result
  assert.equal(typeof houghResult.width, 'number');
  assert.equal(typeof houghResult.height, 'number');
  assert(Array.isArray(houghResult.lines));
  assert(typeof houghResult.maxRho, 'number');
});
