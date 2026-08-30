/**
 * Browser-side TrackNet input/output contract.
 *
 * TrackNet V2 and the official TrackNet V4 implementation consume three RGB
 * frames packed as [N, 9, H, W] and emit three heatmaps [N, 3, H, W]. The
 * V3 tracker can use the same contract when exported with seq_len=3 and no
 * background channel (`bg_mode=""`).
 */

export function preprocessFrames(frames, { width, height } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TypeError('width and height must be positive integers');
  }
  if (!Array.isArray(frames) || frames.length !== 3) {
    throw new TypeError('TrackNet requires exactly 3 frames');
  }

  const result = new Float32Array(3 * 3 * width * height);
  const planeSize = width * height;
  frames.forEach((frame, frameIndex) => {
    if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || !frame.data) {
      throw new TypeError(`frame ${frameIndex} must have width, height, and data`);
    }
    const channels = frame.data.length / (frame.width * frame.height);
    if (channels < 3) throw new TypeError(`frame ${frameIndex} must have RGB or RGBA data`);
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(frame.height - 1, Math.floor(y * frame.height / height));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(frame.width - 1, Math.floor(x * frame.width / width));
        const source = (sourceY * frame.width + sourceX) * channels;
        const pixel = y * width + x;
        // TrackNet source implementations use frame-major RGB planes, not
        // interleaved RGBRGB... values. Keep this explicit at the boundary.
        result[frameIndex * 3 * planeSize + pixel] = frame.data[source] / 255;
        result[frameIndex * 3 * planeSize + planeSize + pixel] = frame.data[source + 1] / 255;
        result[frameIndex * 3 * planeSize + 2 * planeSize + pixel] = frame.data[source + 2] / 255;
      }
    }
  });
  return result;
}

function shapeProduct(dims) {
  return dims.reduce((product, dim) => product * dim, 1);
}

function outputOffset(dims, frame, y, x) {
  // Supported output layouts are [N, T, H, W] and [T, H, W].
  if (dims.length === 4) return ((frame * dims[2] + y) * dims[3]) + x;
  return ((frame * dims[1] + y) * dims[2]) + x;
}

function outputShape(dims) {
  if (dims.length === 4 && dims[0] === 1) return { frames: dims[1], height: dims[2], width: dims[3] };
  if (dims.length === 3) return { frames: dims[0], height: dims[1], width: dims[2] };
  throw new TypeError(`expected [1,T,H,W] or [T,H,W] heatmaps, got [${dims}]`);
}

/**
 * Decode one or more sigmoid heatmaps. A TrackNet detection is the centroid
 * of the largest 8-connected component above threshold; the raw argmax is
 * returned as a diagnostic because it is useful for spotting diffuse peaks.
 */
export function decodeHeatmaps(values, dims, { threshold = 0.5, frameIndex = 'all' } = {}) {
  if (!values || !dims || shapeProduct(dims) !== values.length) {
    throw new TypeError('heatmap values and dimensions do not match');
  }
  if (!(threshold >= 0 && threshold <= 1)) throw new RangeError('threshold must be in [0, 1]');
  const shape = outputShape(Array.from(dims, Number));
  const selected = frameIndex === 'all'
    ? [...Array(shape.frames).keys()]
    : [frameIndex];
  return selected.map((frame) => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= shape.frames) {
      throw new RangeError(`frame index ${frame} is outside [0, ${shape.frames})`);
    }
    let max = -Infinity;
    let maxX = 0;
    let maxY = 0;
    const active = new Uint8Array(shape.width * shape.height);
    for (let y = 0; y < shape.height; y += 1) {
      for (let x = 0; x < shape.width; x += 1) {
        const value = Number(values[outputOffset(dims, frame, y, x)]);
        if (value > max) {
          max = value;
          maxX = x;
          maxY = y;
        }
        if (value >= threshold) active[y * shape.width + x] = 1;
      }
    }

    let best = null;
    const visited = new Uint8Array(active.length);
    for (let start = 0; start < active.length; start += 1) {
      if (!active[start] || visited[start]) continue;
      const queue = [start];
      visited[start] = 1;
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let componentMax = -Infinity;
      let componentPeakX = 0;
      let componentPeakY = 0;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const index = queue[cursor];
        const x = index % shape.width;
        const y = Math.floor(index / shape.width);
        const value = Number(values[outputOffset(dims, frame, y, x)]);
        count += 1;
        sumX += x;
        sumY += y;
        if (value > componentMax) {
          componentMax = value;
          componentPeakX = x;
          componentPeakY = y;
        }
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= shape.width || ny < 0 || ny >= shape.height) continue;
            const next = ny * shape.width + nx;
            if (active[next] && !visited[next]) {
              visited[next] = 1;
              queue.push(next);
            }
          }
        }
      }
      if (!best || count > best.count) {
        best = { count, x: sumX / count, y: sumY / count, confidence: componentMax, peakX: componentPeakX, peakY: componentPeakY };
      }
    }

    return {
      frame,
      width: shape.width,
      height: shape.height,
      detected: best !== null,
      confidence: best ? best.confidence : Math.max(0, max),
      x: best ? best.x : null,
      y: best ? best.y : null,
      peakX: best ? best.peakX : maxX,
      peakY: best ? best.peakY : maxY,
      max,
      activePixels: best ? best.count : 0,
    };
  });
}

/**
 * A three-frame rolling buffer. Each emitted window is tagged with the media
 * timestamp of all three input frames so an offscreen consumer can preserve
 * video-time ordering without waiting for the page or controlling playback.
 */
export class TemporalWindowBuffer {
  constructor(size = 3) {
    if (!Number.isInteger(size) || size < 1) throw new TypeError('size must be a positive integer');
    this.size = size;
    this.frames = [];
  }

  push(frame, mediaTime) {
    if (!Number.isFinite(mediaTime)) throw new TypeError('mediaTime must be finite');
    this.frames.push({ frame, mediaTime });
    if (this.frames.length > this.size) this.frames.shift();
    if (this.frames.length < this.size) return null;
    const window = this.frames.slice();
    return {
      frames: window.map((entry) => entry.frame),
      mediaTimes: window.map((entry) => entry.mediaTime),
      targetMediaTime: window[window.length - 1].mediaTime,
      centerMediaTime: window[Math.floor(window.length / 2)].mediaTime,
      initialFrameDelay: this.size - 1,
    };
  }

  reset() { this.frames = []; }
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
